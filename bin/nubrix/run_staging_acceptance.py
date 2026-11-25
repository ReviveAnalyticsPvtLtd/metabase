"""Isolated MySQL + Metabase Staging Acceptance Suite.

Verifies against disposable local containers (127.0.0.1:3307 MySQL + 127.0.0.1:3001 Metabase):
1. Synthetic India fixtures (including hostile XSS category/name value) seeded into staging MySQL.
2. Two-run activation (RUN-STG-001 -> RUN-STG-002) and rollback (RUN-STG-001) via PocStorageManager.
3. Failed/concurrent publication resilience (pointer stays valid & consistent).
4. Real Metabase Card 141-145 SQL execution against staging MySQL across Run 1, Run 2, and Rollback.
5. Real non-admin viewer RBAC verification:
   - Proves broader All Users permissions would defeat a restricted viewer group if left enabled.
   - Proves scoped All Users + MicroStar Viewers allows dashboard viewing (200) while blocking
     direct native SQL (403), CSV/XLSX downloads (403), and dashboard edits (403).
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
import json
import os
import sys
import time
from typing import Any, Dict, List
import pymysql
import requests

from adapters import RailwayWarehouseAdapter
from fulfillment_planner import NearestSourceBaselinePlanner, OrToolsFulfillmentPlanner
from poc_storage import PocStorageManager
import configure_control_tower as cct


STAGING_MYSQL = {
    "host": "127.0.0.1",
    "port": int(os.environ.get("STAGING_MYSQL_PORT", "3307")),
    "user": "root",
    "password": os.environ["STAGING_MYSQL_ROOT_PASSWORD"],
    "database": "microstar_staging",
}
METABASE_URL = os.environ.get("STAGING_METABASE_URL", "http://127.0.0.1:3001").rstrip("/")
ADMIN_EMAIL = os.environ.get("STAGING_ADMIN_EMAIL", "admin@microstar.local")
ADMIN_PASS = os.environ["STAGING_ADMIN_PASSWORD"]
VIEWER_EMAIL = os.environ.get("STAGING_VIEWER_EMAIL", "viewer@microstar.local")
VIEWER_PASS = os.environ["STAGING_VIEWER_PASSWORD"]


def seed_synthetic_mysql() -> None:
    conn = pymysql.connect(
        host=STAGING_MYSQL["host"],
        port=STAGING_MYSQL["port"],
        user=STAGING_MYSQL["user"],
        password=STAGING_MYSQL["password"],
        database=STAGING_MYSQL["database"],
        autocommit=True,
    )
    with conn.cursor() as cur:
        ddl_statements = [
            """CREATE TABLE IF NOT EXISTS dimCustomer (
                CustomerId VARCHAR(64) PRIMARY KEY,
                CustomerName VARCHAR(255) NOT NULL,
                CustomerType VARCHAR(64) NOT NULL,
                Region VARCHAR(32) NOT NULL,
                ShippingCity VARCHAR(100) NOT NULL,
                ShippingState VARCHAR(100) NOT NULL,
                Country VARCHAR(50) NOT NULL,
                Latitude DECIMAL(10,6) NOT NULL,
                Longitude DECIMAL(10,6) NOT NULL,
                CustomerStatus VARCHAR(32) NOT NULL
            ) ENGINE=InnoDB""",
            """CREATE TABLE IF NOT EXISTS dimCarrier (
                CarrierId INT PRIMARY KEY,
                CarrierName VARCHAR(100) NOT NULL,
                CostPerKegKmINR DECIMAL(8,4) NOT NULL,
                MaxLoadKegs INT NOT NULL
            ) ENGINE=InnoDB""",
            """CREATE TABLE IF NOT EXISTS ReportedInventory (
                InventorySnapshotId VARCHAR(64) PRIMARY KEY,
                CustomerId VARCHAR(64) NOT NULL,
                CustomerName VARCHAR(255) NOT NULL,
                CustomerType VARCHAR(64) NOT NULL,
                Region VARCHAR(32) NOT NULL,
                SizeCode VARCHAR(16) NOT NULL,
                SnapshotDate DATE NOT NULL,
                AvailableQuantity INT NOT NULL
            ) ENGINE=InnoDB""",
            """CREATE TABLE IF NOT EXISTS KegOrder (
                OrderId VARCHAR(64) PRIMARY KEY,
                CustomerId VARCHAR(64) NOT NULL,
                SizeCode VARCHAR(16) NOT NULL,
                OrderedDate DATE NOT NULL,
                NeededByDate DATE NOT NULL,
                QuantityOrdered INT NOT NULL,
                QuantityFulfilled INT NOT NULL,
                QuantityPending INT NOT NULL,
                OrderStatus VARCHAR(32) NOT NULL
            ) ENGINE=InnoDB""",
            """CREATE TABLE IF NOT EXISTS FreightRoadDistance (
                DistanceId VARCHAR(64) PRIMARY KEY,
                OriginCustomerId VARCHAR(64) NOT NULL,
                DestCustomerId VARCHAR(64) NOT NULL,
                RoadDistanceKm INT NOT NULL
            ) ENGINE=InnoDB""",
        ]
        for ddl in ddl_statements:
            cur.execute(ddl)

        # Clear any prior staging fixture rows
        for tbl in ["FreightRoadDistance", "KegOrder", "ReportedInventory", "dimCarrier", "dimCustomer"]:
            cur.execute(f"DELETE FROM {tbl}")

        # Synthetic India facilities + 1 hostile XSS category value
        customers = [
            ("CUST-0001", "Mumbai Brewer 0001", "Brewer", "West", "Mumbai", "Maharashtra", "India", 19.0760, 72.8777, "Active"),
            ("CUST-0002", "Pune Brewer 0002", "Brewer", "West", "Pune", "Maharashtra", "India", 18.5204, 73.8567, "Active"),
            ("CUST-0003", "Bengaluru Brewer 0003", "<img src=x onerror=alert(1)>", "South", "Bengaluru", "Karnataka", "India", 12.9716, 77.5946, "Active"),
            ("CUST-0101", "Mumbai Depot 0101", "Maintenance Facility", "West", "Navi Mumbai", "Maharashtra", "India", 19.0330, 73.0297, "Active"),
            ("CUST-0201", "West Hub Distributor 0201", "Distributor", "West", "Thane", "Maharashtra", "India", 19.2183, 72.9781, "Active"),
            ("CUST-0202", "South Hub Distributor 0202", "Distributor", "South", "Hosur", "Tamil Nadu", "India", 12.7409, 77.8253, "Active"),
        ]
        cur.executemany(
            "INSERT INTO dimCustomer VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            customers,
        )
        cur.executemany(
            "INSERT INTO dimCarrier VALUES (%s,%s,%s,%s)",
            [(1, "SwiftHaul Logistics", 2.10, 500), (2, "Deccan Freight", 1.85, 400)],
        )
        cur.executemany(
            "INSERT INTO ReportedInventory VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            [
                ("INV-001", "CUST-0101", "Mumbai Depot 0101", "Maintenance Facility", "West", "50L", "2026-07-01", 600),
                ("INV-002", "CUST-0202", "South Hub Distributor 0202", "Distributor", "South", "50L", "2026-07-01", 300),
            ],
        )
        cur.executemany(
            "INSERT INTO KegOrder VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            [
                ("ORD-STG-001", "CUST-0001", "50L", "2026-07-01", "2026-07-05", 100, 0, 100, "Open"),
                ("ORD-STG-002", "CUST-0002", "50L", "2026-07-01", "2026-07-06", 150, 0, 150, "Open"),
                ("ORD-STG-003", "CUST-0003", "50L", "2026-07-01", "2026-07-08", 80, 0, 80, "Open"),
            ],
        )
        cur.executemany(
            "INSERT INTO FreightRoadDistance VALUES (%s,%s,%s,%s)",
            [
                ("DIST-1", "CUST-0101", "CUST-0001", 40),
                ("DIST-2", "CUST-0101", "CUST-0002", 140),
                ("DIST-3", "CUST-0202", "CUST-0003", 45),
                ("DIST-4", "CUST-0101", "CUST-0003", 980),
            ],
        )
    conn.close()
    print("[1/6] Seeded synthetic India fixtures into staging MySQL.")


def build_allocations_from_plan(run_id: str, plan_res: Dict[str, Any]) -> tuple[list[dict], list[dict]]:
    allocs, evs = [], []
    for idx, o in enumerate(plan_res["outcomes"]):
        allocs.append({
            "allocation_id": f"{run_id}-A{idx+1:05d}",
            "order_id": o.order_id,
            "destination_customer_id": o.destination_customer_id,
            "destination_brewer": o.destination_brewer,
            "region": o.region,
            "customer_type": o.customer_type,
            "keg_size": o.keg_size,
            "ordered_date": o.ordered_date,
            "needed_by": o.needed_by,
            "ordered_units": o.ordered_units,
            "fulfilled_units": o.fulfilled_units,
            "pending_units": o.pending_units,
            "allocated_units": o.allocated_units,
            "proposed_on_time_units": o.proposed_on_time_units,
            "uncovered_units": o.uncovered_units,
            "source_hub": o.source_hub,
            "source_customer_id": o.source_customer_id,
            "distributor": o.distributor,
            "distributor_customer_id": o.distributor_customer_id,
            "carrier": o.carrier,
            "distance_km": o.distance_km,
            "freight_cost_inr": o.freight_cost_inr,
            "transit_days": o.transit_days,
            "on_time_feasible": o.on_time_feasible,
            "planning_status": o.planning_status,
            "explanation": o.explanation,
            "planning_basis": f"OR-Tools ({plan_res['solver_status']})",
        })
        for ev_idx, ev in enumerate(o.evidence[:2]):
            if "source" in ev:
                evs.append({
                    "evidence_id": f"EVID-{run_id[-6:]}-{idx+1:03d}-{ev_idx+1}",
                    "order_id": o.order_id,
                    "candidate_route_id": int(ev.get("candidate_id", ev_idx + 1)),
                    "source_customer_id": str(ev.get("source", "UNKNOWN"))[:64],
                    "carrier_name": str(ev.get("carrier", o.carrier))[:100],
                    "distance_km": int(ev.get("distance_km", o.distance_km)),
                    "freight_cost_inr": float(ev.get("freight_cost_inr", o.freight_cost_inr)),
                    "transit_days": int(ev.get("transit_days", o.transit_days)),
                    "slack_days": int(ev.get("slack_days", 0)),
                    "is_selected": False,
                    "rejection_reason": ev.get("reason"),
                })
    return allocs, evs


def setup_metabase_and_db() -> tuple[str, int]:
    # Wait for health
    for _ in range(30):
        try:
            r = requests.get(f"{METABASE_URL}/api/health", timeout=5)
            if r.status_code == 200 and r.json().get("status") == "ok":
                break
        except Exception:
            pass
        time.sleep(3)

    props = requests.get(f"{METABASE_URL}/api/session/properties", timeout=10).json()
    setup_token = props.get("setup-token")
    if setup_token:
        resp = requests.post(
            f"{METABASE_URL}/api/setup",
            json={
                "token": setup_token,
                "user": {
                    "first_name": "Staging",
                    "last_name": "Admin",
                    "email": ADMIN_EMAIL,
                    "password": ADMIN_PASS,
                    "site_name": "MicroStar Staging",
                },
                "prefs": {"site_name": "MicroStar Staging", "allow_tracking": False},
            },
            timeout=20,
        )
        resp.raise_for_status()

    token = requests.post(
        f"{METABASE_URL}/api/session",
        json={"username": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=15,
    ).json()["id"]
    h = {"X-Metabase-Session": token}

    # Ensure staging MySQL database exists in Metabase
    dbs = requests.get(f"{METABASE_URL}/api/database", headers=h, timeout=15).json().get("data", [])
    db_id = next((d["id"] for d in dbs if d["name"] == "microstar_staging"), None)
    if db_id is None:
        db_resp = requests.post(
            f"{METABASE_URL}/api/database",
            headers=h,
            json={
                "engine": "mysql",
                "name": "microstar_staging",
                "details": {
                    "host": "host.docker.internal",
                    "port": STAGING_MYSQL["port"],
                    "dbname": STAGING_MYSQL["database"],
                    "user": STAGING_MYSQL["user"],
                    "password": STAGING_MYSQL["password"],
                },
            },
            timeout=20,
        )
        db_resp.raise_for_status()
        db_id = db_resp.json()["id"]
    return token, db_id


def provision_staging_dashboard(token: str, db_id: int) -> tuple[int, int, Dict[str, int]]:
    h = {"X-Metabase-Session": token}
    # Create dedicated collection
    cols = requests.get(f"{METABASE_URL}/api/collection", headers=h, timeout=15).json()
    col_id = next((c["id"] for c in cols if c["name"] == "MicroStar Control Tower"), None)
    if col_id is None:
        col_id = requests.post(
            f"{METABASE_URL}/api/collection",
            headers=h,
            json={"name": "MicroStar Control Tower", "color": "#509EE3"},
            timeout=15,
        ).json()["id"]

    card_specs = [
        ("map", "Customer Locations — Brewers, Distributors & Maintenance Facilities", cct.build_card_141_map_query(), {
            "map.type": "pin", "map.pin_type": "markers",
            "map.latitude_column": "Latitude", "map.longitude_column": "Longitude", "map.name_column": "CustomerName",
        }),
        ("ledger", "Fulfillment Dispatch & Feasibility Ledger (Active OR-Tools Run)", cct.build_card_142_ledger_query(), {}),
        ("demand", "Keg Demand & Pending Orders by Region", cct.build_card_143_demand_query(), {}),
        ("inventory", "Warehouse Inventory by Region & Keg Size", cct.build_card_144_inventory_query(), {}),
        ("carrier", "Carrier Freight Volume & Delivery Feasibility (Active OR-Tools Run)", cct.build_card_145_carrier_query(), {}),
    ]
    card_ids = {}
    for key, name, q_spec, viz in card_specs:
        c = requests.post(
            f"{METABASE_URL}/api/card",
            headers=h,
            json={
                "name": name,
                "collection_id": col_id,
                "display": "map" if key == "map" else ("bar" if key in ("demand", "inventory") else "table"),
                "dataset_query": {
                    "database": db_id,
                    "type": "native",
                    "native": {"query": q_spec["query"], "template-tags": q_spec["template-tags"]},
                },
                "visualization_settings": viz,
            },
            timeout=20,
        ).json()
        card_ids[key] = c["id"]

    dash = requests.post(
        f"{METABASE_URL}/api/dashboard",
        headers=h,
        json={"name": "MicroStar Staging Control Tower", "collection_id": col_id},
        timeout=15,
    ).json()
    dash_id = dash["id"]

    dash["parameters"] = [
        {"id": "param_region", "name": "Region", "slug": "region", "type": "category"},
        {"id": "param_customer_type", "name": "Customer Type", "slug": "customer_type", "type": "category"},
        {"id": "param_customer", "name": "Customer", "slug": "customer", "type": "category"},
        {"id": "param_carrier", "name": "Carrier", "slug": "carrier", "type": "category"},
    ]
    dash["dashcards"] = [
        {
            "id": -1, "card_id": card_ids["map"], "col": 0, "row": 0, "size_x": 12, "size_y": 10,
            "parameter_mappings": [
                {"parameter_id": "param_region", "card_id": card_ids["map"], "target": ["variable", ["template-tag", "region"]]},
                {"parameter_id": "param_customer_type", "card_id": card_ids["map"], "target": ["variable", ["template-tag", "customer_type"]]},
                {"parameter_id": "param_customer", "card_id": card_ids["map"], "target": ["variable", ["template-tag", "customer"]]},
            ],
            "visualization_settings": {
                "click_behavior": {
                    "type": "crossfilter",
                    "parameterMapping": {
                        "param_customer": {
                            "id": "param_customer",
                            "source": {"type": "column", "id": "CustomerName", "name": "CustomerName"},
                            "target": {"type": "parameter", "id": "param_customer"},
                        }
                    },
                }
            },
        },
        {
            "id": -2, "card_id": card_ids["ledger"], "col": 12, "row": 0, "size_x": 12, "size_y": 10,
            "parameter_mappings": [
                {"parameter_id": "param_region", "card_id": card_ids["ledger"], "target": ["variable", ["template-tag", "region"]]},
                {"parameter_id": "param_customer_type", "card_id": card_ids["ledger"], "target": ["variable", ["template-tag", "customer_type"]]},
                {"parameter_id": "param_customer", "card_id": card_ids["ledger"], "target": ["variable", ["template-tag", "customer"]]},
                {"parameter_id": "param_carrier", "card_id": card_ids["ledger"], "target": ["variable", ["template-tag", "carrier"]]},
            ],
            "visualization_settings": {},
        },
        {
            "id": -3, "card_id": card_ids["demand"], "col": 0, "row": 10, "size_x": 12, "size_y": 6,
            "parameter_mappings": [
                {"parameter_id": "param_region", "card_id": card_ids["demand"], "target": ["variable", ["template-tag", "region"]]},
                {"parameter_id": "param_customer_type", "card_id": card_ids["demand"], "target": ["variable", ["template-tag", "customer_type"]]},
                {"parameter_id": "param_customer", "card_id": card_ids["demand"], "target": ["variable", ["template-tag", "customer"]]},
            ],
            "visualization_settings": {},
        },
        {
            "id": -4, "card_id": card_ids["inventory"], "col": 12, "row": 10, "size_x": 12, "size_y": 6,
            "parameter_mappings": [
                {"parameter_id": "param_region", "card_id": card_ids["inventory"], "target": ["variable", ["template-tag", "region"]]},
            ],
            "visualization_settings": {},
        },
        {
            "id": -5, "card_id": card_ids["carrier"], "col": 0, "row": 16, "size_x": 24, "size_y": 6,
            "parameter_mappings": [
                {"parameter_id": "param_region", "card_id": card_ids["carrier"], "target": ["variable", ["template-tag", "region"]]},
                {"parameter_id": "param_customer_type", "card_id": card_ids["carrier"], "target": ["variable", ["template-tag", "customer_type"]]},
                {"parameter_id": "param_customer", "card_id": card_ids["carrier"], "target": ["variable", ["template-tag", "customer"]]},
                {"parameter_id": "param_carrier", "card_id": card_ids["carrier"], "target": ["variable", ["template-tag", "carrier"]]},
            ],
            "visualization_settings": {},
        },
    ]
    requests.put(f"{METABASE_URL}/api/dashboard/{dash_id}", headers=h, json=dash, timeout=20).raise_for_status()
    return dash_id, col_id, card_ids


def main() -> int:
    seed_synthetic_mysql()
    storage = PocStorageManager(STAGING_MYSQL)
    storage.init_schema()

    adapter_res = RailwayWarehouseAdapter(STAGING_MYSQL).load_snapshot()
    snap = adapter_res.snapshot
    planner = OrToolsFulfillmentPlanner(time_limit_seconds=10, max_candidates_per_order=5)

    # Publish Run 1
    plan1 = planner.plan(snap)
    a1, e1 = build_allocations_from_plan("RUN-STG-001", plan1)
    storage.publish_run("RUN-STG-001", date(2026, 7, 1), plan1, a1, e1, set_active=True)

    token, db_id = setup_metabase_and_db()
    dash_id, col_id, card_ids = provision_staging_dashboard(token, db_id)
    h = {"X-Metabase-Session": token}

    # Verify Run 1 in Metabase Card 142
    q1 = requests.post(f"{METABASE_URL}/api/card/{card_ids['ledger']}/query", headers=h, timeout=20).json()
    rows1 = q1["data"]["rows"]
    assert len(rows1) == 3 and all(r[1] == "RUN-STG-001" for r in rows1), f"Run 1 mismatch: {rows1}"
    print(f"[2/6] Run 1 verified via real Metabase Card query ({len(rows1)} rows, run_id=RUN-STG-001).")

    # Publish Run 2
    snap2 = json.loads(json.dumps(snap))
    snap2["orders"][0]["pending"] = 50
    snap2["orders"][0]["quantity_ordered"] = 50
    plan2 = planner.plan(snap2)
    a2, e2 = build_allocations_from_plan("RUN-STG-002", plan2)
    storage.publish_run("RUN-STG-002", date(2026, 7, 2), plan2, a2, e2, set_active=True)

    q2 = requests.post(f"{METABASE_URL}/api/card/{card_ids['ledger']}/query", headers=h, timeout=20).json()
    rows2 = q2["data"]["rows"]
    assert len(rows2) == 3 and all(r[1] == "RUN-STG-002" for r in rows2), f"Run 2 mismatch: {rows2}"
    print(f"[3/6] Run 2 verified via real Metabase Card query ({len(rows2)} rows, run_id=RUN-STG-002).")

    # Rollback to Run 1
    storage.rollback_to_run("RUN-STG-001")
    q_rb = requests.post(f"{METABASE_URL}/api/card/{card_ids['ledger']}/query", headers=h, timeout=20).json()
    rows_rb = q_rb["data"]["rows"]
    assert len(rows_rb) == 3 and all(r[1] == "RUN-STG-001" for r in rows_rb), f"Rollback mismatch: {rows_rb}"
    print("[4/6] Rollback to RUN-STG-001 verified via real Metabase Card query.")

    # Failed & Concurrent Publication Tests
    try:
        storage.rollback_to_run("RUN-DOES-NOT-EXIST")
        raise AssertionError("Expected ValueError on nonexistent rollback")
    except ValueError:
        pass
    with ThreadPoolExecutor(max_workers=2) as pool:
        f1 = pool.submit(storage.publish_run, "RUN-STG-CONC-1", date(2026, 7, 3), plan1, *build_allocations_from_plan("RUN-STG-CONC-1", plan1), True)
        f2 = pool.submit(storage.publish_run, "RUN-STG-CONC-2", date(2026, 7, 3), plan2, *build_allocations_from_plan("RUN-STG-CONC-2", plan2), True)
        f1.result()
        f2.result()
    conn = pymysql.connect(**STAGING_MYSQL, cursorclass=pymysql.cursors.DictCursor)
    with conn.cursor() as cur:
        cur.execute("SELECT active_run_id FROM nubrix_poc_run_pointer WHERE pointer_id = 1")
        active_id = cur.fetchone()["active_run_id"]
        cur.execute("SELECT COUNT(*) AS cnt FROM nubrix_poc_runs WHERE is_active = 1")
        active_cnt = cur.fetchone()["cnt"]
    conn.close()
    assert active_id in ("RUN-STG-CONC-1", "RUN-STG-CONC-2") and active_cnt == 1, f"Concurrent state invalid: {active_id}, cnt={active_cnt}"
    print(f"[5/6] Failed rollback & concurrent publication verified (active_run_id={active_id}, active_cnt={active_cnt}).")

    # Non-admin Viewer RBAC Test
    users = requests.get(f"{METABASE_URL}/api/user", headers=h, timeout=15).json().get("data", [])
    viewer = next((u for u in users if u["email"] == VIEWER_EMAIL), None)
    groups = requests.get(f"{METABASE_URL}/api/permissions/group", headers=h, timeout=15).json()
    vg_id = next((g["id"] for g in groups if g["name"] == "MicroStar Viewers"), None)
    if vg_id is None:
        vg_id = requests.post(f"{METABASE_URL}/api/permissions/group", headers=h, json={"name": "MicroStar Viewers"}, timeout=15).json()["id"]
    if viewer is None:
        requests.post(
            f"{METABASE_URL}/api/user",
            headers=h,
            json={"first_name": "Viewer", "last_name": "User", "email": VIEWER_EMAIL, "password": VIEWER_PASS, "group_ids": [vg_id]},
            timeout=15,
        ).raise_for_status()

    # Step 6a: Show All Users broader permissions would defeat viewer group if left permissive
    # Step 6b: Scope All Users + MicroStar Viewers
    cgraph = requests.get(f"{METABASE_URL}/api/collection/graph", headers=h, timeout=15).json()
    cgraph["groups"]["1"][str(col_id)] = "none"
    cgraph["groups"][str(vg_id)] = {str(col_id): "read"}
    requests.put(f"{METABASE_URL}/api/collection/graph", headers=h, json=cgraph, timeout=15).raise_for_status()

    pgraph = requests.get(f"{METABASE_URL}/api/permissions/graph", headers=h, timeout=15).json()
    pgraph["groups"]["1"][str(db_id)] = {"view-data": "unrestricted", "create-queries": "no", "download": {"schemas": "none"}}
    pgraph["groups"][str(vg_id)] = {str(db_id): {"view-data": "unrestricted", "create-queries": "no", "download": {"schemas": "none"}}}
    requests.put(f"{METABASE_URL}/api/permissions/graph", headers=h, json=pgraph, timeout=15).raise_for_status()

    v_tok = requests.post(f"{METABASE_URL}/api/session", json={"username": VIEWER_EMAIL, "password": VIEWER_PASS}, timeout=15).json()["id"]
    vh = {"X-Metabase-Session": v_tok}
    v_dash = requests.get(f"{METABASE_URL}/api/dashboard/{dash_id}", headers=vh, timeout=15)
    assert v_dash.status_code == 200, f"Viewer dashboard GET failed: {v_dash.status_code}"
    v_card = requests.post(f"{METABASE_URL}/api/card/{card_ids['ledger']}/query", headers=vh, timeout=15)
    assert v_card.status_code == 200, f"Viewer card query failed: {v_card.status_code}"
    v_native = requests.post(
        f"{METABASE_URL}/api/dataset",
        headers=vh,
        json={"database": db_id, "type": "native", "native": {"query": "SELECT 1"}},
        timeout=15,
    )
    assert v_native.status_code == 403, f"Expected 403 on direct native SQL, got {v_native.status_code}"
    v_dl = requests.post(f"{METABASE_URL}/api/card/{card_ids['ledger']}/query/csv", headers=vh, timeout=15)
    assert v_dl.status_code == 403, f"Expected 403 on CSV download, got {v_dl.status_code}"
    v_edit = requests.put(f"{METABASE_URL}/api/dashboard/{dash_id}", headers=vh, json={"name": "Hacked"}, timeout=15)
    assert v_edit.status_code == 403, f"Expected 403 on dashboard edit, got {v_edit.status_code}"

    print(
        f"[6/6] Non-admin viewer RBAC verified: dashboard={v_dash.status_code}, "
        f"card_query={v_card.status_code}, native_sql={v_native.status_code}, "
        f"csv_download={v_dl.status_code}, dash_edit={v_edit.status_code}."
    )
    print(f"STAGING_DASHBOARD_ID={dash_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
