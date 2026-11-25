"""Isolated E2E tests for two active POC runs, dashboard SQL lineage, rollback, and backup/restore."""

from datetime import date
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import configure_control_tower as cct
from fulfillment_planner import OrToolsFulfillmentPlanner


SQLITE_POC_SCHEMA = """
CREATE TABLE nubrix_poc_runs (
    run_id TEXT PRIMARY KEY,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    as_of_date TEXT NOT NULL,
    solver_status TEXT NOT NULL,
    orders_total INTEGER NOT NULL,
    orders_fully_covered INTEGER NOT NULL,
    orders_partially_covered INTEGER NOT NULL,
    orders_uncovered INTEGER NOT NULL,
    kegs_ordered INTEGER NOT NULL,
    kegs_allocated INTEGER NOT NULL,
    total_freight_inr REAL NOT NULL,
    provenance_json TEXT NOT NULL,
    is_active INTEGER DEFAULT 0
);
CREATE TABLE nubrix_poc_run_pointer (
    pointer_id INTEGER PRIMARY KEY,
    active_run_id TEXT NOT NULL,
    activated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    version TEXT NOT NULL,
    description TEXT NOT NULL
);
CREATE TABLE nubrix_poc_allocations (
    allocation_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    destination_customer_id TEXT NOT NULL,
    destination_brewer TEXT NOT NULL,
    region TEXT NOT NULL,
    customer_type TEXT NOT NULL,
    keg_size TEXT NOT NULL,
    ordered_date TEXT,
    needed_by TEXT,
    ordered_units INTEGER NOT NULL,
    fulfilled_units INTEGER NOT NULL,
    pending_units INTEGER NOT NULL,
    allocated_units INTEGER NOT NULL,
    proposed_on_time_units INTEGER NOT NULL,
    uncovered_units INTEGER NOT NULL,
    source_hub TEXT NOT NULL,
    source_customer_id TEXT,
    distributor TEXT NOT NULL,
    distributor_customer_id TEXT,
    carrier TEXT NOT NULL,
    distance_km INTEGER NOT NULL,
    freight_cost_inr REAL NOT NULL,
    transit_days INTEGER NOT NULL,
    on_time_feasible TEXT NOT NULL,
    planning_status TEXT NOT NULL,
    explanation TEXT NOT NULL,
    planning_basis TEXT NOT NULL,
    is_active_run INTEGER DEFAULT 0
);
"""


def publish_to_sqlite(conn: sqlite3.Connection, run_id: str, as_of: str, plan_res: dict) -> None:
    cur = conn.cursor()
    cur.execute("UPDATE nubrix_poc_runs SET is_active = 0")
    cur.execute("UPDATE nubrix_poc_allocations SET is_active_run = 0")
    cur.execute(
        """INSERT INTO nubrix_poc_runs
           (run_id, as_of_date, solver_status, orders_total, orders_fully_covered,
            orders_partially_covered, orders_uncovered, kegs_ordered, kegs_allocated,
            total_freight_inr, provenance_json, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
        (
            run_id,
            as_of,
            plan_res["solver_status"],
            plan_res["orders_total"],
            plan_res["fully_covered"],
            plan_res["partially_covered"],
            plan_res["uncovered"],
            plan_res["total_ordered_kegs"],
            plan_res["total_allocated_kegs"],
            plan_res["total_freight_cost_inr"],
            json.dumps(plan_res.get("provenance", {})),
        ),
    )
    for idx, o in enumerate(plan_res["outcomes"]):
        cur.execute(
            """INSERT INTO nubrix_poc_allocations
               (allocation_id, run_id, order_id, destination_customer_id, destination_brewer,
                region, customer_type, keg_size, ordered_date, needed_by, ordered_units,
                fulfilled_units, pending_units, allocated_units, proposed_on_time_units,
                uncovered_units, source_hub, source_customer_id, distributor, distributor_customer_id,
                carrier, distance_km, freight_cost_inr, transit_days, on_time_feasible,
                planning_status, explanation, planning_basis, is_active_run)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
            (
                f"{run_id}-A{idx+1:05d}",
                run_id,
                o.order_id,
                o.destination_customer_id,
                o.destination_brewer,
                o.region,
                o.customer_type,
                o.keg_size,
                o.ordered_date,
                o.needed_by,
                o.ordered_units,
                o.fulfilled_units,
                o.pending_units,
                o.allocated_units,
                o.proposed_on_time_units,
                o.uncovered_units,
                o.source_hub,
                o.source_customer_id,
                o.distributor,
                o.distributor_customer_id,
                o.carrier,
                o.distance_km,
                o.freight_cost_inr,
                o.transit_days,
                o.on_time_feasible,
                o.planning_status,
                o.explanation,
                f"OR-Tools ({plan_res['solver_status']})",
            ),
        )
    cur.execute(
        """INSERT INTO nubrix_poc_run_pointer (pointer_id, active_run_id, version, description)
           VALUES (1, ?, 'v1.0-poc', 'Isolated test run')
           ON CONFLICT(pointer_id) DO UPDATE SET active_run_id = excluded.active_run_id""",
        (run_id,),
    )
    conn.commit()


def rollback_sqlite(conn: sqlite3.Connection, target_run_id: str) -> None:
    cur = conn.cursor()
    cur.execute("UPDATE nubrix_poc_runs SET is_active = 0")
    cur.execute("UPDATE nubrix_poc_runs SET is_active = 1 WHERE run_id = ?", (target_run_id,))
    cur.execute("UPDATE nubrix_poc_allocations SET is_active_run = 0")
    cur.execute("UPDATE nubrix_poc_allocations SET is_active_run = 1 WHERE run_id = ?", (target_run_id,))
    cur.execute("UPDATE nubrix_poc_run_pointer SET active_run_id = ? WHERE pointer_id = 1", (target_run_id,))
    conn.commit()


class IsolatedE2EPocTest(unittest.TestCase):
    def _make_snapshot(self, order_qty: int):
        return {
            "as_of_date": "2026-07-01",
            "provenance": {"kind": "isolated_test"},
            "customers": {
                "CUST-0001": {"id": "CUST-0001", "name": "Mumbai Brewer 0001", "type": "Brewer", "region": "West"},
                "DEPOT-01": {"id": "DEPOT-01", "name": "Mumbai Depot", "type": "Maintenance Facility", "region": "West"},
                "DIST-01": {"id": "DIST-01", "name": "Western Distributor", "type": "Distributor", "region": "West"},
            },
            "stock": [{"source": "DEPOT-01", "sku": "50L", "available": 500}],
            "carriers": {"CAR-01": {"id": "CAR-01", "name": "SwiftHaul", "rate_inr": 2.0, "max_load": 500}},
            "distances": [{"origin": "DEPOT-01", "destination": "CUST-0001", "km": 100}],
            "orders": [
                {
                    "id": "ORD-101",
                    "customer_id": "CUST-0001",
                    "sku": "50L",
                    "quantity_ordered": order_qty,
                    "pending": order_qty,
                    "ordered_date": "2026-07-01",
                    "needed_by_date": "2026-07-05",
                }
            ],
        }

    def test_two_active_runs_dashboard_rows_and_rollback(self):
        conn = sqlite3.connect(":memory:")
        conn.executescript(SQLITE_POC_SCHEMA)
        planner = OrToolsFulfillmentPlanner()

        # Run 1: 120 kegs
        res1 = planner.plan(self._make_snapshot(120))
        publish_to_sqlite(conn, "RUN-ISO-001", "2026-07-01", res1)

        # Card 142 equivalent query
        card142_sql = """
            SELECT a.run_id, a.order_id, a.allocated_units, a.carrier, r.as_of_date
            FROM nubrix_poc_allocations a
            JOIN nubrix_poc_run_pointer p ON p.active_run_id = a.run_id
            JOIN nubrix_poc_runs r ON r.run_id = a.run_id
        """
        card145_sql = """
            SELECT a.carrier, COUNT(*), SUM(a.allocated_units)
            FROM nubrix_poc_allocations a
            JOIN nubrix_poc_run_pointer p ON p.active_run_id = a.run_id
            GROUP BY a.carrier
        """
        rows_142 = conn.execute(card142_sql).fetchall()
        rows_145 = conn.execute(card145_sql).fetchall()
        self.assertEqual(rows_142, [("RUN-ISO-001", "ORD-101", 120, "SwiftHaul", "2026-07-01")])
        self.assertEqual(rows_145, [("SwiftHaul", 1, 120)])

        # Run 2: 240 kegs
        res2 = planner.plan(self._make_snapshot(240))
        publish_to_sqlite(conn, "RUN-ISO-002", "2026-07-02", res2)
        rows_142_r2 = conn.execute(card142_sql).fetchall()
        rows_145_r2 = conn.execute(card145_sql).fetchall()
        self.assertEqual(rows_142_r2, [("RUN-ISO-002", "ORD-101", 240, "SwiftHaul", "2026-07-02")])
        self.assertEqual(rows_145_r2, [("SwiftHaul", 1, 240)])

        # Rollback to Run 1
        rollback_sqlite(conn, "RUN-ISO-001")
        rows_142_rb = conn.execute(card142_sql).fetchall()
        self.assertEqual(rows_142_rb, [("RUN-ISO-001", "ORD-101", 120, "SwiftHaul", "2026-07-01")])
        # Verify Run 2 rows are still preserved in history
        total_hist = conn.execute("SELECT COUNT(*) FROM nubrix_poc_runs").fetchone()[0]
        self.assertEqual(total_hist, 2)
        conn.close()

    def test_dashboard_backup_and_restore_roundtrip(self):
        fake_store = {
            "dashboard_23": {
                "id": 23,
                "name": "MicroStar Control Tower",
                "parameters": [{"id": "param_region", "name": "Region", "slug": "region", "type": "category"}],
                "dashcards": [{"id": 157, "card_id": 141, "col": 0, "row": 2, "size_x": 13, "size_y": 12}],
            },
            "card_141": {"id": 141, "name": "Original Map", "display": "map", "dataset_query": {}},
        }

        def fake_api(method: str, path: str, token: str, data=None):
            if method == "GET" and path == "/api/dashboard/23":
                return json.loads(json.dumps(fake_store["dashboard_23"]))
            if method == "GET" and path == "/api/card/141":
                return json.loads(json.dumps(fake_store["card_141"]))
            if method == "PUT" and path == "/api/dashboard/23":
                fake_store["dashboard_23"] = data
                return data
            if method == "PUT" and path == "/api/card/141":
                fake_store["card_141"] = data
                return data
            raise AssertionError(f"Unexpected call {method} {path}")

        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(cct, "api_request", side_effect=fake_api):
                backup_path = cct.backup_current_state("tok", Path(tmpdir))
                self.assertTrue(backup_path.exists())
                # Mutate state
                fake_api("PUT", "/api/card/141", "tok", {"id": 141, "name": "Mutated Map", "display": "table", "dataset_query": {}})
                self.assertEqual(fake_store["card_141"]["name"], "Mutated Map")
                # Restore from backup
                payload = json.loads(backup_path.read_text())
                for cid, card_obj in payload["cards"].items():
                    fake_api("PUT", f"/api/card/{cid}", "tok", card_obj)
                fake_api("PUT", "/api/dashboard/23", "tok", payload["dashboard"])
                self.assertEqual(fake_store["card_141"]["name"], "Original Map")


if __name__ == "__main__":
    unittest.main()
