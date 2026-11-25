import unittest

from plan_snapshot import plan_snapshot


class PlanSnapshotTest(unittest.TestCase):
    def base(self):
        return {"as_of": 0, "provenance": {"kind": "fixture"},
                "orders": [{"id": "early", "sku": "30L", "destination": "brew-a", "released": 0, "due": 100, "pending": 100, "committed": 0},
                           {"id": "late", "sku": "30L", "destination": "brew-b", "released": 0, "due": 200, "pending": 100, "committed": 0}],
                "stock": [{"source": "depot", "sku": "30L", "available": 100}],
                "vehicles": [{"id": "truck", "carrier": "carrier", "origin": "depot", "free_from": 0, "free_until": 500, "capacity": 100}],
                "lanes": [{"carrier": "carrier", "origin": "depot", "destination": "brew-a", "coordinator": "dist", "via": None, "rate_paise": 1, "handling_minutes": 0},
                          {"carrier": "carrier", "origin": "depot", "destination": "brew-b", "coordinator": "dist", "via": None, "rate_paise": 1, "handling_minutes": 0}],
                "legs": [{"carrier": "carrier", "origin": "depot", "destination": "brew-a", "km": 10, "minutes": 10},
                         {"carrier": "carrier", "origin": "brew-a", "destination": "depot", "km": 10, "minutes": 10},
                         {"carrier": "carrier", "origin": "depot", "destination": "brew-b", "km": 10, "minutes": 10},
                         {"carrier": "carrier", "origin": "brew-b", "destination": "depot", "km": 10, "minutes": 10}]}

    def test_earliest_order_uses_shared_stock(self):
        result = plan_snapshot(self.base())
        orders = {row["id"]: row for row in result["orders"]}
        self.assertEqual(orders["early"]["uncovered"], 0)
        self.assertEqual(orders["late"]["uncovered"], 100)

    def test_overdue_order_is_reported(self):
        snapshot = self.base(); snapshot["as_of"] = 300
        result = plan_snapshot(snapshot)
        self.assertEqual(result["orders"][0]["reason"], "overdue")

    def test_missing_lane_is_reported(self):
        snapshot = self.base(); snapshot["lanes"] = snapshot["lanes"][:1]
        result = plan_snapshot(snapshot)
        self.assertEqual(result["orders"][1]["reason"], "no_candidate_meets_lane_vehicle_and_deadline_constraints")
