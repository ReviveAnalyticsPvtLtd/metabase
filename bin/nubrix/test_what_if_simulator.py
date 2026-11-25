import copy
import unittest

from what_if_simulator import run_what_if_scenario


class WhatIfSimulatorTest(unittest.TestCase):
    def setUp(self):
        self.snapshot = {
            "as_of_date": "2026-11-20",
            "directed_lanes": True,
            "distributor_mode": "coordinator",
            "customers": {
                "BRW-1": {"id": "BRW-1", "name": "Brewer One", "type": "Brewer", "region": "West"},
                "SRC-1": {"id": "SRC-1", "name": "Maint Hub 1", "type": "Maintenance Facility", "region": "West"},
                "DST-1": {"id": "DST-1", "name": "Dist One", "type": "Distributor", "region": "West"},
            },
            "orders": [
                {
                    "id": "ORD-101",
                    "customer_id": "BRW-1",
                    "sku": "50L",
                    "ordered_date": "2026-11-18",
                    "needed_by_date": "2026-11-25",
                    "quantity_ordered": 100,
                    "pending": 100,
                }
            ],
            "stock": [
                {"source": "SRC-1", "sku": "50L", "available": 120},
                {"source": "DST-1", "sku": "50L", "available": 50},
            ],
            "carriers": {
                "CAR-1": {"id": "CAR-1", "name": "FastHaul", "rate_inr": 2.0, "max_load": 200},
                "CAR-2": {"id": "CAR-2", "name": "EcoFreight", "rate_inr": 1.0, "max_load": 200},
            },
            "distances": [
                {"origin": "SRC-1", "destination": "BRW-1", "km": 200},
                {"origin": "SRC-1", "destination": "DST-1", "km": 100},
                {"origin": "DST-1", "destination": "BRW-1", "km": 150},
            ],
        }

    def test_carrier_unavailable_and_source_immutability(self):
        orig_snapshot = copy.deepcopy(self.snapshot)
        res = run_what_if_scenario(
            scenario_name="carrier_unavailable",
            snapshot=self.snapshot,
            disabled_carriers=["EcoFreight"],
        )
        self.assertEqual(self.snapshot, orig_snapshot)
        self.assertTrue(res.is_simulation)
        self.assertEqual(res.baseline_allocated_kegs, 100)
        self.assertEqual(res.scenario_allocated_kegs, 100)
        self.assertGreater(res.freight_delta_inr, 0.0)

    def test_source_stock_reduced_creates_shortfall(self):
        res = run_what_if_scenario(
            scenario_name="source_stock_reduced",
            snapshot=self.snapshot,
            stock_multiplier={"SRC-1": 0.5, "DST-1": 0.0},
        )
        self.assertEqual(res.scenario_allocated_kegs, 60)
        self.assertEqual(res.allocated_delta_kegs, -40)

    def test_changed_needed_by_date_misses_deadline(self):
        res = run_what_if_scenario(
            scenario_name="changed_needed_by_date",
            snapshot=self.snapshot,
            needed_by_shift_days={"ORD-101": -5},  # due on 2026-11-20, 1 transit day needed
        )
        self.assertEqual(res.scenario_allocated_kegs, 0)
        self.assertEqual(res.scenario_uncovered_orders, 1)

    def test_no_distributor_capacity_and_split_toggle(self):
        res_no_dist = run_what_if_scenario(
            scenario_name="no_distributor_capacity",
            snapshot=self.snapshot,
        )
        self.assertTrue(res_no_dist.is_simulation)
        self.assertEqual(res_no_dist.scenario_allocated_kegs, 100)

        res_split = run_what_if_scenario(
            scenario_name="split_policy_toggle",
            snapshot=self.snapshot,
        )
        self.assertTrue(res_split.is_simulation)
        self.assertEqual(res_split.scenario_allocated_kegs, 100)


if __name__ == "__main__":
    unittest.main()
