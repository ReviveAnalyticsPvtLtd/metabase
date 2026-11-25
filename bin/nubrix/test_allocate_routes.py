import unittest

from allocate_routes import allocate


class AllocateRoutesTest(unittest.TestCase):
    def test_stock_is_shared_and_earlier_commitment_wins(self):
        key = ("depot", "30L")
        orders = {"early": (1, 100), "later": (2, 100)}
        routes = [self.route("early", "truck-a", [("early", key, 100)], 200),
                  self.route("later", "truck-b", [("later", key, 100)], 100)]
        result = allocate(orders, {key: 100}, routes)
        self.assertEqual(result, {"status": "optimal_over_candidates", "route_ids": ["early"]})

    def test_shared_load_beats_conflicting_single_shipments(self):
        key = ("depot", "30L")
        orders = {"a": (1, 40), "b": (1, 60)}
        routes = [self.route("a", "truck", [("a", key, 40)], 100),
                  self.route("b", "truck", [("b", key, 60)], 100),
                  self.route("shared", "truck", [("a", key, 40), ("b", key, 60)], 150)]
        self.assertEqual(allocate(orders, {key: 100}, routes)["route_ids"], ["shared"])

    def test_orders_without_candidates_are_feasible_to_report(self):
        result = allocate({"uncovered": (1, 40)}, {}, [])
        self.assertEqual(result, {"status": "optimal_over_candidates", "route_ids": []})

    @staticmethod
    def route(route_id, vehicle, shipments, cost):
        return {"id": route_id, "vehicle": vehicle, "start": 0, "end": 60,
                "shipments": shipments, "freight_paise": cost}
