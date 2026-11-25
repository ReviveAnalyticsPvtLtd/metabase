"""End-to-End Snapshot Publication & Optimization Benchmark Pipeline.

1. Extracts live data from Railway MySQL via RailwayWarehouseAdapter.
2. Runs OrToolsFulfillmentPlanner (CP-SAT) and NearestSourceBaselinePlanner.
3. Validates all post-solve invariants (order/stock conservation).
4. Atomically publishes versioned run to nubrix_poc_* tables via PocStorageManager.
5. Demonstrates GroundedAssistant explanation on a real published order.
"""

import argparse
from datetime import date, datetime, timezone
import json
import os
import sys
import time
from typing import Any, Dict
import uuid

from adapters import RailwayWarehouseAdapter
from fulfillment_planner import NearestSourceBaselinePlanner, OrToolsFulfillmentPlanner
from grounded_ai import GroundedAssistant
from poc_storage import PocStorageManager


def get_railway_params() -> Dict[str, Any]:
    host = os.environ.get("RAILWAY_HOST")
    port = os.environ.get("RAILWAY_PORT")
    user = os.environ.get("RAILWAY_USER")
    password = os.environ.get("RAILWAY_PASSWORD")
    database = os.environ.get("RAILWAY_DATABASE", "railway")
    missing = [k for k, v in [("RAILWAY_HOST", host), ("RAILWAY_PORT", port), ("RAILWAY_USER", user), ("RAILWAY_PASSWORD", password)] if not v]
    if missing:
        raise RuntimeError(f"Missing required Railway environment variables: {', '.join(missing)}")
    return {
        "host": host,
        "port": int(port),
        "user": user,
        "password": password,
        "database": database,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="MicroStar Snapshot Extraction & Optimization Pipeline")
    parser.add_argument("--horizon", type=int, default=1000, help="Earliest-due open orders horizon (default: 1000)")
    parser.add_argument("--time-limit", type=int, default=15, help="CP-SAT solver time limit in seconds (default: 15)")
    parser.add_argument("--publish", action="store_true", help="Actually write run to Railway nubrix_poc_* tables (default: dry-run)")
    args = parser.parse_args()

    print("=== MicroStar End-to-End Snapshot Publication Pipeline ===")
    if not args.publish:
        print("MODE: DRY-RUN (read-only extraction & optimization; pass --publish to write nubrix_poc_* tables)")
    t0 = time.time()
    railway_params = get_railway_params()

    # 1. Extract live snapshot
    print("\n[1/5] Extracting live snapshot from Railway MySQL (read-only)...")
    adapter = RailwayWarehouseAdapter(railway_params)
    adapter_result = adapter.load_snapshot()
    snapshot = adapter_result.snapshot
    total_open_orders = len(snapshot["orders"])
    # Scope planning horizon to earliest-due open orders for fast, bounded CP-SAT execution
    snapshot["orders"] = snapshot["orders"][:args.horizon]
    snapshot["provenance"]["total_open_orders"] = total_open_orders
    snapshot["provenance"]["planning_horizon_orders"] = len(snapshot["orders"])
    snapshot["provenance"]["horizon_truncated"] = len(snapshot["orders"]) < total_open_orders
    print(
        f"Snapshot loaded in {time.time() - t0:.2f}s (adapter_status={adapter_result.status}): "
        f"{total_open_orders} total open orders (planning horizon: {len(snapshot['orders'])} earliest-due), "
        f"{len(snapshot['stock'])} stock records, "
        f"{len(snapshot['customers'])} facilities, "
        f"{len(snapshot['carriers'])} carriers."
    )

    # 2. Run Nearest-Source Baseline (identical constraints, denominators & cost basis)
    print("\n[2/5] Running NearestSourceBaselinePlanner...")
    t_base = time.time()
    baseline_planner = NearestSourceBaselinePlanner()
    baseline_result = baseline_planner.plan(snapshot)
    base_time = time.time() - t_base
    base_on_time_kegs = baseline_result["total_on_time_kegs"]
    base_cost_per_keg = (baseline_result["total_freight_cost_inr"] / base_on_time_kegs) if base_on_time_kegs else 0.0
    print(
        f"Baseline ({base_time:.2f}s): "
        f"Pending={baseline_result['total_pending_kegs']} kegs | "
        f"On-time kegs={base_on_time_kegs} | "
        f"Full={baseline_result['fully_covered']}, Partial={baseline_result['partially_covered']}, Uncovered={baseline_result['uncovered']} | "
        f"Freight=INR {baseline_result['total_freight_cost_inr']:,.2f} (INR {base_cost_per_keg:,.2f}/on-time keg)"
    )

    # 3. Run OR-Tools CP-SAT Planner
    print("\n[3/5] Running OrToolsFulfillmentPlanner (CP-SAT)...")
    t_opt = time.time()
    ortools_planner = OrToolsFulfillmentPlanner(time_limit_seconds=args.time_limit, max_candidates_per_order=5)
    ortools_result = ortools_planner.plan(snapshot)
    opt_time = time.time() - t_opt
    opt_on_time_kegs = ortools_result["total_on_time_kegs"]
    opt_cost_per_keg = (ortools_result["total_freight_cost_inr"] / opt_on_time_kegs) if opt_on_time_kegs else 0.0
    print(
        f"OR-Tools [{ortools_result['solver_status']}] ({opt_time:.2f}s): "
        f"Pending={ortools_result['total_pending_kegs']} kegs | "
        f"On-time kegs={opt_on_time_kegs} | "
        f"Full={ortools_result['fully_covered']}, Partial={ortools_result['partially_covered']}, Uncovered={ortools_result['uncovered']} | "
        f"Freight=INR {ortools_result['total_freight_cost_inr']:,.2f} (INR {opt_cost_per_keg:,.2f}/on-time keg)"
    )
    print(
        f"Limitations & Disclosures: vehicle_mode={ortools_result['vehicle_mode']}, "
        f"horizon={len(snapshot['orders'])}/{total_open_orders}, max_candidates_per_order=5, "
        f"time_limit={args.time_limit}s. Railway schema has no Truck or InventoryReservation table."
    )

    # 4. Prepare allocations & evidence for PocStorageManager
    run_id = f"RUN-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"
    allocations = []
    evidence_list = []

    for idx, outcome in enumerate(ortools_result["outcomes"]):
        alloc_id = f"{run_id}-A{idx+1:05d}"
        allocations.append({
            "allocation_id": alloc_id,
            "order_id": outcome.order_id,
            "destination_customer_id": outcome.destination_customer_id,
            "destination_brewer": outcome.destination_brewer,
            "region": outcome.region,
            "customer_type": outcome.customer_type,
            "keg_size": outcome.keg_size,
            "ordered_date": outcome.ordered_date,
            "needed_by": outcome.needed_by,
            "ordered_units": outcome.ordered_units,
            "fulfilled_units": outcome.fulfilled_units,
            "pending_units": outcome.pending_units,
            "allocated_units": outcome.allocated_units,
            "proposed_on_time_units": outcome.proposed_on_time_units,
            "uncovered_units": outcome.uncovered_units,
            "source_hub": outcome.source_hub,
            "source_customer_id": outcome.source_customer_id,
            "distributor": outcome.distributor,
            "distributor_customer_id": outcome.distributor_customer_id,
            "carrier": outcome.carrier,
            "distance_km": outcome.distance_km,
            "freight_cost_inr": outcome.freight_cost_inr,
            "transit_days": outcome.transit_days,
            "on_time_feasible": outcome.on_time_feasible,
            "planning_status": outcome.planning_status,
            "explanation": outcome.explanation,
            "planning_basis": f"OR-Tools CP-SAT ({ortools_result['solver_status']})",
        })

        missing_lane_seen = False
        for ev_idx, ev in enumerate(outcome.evidence):
            reason = ev.get("reason")
            if reason == "missing_lane":
                if missing_lane_seen:
                    continue
                missing_lane_seen = True
            if "candidate_id" in ev or reason in ("overdue", "no_stock_for_sku", "missing_lane"):
                is_sel = bool(
                    "candidate_id" in ev
                    and outcome.allocated_units > 0
                    and ev.get("source") == outcome.source_hub
                    and ev.get("carrier") == outcome.carrier
                )
                rej_reason = reason
                if not rej_reason and ev.get("is_feasible") is False:
                    rej_reason = f"Transit ({ev.get('transit_days')}d) exceeds slack ({ev.get('slack_days')}d)"
                elif not rej_reason and outcome.allocated_units == 0 and "candidate_id" in ev:
                    rej_reason = "Source exhausted by higher-priority orders"
                cand_route_id = int(ev.get("candidate_id", ev_idx + 1))
                src_cid = str(ev.get("source", outcome.source_customer_id or "UNKNOWN"))
                car_name = str(ev.get("carrier", outcome.carrier))
                dist_km = int(ev.get("distance_km", outcome.distance_km))
                freight_inr = float(ev.get("freight_cost_inr", ev.get("freight_inr", outcome.freight_cost_inr)))
                t_days = int(ev.get("transit_days", outcome.transit_days))
                s_days = int(ev.get("slack_days", 0))
                if len(src_cid) > 64 or len(car_name) > 100 or (rej_reason and len(rej_reason) > 255):
                    raise ValueError(f"Evidence field exceeds MySQL column width on {outcome.order_id}")
                evidence_list.append({
                    "evidence_id": f"EVID-{idx+1:05d}-{ev_idx+1:02d}-{uuid.uuid4().hex[:4].upper()}",
                    "order_id": outcome.order_id,
                    "candidate_route_id": cand_route_id,
                    "source_customer_id": src_cid,
                    "carrier_name": car_name,
                    "distance_km": dist_km,
                    "freight_cost_inr": freight_inr,
                    "transit_days": t_days,
                    "slack_days": s_days,
                    "is_selected": is_sel,
                    "rejection_reason": rej_reason,
                })

    if args.publish:
        print(f"\n[4/5] Publishing run {run_id} ({len(allocations)} allocations, {len(evidence_list)} evidence rows) to nubrix_poc_* tables...")
        storage = PocStorageManager(railway_params)
        storage.init_schema()
        pub_summary = storage.publish_run(
            run_id=run_id,
            as_of_date=date.today(),
            plan_result=ortools_result,
            allocations=allocations,
            evidence_list=evidence_list,
            set_active=True,
        )
        print("Published:", json.dumps(pub_summary, indent=2))
    else:
        print(f"\n[4/5] DRY-RUN: Skipping publish of {run_id} ({len(allocations)} allocations, {len(evidence_list)} evidence rows).")

    # 5. Verify Grounded AI explanation on a sample allocation
    print("\n[5/5] Verifying GroundedAssistant deterministic explanation...")
    sample_alloc = allocations[0]
    assistant = GroundedAssistant(run_outcomes=allocations, provenance=snapshot["provenance"])
    resp = assistant.ask(f"Explain allocation for order {sample_alloc['order_id']}")
    print("Grounded AI Response:")
    print(f"  Order: {sample_alloc['order_id']} ({sample_alloc['planning_status']})")
    print(f"  Answer: {resp.answer}")
    print(f"  Citations: {resp.cited_ids}")
    print(f"  Evidence Status: {resp.evidence_status} | Grounded: {resp.is_grounded}")
    print(f"  Disclosure: {resp.synthetic_disclosure}")

    print("\n=== Pipeline Completed Successfully! ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
