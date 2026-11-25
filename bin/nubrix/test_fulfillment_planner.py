import unittest
from datetime import date, timedelta

from fulfillment_planner import (
    InvariantValidationError,
    NearestSourceBaselinePlanner,
    OrToolsFulfillmentPlanner,
)


class FulfillmentPlannerTest(unittest.TestCase):
    def base_snapshot(self):
        return {
            "as_of": 0,
            "provenance": {"kind": "unit_test"},
            "customers": {
                "CUST-0001": {"id": "CUST-0001", "name": "Mumbai Brewer 0001", "type": "Brewer", "region": "West"},
                "CUST-0002": {"id": "CUST-0002", "name": "Pune Brewer 0002", "type": "Brewer", "region": "West"},
                "CUST-0003": {"id": "CUST-0003", "name": "Kochi Brewer 0003", "type": "Brewer", "region": "South"},
                "DEPOT-01": {"id": "DEPOT-01", "name": "Mumbai Depot", "type": "Maintenance Facility", "region": "West"},
                "DEPOT-02": {"id": "DEPOT-02", "name": "Bengaluru Depot", "type": "Maintenance Facility", "region": "South"},
                "DIST-01": {"id": "DIST-01", "name": "Western Distributor", "type": "Distributor", "region": "West"},
            },
            "stock": [
                {"source": "DEPOT-01", "sku": "50L", "available": 100},
                {"source": "DEPOT-02", "sku": "50L", "available": 200},
            ],
            "carriers": {
                "CAR-01": {"id": "CAR-01", "name": "SwiftHaul", "rate_inr": 2.0, "max_load": 500},
            },
            "distances": [
                {"origin": "DEPOT-01", "destination": "CUST-0001", "km": 50},
                {"origin": "DEPOT-01", "destination": "CUST-0002", "km": 150},
                {"origin": "DEPOT-02", "destination": "CUST-0001", "km": 900},
                {"origin": "DEPOT-02", "destination": "CUST-0002", "km": 800},
            ],
            "orders": [
                {
                    "id": "ORD-01",
                    "customer_id": "CUST-0001",
                    "sku": "50L",
                    "quantity_ordered": 100,
                    "pending": 100,
                    "ordered_date": "2026-07-01",
                    "needed_by_date": "2026-07-05",  # 4 days available
                },
                {
                    "id": "ORD-02",
                    "customer_id": "CUST-0002",
                    "sku": "50L",
                    "quantity_ordered": 100,
                    "pending": 100,
                    "ordered_date": "2026-07-01",
                    "needed_by_date": "2026-07-08",  # 7 days available
                },
            ],
        }

    def test_competing_orders_prioritizes_earlier_deadline(self):
        # DEPOT-01 only has 100 kegs. Both ORD-01 and ORD-02 want 100 kegs.
        # ORD-01 is due 2026-07-05 (earlier). DEPOT-02 has 200 kegs.
        # Planner should allocate DEPOT-01 to ORD-01 and DEPOT-02 to ORD-02.
        snapshot = self.base_snapshot()
        planner = OrToolsFulfillmentPlanner()
        result = planner.plan(snapshot)

        self.assertEqual(result["orders_total"], 2)
        self.assertEqual(result["fully_covered"], 2)
        outcomes = {o.order_id: o for o in result["outcomes"]}
        self.assertEqual(outcomes["ORD-01"].allocated_units, 100)
        self.assertEqual(outcomes["ORD-01"].source_customer_id, "DEPOT-01")
        self.assertEqual(outcomes["ORD-02"].allocated_units, 100)
        self.assertEqual(outcomes["ORD-02"].source_customer_id, "DEPOT-02")
        self.assertEqual(outcomes["ORD-01"].on_time_feasible, "Y")
        self.assertEqual(outcomes["ORD-02"].on_time_feasible, "Y")

    def test_nearer_source_missing_deadline_picks_feasible_source_or_reports_slack(self):
        # Suppose ORD-01 has needed_by_date tomorrow (1 day), distance 900 km from DEPOT-02
        snapshot = self.base_snapshot()
        snapshot["stock"] = [{"source": "DEPOT-02", "sku": "50L", "available": 200}]  # 900km away (3 days transit)
        snapshot["orders"] = [
            {
                "id": "ORD-RUSH",
                "customer_id": "CUST-0001",
                "sku": "50L",
                "quantity_ordered": 100,
                "pending": 100,
                "ordered_date": "2026-07-01",
                "needed_by_date": "2026-07-02",  # Only 1 day! 900km / 400 = 3 days transit -> late!
            }
        ]
        planner = OrToolsFulfillmentPlanner()
        result = planner.plan(snapshot)
        rush = result["outcomes"][0]
        # It detects that transit cannot meet needed by date
        self.assertEqual(rush.on_time_feasible, "N")
        self.assertIn("exceeds", rush.explanation.lower())

    def test_overdue_order_is_flagged_with_shortfall_reason(self):
        snapshot = self.base_snapshot()
        snapshot["orders"] = [
            {
                "id": "ORD-OVERDUE",
                "customer_id": "CUST-0001",
                "sku": "50L",
                "quantity_ordered": 50,
                "pending": 50,
                "ordered_date": "2026-07-10",
                "needed_by_date": "2026-07-05",  # Overdue!
            }
        ]
        planner = OrToolsFulfillmentPlanner()
        result = planner.plan(snapshot)
        outcome = result["outcomes"][0]
        self.assertEqual(outcome.allocated_units, 0)
        self.assertEqual(outcome.planning_status, "No allocation")
        self.assertIn("overdue", outcome.explanation.lower())

    def test_no_stock_for_sku_is_flagged(self):
        snapshot = self.base_snapshot()
        snapshot["orders"] = [
            {
                "id": "ORD-UNKNOWN-SKU",
                "customer_id": "CUST-0001",
                "sku": "20L",  # We only have 50L stock in base_snapshot!
                "quantity_ordered": 50,
                "pending": 50,
                "ordered_date": "2026-07-01",
                "needed_by_date": "2026-07-10",
            }
        ]
        planner = OrToolsFulfillmentPlanner()
        result = planner.plan(snapshot)
        outcome = result["outcomes"][0]
        self.assertEqual(outcome.allocated_units, 0)
        self.assertEqual(outcome.planning_status, "No allocation")
        self.assertIn("no available warehouse stock", outcome.explanation.lower())

    def test_baseline_comparison(self):
        snapshot = self.base_snapshot()
        planner_cp = OrToolsFulfillmentPlanner()
        planner_base = NearestSourceBaselinePlanner()

        res_cp = planner_cp.plan(snapshot)
        res_base = planner_base.plan(snapshot)

        self.assertEqual(res_cp["orders_total"], res_base["orders_total"])
        self.assertEqual(res_cp["total_allocated_kegs"], res_base["allocated_kegs"])

    def test_missing_lane_is_excluded_not_fabricated(self):
        snapshot = self.base_snapshot()
        snapshot["distances"] = []  # No lanes at all
        snapshot["orders"] = [snapshot["orders"][0]]
        planner = OrToolsFulfillmentPlanner()
        res = planner.plan(snapshot)
        outcome = res["outcomes"][0]
        self.assertEqual(outcome.allocated_units, 0)
        self.assertIn("road distance lane", outcome.explanation.lower())

        base_res = NearestSourceBaselinePlanner().plan(snapshot)
        self.assertEqual(base_res["allocated_kegs"], 0)

    def test_carrier_max_load_caps_allocation(self):
        snapshot = self.base_snapshot()
        snapshot["carriers"] = {
            "CAR-SMALL": {"id": "CAR-SMALL", "name": "MiniVan", "rate_inr": 2.0, "max_load": 60},
        }
        snapshot["orders"] = [snapshot["orders"][0]]
        res = OrToolsFulfillmentPlanner().plan(snapshot)
        outcome = res["outcomes"][0]
        self.assertEqual(outcome.allocated_units, 60)
        self.assertEqual(outcome.uncovered_units, 40)
        self.assertEqual(outcome.planning_status, "Partially covered")

    def test_partial_allocation_avoids_stranding_shared_stock(self):
        snapshot = self.base_snapshot()
        snapshot["stock"] = [{"source": "DEPOT-01", "sku": "50L", "available": 100}]
        snapshot["orders"][0]["pending"] = 80
        snapshot["orders"][0]["quantity_ordered"] = 80
        snapshot["orders"][1]["pending"] = 60
        snapshot["orders"][1]["quantity_ordered"] = 60
        res = OrToolsFulfillmentPlanner().plan(snapshot)
        self.assertEqual(res["total_allocated_kegs"], 100)
        outcomes = {o.order_id: o for o in res["outcomes"]}
        self.assertEqual(outcomes["ORD-01"].allocated_units, 80)
        self.assertEqual(outcomes["ORD-02"].allocated_units, 20)

    def test_validate_invariants_fails_closed_on_capacity_breach(self):
        from collections import Counter
        from fulfillment_planner import PlannerOutcome
        planner = OrToolsFulfillmentPlanner()
        bad_outcome = PlannerOutcome(
            order_id="ORD-BAD",
            destination_customer_id="CUST-0001",
            destination_brewer="Brewer 1",
            region="West",
            customer_type="Brewer",
            keg_size="50L",
            ordered_date="2026-07-01",
            needed_by="2026-07-05",
            ordered_units=100,
            fulfilled_units=0,
            pending_units=100,
            allocated_units=90,
            proposed_on_time_units=90,
            uncovered_units=10,
            source_hub="DEPOT-01",
            source_customer_id="DEPOT-01",
            distributor="DIST-01",
            distributor_customer_id="DIST-01",
            carrier="MiniVan",
            distance_km=50,
            freight_cost_inr=9000.0,
            transit_days=1,
            on_time_feasible="Y",
            planning_status="Partially covered",
            explanation="test",
            evidence=[],
        )
        with self.assertRaises(InvariantValidationError):
            planner.validate_invariants(
                [bad_outcome],
                {("DEPOT-01", "50L"): 200},
                Counter({("DEPOT-01", "50L"): 90}),
                carrier_max_load={"MiniVan": 60},
            )

    def test_as_of_date_deadline_semantics(self):
        snapshot = self.base_snapshot()
        # ORD-01 ordered 2026-07-01, needed 2026-07-05. From DEPOT-02 (900km = 3d transit):
        # Without as_of_date: 4d available >= 3d -> feasible.
        # With as_of_date=2026-07-04: only 1d available < 3d -> infeasible!
        snapshot["stock"] = [{"source": "DEPOT-02", "sku": "50L", "available": 200}]
        snapshot["orders"] = [snapshot["orders"][0]]
        snapshot["as_of_date"] = "2026-07-04"
        res = OrToolsFulfillmentPlanner().plan(snapshot)
        self.assertEqual(res["outcomes"][0].allocated_units, 0)
        self.assertEqual(res["outcomes"][0].on_time_feasible, "N")

        base_res = NearestSourceBaselinePlanner().plan(snapshot)
        self.assertEqual(base_res["allocated_kegs"], 0)

    def test_physical_distributor_route_legs(self):
        snapshot = self.base_snapshot()
        snapshot["distributor_mode"] = "physical_stop"
        snapshot["distributor_handling_days"] = 1
        snapshot["distances"] = [
            {"origin": "DEPOT-01", "destination": "DIST-01", "km": 200},
            {"origin": "DIST-01", "destination": "CUST-0001", "km": 300},
        ]
        snapshot["stock"] = [{"source": "DEPOT-01", "sku": "50L", "available": 100}]
        snapshot["orders"] = [snapshot["orders"][0]]
        res = OrToolsFulfillmentPlanner().plan(snapshot)
        out = res["outcomes"][0]
        self.assertEqual(out.distance_km, 500)
        # 500km = 2d + 1d handling = 3d transit; 2026-07-01 -> 2026-07-05 = 4d -> feasible
        self.assertEqual(out.transit_days, 3)
        self.assertEqual(out.distributor_mode, "physical_stop")
        self.assertEqual(out.on_time_feasible, "Y")

    def test_vehicle_availability_and_non_overlap(self):
        snapshot = self.base_snapshot()
        snapshot["stock"] = [{"source": "DEPOT-01", "sku": "50L", "available": 200}]
        # Both orders dispatch on 2026-07-01 for 1-day overlapping trip on the same single truck
        snapshot["orders"][1]["needed_by_date"] = "2026-07-05"
        snapshot["vehicles"] = [
            {"id": "TRK-ONLY-1", "carrier": "SwiftHaul", "origin": "DEPOT-01", "free_from": 0, "free_until": 20000, "capacity": 500}
        ]
        res = OrToolsFulfillmentPlanner().plan(snapshot)
        self.assertEqual(res["vehicle_mode"], "interval_no_overlap")
        allocated_orders = [o for o in res["outcomes"] if o.allocated_units > 0]
        self.assertEqual(len(allocated_orders), 1)

        base_res = NearestSourceBaselinePlanner().plan(snapshot)
        self.assertEqual(sum(1 for o in base_res["outcomes"] if o["allocated_units"] > 0), 1)

    def test_directed_lane_completeness(self):
        snapshot = self.base_snapshot()
        snapshot["directed_lanes"] = True
        # Reverse direction only: CUST-0001 -> DEPOT-01, missing DEPOT-01 -> CUST-0001
        snapshot["distances"] = [{"origin": "CUST-0001", "destination": "DEPOT-01", "km": 50}]
        snapshot["stock"] = [{"source": "DEPOT-01", "sku": "50L", "available": 100}]
        snapshot["orders"] = [snapshot["orders"][0]]
        res = OrToolsFulfillmentPlanner().plan(snapshot)
        self.assertEqual(res["outcomes"][0].allocated_units, 0)
        self.assertIn("road distance lane", res["outcomes"][0].explanation.lower())
        self.assertTrue(any("directed" in e.get("details", "").lower() for e in res["outcomes"][0].evidence))

    def test_solver_status_and_identical_denominators(self):
        snapshot = self.base_snapshot()
        res_cp = OrToolsFulfillmentPlanner().plan(snapshot)
        res_base = NearestSourceBaselinePlanner().plan(snapshot)
        self.assertEqual(res_cp["solver_status"], "OPTIMAL_OVER_CANDIDATES")
        self.assertEqual(res_cp["orders_total"], res_base["orders_total"])
        self.assertEqual(res_cp["total_ordered_kegs"], res_base["total_ordered_kegs"])
        self.assertEqual(res_cp["total_pending_kegs"], res_base["total_pending_kegs"])
        self.assertEqual(
            res_base["fully_covered"] + res_base["partially_covered"] + res_base["uncovered"],
            res_base["orders_total"],
        )

    def test_solver_fails_closed_on_unknown_or_invalid_status(self):
        from unittest.mock import patch
        from ortools.sat.python import cp_model

        snapshot = self.base_snapshot()
        with patch.object(cp_model.CpSolver, "Solve", return_value=cp_model.UNKNOWN), \
             patch.object(cp_model.CpSolver, "StatusName", return_value="UNKNOWN"):
            with self.assertRaises(InvariantValidationError):
                OrToolsFulfillmentPlanner().plan(snapshot)

    def test_stage2_residual_revalidated_for_physical_legs_and_vehicle_window(self):
        from collections import Counter
        from fulfillment_planner import PlannerOutcome

        snapshot = self.base_snapshot()
        snapshot["distributor_mode"] = "physical_stop"
        snapshot["distributor_handling_days"] = 1
        snapshot["as_of_date"] = "2026-07-01"
        snapshot["distances"] = [
            {"origin": "DEPOT-01", "destination": "DIST-01", "km": 100},
            {"origin": "DIST-01", "destination": "CUST-0001", "km": 100},
            {"origin": "DIST-01", "destination": "CUST-0002", "km": 150},
        ]
        snapshot["stock"] = [{"source": "DEPOT-01", "sku": "50L", "available": 100}]
        snapshot["orders"][0]["pending"] = 70
        snapshot["orders"][0]["quantity_ordered"] = 70
        snapshot["orders"][1]["pending"] = 50
        snapshot["orders"][1]["quantity_ordered"] = 50
        snapshot["orders"][1]["needed_by_date"] = "2026-07-06"
        snapshot["vehicles"] = [
            {"id": "TRK-1", "carrier": "SwiftHaul", "origin": "DEPOT-01", "free_from": 0, "free_until": 20000, "capacity": 100},
            {"id": "TRK-2", "carrier": "SwiftHaul", "origin": "DEPOT-01", "free_from": 0, "free_until": 20000, "capacity": 100},
        ]

        res = OrToolsFulfillmentPlanner().plan(snapshot)
        self.assertEqual(res["total_allocated_kegs"], 100)
        self.assertEqual(res["solver_status"], "FEASIBLE (bounded_candidates_and_residual)")

        # Prove validate_invariants rejects missing physical leg and vehicle window violation
        planner = OrToolsFulfillmentPlanner()
        out0 = res["outcomes"][0]
        with self.assertRaises(InvariantValidationError):
            planner.validate_invariants(
                [out0],
                {("DEPOT-01", "50L"): 100},
                Counter({("DEPOT-01", "50L"): out0.allocated_units}),
                distance_map={("DEPOT-01", "DIST-01"): 100},  # Missing DIST-01 -> CUST-0001!
                directed_lanes=True,
            )

        bad_veh = PlannerOutcome(**{**out0.__dict__, "trip_end": 999999})
        with self.assertRaises(InvariantValidationError):
            planner.validate_invariants(
                [bad_veh],
                {("DEPOT-01", "50L"): 100},
                Counter({("DEPOT-01", "50L"): bad_veh.allocated_units}),
                vehicles_by_id={"TRK-1": {"id": "TRK-1", "free_from": 0, "free_until": 20000, "capacity": 100}},
            )


if __name__ == "__main__":
    unittest.main()
