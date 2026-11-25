"""Isolated What-If Scenario Simulator for MicroStar Keg Fulfillment.

Supports Phase 4 scenario testing without mutating source tables or active runs:
- carrier_unavailable
- source_stock_reduced
- changed_needed_by_date
- no_distributor_capacity
- split_policy_toggle
"""

import copy
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from fulfillment_planner import OrToolsFulfillmentPlanner


@dataclass
class WhatIfResult:
    scenario_name: str
    baseline_allocated_kegs: int
    scenario_allocated_kegs: int
    allocated_delta_kegs: int
    baseline_uncovered_orders: int
    scenario_uncovered_orders: int
    uncovered_delta_orders: int
    baseline_freight_inr: float
    scenario_freight_inr: float
    freight_delta_inr: float
    solver_status: str
    outcomes: List[Dict[str, Any]]
    is_simulation: bool = True


def _field(obj: Any, name: str, default: Any = 0) -> Any:
    return obj.get(name, default) if isinstance(obj, dict) else getattr(obj, name, default)


def _summarize(result: Dict[str, Any]) -> Dict[str, Any]:
    outcomes = result.get("outcomes", [])
    return {
        "allocated_kegs": sum(int(_field(o, "allocated_units", 0)) for o in outcomes),
        "uncovered_orders": sum(1 for o in outcomes if _field(o, "planning_status", "") == "No allocation"),
        "freight_inr": round(sum(float(_field(o, "freight_cost_inr", 0.0)) for o in outcomes), 2),
    }


def run_what_if_scenario(
    *,
    scenario_name: str,
    snapshot: Dict[str, Any],
    disabled_carriers: Optional[List[str]] = None,
    stock_multiplier: Optional[Dict[str, float]] = None,
    needed_by_shift_days: Optional[Dict[str, int]] = None,
    time_limit_seconds: int = 5,
) -> WhatIfResult:
    """Run an isolated baseline vs. what-if comparison without mutating caller snapshot."""
    planner = OrToolsFulfillmentPlanner(time_limit_seconds=time_limit_seconds)
    base_res = planner.plan(copy.deepcopy(snapshot))
    base_sum = _summarize(base_res)

    scen_snapshot = copy.deepcopy(snapshot)

    if disabled_carriers:
        disabled = {c.lower() for c in disabled_carriers}
        carriers = scen_snapshot.get("carriers", {})
        if isinstance(carriers, dict):
            scen_snapshot["carriers"] = {
                k: v for k, v in carriers.items()
                if k.lower() not in disabled and str(v.get("name", "")).lower() not in disabled
            }

    if stock_multiplier:
        for inv in scen_snapshot.get("stock", []):
            src = inv.get("source")
            if src in stock_multiplier:
                inv["available"] = max(0, int(int(inv.get("available", 0)) * stock_multiplier[src]))

    if needed_by_shift_days:
        for o in scen_snapshot.get("orders", []):
            oid = o.get("id")
            if oid in needed_by_shift_days and o.get("needed_by_date"):
                nb = o["needed_by_date"]
                if isinstance(nb, str):
                    nb_date = date.fromisoformat(nb[:10])
                    o["needed_by_date"] = (nb_date + timedelta(days=needed_by_shift_days[oid])).isoformat()
                elif isinstance(nb, date):
                    o["needed_by_date"] = nb + timedelta(days=needed_by_shift_days[oid])

    if scenario_name == "no_distributor_capacity":
        scen_snapshot["distributor_mode"] = "physical_stop"
        customers = scen_snapshot.get("customers", {})
        scen_snapshot["stock"] = [
            inv for inv in scen_snapshot.get("stock", [])
            if customers.get(inv.get("source", ""), {}).get("type") != "Distributor"
        ]

    if scenario_name == "split_policy_toggle":
        scen_snapshot["allow_split"] = not bool(scen_snapshot.get("allow_split", True))

    scen_res = planner.plan(scen_snapshot)
    scen_sum = _summarize(scen_res)

    return WhatIfResult(
        scenario_name=scenario_name,
        baseline_allocated_kegs=base_sum["allocated_kegs"],
        scenario_allocated_kegs=scen_sum["allocated_kegs"],
        allocated_delta_kegs=scen_sum["allocated_kegs"] - base_sum["allocated_kegs"],
        baseline_uncovered_orders=base_sum["uncovered_orders"],
        scenario_uncovered_orders=scen_sum["uncovered_orders"],
        uncovered_delta_orders=scen_sum["uncovered_orders"] - base_sum["uncovered_orders"],
        baseline_freight_inr=base_sum["freight_inr"],
        scenario_freight_inr=scen_sum["freight_inr"],
        freight_delta_inr=round(scen_sum["freight_inr"] - base_sum["freight_inr"], 2),
        solver_status=scen_res.get("solver_status", "UNKNOWN"),
        outcomes=scen_res.get("outcomes", []),
    )
