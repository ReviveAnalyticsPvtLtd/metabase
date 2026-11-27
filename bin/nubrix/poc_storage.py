"""Isolated, versioned POC schema and run publisher for Nubrix Keg Logistics.

Stores runs in nubrix_poc_* tables without mutating existing tables or historical data.
Provides atomic active run pointer switching, verification invariants, and rollback.
"""

import base64
from datetime import date, datetime, timezone
import hashlib
import json
from typing import Any, Dict, List, Optional, Tuple
import zlib

import pymysql


CREATE_TABLES_SQL = [
    """
    CREATE TABLE IF NOT EXISTS `nubrix_poc_run_pointer` (
        `pointer_id` INT PRIMARY KEY DEFAULT 1,
        `active_run_id` VARCHAR(64) NOT NULL,
        `activated_at` DATETIME NOT NULL,
        `version` VARCHAR(32) NOT NULL,
        `description` VARCHAR(255) NULL
    ) ENGINE=InnoDB;
    """,
    """
    CREATE TABLE IF NOT EXISTS `nubrix_poc_runs` (
        `run_id` VARCHAR(64) PRIMARY KEY,
        `created_at` DATETIME NOT NULL,
        `as_of_date` DATE NOT NULL,
        `solver_status` VARCHAR(64) NOT NULL,
        `orders_total` INT NOT NULL,
        `orders_fully_covered` INT NOT NULL,
        `orders_partially_covered` INT NOT NULL,
        `orders_uncovered` INT NOT NULL,
        `kegs_ordered` INT NOT NULL,
        `kegs_allocated` INT NOT NULL,
        `total_freight_inr` DECIMAL(14,2) NOT NULL,
        `provenance_json` TEXT NOT NULL,
        `is_active` TINYINT(1) DEFAULT 0,
        KEY `idx_runs_active` (`is_active`),
        KEY `idx_runs_created` (`created_at`)
    ) ENGINE=InnoDB;
    """,
    """
    CREATE TABLE IF NOT EXISTS `nubrix_poc_allocations` (
        `allocation_id` VARCHAR(64) PRIMARY KEY,
        `run_id` VARCHAR(64) NOT NULL,
        `order_id` VARCHAR(64) NOT NULL,
        `destination_customer_id` VARCHAR(64) NOT NULL,
        `destination_brewer` VARCHAR(255) NOT NULL,
        `region` VARCHAR(32) NOT NULL,
        `customer_type` VARCHAR(64) NOT NULL,
        `keg_size` VARCHAR(16) NOT NULL,
        `ordered_date` DATE NOT NULL,
        `needed_by` DATE NOT NULL,
        `ordered_units` INT NOT NULL,
        `fulfilled_units` INT NOT NULL,
        `pending_units` INT NOT NULL,
        `allocated_units` INT NOT NULL,
        `proposed_on_time_units` INT NOT NULL,
        `uncovered_units` INT NOT NULL,
        `source_hub` VARCHAR(255) NOT NULL,
        `source_customer_id` VARCHAR(64) NULL,
        `distributor` VARCHAR(255) NOT NULL,
        `distributor_customer_id` VARCHAR(64) NULL,
        `carrier` VARCHAR(100) NOT NULL,
        `distance_km` INT NOT NULL,
        `freight_cost_inr` DECIMAL(12,2) NOT NULL,
        `transit_days` INT NOT NULL,
        `on_time_feasible` CHAR(1) NOT NULL,
        `planning_status` VARCHAR(32) NOT NULL,
        `explanation` TEXT NOT NULL,
        `planning_basis` VARCHAR(255) NOT NULL,
        `is_active_run` TINYINT(1) DEFAULT 0,
        KEY `idx_alloc_run_id` (`run_id`),
        KEY `idx_alloc_active` (`is_active_run`),
        KEY `idx_alloc_order` (`order_id`),
        KEY `idx_alloc_dest` (`destination_customer_id`),
        KEY `idx_alloc_region` (`region`),
        KEY `idx_alloc_carrier` (`carrier`)
    ) ENGINE=InnoDB;
    """,
    """
    CREATE TABLE IF NOT EXISTS `nubrix_poc_candidate_evidence` (
        `evidence_id` VARCHAR(64) PRIMARY KEY,
        `run_id` VARCHAR(64) NOT NULL,
        `order_id` VARCHAR(64) NOT NULL,
        `candidate_route_id` INT NOT NULL,
        `source_customer_id` VARCHAR(64) NOT NULL,
        `carrier_name` VARCHAR(100) NOT NULL,
        `distance_km` INT NOT NULL,
        `freight_cost_inr` DECIMAL(12,2) NOT NULL,
        `transit_days` INT NOT NULL,
        `slack_days` INT NOT NULL,
        `is_selected` TINYINT(1) NOT NULL,
        `rejection_reason` VARCHAR(255) NULL,
        KEY `idx_evid_run_order` (`run_id`, `order_id`)
    ) ENGINE=InnoDB;
    """,
    """
    CREATE TABLE IF NOT EXISTS `nubrix_poc_snapshots` (
        `run_id` VARCHAR(64) PRIMARY KEY,
        `snapshot_hash` VARCHAR(64) NOT NULL,
        `snapshot_json` LONGTEXT NOT NULL,
        `created_at` DATETIME NOT NULL
    ) ENGINE=InnoDB;
    """,
    """
    CREATE TABLE IF NOT EXISTS `nubrix_poc_distance_matrix` (
        `OriginCustomerId` VARCHAR(64) NOT NULL,
        `DestCustomerId` VARCHAR(64) NOT NULL,
        `RoadDistanceKm` INT NOT NULL,
        `lane_source` VARCHAR(64) NOT NULL DEFAULT 'synthetic_haversine_proxy',
        PRIMARY KEY (`OriginCustomerId`, `DestCustomerId`)
    ) ENGINE=InnoDB;
    """,
    """
    CREATE TABLE IF NOT EXISTS `nubrix_poc_trips` (
        `trip_id` VARCHAR(64) PRIMARY KEY,
        `run_id` VARCHAR(64) NOT NULL,
        `trip_code` VARCHAR(32) NOT NULL,
        `source_customer_id` VARCHAR(64) NOT NULL,
        `source_name` VARCHAR(255) NOT NULL,
        `source_role` VARCHAR(64) NOT NULL,
        `carrier_id` VARCHAR(64) NOT NULL,
        `carrier_name` VARCHAR(100) NOT NULL,
        `carrier_max_load_kegs` INT NOT NULL,
        `total_kegs` INT NOT NULL,
        `utilization_pct` DECIMAL(6,2) NOT NULL,
        `stop_count` INT NOT NULL,
        `total_distance_km` INT NOT NULL,
        `total_freight_inr` DECIMAL(12,2) NOT NULL,
        `dispatch_date` DATE NOT NULL,
        KEY `idx_trips_run` (`run_id`),
        KEY `idx_trips_code` (`run_id`, `trip_code`)
    ) ENGINE=InnoDB;
    """,
    """
    CREATE TABLE IF NOT EXISTS `nubrix_poc_trip_stops` (
        `stop_id` VARCHAR(80) PRIMARY KEY,
        `trip_id` VARCHAR(64) NOT NULL,
        `run_id` VARCHAR(64) NOT NULL,
        `trip_code` VARCHAR(32) NOT NULL,
        `stop_sequence` INT NOT NULL,
        `order_id` VARCHAR(64) NOT NULL,
        `destination_customer_id` VARCHAR(64) NOT NULL,
        `destination_name` VARCHAR(255) NOT NULL,
        `keg_size` VARCHAR(16) NOT NULL,
        `kegs_delivered` INT NOT NULL,
        `load_before_stop_kegs` INT NOT NULL,
        `load_after_stop_kegs` INT NOT NULL,
        `leg_from_id` VARCHAR(64) NOT NULL,
        `leg_from_name` VARCHAR(255) NOT NULL,
        `leg_distance_km` INT NOT NULL,
        `cumulative_distance_km` INT NOT NULL,
        `cumulative_transit_days` INT NOT NULL,
        `needed_by` DATE NOT NULL,
        `on_time_feasible` CHAR(1) NOT NULL,
        `allocated_freight_inr` DECIMAL(12,2) NOT NULL,
        KEY `idx_stops_run_order` (`run_id`, `order_id`),
        KEY `idx_stops_trip` (`trip_id`, `stop_sequence`)
    ) ENGINE=InnoDB;
    """,
    """
    CREATE TABLE IF NOT EXISTS `nubrix_poc_allocation_lines` (
        `line_id` VARCHAR(80) PRIMARY KEY,
        `run_id` VARCHAR(64) NOT NULL,
        `order_id` VARCHAR(64) NOT NULL,
        `line_seq` INT NOT NULL,
        `source_customer_id` VARCHAR(64) NOT NULL,
        `source_name` VARCHAR(255) NOT NULL,
        `source_role` VARCHAR(64) NOT NULL,
        `carrier_id` VARCHAR(64) NULL,
        `carrier` VARCHAR(100) NOT NULL,
        `allocated_units` INT NOT NULL,
        `distance_km` INT NOT NULL,
        `freight_cost_inr` DECIMAL(12,2) NOT NULL,
        `transit_days` INT NOT NULL,
        `trip_code` VARCHAR(32) NULL,
        `stop_sequence` INT NULL,
        KEY `idx_lines_run_order` (`run_id`, `order_id`)
    ) ENGINE=InnoDB;
    """,
]


class PocStorageManager:
    """Manages creation, publishing, verification, and rollback of POC tables."""

    def __init__(self, connection_params: Dict[str, Any]):
        self.params = connection_params

    def _get_connection(self):
        return pymysql.connect(
            host=self.params.get("host", "switchyard.proxy.rlwy.net"),
            port=int(self.params.get("port", 32007)),
            user=self.params.get("user", "root"),
            password=self.params.get("password", ""),
            database=self.params.get("database", "railway"),
            connect_timeout=15,
            charset="utf8mb4",
            autocommit=False,
        )

    def init_schema(self) -> None:
        """Create versioned POC tables idempotently without affecting live tables."""
        extra_columns = [
            ("nubrix_poc_runs", "planning_mode", "VARCHAR(64) NULL"),
            ("nubrix_poc_runs", "objective_policy", "VARCHAR(64) NULL"),
            ("nubrix_poc_runs", "split_policy", "VARCHAR(64) NULL"),
            ("nubrix_poc_runs", "omitted_candidates_total", "INT NULL"),
            ("nubrix_poc_runs", "snapshot_hash", "VARCHAR(64) NULL"),
            ("nubrix_poc_runs", "trips_total", "INT NULL"),
            ("nubrix_poc_runs", "shared_trips_count", "INT NULL"),
            ("nubrix_poc_allocations", "selected_candidate_id", "INT NULL"),
            ("nubrix_poc_allocations", "decision_stage", "VARCHAR(32) NULL"),
            ("nubrix_poc_allocations", "carrier_id", "VARCHAR(64) NULL"),
            ("nubrix_poc_allocations", "distributor_mode", "VARCHAR(32) NULL"),
            ("nubrix_poc_allocations", "omitted_candidates_count", "INT DEFAULT 0"),
            ("nubrix_poc_allocations", "trip_id", "VARCHAR(64) NULL"),
            ("nubrix_poc_allocations", "stop_sequence", "INT NULL"),
            ("nubrix_poc_trip_stops", "line_id", "VARCHAR(80) NULL"),
            ("nubrix_poc_candidate_evidence", "source_name", "VARCHAR(255) NULL"),
            ("nubrix_poc_candidate_evidence", "distributor_customer_id", "VARCHAR(64) NULL"),
            ("nubrix_poc_candidate_evidence", "distributor_name", "VARCHAR(255) NULL"),
            ("nubrix_poc_candidate_evidence", "carrier_id", "VARCHAR(64) NULL"),
            ("nubrix_poc_candidate_evidence", "candidate_quantity", "INT NULL"),
            ("nubrix_poc_candidate_evidence", "stock_available_kegs", "INT NULL"),
            ("nubrix_poc_candidate_evidence", "stock_remaining_kegs", "INT NULL"),
            ("nubrix_poc_candidate_evidence", "carrier_max_load_kegs", "INT NULL"),
            ("nubrix_poc_candidate_evidence", "is_feasible", "TINYINT(1) NULL"),
            ("nubrix_poc_candidate_evidence", "reason_code", "VARCHAR(64) NULL"),
            ("nubrix_poc_candidate_evidence", "competing_order_ids", "VARCHAR(255) NULL"),
            ("nubrix_poc_candidate_evidence", "decision_stage", "VARCHAR(32) NULL"),
            ("nubrix_poc_candidate_evidence", "cost_formula", "VARCHAR(255) NULL"),
        ]
        conn = self._get_connection()
        try:
            with conn.cursor() as cursor:
                for ddl in CREATE_TABLES_SQL:
                    cursor.execute(ddl)
                for table_name, col_name, col_def in extra_columns:
                    cursor.execute(
                        """
                        SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s
                        """,
                        (table_name, col_name),
                    )
                    if cursor.fetchone()[0] == 0:
                        cursor.execute(f"ALTER TABLE `{table_name}` ADD COLUMN `{col_name}` {col_def}")
            conn.commit()
        finally:
            conn.close()

    def get_active_run_id(self) -> Optional[str]:
        conn = self._get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute("SELECT active_run_id FROM nubrix_poc_run_pointer WHERE pointer_id = 1")
                row = cursor.fetchone()
                return row[0] if row else None
        except Exception:
            return None
        finally:
            conn.close()

    def publish_run(
        self,
        run_id: str,
        as_of_date: date,
        plan_result: Dict[str, Any],
        allocations: List[Dict[str, Any]],
        evidence_list: Optional[List[Dict[str, Any]]] = None,
        set_active: bool = True,
    ) -> Dict[str, Any]:
        """Atomically persist plan results and switch the active pointer if validated."""
        # 1. Independent invariant checks
        for alloc in allocations:
            if alloc["allocated_units"] < 0:
                raise ValueError(f"Negative allocation: {alloc}")
            if alloc["allocated_units"] > alloc["pending_units"]:
                raise ValueError(f"Overallocated: {alloc}")
            if alloc["distance_km"] < 0:
                raise ValueError(f"Negative distance: {alloc}")
            expected_pending = max(0, int(alloc["ordered_units"]) - int(alloc["fulfilled_units"]))
            if int(alloc["pending_units"]) != expected_pending:
                raise ValueError(f"Pending quantity mismatch for {alloc['order_id']}: {alloc['pending_units']} != {expected_pending}")
            lines = alloc.get("allocation_lines") or []
            if lines and sum(int(line["allocated_units"]) for line in lines) != int(alloc["allocated_units"]):
                raise ValueError(f"Shipment lines do not reconcile for {alloc['order_id']}")
            expected_status = (
                "Fully covered" if int(alloc["allocated_units"]) == int(alloc["pending_units"])
                else ("Partially covered" if int(alloc["allocated_units"]) > 0 else "No allocation")
            )
            if alloc["planning_status"] != expected_status:
                raise ValueError(f"Coverage status mismatch for {alloc['order_id']}")

        total_ordered = sum(a["pending_units"] for a in allocations)
        total_allocated = sum(a["allocated_units"] for a in allocations)
        total_freight = sum(float(a["freight_cost_inr"]) for a in allocations)
        fully_covered = sum(1 for a in allocations if a["planning_status"] == "Fully covered")
        partially_covered = sum(1 for a in allocations if a["planning_status"] == "Partially covered")
        uncovered = sum(1 for a in allocations if a["planning_status"] == "No allocation")

        conn = self._get_connection()
        try:
            with conn.cursor() as cursor:
                now_dt = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

                # Insert Run
                cursor.execute("""
                    INSERT INTO nubrix_poc_runs (
                        run_id, created_at, as_of_date, solver_status, orders_total,
                        orders_fully_covered, orders_partially_covered, orders_uncovered,
                        kegs_ordered, kegs_allocated, total_freight_inr, provenance_json, is_active,
                        planning_mode, objective_policy, split_policy, omitted_candidates_total,
                        trips_total, shared_trips_count
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    run_id, now_dt, as_of_date.strftime("%Y-%m-%d"),
                    plan_result.get("solver_status", "optimal_over_candidates"),
                    len(allocations), fully_covered, partially_covered, uncovered,
                    total_ordered, total_allocated, total_freight,
                    json.dumps(plan_result.get("provenance", {})),
                    1 if set_active else 0,
                    plan_result.get("planning_mode", "MODE_A_ORDER_LEVEL"),
                    plan_result.get("objective_policy", "lexicographic_equivalent_weighted_v2"),
                    plan_result.get("split_policy", "single_source_per_order"),
                    plan_result.get("omitted_candidates_total"),
                    plan_result.get("trips_total", 0),
                    plan_result.get("shared_trips_count", 0),
                ))

                # Insert Allocations
                alloc_sql = """
                    INSERT INTO nubrix_poc_allocations (
                        allocation_id, run_id, order_id, destination_customer_id, destination_brewer,
                        region, customer_type, keg_size, ordered_date, needed_by,
                        ordered_units, fulfilled_units, pending_units, allocated_units,
                        proposed_on_time_units, uncovered_units, source_hub, source_customer_id,
                        distributor, distributor_customer_id, carrier, distance_km,
                        freight_cost_inr, transit_days, on_time_feasible, planning_status,
                        explanation, planning_basis, is_active_run,
                        selected_candidate_id, decision_stage, carrier_id, distributor_mode, omitted_candidates_count,
                        trip_id, stop_sequence
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s
                    )
                """
                alloc_data = [
                    (
                        a["allocation_id"], run_id, a["order_id"], a["destination_customer_id"], a["destination_brewer"],
                        a["region"], a.get("customer_type", "Brewer"), a["keg_size"], a["ordered_date"], a["needed_by"],
                        a["ordered_units"], a["fulfilled_units"], a["pending_units"], a["allocated_units"],
                        a["proposed_on_time_units"], a["uncovered_units"], a["source_hub"], a.get("source_customer_id"),
                        a["distributor"], a.get("distributor_customer_id"), a["carrier"], a["distance_km"],
                        a["freight_cost_inr"], a["transit_days"], a["on_time_feasible"], a["planning_status"],
                        a["explanation"], a.get("planning_basis", "Deterministic OR-Tools Optimization"),
                        1 if set_active else 0,
                        a.get("selected_candidate_id"), a.get("decision_stage"), a.get("carrier_id"),
                        a.get("distributor_mode", "coordinator"), int(a.get("omitted_candidates_count", 0) or 0),
                        a.get("trip_id"), a.get("stop_sequence"),
                    )
                    for a in allocations
                ]
                cursor.executemany(alloc_sql, alloc_data)

                # Insert consolidated trips & stops if present
                trips_list = plan_result.get("trips") or []
                if trips_list:
                    trip_sql = """
                        INSERT INTO nubrix_poc_trips (
                            trip_id, run_id, trip_code, source_customer_id, source_name, source_role,
                            carrier_id, carrier_name, carrier_max_load_kegs, total_kegs, utilization_pct,
                            stop_count, total_distance_km, total_freight_inr, dispatch_date
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """
                    trip_rows = []
                    stop_rows = []
                    for t in trips_list:
                        full_tid = f"{run_id}-{t['trip_code']}"
                        trip_rows.append((
                            full_tid, run_id, t["trip_code"], t["source_customer_id"], t["source_name"], t["source_role"],
                            t["carrier_id"], t["carrier_name"], t["carrier_max_load_kegs"], t["total_kegs"], t["utilization_pct"],
                            t["stop_count"], t["total_distance_km"], t["total_freight_inr"], t["dispatch_date"],
                        ))
                        for st in t["stops"]:
                            line_seq_id = st.get("line_id") or f"{st['order_id']}#S1"
                            stop_id = f"{full_tid}-S{st['stop_sequence']:02d}"
                            stop_rows.append((
                                stop_id, full_tid, run_id, t["trip_code"], st["stop_sequence"], st["order_id"],
                                st["destination_customer_id"], st["destination_name"], st["keg_size"], st["kegs_delivered"],
                                st["load_before_stop_kegs"], st["load_after_stop_kegs"], st["leg_from_id"], st["leg_from_name"],
                                st["leg_distance_km"], st["cumulative_distance_km"], st["cumulative_transit_days"],
                                st["needed_by"], st["on_time_feasible"], st["allocated_freight_inr"], line_seq_id,
                            ))
                    cursor.executemany(trip_sql, trip_rows)
                    stop_sql = """
                        INSERT INTO nubrix_poc_trip_stops (
                            stop_id, trip_id, run_id, trip_code, stop_sequence, order_id,
                            destination_customer_id, destination_name, keg_size, kegs_delivered,
                            load_before_stop_kegs, load_after_stop_kegs, leg_from_id, leg_from_name,
                            leg_distance_km, cumulative_distance_km, cumulative_transit_days,
                            needed_by, on_time_feasible, allocated_freight_inr, line_id
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """
                    cursor.executemany(stop_sql, stop_rows)

                # Insert split/shipment allocation lines
                line_rows = []
                for a in allocations:
                    for ln in (a.get("allocation_lines") or []):
                        line_rows.append((
                            f"{run_id}-{ln['line_id']}",
                            run_id,
                            a["order_id"],
                            ln["line_seq"],
                            ln["source_customer_id"],
                            ln["source_name"],
                            ln["source_role"],
                            ln.get("carrier_id"),
                            ln["carrier"],
                            ln["allocated_units"],
                            ln["distance_km"],
                            ln["freight_cost_inr"],
                            ln["transit_days"],
                            ln.get("trip_code"),
                            ln.get("stop_sequence"),
                        ))
                if line_rows:
                    line_sql = """
                        INSERT INTO nubrix_poc_allocation_lines (
                            line_id, run_id, order_id, line_seq, source_customer_id, source_name,
                            source_role, carrier_id, carrier, allocated_units, distance_km,
                            freight_cost_inr, transit_days, trip_code, stop_sequence
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """
                    cursor.executemany(line_sql, line_rows)

                # Insert Evidence if provided
                if evidence_list:
                    evid_sql = """
                        INSERT INTO nubrix_poc_candidate_evidence (
                            evidence_id, run_id, order_id, candidate_route_id, source_customer_id,
                            carrier_name, distance_km, freight_cost_inr, transit_days, slack_days,
                            is_selected, rejection_reason,
                            source_name, distributor_customer_id, distributor_name, carrier_id,
                            candidate_quantity, stock_available_kegs, stock_remaining_kegs,
                            carrier_max_load_kegs, is_feasible, reason_code, competing_order_ids,
                            decision_stage, cost_formula
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                        )
                    """
                    evid_data = [
                        (
                            e["evidence_id"], run_id, e["order_id"], e["candidate_route_id"], e["source_customer_id"],
                            e["carrier_name"], e["distance_km"], e["freight_cost_inr"], e["transit_days"], e["slack_days"],
                            1 if e["is_selected"] else 0, e.get("rejection_reason"),
                            e.get("source_name"), e.get("distributor_customer_id"), e.get("distributor_name"),
                            e.get("carrier_id"), e.get("candidate_quantity"), e.get("stock_available_kegs"),
                            e.get("stock_remaining_kegs"), e.get("carrier_max_load_kegs"),
                            (1 if e["is_feasible"] else 0) if e.get("is_feasible") is not None else None,
                            e.get("reason_code"), e.get("competing_order_ids"),
                            e.get("decision_stage"), e.get("cost_formula"),
                        )
                        for e in evidence_list
                    ]
                    cursor.executemany(evid_sql, evid_data)

                # If set_active, update pointer and reset other runs' is_active flag
                if set_active:
                    cursor.execute("UPDATE nubrix_poc_runs SET is_active = 0 WHERE run_id != %s", (run_id,))
                    cursor.execute("UPDATE nubrix_poc_allocations SET is_active_run = 0 WHERE run_id != %s", (run_id,))
                    cursor.execute("""
                        INSERT INTO nubrix_poc_run_pointer (pointer_id, active_run_id, activated_at, version, description)
                        VALUES (1, %s, %s, 'v1.0-poc', 'Active validated planning run')
                        ON DUPLICATE KEY UPDATE active_run_id = VALUES(active_run_id), activated_at = VALUES(activated_at)
                    """, (run_id, now_dt))

            conn.commit()
        finally:
            conn.close()

        return {
            "run_id": run_id,
            "status": "PUBLISHED",
            "is_active": set_active,
            "orders_count": len(allocations),
            "allocated_kegs": total_allocated,
            "total_freight_inr": total_freight,
        }

    def save_snapshot(self, run_id: str, snapshot: Dict[str, Any]) -> str:
        """Persist compressed immutable snapshot JSON and SHA-256 hash for a published run."""
        payload = json.dumps(snapshot, sort_keys=True, separators=(",", ":"))
        snap_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        compressed = "zlib+b64:" + base64.b64encode(zlib.compress(payload.encode("utf-8"), level=6)).decode("ascii")
        now_dt = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        conn = self._get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO nubrix_poc_snapshots (run_id, snapshot_hash, snapshot_json, created_at)
                    VALUES (%s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE snapshot_hash = VALUES(snapshot_hash), snapshot_json = VALUES(snapshot_json)
                    """,
                    (run_id, snap_hash, compressed, now_dt),
                )
                cursor.execute(
                    "UPDATE nubrix_poc_runs SET snapshot_hash = %s WHERE run_id = %s",
                    (snap_hash, run_id),
                )
            conn.commit()
            return snap_hash
        finally:
            conn.close()

    def load_snapshot_by_run_id(self, run_id: str) -> Tuple[Dict[str, Any], str]:
        """Load and verify the immutable snapshot for a run_id."""
        conn = self._get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT snapshot_hash, snapshot_json FROM nubrix_poc_snapshots WHERE run_id = %s LIMIT 1",
                    (run_id,),
                )
                row = cursor.fetchone()
                if not row:
                    raise ValueError(f"No immutable snapshot persisted for run {run_id}")
                expected_hash, stored = row
                if stored.startswith("zlib+b64:"):
                    payload = zlib.decompress(base64.b64decode(stored[len("zlib+b64:"):])).decode("utf-8")
                else:
                    payload = stored
                actual_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()
                if actual_hash != expected_hash:
                    raise ValueError(f"Snapshot hash mismatch for run {run_id}: {actual_hash} != {expected_hash}")
                return json.loads(payload), actual_hash
        finally:
            conn.close()

    def rollback_to_run(self, previous_run_id: str) -> None:
        """Atomically point active_run back to a previous run."""
        conn = self._get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute("SELECT run_id FROM nubrix_poc_runs WHERE run_id = %s", (previous_run_id,))
                if not cursor.fetchone():
                    raise ValueError(f"Run {previous_run_id} does not exist for rollback")
                now_dt = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                cursor.execute("UPDATE nubrix_poc_runs SET is_active = (run_id = %s)", (previous_run_id,))
                cursor.execute("UPDATE nubrix_poc_allocations SET is_active_run = (run_id = %s)", (previous_run_id,))
                cursor.execute("""
                    UPDATE nubrix_poc_run_pointer
                    SET active_run_id = %s, activated_at = %s, description = 'Rolled back to prior run'
                    WHERE pointer_id = 1
                """, (previous_run_id, now_dt))
            conn.commit()
        finally:
            conn.close()
