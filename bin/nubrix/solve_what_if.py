"""Solver-backed Counterfactual, Scenario Lab, and Order Override Runner.

Executes isolated OR-Tools CP-SAT re-solves over a copied immutable snapshot
without mutating active Railway tables or the active run pointer.
"""

import argparse
from copy import deepcopy
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import sys
import time
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from adapters import RailwayWarehouseAdapter
from fulfillment_planner import OrToolsFulfillmentPlanner


def _load_snapshot(args: argparse.Namespace) -> Dict[str, Any]:
    if args.snapshot_file:
        with open(args.snapshot_file, "r", encoding="utf-8") as f:
            snap = json.load(f)
        return snap

    cache_path = Path(args.cache_file) if args.cache_file else None
    if cache_path and cache_path.exists():
        age_sec = time.time() - cache_path.stat().st_mtime
        if age_sec <= 300:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)

    host = os.environ.get("RAILWAY_HOST", "switchyard.proxy.rlwy.net")
    port = int(os.environ.get("RAILWAY_PORT", "32007"))
    user = os.environ.get("RAILWAY_USER", "root")
    password = os.environ.get("RAILWAY_PASSWORD", "")
    database = os.environ.get("RAILWAY_DATABASE", "railway")
    if not password:
        raise RuntimeError("Missing RAILWAY_PASSWORD environment variable.")

    adapter = RailwayWarehouseAdapter({
        "host": host,
        "port": port,
        "user": user,
        "password": password,
        "database": database,
    })
    res = adapter.load_snapshot()
    snap = res.snapshot
    total_open = len(snap["orders"])
    snap["orders"] = snap["orders"][: args.horizon]
    snap["provenance"]["total_open_orders"] = total_open
    snap["provenance"]["planning_horizon_orders"] = len(snap["orders"])
    snap["provenance"]["horizon_truncated"] = len(snap["orders"]) < total_open

    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(snap), encoding="utf-8")
    return snap


def _diff_outcomes(base_res: Dict[str, Any], alt_res: Dict[str, Any], focus_order_id: Optional[str] = None) -> List[Dict[str, Any]]:
    base_map = {o.order_id: o for o in base_res["outcomes"]}
    affected = []
    for o in alt_res["outcomes"]:
        b = base_map.get(o.order_id)
        if not b:
            continue
        if (
            b.allocated_units != o.allocated_units
            or b.source_customer_id != o.source_customer_id
            or b.carrier != o.carrier
            or abs(b.freight_cost_inr - o.freight_cost_inr) > 0.01
        ):
            affected.append({
                "order_id": o.order_id,
                "destination_brewer": o.destination_brewer,
                "is_focus_order": o.order_id == focus_order_id,
                "baseline_allocated_kegs": b.allocated_units,
                "scenario_allocated_kegs": o.allocated_units,
                "allocated_delta_kegs": o.allocated_units - b.allocated_units,
                "baseline_source_id": b.source_customer_id,
                "baseline_source_name": b.source_hub,
                "scenario_source_id": o.source_customer_id,
                "scenario_source_name": o.source_hub,
                "baseline_freight_inr": round(b.freight_cost_inr, 2),
                "scenario_freight_inr": round(o.freight_cost_inr, 2),
                "freight_delta_inr": round(o.freight_cost_inr - b.freight_cost_inr, 2),
            })
    affected.sort(key=lambda r: (0 if r["is_focus_order"] else 1, -abs(r["allocated_delta_kegs"]), r["order_id"]))
    return affected


def _solve_forced_order(
    base_snap: Dict[str, Any],
    base_policy: str,
    order_id: str,
    target_source_id: str,
    target_carrier: str,
    target_qty: Optional[int],
    time_limit: int,
) -> Dict[str, Any]:
    base_planner = OrToolsFulfillmentPlanner(
        time_limit_seconds=time_limit,
        max_candidates_per_order=12,
        source_policy=base_policy,
    )
    base_res = base_planner.plan(deepcopy(base_snap))

    # Validate target order exists in horizon
    target_order = next((o for o in base_snap["orders"] if o["id"] == order_id), None)
    if not target_order:
        return {"ok": False, "error": f"Order {order_id} is outside the current planning horizon."}

    # Check policy eligibility for target source
    cust = base_snap["customers"].get(target_source_id)
    if not cust:
        return {"ok": False, "error": f"Source {target_source_id} not found in snapshot."}
    if base_policy == "depot_first" and cust.get("type") not in ("Maintenance Facility", "Distributor"):
        return {
            "ok": False,
            "error": f"Source {cust.get('name', target_source_id)} ({cust.get('type')}) is excluded by the active Depot-First policy.",
        }

    # Verify stock and force allocation on copied snapshot by reserving stock for this forced order first
    forced_snap = deepcopy(base_snap)
    avail = 0
    for s in forced_snap["stock"]:
        if s["source"] == target_source_id and s["sku"] == target_order["sku"]:
            avail = int(s["available"])
            break
    if avail <= 0:
        return {"ok": False, "error": f"Source {target_source_id} has 0 available {target_order['sku']} kegs."}

    car_obj = next((c for c in forced_snap["carriers"].values() if c["name"] == target_carrier), None)
    if not car_obj:
        return {"ok": False, "error": f"Carrier {target_carrier} not found."}

    # Check distance lane
    dest_id = target_order["customer_id"]
    km = None
    for leg in forced_snap.get("legs", []):
        if (leg["origin"] == target_source_id and leg["destination"] == dest_id) or (
            leg["origin"] == dest_id and leg["destination"] == target_source_id
        ):
            km = int(leg["km"])
            break
    if km is None:
        return {"ok": False, "error": f"No verified distance lane between {target_source_id} and {dest_id}."}

    req_qty = int(target_qty) if target_qty is not None else int(target_order["pending"])
    forced_qty = min(req_qty, int(target_order["pending"]), avail, int(car_obj["max_load"]))
    if forced_qty <= 0:
        return {"ok": False, "error": "Forced quantity resolves to 0 after capacity/stock bounds."}

    # Deduct forced_qty from target source stock and reduce target_order pending before re-solving remaining network
    for s in forced_snap["stock"]:
        if s["source"] == target_source_id and s["sku"] == target_order["sku"]:
            s["available"] = max(0, int(s["available"]) - forced_qty)
    forced_snap["orders"] = [o for o in forced_snap["orders"] if o["id"] != order_id]

    rem_planner = OrToolsFulfillmentPlanner(
        time_limit_seconds=time_limit,
        max_candidates_per_order=12,
        source_policy=base_policy,
    )
    rem_res = rem_planner.plan(forced_snap)

    forced_freight = round(forced_qty * km * float(car_obj["rate_inr"]), 2)
    base_focus = next(o for o in base_res["outcomes"] if o.order_id == order_id)

    base_total_kegs = base_res["total_allocated_kegs"]
    forced_total_kegs = rem_res["total_allocated_kegs"] + forced_qty
    base_total_freight = round(base_res["total_freight_cost_inr"], 2)
    forced_total_freight = round(rem_res["total_freight_cost_inr"] + forced_freight, 2)
    base_uncovered = base_res["uncovered"]
    forced_uncovered = rem_res["uncovered"] + (0 if forced_qty >= target_order["pending"] else 0)

    affected = _diff_outcomes(base_res, rem_res, focus_order_id=order_id)
    if (
        base_focus.allocated_units != forced_qty
        or base_focus.source_customer_id != target_source_id
        or base_focus.carrier != target_carrier
    ):
        affected.insert(0, {
            "order_id": order_id,
            "destination_brewer": base_focus.destination_brewer,
            "is_focus_order": True,
            "baseline_allocated_kegs": base_focus.allocated_units,
            "scenario_allocated_kegs": forced_qty,
            "allocated_delta_kegs": forced_qty - base_focus.allocated_units,
            "baseline_source_id": base_focus.source_customer_id,
            "baseline_source_name": base_focus.source_hub,
            "scenario_source_id": target_source_id,
            "scenario_source_name": cust.get("name", target_source_id),
            "baseline_freight_inr": round(base_focus.freight_cost_inr, 2),
            "scenario_freight_inr": forced_freight,
            "freight_delta_inr": round(forced_freight - base_focus.freight_cost_inr, 2),
        })

    return {
        "ok": True,
        "is_solver_reoptimization": True,
        "solver_status": rem_res["solver_status"],
        "source_policy": base_policy,
        "order_id": order_id,
        "target_source_id": target_source_id,
        "target_source_name": cust.get("name", target_source_id),
        "target_carrier": target_carrier,
        "forced_qty": forced_qty,
        "baseline_kegs": base_total_kegs,
        "scenario_kegs": forced_total_kegs,
        "kegs_delta": forced_total_kegs - base_total_kegs,
        "baseline_uncovered": base_uncovered,
        "scenario_uncovered": forced_uncovered,
        "uncovered_delta": forced_uncovered - base_uncovered,
        "baseline_freight_inr": base_total_freight,
        "scenario_freight_inr": forced_total_freight,
        "freight_delta_inr": round(forced_total_freight - base_total_freight, 2),
        "affected_orders": affected[:25],
        "affected_orders_total": len(affected),
    }


def _solve_scenario(base_snap: Dict[str, Any], base_policy: str, args: argparse.Namespace) -> Dict[str, Any]:
    base_planner = OrToolsFulfillmentPlanner(
        time_limit_seconds=args.time_limit,
        max_candidates_per_order=12,
        source_policy=base_policy,
    )
    base_res = base_planner.plan(deepcopy(base_snap))

    scen_snap = deepcopy(base_snap)
    scen_policy = base_policy
    title = ""
    assumptions = [f"Baseline and scenario use identical {len(base_snap['orders'])}-order horizon, lanes, and CP-SAT objective."]

    if args.scenario_type == "carrier_outage":
        disabled = args.disabled_carrier or "EastWest Transport"
        scen_snap["carriers"] = {
            k: v for k, v in scen_snap["carriers"].items() if v.get("name") != disabled
        }
        title = f"Solver Re-Run: Carrier Outage ({disabled} removed)"
        assumptions.append(f"Removed carrier '{disabled}' from copied snapshot and re-solved with remaining {len(scen_snap['carriers'])} carriers.")
    elif args.scenario_type == "stock_shock":
        pct = max(0.1, min(1.5, float(args.stock_pct if args.stock_pct is not None else 0.8)))
        for s in scen_snap["stock"]:
            s["available"] = max(0, int(round(int(s["available"]) * pct)))
        title = f"Solver Re-Run: Inventory Shock ({round(pct * 100)}% stock)"
        assumptions.append(f"Scaled source inventory in copied snapshot to {round(pct * 100)}% before re-solving.")
    elif args.scenario_type == "unrestricted_benchmark":
        scen_policy = "unrestricted_nearest"
        title = "Solver Re-Run: Unrestricted Peer-Brewer Benchmark"
        assumptions.append("Switched source eligibility on identical snapshot from depot_first to unrestricted_nearest.")
    elif args.scenario_type == "deadline_shift":
        delta_days = int(args.deadline_days_delta if args.deadline_days_delta is not None else -2)
        for o in scen_snap["orders"]:
            nb = datetime.strptime(o["needed_by_date"][:10], "%Y-%m-%d").date()
            o["needed_by_date"] = str(nb + timedelta(days=delta_days))
        title = f"Solver Re-Run: Deadline Shift ({delta_days:+d} days)"
        assumptions.append(f"Shifted all NeededByDate values by {delta_days:+d} days in copied snapshot before re-solving.")
    else:
        return {"ok": False, "error": f"Unsupported scenario_type: {args.scenario_type}"}

    scen_planner = OrToolsFulfillmentPlanner(
        time_limit_seconds=args.time_limit,
        max_candidates_per_order=12,
        source_policy=scen_policy,
    )
    scen_res = scen_planner.plan(scen_snap)
    affected = _diff_outcomes(base_res, scen_res)

    return {
        "ok": True,
        "is_solver_reoptimization": True,
        "scenario_type": args.scenario_type,
        "title": title,
        "solver_status": scen_res["solver_status"],
        "baseline_policy": base_policy,
        "scenario_policy": scen_policy,
        "baseline_kegs": base_res["total_allocated_kegs"],
        "scenario_kegs": scen_res["total_allocated_kegs"],
        "kegs_delta": scen_res["total_allocated_kegs"] - base_res["total_allocated_kegs"],
        "baseline_uncovered": base_res["uncovered"],
        "scenario_uncovered": scen_res["uncovered"],
        "uncovered_delta": scen_res["uncovered"] - base_res["uncovered"],
        "baseline_freight_inr": round(base_res["total_freight_cost_inr"], 2),
        "scenario_freight_inr": round(scen_res["total_freight_cost_inr"], 2),
        "freight_delta_inr": round(scen_res["total_freight_cost_inr"] - base_res["total_freight_cost_inr"], 2),
        "affected_orders": affected[:25],
        "affected_orders_total": len(affected),
        "assumptions": assumptions,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["counterfactual", "scenario", "override"])
    parser.add_argument("--horizon", type=int, default=1000)
    parser.add_argument("--time-limit", type=int, default=8)
    parser.add_argument("--source-policy", default="depot_first")
    parser.add_argument("--snapshot-file", default=None)
    parser.add_argument("--cache-file", default="/tmp/nubrix_snapshot_cache.json")
    parser.add_argument("--order-id", default=None)
    parser.add_argument("--source-customer-id", default=None)
    parser.add_argument("--carrier", default=None)
    parser.add_argument("--quantity", type=int, default=None)
    parser.add_argument("--scenario-type", default=None)
    parser.add_argument("--disabled-carrier", default=None)
    parser.add_argument("--stock-pct", type=float, default=None)
    parser.add_argument("--deadline-days-delta", type=int, default=None)
    args = parser.parse_args()

    snap = _load_snapshot(args)
    if args.mode in ("counterfactual", "override"):
        out = _solve_forced_order(
            snap,
            args.source_policy,
            args.order_id,
            args.source_customer_id,
            args.carrier,
            args.quantity,
            args.time_limit,
        )
    else:
        out = _solve_scenario(snap, args.source_policy, args)
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
