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


if __name__ == "__main__":
    unittest.main()
