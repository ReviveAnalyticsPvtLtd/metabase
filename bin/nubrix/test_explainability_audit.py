"""Phase 1-3 Explainability & Data-Quality Correctness Tests."""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fulfillment_planner import OrToolsFulfillmentPlanner
from snapshot_validator import validate_snapshot


def _sample_snapshot():
    return {
        "as_of_date": "2026-07-01",
        "directed_lanes": False,
        "distributor_mode": "coordinator",
        "customers": {
            "CUST-DEST": {
                "id": "CUST-DEST",
                "name": "Dest Brewer 01",
                "type": "Brewer",
                "region": "North",
                "city": "Chandigarh",
                "state": "Chandigarh",
                "lat": 30.73,
                "lon": 76.78,
            },
            "CUST-NEAR": {
                "id": "CUST-NEAR",
                "name": "Near Brewer 02",
                "type": "Brewer",
                "region": "North",
                "city": "Mohali",
                "state": "Punjab",
                "lat": 30.70,
                "lon": 76.71,
            },
            "CUST-FAR": {
                "id": "CUST-FAR",
                "name": "Far Brewer 03",
                "type": "Brewer",
                "region": "North",
                "city": "Ludhiana",
                "state": "Punjab",
                "lat": 30.90,
                "lon": 75.85,
            },
            "CUST-DIST": {
                "id": "CUST-DIST",
                "name": "Delhi Distributor",
                "type": "Distributor",
                "region": "North",
                "city": "Delhi",
                "state": "Delhi",
                "lat": 28.61,
                "lon": 77.20,
            },
        },
        "carriers": {
            "CAR-1": {"id": "CAR-1", "name": "EastWest Transport", "rate_inr": 1.65, "max_load": 500},
        },
        "stock": [
            {"source": "CUST-NEAR", "sku": "50L", "available": 30, "as_of_date": "2026-06-30"},
            {"source": "CUST-FAR", "sku": "50L", "available": 50, "as_of_date": "2026-06-30"},
        ],
        "orders": [
            {
                "id": "ORD-COMPETING",
                "customer_id": "CUST-DEST",
                "sku": "50L",
                "ordered_date": "2026-07-01",
                "needed_by_date": "2026-07-03",
                "quantity_ordered": 30,
                "fulfilled_units": 0,
                "pending": 30,
            },
            {
                "id": "ORD-TARGET",
                "customer_id": "CUST-DEST",
                "sku": "50L",
                "ordered_date": "2026-07-01",
                "needed_by_date": "2026-07-05",
                "quantity_ordered": 30,
                "fulfilled_units": 0,
                "pending": 30,
            },
        ],
        "legs": [
            {"origin": "CUST-NEAR", "destination": "CUST-DEST", "km": 5},
            {"origin": "CUST-FAR", "destination": "CUST-DEST", "km": 100},
        ],
        "vehicles": [],
    }


class ExplainabilityAuditTests(unittest.TestCase):
    def test_snapshot_validator_catches_reconciliation_and_warns_duplicate_names(self):
        snap = _sample_snapshot()
        res = validate_snapshot(snap)
        self.assertTrue(res.ok)

        snap["customers"]["CUST-FAR"]["name"] = "Near Brewer 02"
        res_dup = validate_snapshot(snap)
        self.assertTrue(res_dup.ok)
        self.assertTrue(any("Duplicate customer display names" in w for w in res_dup.warnings))

        snap["orders"][0]["pending"] = 999
        res_bad = validate_snapshot(snap)
        self.assertFalse(res_bad.ok)
        self.assertTrue(any("reconciliation failed" in e for e in res_bad.errors))

    def test_canonical_ids_persisted_and_reason_codes_populated(self):
        snap = _sample_snapshot()
        planner = OrToolsFulfillmentPlanner(
            time_limit_seconds=5,
            max_candidates_per_order=1,
            source_policy="unrestricted_nearest",
        )
        result = planner.plan(snap)

        self.assertEqual(result["planning_mode"], "MODE_A_ORDER_LEVEL")
        self.assertEqual(result["source_policy"], "unrestricted_nearest")
        self.assertEqual(result["split_policy"], "single_source_per_order")
        self.assertGreater(result["omitted_candidates_total"], 0)
        self.assertNotIn("optimal", result["solver_status"].lower())

        for outcome in result["outcomes"]:
            self.assertNotIn("optimally", outcome.explanation.lower())
            for ev in outcome.evidence:
                if "candidate_id" in ev:
                    self.assertTrue(ev["source_customer_id"].startswith("CUST-"))
                    self.assertIsNotNone(ev.get("reason_code"))
                    self.assertIsNotNone(ev.get("reason"))

    def test_depot_first_excludes_peer_brewers_by_policy(self):
        snap = _sample_snapshot()
        snap["customers"]["CUST-DEPOT"] = {
            "id": "CUST-DEPOT",
            "name": "West Maintenance Depot",
            "type": "Maintenance Facility",
            "region": "North",
            "lat": 28.5,
            "lon": 77.2,
        }
        snap["stock"].append({"source": "CUST-DEPOT", "sku": "50L", "available": 100})
        snap["legs"].append({"origin": "CUST-DEPOT", "destination": "CUST-DEST", "km": 200})

        planner = OrToolsFulfillmentPlanner(time_limit_seconds=5, max_candidates_per_order=10, source_policy="depot_first")
        result = planner.plan(snap)
        self.assertEqual(result["source_policy"], "depot_first")
        outcomes = {o.order_id: o for o in result["outcomes"]}
        self.assertEqual(outcomes["ORD-TARGET"].source_customer_id, "CUST-DEPOT")
        self.assertTrue(
            any(ev.get("reason_code") == "POLICY_EXCLUDED_PEER_BREWER" for ev in outcomes["ORD-TARGET"].evidence)
        )

    def test_service_first_fallback_prefers_facility_then_distributor_then_brewer(self):
        snap = _sample_snapshot()
        snap["as_of_date"] = "2026-01-02"
        snap["directed_lanes"] = True
        snap["customers"]["CUST-MAINT"] = {
            "id": "CUST-MAINT", "name": "North Maint Depot", "type": "Maintenance Facility",
            "region": "North", "lat": 28.5, "lon": 77.2,
        }
        snap["customers"]["CUST-DIST-S"] = {
            "id": "CUST-DIST-S", "name": "North Dist Hub", "type": "Distributor",
            "region": "North", "lat": 28.6, "lon": 77.3,
        }
        # Give Brewer cheaper/closer lane (10 km) than Maint (200 km) and Dist (100 km)
        snap["stock"] = [
            {"source": "CUST-MAINT", "sku": "50L", "available": 100},
            {"source": "CUST-DIST-S", "sku": "50L", "available": 100},
            {"source": "CUST-NEAR", "sku": "50L", "available": 100},
        ]
        snap["legs"].extend([
            {"origin": "CUST-MAINT", "destination": "CUST-DEST", "km": 200},
            {"origin": "CUST-DIST-S", "destination": "CUST-DEST", "km": 100},
        ])
        snap["orders"] = [
            {
                "id": "ORD-TARGET", "customer_id": "CUST-DEST", "sku": "50L",
                "ordered_date": "2026-01-01", "needed_by_date": "2026-01-10",
                "quantity_ordered": 50, "fulfilled_units": 0, "pending": 50,
            }
        ]
        planner = OrToolsFulfillmentPlanner(
            time_limit_seconds=5, max_candidates_per_order=12, source_policy="service_first_fallback"
        )
        res = planner.plan(snap)
        out = res["outcomes"][0]
        # Must prefer Maintenance Facility even though Brewer is closer/cheaper
        self.assertEqual(out.source_customer_id, "CUST-MAINT")

        # When Maintenance Facility has 0 stock, must prefer Distributor over Brewer
        snap["stock"] = [
            {"source": "CUST-DIST-S", "sku": "50L", "available": 100},
            {"source": "CUST-NEAR", "sku": "50L", "available": 100},
        ]
        res2 = planner.plan(snap)
        self.assertEqual(res2["outcomes"][0].source_customer_id, "CUST-DIST-S")

        # When neither Maint nor Dist has stock, Brewer fallback covers the order
        snap["stock"] = [{"source": "CUST-NEAR", "sku": "50L", "available": 100}]
        res3 = planner.plan(snap)
        self.assertEqual(res3["outcomes"][0].source_customer_id, "CUST-NEAR")
        self.assertEqual(res3["outcomes"][0].allocated_units, 50)

    def test_overdue_against_as_of_date_fails_closed(self):
        snap = _sample_snapshot()
        snap["as_of_date"] = "2026-11-27"
        snap["orders"] = [
            {
                "id": "ORD-PAST", "customer_id": "CUST-DEST", "sku": "50L",
                "ordered_date": "2026-01-01", "needed_by_date": "2026-01-04",
                "quantity_ordered": 50, "fulfilled_units": 0, "pending": 50,
            }
        ]
        planner = OrToolsFulfillmentPlanner(
            time_limit_seconds=5, max_candidates_per_order=10, source_policy="service_first_fallback"
        )
        res = planner.plan(snap)
        out = res["outcomes"][0]
        self.assertEqual(out.allocated_units, 0)
        self.assertEqual(out.on_time_feasible, "N")
        self.assertTrue(any(ev.get("reason") == "overdue" for ev in out.evidence))

    def test_forced_assignment_rejects_reverse_only_lane(self):
        from solve_what_if import _solve_forced_order
        snap = _sample_snapshot()
        snap["as_of_date"] = "2026-01-02"
        snap["directed_lanes"] = True
        # Only CUST-DEST -> CUST-FAR exists, NOT CUST-FAR -> CUST-DEST
        snap["legs"] = [
            {"origin": "CUST-NEAR", "destination": "CUST-DEST", "km": 50},
            {"origin": "CUST-DEST", "destination": "CUST-FAR", "km": 100},
        ]
        out = _solve_forced_order(
            snap, "snap-hash", "RUN-TEST", "service_first_fallback",
            "ORD-TARGET", "CUST-FAR", "SwiftHaul", None, 5
        )
        self.assertFalse(out["ok"])
        self.assertFalse(out.get("feasible", True))

    def test_multi_order_trip_consolidation_saves_trucks_and_validates(self):
        snap = _sample_snapshot()
        snap["as_of_date"] = "2026-01-02"
        snap["directed_lanes"] = True
        snap["consolidate_trips"] = True
        # Two orders going to nearby Brewer corridors with a 1-truck cap on cheap carrier
        snap["carrier_truck_limits"] = {"EastWest Transport": 1, "Deccan Freight": 2}
        snap["carriers"]["CAR-02"] = {
            "id": "CAR-02", "name": "Deccan Freight", "rate_inr": 2.50, "rate_paise": 250, "max_load": 500
        }
        snap["customers"]["CUST-DEST2"] = {
            "id": "CUST-DEST2", "name": "Dest Brewer 2", "type": "Brewer",
            "region": "North", "city": "Jaipur", "lat": 26.92, "lon": 75.81,
        }
        snap["stock"] = [{"source": "CUST-NEAR", "sku": "50L", "available": 300}]
        snap["legs"].extend([
            {"origin": "CUST-NEAR", "destination": "CUST-DEST2", "km": 55},
            {"origin": "CUST-DEST", "destination": "CUST-DEST2", "km": 5},
            {"origin": "CUST-DEST2", "destination": "CUST-DEST", "km": 5},
        ])
        snap["orders"] = [
            {
                "id": "ORD-1", "customer_id": "CUST-DEST", "sku": "50L",
                "ordered_date": "2026-01-01", "needed_by_date": "2026-01-10",
                "quantity_ordered": 100, "fulfilled_units": 0, "pending": 100,
            },
            {
                "id": "ORD-2", "customer_id": "CUST-DEST2", "sku": "50L",
                "ordered_date": "2026-01-01", "needed_by_date": "2026-01-10",
                "quantity_ordered": 100, "fulfilled_units": 0, "pending": 100,
            },
        ]
        planner = OrToolsFulfillmentPlanner(
            time_limit_seconds=10, max_candidates_per_order=10, source_policy="service_first_fallback"
        )
        res = planner.plan(snap)
        self.assertEqual(res["shared_trips_count"], 1)
        self.assertEqual(res["trips_total"], 1)
        self.assertEqual(res["planning_mode"], "MODE_B_CONSOLIDATED_TRIPS")
        trip = res["trips"][0]
        self.assertEqual(trip["stop_count"], 2)
        self.assertEqual(trip["carrier_name"], "EastWest Transport")
        self.assertEqual(trip["total_kegs"], 200)
        # 200 kegs * 50km + 100 kegs * 5km = 10,500 keg-km * INR 2.0 = INR 21,000 (cheaper than separate 100*50*2 + 100*55*2 = 21,000 using 2 trucks!)
        self.assertEqual(trip["stops"][0]["load_before_stop_kegs"], 200)
        self.assertEqual(trip["stops"][0]["load_after_stop_kegs"], 100)
        self.assertEqual(trip["stops"][1]["load_before_stop_kegs"], 100)
        self.assertEqual(trip["stops"][1]["load_after_stop_kegs"], 0)

    def test_cost_service_optimal_splits_nearby_when_cheaper_than_far_depot(self):
        snap = _sample_snapshot()
        snap["as_of_date"] = "2026-01-02"
        snap["directed_lanes"] = True
        snap["consolidate_trips"] = True
        # Two nearby Brewers (10km, 15km) holding 250 + 150 = 400 kegs vs 1 far Depot (500km) holding 500 kegs
        snap["customers"]["CUST-MAINT-FAR"] = {
            "id": "CUST-MAINT-FAR", "name": "Far Maint Depot", "type": "Maintenance Facility",
            "region": "South", "city": "Chennai", "lat": 13.08, "lon": 80.27,
        }
        snap["stock"] = [
            {"source": "CUST-NEAR", "sku": "50L", "available": 250},
            {"source": "CUST-FAR", "sku": "50L", "available": 150},
            {"source": "CUST-MAINT-FAR", "sku": "50L", "available": 500},
        ]
        snap["legs"] = [
            {"origin": "CUST-NEAR", "destination": "CUST-DEST", "km": 10},
            {"origin": "CUST-FAR", "destination": "CUST-DEST", "km": 15},
            {"origin": "CUST-MAINT-FAR", "destination": "CUST-DEST", "km": 500},
        ]
        snap["orders"] = [
            {
                "id": "ORD-SPLIT", "customer_id": "CUST-DEST", "sku": "50L",
                "ordered_date": "2026-01-01", "needed_by_date": "2026-01-10",
                "quantity_ordered": 400, "fulfilled_units": 0, "pending": 400,
            }
        ]
        planner = OrToolsFulfillmentPlanner(
            time_limit_seconds=10, max_candidates_per_order=12, source_policy="cost_service_optimal"
        )
        res = planner.plan(snap)
        out = res["outcomes"][0]
        self.assertEqual(out.allocated_units, 400)
        self.assertEqual(out.uncovered_units, 0)
        self.assertEqual(len(out.allocation_lines), 2)
        # 250*10*1.65 + 150*15*1.65 = 4125 + 3712.5 = 7837.50 INR (vs 400*500*1.65 = 330,000 INR!)
        self.assertAlmostEqual(out.freight_cost_inr, 7837.50, places=2)


if __name__ == "__main__":
    unittest.main()
