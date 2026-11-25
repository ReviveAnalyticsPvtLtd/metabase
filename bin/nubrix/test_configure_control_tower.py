import unittest

from configure_control_tower import (
    build_card_142_ledger_query,
    build_card_145_carrier_query,
    build_exceptions_query,
    build_kpi_strip_query,
    build_order_evidence_query,
)


class ConfigureControlTowerSqlTest(unittest.TestCase):
    def test_ledger_query_joins_active_pointer_and_exposes_all_1000_orders(self):
        spec = build_card_142_ledger_query()
        sql = spec["query"]
        self.assertIn("JOIN nubrix_poc_run_pointer", sql)
        self.assertIn("JOIN nubrix_poc_runs", sql)
        self.assertIn("ORDER BY a.uncovered_units DESC", sql)
        self.assertNotIn("LIMIT 500", sql)
        self.assertNotIn("LIMIT 1000", sql)
        self.assertIn("order_id", spec["template-tags"])
        self.assertIn("planning_status", spec["template-tags"])
        self.assertIn("customer_id", spec["template-tags"])

    def test_kpi_strip_query_has_denominators(self):
        spec = build_kpi_strip_query()
        sql = spec["query"]
        self.assertIn("Horizon_Orders", sql)
        self.assertIn("Open_Demand_Kegs", sql)
        self.assertIn("Shortfall_Kegs", sql)
        self.assertIn("Uncovered_Or_Partial_Orders", sql)

    def test_order_evidence_and_exceptions_queries_join_active_pointer(self):
        ev = build_order_evidence_query()
        exc = build_exceptions_query()
        self.assertIn("JOIN nubrix_poc_run_pointer", ev["query"])
        self.assertIn("nubrix_poc_candidate_evidence", ev["query"])
        self.assertIn("order_id", ev["template-tags"])
        self.assertIn("JOIN nubrix_poc_run_pointer", exc["query"])
        self.assertIn("a.uncovered_units > 0 OR a.on_time_feasible = 'N'", exc["query"])
        self.assertNotIn("LIMIT 500", exc["query"])
        self.assertNotIn("LIMIT 1000", exc["query"])

    def test_carrier_query_joins_active_pointer(self):
        spec = build_card_145_carrier_query()
        self.assertIn("JOIN nubrix_poc_run_pointer", spec["query"])


if __name__ == "__main__":
    unittest.main()
