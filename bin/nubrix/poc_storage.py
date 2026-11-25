"""Isolated, versioned POC schema and run publisher for Nubrix Keg Logistics.

Stores runs in nubrix_poc_* tables without mutating existing tables or historical data.
Provides atomic active run pointer switching, verification invariants, and rollback.
"""

from datetime import date, datetime, timezone
import json
from typing import Any, Dict, List, Optional, Tuple

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
        `solver_status` VARCHAR(32) NOT NULL,
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
        conn = self._get_connection()
        try:
            with conn.cursor() as cursor:
                for ddl in CREATE_TABLES_SQL:
                    cursor.execute(ddl)
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

        total_ordered = sum(a["ordered_units"] for a in allocations)
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
                        kegs_ordered, kegs_allocated, total_freight_inr, provenance_json, is_active
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    run_id, now_dt, as_of_date.strftime("%Y-%m-%d"),
                    plan_result.get("solver_status", "optimal_over_candidates"),
                    len(allocations), fully_covered, partially_covered, uncovered,
                    total_ordered, total_allocated, total_freight,
                    json.dumps(plan_result.get("provenance", {})),
                    1 if set_active else 0,
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
                        explanation, planning_basis, is_active_run
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s, %s
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
                    )
                    for a in allocations
                ]
                cursor.executemany(alloc_sql, alloc_data)

                # Insert Evidence if provided
                if evidence_list:
                    evid_sql = """
                        INSERT INTO nubrix_poc_candidate_evidence (
                            evidence_id, run_id, order_id, candidate_route_id, source_customer_id,
                            carrier_name, distance_km, freight_cost_inr, transit_days, slack_days,
                            is_selected, rejection_reason
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """
                    evid_data = [
                        (
                            e["evidence_id"], run_id, e["order_id"], e["candidate_route_id"], e["source_customer_id"],
                            e["carrier_name"], e["distance_km"], e["freight_cost_inr"], e["transit_days"], e["slack_days"],
                            1 if e["is_selected"] else 0, e.get("rejection_reason"),
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
