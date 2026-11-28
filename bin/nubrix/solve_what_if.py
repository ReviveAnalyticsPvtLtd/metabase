"""Solver-backed Counterfactual, Scenario Lab, and Order Override Runner.

Executes isolated OR-Tools CP-SAT re-solves over a copied immutable snapshot
without mutating active Railway tables or the active run pointer.
"""

import argparse
from collections import Counter
from datetime import datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

from adapters import RailwayWarehouseAdapter
from fulfillment_planner import InvariantValidationError, OrToolsFulfillmentPlanner
from poc_storage import PocStorageManager


def _load_snapshot(args: argparse.Namespace) -> Tuple[Dict[str, Any], Optional[str]]:
    if args.snapshot_file:
        with open(args.snapshot_file, "r", encoding="utf-8") as f:
            raw = f.read()
        snap = json.loads(raw)
        snap_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        return snap, snap_hash

    host = os.environ.get("RAILWAY_HOST", "switchyard.proxy.rlwy.net")
    port = int(os.environ.get("RAILWAY_PORT", "32007"))
    user = os.environ.get("RAILWAY_USER", "root")
    password = os.environ.get("RAILWAY_PASSWORD", "")
    database = os.environ.get("RAILWAY_DATABASE", "railway")
    if not password:
        raise RuntimeError("Missing RAILWAY_PASSWORD environment variable.")

    if args.run_id:
        storage = PocStorageManager({
            "host": host,
            "port": port,
            "user": user,
            "password": password,
            "database": database,
        })
        return storage.load_snapshot_by_run_id(args.run_id)

    cache_path = Path(args.cache_file) if args.cache_file else None
    if cache_path and cache_path.exists():
        age_sec = time.time() - cache_path.stat().st_mtime
        if age_sec <= 300:
            raw = cache_path.read_text(encoding="utf-8")
            return json.loads(raw), hashlib.sha256(raw.encode("utf-8")).hexdigest()

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
    snap["directed_lanes"] = True
    snap["provenance"]["total_open_orders"] = total_open
    snap["provenance"]["planning_horizon_orders"] = len(snap["orders"])
    snap["provenance"]["horizon_truncated"] = len(snap["orders"]) < total_open

    raw = json.dumps(snap, sort_keys=True, separators=(",", ":"))
    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(raw, encoding="utf-8")
    return snap, hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _copy_mutable_snapshot(snap: Dict[str, Any]) -> Dict[str, Any]:
    """Copy only mutable collections (orders/stock/carriers) while sharing immutable legs/customers."""
    out = dict(snap)
    out["orders"] = [dict(o) for o in snap.get("orders", [])]
    out["stock"] = [dict(s) for s in snap.get("stock", [])]
    out["carriers"] = {k: dict(v) for k, v in snap.get("carriers", {}).items()}
    return out


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


def _role_breakdown(res: Dict[str, Any], customers: Dict[str, Any]) -> Dict[str, Dict[str, int]]:
    counts: Dict[str, Dict[str, int]] = {
        "Maintenance Facility": {"orders": 0, "kegs": 0},
        "Distributor": {"orders": 0, "kegs": 0},
        "Brewer": {"orders": 0, "kegs": 0},
    }
    for o in res["outcomes"]:
        if o.allocated_units > 0 and o.source_customer_id:
            role = customers.get(o.source_customer_id, {}).get("type", "Unknown")
            if role not in counts:
                counts[role] = {"orders": 0, "kegs": 0}
            counts[role]["orders"] += 1
            counts[role]["kegs"] += int(o.allocated_units)
    return counts


def _solve_forced_order(
    base_snap: Dict[str, Any],
    snap_hash: Optional[str],
    run_id: Optional[str],
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
    base_res = base_planner.plan(_copy_mutable_snapshot(base_snap))

    target_order = next((o for o in base_snap["orders"] if o["id"] == order_id), None)
    if not target_order:
        return {"ok": False, "feasible": False, "error": f"Order {order_id} is outside the current planning horizon."}

    cust = base_snap["customers"].get(target_source_id)
    if not cust:
        return {"ok": False, "feasible": False, "error": f"Source {target_source_id} not found in snapshot."}
    if base_policy == "depot_first" and cust.get("type") not in ("Maintenance Facility", "Distributor"):
        return {
            "ok": False,
            "feasible": False,
            "error": f"Source {cust.get('name', target_source_id)} ({cust.get('type')}) is excluded by the active Depot-First policy.",
        }

    car_obj = next((c for c in base_snap["carriers"].values() if c["name"] == target_carrier), None)
    if not car_obj:
        return {"ok": False, "feasible": False, "error": f"Carrier {target_carrier} not found."}

    # Check directed lane only (never fabricate reverse lane)
    dest_id = target_order["customer_id"]
    directed = bool(base_snap.get("directed_lanes", True))
    km = None
    for leg in base_snap.get("legs", []):
        if leg["origin"] == target_source_id and leg["destination"] == dest_id:
            km = int(leg["km"])
            break
        if not directed and leg["origin"] == dest_id and leg["destination"] == target_source_id:
            km = int(leg["km"])
            break
    if km is None:
        return {"ok": False, "feasible": False, "error": f"No verified directed distance lane from {target_source_id} to {dest_id}."}

    # Force candidate inside the complete CP-SAT model
    forced_snap = _copy_mutable_snapshot(base_snap)
    forced_snap["forced_assignment"] = {
        order_id: {
            "source_customer_id": target_source_id,
            "carrier": target_carrier,
            "quantity": target_qty,
        }
    }
    forced_planner = OrToolsFulfillmentPlanner(
        time_limit_seconds=time_limit,
        max_candidates_per_order=12,
        source_policy=base_policy,
    )
    try:
        alt_res = forced_planner.plan(forced_snap)
    except InvariantValidationError as exc:
        return {"ok": False, "feasible": False, "error": str(exc)}

    alt_focus = next((o for o in alt_res["outcomes"] if o.order_id == order_id), None)
    base_focus = next((o for o in base_res["outcomes"] if o.order_id == order_id), None)
    if not alt_focus or alt_focus.allocated_units <= 0 or alt_focus.source_customer_id != target_source_id:
        return {"ok": False, "feasible": False, "error": "Forced assignment could not be satisfied under full model constraints."}

    affected = _diff_outcomes(base_res, alt_res, focus_order_id=order_id)
    return {
        "ok": True,
        "feasible": True,
        "is_solver_reoptimization": True,
        "active_plan_unchanged": True,
        "run_id": run_id,
        "snapshot_hash": snap_hash,
        "solver_status": alt_res["solver_status"],
        "source_policy": base_policy,
        "order_id": order_id,
        "target_source_id": target_source_id,
        "target_source_name": cust.get("name", target_source_id),
        "target_carrier": target_carrier,
        "forced_qty": alt_focus.allocated_units,
        "focus_baseline_qty": base_focus.allocated_units if base_focus else 0,
        "focus_baseline_freight_inr": round(base_focus.freight_cost_inr, 2) if base_focus else 0.0,
        "focus_scenario_freight_inr": round(alt_focus.freight_cost_inr, 2),
        "baseline_kegs": base_res["total_allocated_kegs"],
        "scenario_kegs": alt_res["total_allocated_kegs"],
        "kegs_delta": alt_res["total_allocated_kegs"] - base_res["total_allocated_kegs"],
        "baseline_uncovered": base_res["uncovered"],
        "scenario_uncovered": alt_res["uncovered"],
        "uncovered_delta": alt_res["uncovered"] - base_res["uncovered"],
        "baseline_freight_inr": round(base_res["total_freight_cost_inr"], 2),
        "scenario_freight_inr": round(alt_res["total_freight_cost_inr"], 2),
        "freight_delta_inr": round(alt_res["total_freight_cost_inr"] - base_res["total_freight_cost_inr"], 2),
        "affected_orders": affected[:25],
        "affected_orders_total": len(affected),
    }


def _solve_scenario(
    base_snap: Dict[str, Any],
    snap_hash: Optional[str],
    run_id: Optional[str],
    base_policy: str,
    args: argparse.Namespace,
) -> Dict[str, Any]:
    base_planner = OrToolsFulfillmentPlanner(
        time_limit_seconds=args.time_limit,
        max_candidates_per_order=12,
        source_policy=base_policy,
    )
    base_res = base_planner.plan(_copy_mutable_snapshot(base_snap))

    scen_snap = _copy_mutable_snapshot(base_snap)
    scen_policy = base_policy
    title = ""
    assumptions = [
        f"Baseline and scenario use identical {len(base_snap['orders'])}-order immutable snapshot (hash: {(snap_hash or 'local')[:12]}).",
    ]

    if args.scenario_type == "carrier_outage":
        disabled = args.disabled_carrier or "EastWest Transport"
        scen_snap["carriers"] = {
            k: v for k, v in scen_snap["carriers"].items() if v.get("name") != disabled
        }
        title = f"Carrier Outage ({disabled} unavailable)"
        assumptions.append(f"Removed carrier '{disabled}' from copied snapshot and re-solved with remaining {len(scen_snap['carriers'])} carriers.")
    elif args.scenario_type == "stock_shock":
        pct = max(0.1, min(1.5, float(args.stock_pct if args.stock_pct is not None else 0.8)))
        for s in scen_snap["stock"]:
            s["available"] = max(0, int(round(int(s["available"]) * pct)))
        title = f"Source Inventory Change ({round(pct * 100)}% available stock)"
        assumptions.append(f"Scaled source inventory in copied snapshot to {round(pct * 100)}% before re-solving.")
    elif args.scenario_type == "strict_depot_only":
        scen_policy = "depot_first"
        title = "Strict Depot-Only Comparison (Maintenance & Distributors only)"
        assumptions.append("Restricted source eligibility to Maintenance Facilities and Distributors on identical snapshot.")
    elif args.scenario_type == "service_first_fallback":
        scen_policy = "service_first_fallback"
        title = "Service-First Tiered Fallback (Facility > Distributor > Brewer)"
        assumptions.append("Enabled all three source roles under staged service-first objective on identical snapshot.")
    elif args.scenario_type == "unrestricted_benchmark":
        scen_policy = "unrestricted_nearest"
        title = "Unrestricted Nearest-Source Benchmark"
        assumptions.append("Removed role hierarchy on identical snapshot to benchmark pure distance/freight.")
    elif args.scenario_type == "deadline_shift":
        delta_days = int(args.deadline_days_delta if args.deadline_days_delta is not None else -2)
        for o in scen_snap["orders"]:
            nb = datetime.strptime(o["needed_by_date"][:10], "%Y-%m-%d").date()
            o["needed_by_date"] = str(nb + timedelta(days=delta_days))
        title = f"Due-Date Shift ({delta_days:+d} days)"
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
    customers = base_snap.get("customers", {})

    return {
        "ok": True,
        "is_solver_reoptimization": True,
        "active_plan_unchanged": True,
        "run_id": run_id,
        "snapshot_hash": snap_hash,
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
        "baseline_role_distribution": _role_breakdown(base_res, customers),
        "scenario_role_distribution": _role_breakdown(scen_res, customers),
        "affected_orders": affected[:25],
        "affected_orders_total": len(affected),
        "assumptions": assumptions,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["counterfactual", "scenario", "override"])
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--horizon", type=int, default=1000)
    parser.add_argument("--time-limit", type=int, default=12)
    parser.add_argument("--source-policy", default="service_first_fallback")
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

    try:
        snap, snap_hash = _load_snapshot(args)
        if args.mode in ("counterfactual", "override"):
            out = _solve_forced_order(
                snap,
                snap_hash,
                args.run_id,
                args.source_policy,
                args.order_id,
                args.source_customer_id,
                args.carrier,
                args.quantity,
                args.time_limit,
            )
        else:
            out = _solve_scenario(snap, snap_hash, args.run_id, args.source_policy, args)
    except Exception as exc:
        out = {"ok": False, "feasible": False, "error": str(exc)}
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
