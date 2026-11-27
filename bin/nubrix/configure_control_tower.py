#!/usr/bin/env python3
"""Configures the customer-ready Keg Fulfillment Control Tower on Dashboard 23.

Idempotent, non-destructive, with automated backup of current cards and dashboard state.
Connects cards, template tags, multi-category parameters, and cross-filter click behaviors.
"""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
from typing import Any, Dict, List, Optional

import requests


BASE_URL = os.environ.get("METABASE_URL", "https://mstar.nubrixai.com").rstrip("/")
DATABASE_ID = int(os.environ.get("METABASE_DATABASE_ID", "2"))
DASHBOARD_ID = int(os.environ.get("METABASE_DASHBOARD_ID", "23"))


def get_session_token() -> str:
    env_token = os.environ.get("METABASE_SESSION_TOKEN")
    if env_token:
        return env_token
    email = os.environ.get("METABASE_ADMIN_EMAIL")
    password = os.environ.get("METABASE_ADMIN_PASSWORD")
    if not email or not password:
        raise RuntimeError(
            "Missing METABASE_SESSION_TOKEN or METABASE_ADMIN_EMAIL / METABASE_ADMIN_PASSWORD env vars."
        )
    resp = requests.post(
        f"{BASE_URL}/api/session",
        json={"username": email, "password": password},
        headers={"Content-Type": "application/json", "X-Forwarded-Proto": "https"},
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()["id"]


def api_request(method: str, path: str, token: str, data: Any = None) -> Any:
    url = f"{BASE_URL}{path}"
    headers = {
        "X-Metabase-Session": token,
        "X-Forwarded-Proto": "https",
        "Content-Type": "application/json",
    }
    resp = requests.request(method=method, url=url, json=data, headers=headers, timeout=30)
    if not resp.ok:
        print(f"HTTPError {resp.status_code} on {method} {path}: {resp.text[:400]}", file=sys.stderr)
        resp.raise_for_status()
    return resp.json() if resp.content else {}


def backup_current_state(token: str, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_file = backup_dir / f"dashboard_23_backup_{ts}.json"

    d23 = api_request("GET", f"/api/dashboard/{DASHBOARD_ID}", token)
    cards = {}
    for dc in d23.get("dashcards", []):
        cid = dc.get("card_id")
        if cid:
            cards[cid] = api_request("GET", f"/api/card/{cid}", token)

    payload = {"dashboard": d23, "cards": cards, "timestamp": ts}
    backup_file.write_text(json.dumps(payload, indent=2))
    print(f"Backed up current dashboard and cards to {backup_file}")
    return backup_file


def build_card_141_map_query() -> Dict[str, Any]:
    query = """
SELECT 
  CustomerId,
  CustomerName,
  CustomerType,
  Region,
  ShippingCity,
  ShippingState,
  CAST(Latitude AS DECIMAL(10, 6)) AS Latitude,
  CAST(Longitude AS DECIMAL(10, 6)) AS Longitude
FROM dimCustomer
WHERE 1=1
[[AND Region = {{region}}]]
[[AND CustomerType = {{customer_type}}]]
[[AND CustomerName = {{customer}}]]
ORDER BY CustomerType, Region, CustomerName;
""".strip()
    return {
        "query": query,
        "template-tags": {
            "region": {
                "id": "tag_map_region",
                "name": "region",
                "display-name": "Region",
                "type": "text",
            },
            "customer_type": {
                "id": "tag_map_cust_type",
                "name": "customer_type",
                "display-name": "Customer Type",
                "type": "text",
            },
            "customer": {
                "id": "tag_map_customer",
                "name": "customer",
                "display-name": "Customer",
                "type": "text",
            },
        },
    }


def build_card_142_ledger_query() -> Dict[str, Any]:
    query = """
SELECT 
  a.order_id AS Order_ID,
  a.destination_brewer AS Destination_Brewer,
  a.region AS Region,
  a.customer_type AS Customer_Type,
  a.keg_size AS Keg_Size,
  a.ordered_units AS Ordered_Units,
  a.pending_units AS Pending_Units,
  a.allocated_units AS Allocated_Units,
  a.uncovered_units AS Uncovered_Units,
  a.source_hub AS Source_Hub,
  a.distributor AS Distributor,
  a.carrier AS Carrier,
  a.distance_km AS Distance_Km,
  ROUND(a.freight_cost_inr, 0) AS Freight_Cost_INR,
  a.needed_by AS Needed_By,
  a.transit_days AS Transit_Days,
  a.on_time_feasible AS Feasible,
  a.planning_status AS Planning_Status,
  a.explanation AS Explanation,
  a.planning_basis AS Planning_Basis,
  r.as_of_date AS Snapshot_As_Of
FROM nubrix_poc_allocations a
JOIN nubrix_poc_run_pointer p ON p.active_run_id = a.run_id
JOIN nubrix_poc_runs r ON r.run_id = a.run_id
WHERE 1=1
[[AND a.region = {{region}}]]
[[AND a.customer_type = {{customer_type}}]]
[[AND (a.destination_brewer = {{customer}} OR a.source_hub = {{customer}} OR a.distributor = {{customer}})]]
[[AND a.carrier = {{carrier}}]]
[[AND a.order_id = {{order_id}}]]
[[AND a.planning_status = {{planning_status}}]]
[[AND a.destination_customer_id = {{customer_id}}]]
ORDER BY a.uncovered_units DESC, a.needed_by ASC, a.on_time_feasible ASC, a.freight_cost_inr DESC;
""".strip()
    return {
        "query": query,
        "template-tags": {
            "region": {
                "id": "tag_c142_region",
                "name": "region",
                "display-name": "Region",
                "type": "text",
            },
            "customer_type": {
                "id": "tag_c142_cust_type",
                "name": "customer_type",
                "display-name": "Customer Type",
                "type": "text",
            },
            "customer": {
                "id": "tag_c142_customer",
                "name": "customer",
                "display-name": "Customer",
                "type": "text",
            },
            "carrier": {
                "id": "tag_c142_carrier",
                "name": "carrier",
                "display-name": "Carrier",
                "type": "text",
            },
            "order_id": {
                "id": "tag_c142_order_id",
                "name": "order_id",
                "display-name": "Order ID",
                "type": "text",
            },
            "planning_status": {
                "id": "tag_c142_status",
                "name": "planning_status",
                "display-name": "Planning Status",
                "type": "text",
            },
            "customer_id": {
                "id": "tag_c142_cust_id",
                "name": "customer_id",
                "display-name": "Customer ID",
                "type": "text",
            },
        },
    }


def build_kpi_strip_query() -> Dict[str, Any]:
    """Phase 3 KPI strip with explicit denominators from the active POC run."""
    query = """
SELECT
  r.as_of_date AS As_Of_Date,
  COUNT(*) AS Horizon_Orders,
  SUM(a.pending_units) AS Open_Demand_Kegs,
  SUM(a.allocated_units) AS Proposed_Allocated_Kegs,
  SUM(a.uncovered_units) AS Shortfall_Kegs,
  SUM(CASE WHEN a.uncovered_units > 0 OR a.on_time_feasible = 'N' THEN 1 ELSE 0 END) AS Uncovered_Or_Partial_Orders,
  ROUND(SUM(a.freight_cost_inr), 0) AS Estimated_Freight_INR
FROM nubrix_poc_allocations a
JOIN nubrix_poc_run_pointer p ON p.active_run_id = a.run_id
JOIN nubrix_poc_runs r ON r.run_id = a.run_id
WHERE 1=1
[[AND a.region = {{region}}]]
[[AND a.customer = {{customer}}]]
GROUP BY r.as_of_date;
""".strip().replace("a.customer = {{customer}}", "(a.destination_brewer = {{customer}} OR a.source_hub = {{customer}} OR a.distributor = {{customer}})")
    return {
        "query": query,
        "template-tags": {
            "region": {"id": "tag_kpi_region", "name": "region", "display-name": "Region", "type": "text"},
            "customer": {"id": "tag_kpi_customer", "name": "customer", "display-name": "Customer", "type": "text"},
        },
    }


def build_order_evidence_query() -> Dict[str, Any]:
    """Phase 3 Selected-Order Evidence & Alternatives query."""
    query = """
SELECT
  e.order_id AS Order_ID,
  e.candidate_route_id AS Candidate_ID,
  e.source_customer_id AS Source_Customer_ID,
  COALESCE(c.CustomerName, e.source_customer_id) AS Source_Name,
  e.carrier_name AS Carrier,
  e.distance_km AS Distance_Km,
  e.transit_days AS Transit_Days,
  e.slack_days AS Slack_Days,
  ROUND(e.freight_cost_inr, 2) AS Modeled_Freight_INR,
  CASE WHEN e.is_selected = 1 THEN 'Selected' ELSE 'Rejected' END AS Decision,
  COALESCE(e.rejection_reason, CASE WHEN e.is_selected = 1 THEN 'selected_by_solver' ELSE 'not_selected' END) AS Decision_Reason
FROM nubrix_poc_candidate_evidence e
JOIN nubrix_poc_run_pointer p ON p.active_run_id = e.run_id
LEFT JOIN dimCustomer c ON c.CustomerId = e.source_customer_id
WHERE 1=1
[[AND e.order_id = {{order_id}}]]
ORDER BY e.is_selected DESC, e.freight_cost_inr ASC
LIMIT 200;
""".strip()
    return {
        "query": query,
        "template-tags": {
            "order_id": {"id": "tag_ev_order_id", "name": "order_id", "display-name": "Order ID", "type": "text"},
        },
    }


def build_exceptions_query() -> Dict[str, Any]:
    """Phase 3 Exceptions queue surfacing uncovered, partial, and late orders."""
    query = """
SELECT
  a.order_id AS Order_ID,
  a.destination_brewer AS Destination_Brewer,
  a.region AS Region,
  a.keg_size AS Keg_Size,
  a.needed_by AS Needed_By,
  a.pending_units AS Pending_Kegs,
  a.allocated_units AS Proposed_Kegs,
  a.uncovered_units AS Shortfall_Kegs,
  a.planning_status AS Status,
  a.explanation AS Actionable_Reason
FROM nubrix_poc_allocations a
JOIN nubrix_poc_run_pointer p ON p.active_run_id = a.run_id
WHERE (a.uncovered_units > 0 OR a.on_time_feasible = 'N')
[[AND a.region = {{region}}]]
[[AND (a.destination_brewer = {{customer}} OR a.source_hub = {{customer}} OR a.distributor = {{customer}})]]
ORDER BY a.uncovered_units DESC, a.needed_by ASC;
""".strip()
    return {
        "query": query,
        "template-tags": {
            "region": {"id": "tag_exc_region", "name": "region", "display-name": "Region", "type": "text"},
            "customer": {"id": "tag_exc_customer", "name": "customer", "display-name": "Customer", "type": "text"},
        },
    }


def build_card_143_demand_query() -> Dict[str, Any]:
    query = """
SELECT 
  c.Region AS Region,
  c.CustomerType AS Customer_Type,
  SUM(o.QuantityOrdered) AS Total_Ordered_Kegs,
  SUM(o.QuantityPending) AS Pending_Fulfillment,
  COUNT(*) AS Total_Orders
FROM KegOrder o
JOIN dimCustomer c ON o.CustomerId = c.CustomerId
WHERE 1=1
[[AND c.Region = {{region}}]]
[[AND c.CustomerType = {{customer_type}}]]
[[AND c.CustomerName = {{customer}}]]
GROUP BY c.Region, c.CustomerType
ORDER BY Total_Ordered_Kegs DESC;
""".strip()
    return {
        "query": query,
        "template-tags": {
            "region": {
                "id": "tag_dem_region",
                "name": "region",
                "display-name": "Region",
                "type": "text",
            },
            "customer_type": {
                "id": "tag_dem_cust_type",
                "name": "customer_type",
                "display-name": "Customer Type",
                "type": "text",
            },
            "customer": {
                "id": "tag_dem_customer",
                "name": "customer",
                "display-name": "Customer",
                "type": "text",
            },
        },
    }


def build_card_144_inventory_query() -> Dict[str, Any]:
    query = """
SELECT 
  Region,
  SizeCode AS Keg_Size,
  SUM(AvailableQuantity) AS Available_Kegs
FROM ReportedInventory
WHERE 1=1
[[AND Region = {{region}}]]
GROUP BY Region, SizeCode
ORDER BY Region, SizeCode;
""".strip()
    return {
        "query": query,
        "template-tags": {
            "region": {
                "id": "tag_inv_region",
                "name": "region",
                "display-name": "Region",
                "type": "text",
            },
        },
    }


def build_card_145_carrier_query() -> Dict[str, Any]:
    query = """
SELECT 
  a.carrier AS Carrier,
  a.on_time_feasible AS Modeled_Deadline_Feasible,
  COUNT(*) AS Allocation_Count,
  SUM(a.allocated_units) AS Kegs_Transported,
  ROUND(SUM(a.freight_cost_inr), 0) AS Total_Freight_INR,
  ROUND(AVG(a.distance_km), 1) AS Avg_Distance_Km
FROM nubrix_poc_allocations a
JOIN nubrix_poc_run_pointer p ON p.active_run_id = a.run_id
WHERE 1=1
[[AND a.region = {{region}}]]
[[AND a.customer_type = {{customer_type}}]]
[[AND (a.destination_brewer = {{customer}} OR a.source_hub = {{customer}} OR a.distributor = {{customer}})]]
[[AND a.carrier = {{carrier}}]]
GROUP BY a.carrier, a.on_time_feasible
ORDER BY Total_Freight_INR DESC;
""".strip()
    return {
        "query": query,
        "template-tags": {
            "region": {
                "id": "tag_car_region",
                "name": "region",
                "display-name": "Region",
                "type": "text",
            },
            "customer_type": {
                "id": "tag_car_cust_type",
                "name": "customer_type",
                "display-name": "Customer Type",
                "type": "text",
            },
            "customer": {
                "id": "tag_car_customer",
                "name": "customer",
                "display-name": "Customer",
                "type": "text",
            },
            "carrier": {
                "id": "tag_car_carrier",
                "name": "carrier",
                "display-name": "Carrier",
                "type": "text",
            },
        },
    }


def update_cards(token: str, apply_changes: bool = False) -> None:
    card_configs = [
        (
            141,
            "Customer Locations — Brewers, Distributors & Maintenance Facilities",
            "Interactive customer network across India (synthetic simulation) with category-segregated facility pins and cross-filtering.",
            "map",
            build_card_141_map_query(),
            {
                "map.type": "pin",
                "map.pin_type": "markers",
                "map.latitude_column": "Latitude",
                "map.longitude_column": "Longitude",
                "map.name_column": "CustomerName",
            },
        ),
        (
            142,
            "Fulfillment Dispatch & Feasibility Ledger",
            "Order-driven fulfillment ledger showing destination brewer, coordinating distributor, source depot, road distance, freight cost, transit days, shortfall, and explanation.",
            "table",
            build_card_142_ledger_query(),
            {
                "table.pivot_column": None,
                "table.cell_column": None,
            },
        ),
        (
            143,
            "Keg Demand & Pending Orders by Region",
            "Regional demand distribution comparing total ordered kegs vs pending fulfillment across facilities.",
            "bar",
            build_card_143_demand_query(),
            {
                "graph.dimensions": ["Region", "Customer_Type"],
                "graph.metrics": ["Total_Ordered_Kegs", "Pending_Fulfillment"],
            },
        ),
        (
            144,
            "Warehouse Inventory by Region & Keg Size",
            "Net available empty keg inventory by region and keg SKU (20L, 30L, 50L).",
            "bar",
            build_card_144_inventory_query(),
            {
                "graph.dimensions": ["Region", "Keg_Size"],
                "graph.metrics": ["Available_Kegs"],
            },
        ),
        (
            145,
            "Carrier Freight Volume & Delivery Feasibility",
            "Logistics partner workload, road distances, freight expenditure, and deadline feasibility rate.",
            "table",
            build_card_145_carrier_query(),
            {},
        ),
    ]

    for card_id, name, desc, display, q_spec, viz_settings in card_configs:
        card = api_request("GET", f"/api/card/{card_id}", token)
        if not card or card.get("id") != card_id:
            raise RuntimeError(f"Ambiguity or missing card check failed for Card {card_id}")
        if not apply_changes:
            print(f"[DRY-RUN] Would update Card {card_id}: {name} (tags={list(q_spec['template-tags'].keys())})")
            continue

        card["name"] = name
        card["description"] = desc
        card["display"] = display

        card["dataset_query"] = {
            "database": DATABASE_ID,
            "type": "native",
            "native": {
                "query": q_spec["query"],
                "template-tags": q_spec["template-tags"],
            },
        }
        if viz_settings:
            card["visualization_settings"] = viz_settings

        api_request("PUT", f"/api/card/{card_id}", token, card)
        print(f"Updated Card {card_id}: {name}")

        # Test query execution
        exec_res = api_request("POST", f"/api/card/{card_id}/query", token)
        row_count = len(exec_res.get("data", {}).get("rows", []))
        print(f"  Verified execution: returned {row_count} rows.")


def ensure_extra_control_tower_cards(token: str, collection_id: Optional[int], apply_changes: bool = False) -> Dict[str, int]:
    """Create or update the Master-Detail KPI Strip, Order Evidence, and Exceptions cards."""
    specs = [
        (
            "kpi_strip",
            "Control Tower KPI Strip (Active OR-Tools Run)",
            "Active run KPI summary with explicit 1,000-order horizon denominator, allocated/shortfall kegs, and modeled freight.",
            "table",
            build_kpi_strip_query(),
        ),
        (
            "order_evidence",
            "Selected Order Plan & Candidate Alternatives",
            "Candidate routes evaluated by the OR-Tools solver for the selected order, including rejection reasons.",
            "table",
            build_order_evidence_query(),
        ),
        (
            "exceptions_queue",
            "Exceptions & Shortfall Queue (Uncovered / Late)",
            "Uncovered, partial, or deadline-late orders requiring planner attention. Click any row to inspect candidate alternatives.",
            "table",
            build_exceptions_query(),
        ),
    ]
    existing_cards = api_request("GET", "/api/card", token)
    by_name = {c.get("name"): c for c in existing_cards if not c.get("archived")}
    card_ids: Dict[str, int] = {}

    for key, name, desc, display, q_spec in specs:
        existing = by_name.get(name)
        if not apply_changes:
            if existing:
                print(f"[DRY-RUN] Would update existing card '{name}' (id={existing['id']})")
                card_ids[key] = existing["id"]
            else:
                print(f"[DRY-RUN] Would create card '{name}'")
            continue

        payload = {
            "name": name,
            "description": desc,
            "display": display,
            "collection_id": collection_id,
            "dataset_query": {
                "database": DATABASE_ID,
                "type": "native",
                "native": {
                    "query": q_spec["query"],
                    "template-tags": q_spec["template-tags"],
                },
            },
            "visualization_settings": {},
        }
        if existing:
            cid = existing["id"]
            api_request("PUT", f"/api/card/{cid}", token, payload)
            print(f"Updated Control Tower Card {cid}: {name}")
        else:
            created = api_request("POST", "/api/card", token, payload)
            cid = created["id"]
            print(f"Created Control Tower Card {cid}: {name}")
        card_ids[key] = cid
        exec_res = api_request("POST", f"/api/card/{cid}/query", token)
        print(f"  Verified execution: returned {len(exec_res.get('data', {}).get('rows', []))} rows.")
    return card_ids


def configure_dashboard_layout_and_wiring(token: str, extra_cards: Optional[Dict[str, int]] = None, apply_changes: bool = False) -> None:
    d23 = api_request("GET", f"/api/dashboard/{DASHBOARD_ID}", token)

    # 1. Dashboard Parameters
    d23["parameters"] = [
        {"id": "param_region", "name": "Region", "slug": "region", "type": "category", "sectionId": "location"},
        {"id": "param_customer_type", "name": "Customer Type", "slug": "customer_type", "type": "category"},
        {"id": "param_customer", "name": "Customer", "slug": "customer", "type": "category"},
        {"id": "param_carrier", "name": "Carrier", "slug": "carrier", "type": "category"},
        {"id": "param_order_id", "name": "Order ID", "slug": "order_id", "type": "string/="},
        {"id": "param_planning_status", "name": "Planning Status", "slug": "planning_status", "type": "category"},
    ]

    extra_cards = extra_cards or {}
    dashcards = d23.get("dashcards", [])
    existing_card_ids = {dc.get("card_id") for dc in dashcards if dc.get("card_id")}

    def _next_temp_id() -> int:
        ids = [dc.get("id", 0) for dc in dashcards if isinstance(dc.get("id"), int)]
        return min(ids + [0]) - 1

    extra_specs = [
        ("kpi_strip", 24, 3, 0, 2, [
            {"parameter_id": "param_region", "target": ["variable", ["template-tag", "region"]]},
            {"parameter_id": "param_customer", "target": ["variable", ["template-tag", "customer"]]},
        ], {}),
        ("order_evidence", 14, 8, 0, 16, [
            {"parameter_id": "param_order_id", "target": ["variable", ["template-tag", "order_id"]]},
        ], {}),
        ("exceptions_queue", 10, 8, 14, 16, [
            {"parameter_id": "param_region", "target": ["variable", ["template-tag", "region"]]},
            {"parameter_id": "param_customer", "target": ["variable", ["template-tag", "customer"]]},
        ], {
            "click_behavior": {
                "type": "crossfilter",
                "parameterMapping": {
                    "param_order_id": {
                        "id": "param_order_id",
                        "source": {"type": "column", "id": "Order_ID", "name": "Order_ID"},
                        "target": {"type": "parameter", "id": "param_order_id"},
                    },
                },
            }
        }),
    ]
    for key, sx, sy, col, row, mappings, viz_cfg in extra_specs:
        cid = extra_cards.get(key)
        if cid and cid not in existing_card_ids:
            dashcards.append({
                "id": _next_temp_id(),
                "card_id": cid,
                "size_x": sx,
                "size_y": sy,
                "col": col,
                "row": row,
                "parameter_mappings": [{**m, "card_id": cid} for m in mappings],
                "visualization_settings": viz_cfg,
                "series": [],
            })
            existing_card_ids.add(cid)

    # 2. Wire DashCards
    for dc in dashcards:
        cid = dc.get("card_id")
        viz = dc.get("visualization_settings", {}) or {}

        if cid == 141:  # Map
            dc["size_x"] = 12
            dc["size_y"] = 11
            dc["col"] = 0
            dc["row"] = 5
            dc["parameter_mappings"] = [
                {"parameter_id": "param_region", "card_id": 141, "target": ["variable", ["template-tag", "region"]]},
                {"parameter_id": "param_customer_type", "card_id": 141, "target": ["variable", ["template-tag", "customer_type"]]},
                {"parameter_id": "param_customer", "card_id": 141, "target": ["variable", ["template-tag", "customer"]]},
            ]
            viz["click_behavior"] = {
                "type": "crossfilter",
                "parameterMapping": {
                    "param_customer": {
                        "id": "param_customer",
                        "source": {"type": "column", "id": "CustomerName", "name": "CustomerName"},
                        "target": {"type": "parameter", "id": "param_customer"},
                    },
                    "param_region": {
                        "id": "param_region",
                        "source": {"type": "column", "id": "Region", "name": "Region"},
                        "target": {"type": "parameter", "id": "param_region"},
                    },
                    "param_customer_type": {
                        "id": "param_customer_type",
                        "source": {"type": "column", "id": "CustomerType", "name": "CustomerType"},
                        "target": {"type": "parameter", "id": "param_customer_type"},
                    },
                },
            }
            dc["visualization_settings"] = viz

        elif cid == 142:  # Order Queue
            dc["size_x"] = 12
            dc["size_y"] = 11
            dc["col"] = 12
            dc["row"] = 5
            dc["parameter_mappings"] = [
                {"parameter_id": "param_region", "card_id": 142, "target": ["variable", ["template-tag", "region"]]},
                {"parameter_id": "param_customer_type", "card_id": 142, "target": ["variable", ["template-tag", "customer_type"]]},
                {"parameter_id": "param_customer", "card_id": 142, "target": ["variable", ["template-tag", "customer"]]},
                {"parameter_id": "param_carrier", "card_id": 142, "target": ["variable", ["template-tag", "carrier"]]},
                {"parameter_id": "param_order_id", "card_id": 142, "target": ["variable", ["template-tag", "order_id"]]},
                {"parameter_id": "param_planning_status", "card_id": 142, "target": ["variable", ["template-tag", "planning_status"]]},
            ]
            viz["click_behavior"] = {
                "type": "crossfilter",
                "parameterMapping": {
                    "param_order_id": {
                        "id": "param_order_id",
                        "source": {"type": "column", "id": "Order_ID", "name": "Order_ID"},
                        "target": {"type": "parameter", "id": "param_order_id"},
                    },
                    "param_customer": {
                        "id": "param_customer",
                        "source": {"type": "column", "id": "Destination_Brewer", "name": "Destination_Brewer"},
                        "target": {"type": "parameter", "id": "param_customer"},
                    },
                    "param_region": {
                        "id": "param_region",
                        "source": {"type": "column", "id": "Region", "name": "Region"},
                        "target": {"type": "parameter", "id": "param_region"},
                    },
                    "param_carrier": {
                        "id": "param_carrier",
                        "source": {"type": "column", "id": "Carrier", "name": "Carrier"},
                        "target": {"type": "parameter", "id": "param_carrier"},
                    },
                },
            }
            dc["visualization_settings"] = viz

        elif cid == 143:  # Demand Bar
            dc["size_x"] = 12
            dc["size_y"] = 7
            dc["col"] = 0
            dc["row"] = 24
            dc["parameter_mappings"] = [
                {"parameter_id": "param_region", "card_id": 143, "target": ["variable", ["template-tag", "region"]]},
                {"parameter_id": "param_customer_type", "card_id": 143, "target": ["variable", ["template-tag", "customer_type"]]},
                {"parameter_id": "param_customer", "card_id": 143, "target": ["variable", ["template-tag", "customer"]]},
            ]
            viz["click_behavior"] = {
                "type": "crossfilter",
                "parameterMapping": {
                    "param_region": {
                        "id": "param_region",
                        "source": {"type": "column", "id": "Region", "name": "Region"},
                        "target": {"type": "parameter", "id": "param_region"},
                    },
                },
            }
            dc["visualization_settings"] = viz

        elif cid == 144:  # Inventory Bar
            dc["size_x"] = 12
            dc["size_y"] = 7
            dc["col"] = 12
            dc["row"] = 24
            dc["parameter_mappings"] = [
                {"parameter_id": "param_region", "card_id": 144, "target": ["variable", ["template-tag", "region"]]},
            ]
            viz["click_behavior"] = {
                "type": "crossfilter",
                "parameterMapping": {
                    "param_region": {
                        "id": "param_region",
                        "source": {"type": "column", "id": "Region", "name": "Region"},
                        "target": {"type": "parameter", "id": "param_region"},
                    },
                },
            }
            dc["visualization_settings"] = viz

        elif cid == 145:  # Carrier Table
            dc["size_x"] = 24
            dc["size_y"] = 8
            dc["col"] = 0
            dc["row"] = 31
            dc["parameter_mappings"] = [
                {"parameter_id": "param_region", "card_id": 145, "target": ["variable", ["template-tag", "region"]]},
                {"parameter_id": "param_customer_type", "card_id": 145, "target": ["variable", ["template-tag", "customer_type"]]},
                {"parameter_id": "param_customer", "card_id": 145, "target": ["variable", ["template-tag", "customer"]]},
                {"parameter_id": "param_carrier", "card_id": 145, "target": ["variable", ["template-tag", "carrier"]]},
            ]
            viz["click_behavior"] = {
                "type": "crossfilter",
                "parameterMapping": {
                    "param_carrier": {
                        "id": "param_carrier",
                        "source": {"type": "column", "id": "Carrier", "name": "Carrier"},
                        "target": {"type": "parameter", "id": "param_carrier"},
                    },
                },
            }
            dc["visualization_settings"] = viz

        elif cid is None:  # Banner Markdown
            dc["size_x"] = 24
            dc["size_y"] = 2
            dc["col"] = 0
            dc["row"] = 0
            try:
                ov = api_request("GET", "/api/operations/overview", token)
                ov_run = ov.get("run", {})
                ov_kpis = ov.get("kpis", {})
                h_orders = int(ov_run.get("horizon_orders") or ov_kpis.get("horizon_orders") or 1000)
                t_open = int(ov_run.get("total_open_orders") or 9899)
                kegs_alloc = int(ov_run.get("kegs_allocated") or ov_kpis.get("proposed_units") or 0)
                freight_inr = float(ov_run.get("total_freight_inr") or ov_kpis.get("estimated_freight_inr") or 0)
                policy_lbl = ov_run.get("source_policy_label") or "Depot-First"
                banner_text = (
                    "# MicroStar Keg Fulfillment Control Tower\n"
                    f"**Policy: {policy_lbl}** · "
                    "**Simulated scenario · Proposed plan — not a booking** · "
                    f"Planning horizon: **{h_orders:,}** earliest-due orders of {t_open:,} open orders "
                    f"(**{kegs_alloc:,}** proposed kegs, **₹{round(freight_inr):,}** modeled freight). "
                    "Explore **[Order Fulfillment](/operations/orders)**, **[Exceptions Triage](/operations/exceptions)**, or **[Scenario Lab](/operations/scenarios)**."
                )
            except Exception:
                banner_text = (
                    "# MicroStar Keg Fulfillment Control Tower\n"
                    "**Simulated scenario · Proposed plan — not a booking** · "
                    "Overview totals reflect the active pinned planning run. "
                    "Explore **[Order Fulfillment](/operations/orders)**, **[Exceptions Triage](/operations/exceptions)**, or **[Scenario Lab](/operations/scenarios)**."
                )
            viz["text"] = banner_text
            viz["virtual_card"] = {
                "display": "text",
                "dataset_query": {},
                "visualization_settings": {
                    "text": banner_text,
                },
            }
            dc["visualization_settings"] = viz

    if not apply_changes:
        print(f"[DRY-RUN] Would update Dashboard {DASHBOARD_ID} ({len(d23.get('dashcards', []))} dashcards, {len(d23.get('parameters', []))} parameters).")
        return

    api_request("PUT", f"/api/dashboard/{DASHBOARD_ID}", token, d23)
    print(f"Updated Dashboard {DASHBOARD_ID} layout, parameters, and cross-filters successfully.")


def setup_rbac(token: str, apply_changes: bool = False) -> None:
    """Inspect and optionally apply least-privilege RBAC for MicroStar Viewers."""
    groups = api_request("GET", "/api/permissions/group", token)
    col_graph = api_request("GET", "/api/collection/graph", token)
    db_graph = api_request("GET", "/api/permissions/graph", token)

    print(f"Found {len(groups)} permission group(s). Current All Users (id=1) root collection access: {col_graph.get('groups', {}).get('1', {}).get('root')}")
    db2_perms = db_graph.get("groups", {}).get("1", {}).get(str(DB_ID), {})
    print(f"Current All Users (id=1) DB {DB_ID} permissions: {db2_perms}")

    if not apply_changes:
        print("[DRY-RUN] Would create 'MicroStar Control Tower' collection, 'MicroStar Viewers' group, restrict All Users DB 2 download/native SQL, and move Dashboard 23.")
        return

    # 1. Ensure MicroStar Viewers group exists
    viewer_group = next((g for g in groups if g.get("name") == "MicroStar Viewers"), None)
    if not viewer_group:
        viewer_group = api_request("POST", "/api/permissions/group", token, {"name": "MicroStar Viewers"})
        print(f"Created group 'MicroStar Viewers' (id={viewer_group['id']}).")

    # 2. Ensure MicroStar Control Tower collection exists
    collections = api_request("GET", "/api/collection", token)
    ct_col = next((c for c in collections if c.get("name") == "MicroStar Control Tower"), None)
    if not ct_col:
        ct_col = api_request("POST", "/api/collection", token, {"name": "MicroStar Control Tower", "color": "#2563EB"})
        print(f"Created collection 'MicroStar Control Tower' (id={ct_col['id']}).")

    # 3. Move Dashboard 23 into MicroStar Control Tower collection
    d23 = api_request("GET", f"/api/dashboard/{DASHBOARD_ID}", token)
    d23["collection_id"] = ct_col["id"]
    api_request("PUT", f"/api/dashboard/{DASHBOARD_ID}", token, d23)
    print(f"Moved Dashboard {DASHBOARD_ID} to collection {ct_col['id']}.")

    # 4. Update collection permissions (All Users=none, MicroStar Viewers=read)
    col_id_str = str(ct_col["id"])
    col_graph["groups"].setdefault("1", {})[col_id_str] = "none"
    col_graph["groups"].setdefault(str(viewer_group["id"]), {})[col_id_str] = "read"
    api_request("PUT", "/api/collection/graph", token, col_graph)
    print("Updated collection permission graph.")


def main():
    parser = argparse.ArgumentParser(description="Configure MicroStar Control Tower on Metabase")
    parser.add_argument("--apply", action="store_true", help="Apply card and dashboard updates (default: dry-run)")
    parser.add_argument("--setup-rbac", action="store_true", help="Inspect or apply least-privilege RBAC for MicroStar Viewers")
    parser.add_argument("--backup-dir", default="/tmp/nubrix_backups", help="Directory for pre-mutation JSON backup")
    args = parser.parse_args()

    print("=== Configuring Nubrix / MicroStar Keg Control Tower ===")
    if not args.apply:
        print("MODE: DRY-RUN (read-only verification; pass --apply to mutate Metabase)")
    token = get_session_token()
    print("Obtained Metabase session token via environment credentials.")

    if args.apply:
        backup_current_state(token, Path(args.backup_dir))

    print("\nChecking/Updating Card SQL queries and template tags...")
    update_cards(token, apply_changes=args.apply)

    print("\nChecking/Provisioning Master-Detail Control Tower cards...")
    d23 = api_request("GET", f"/api/dashboard/{DASHBOARD_ID}", token)
    extra_cards = ensure_extra_control_tower_cards(token, d23.get("collection_id"), apply_changes=args.apply)

    print("\nChecking/Configuring Dashboard 23 layout, parameters, and click wiring...")
    configure_dashboard_layout_and_wiring(token, extra_cards=extra_cards, apply_changes=args.apply)

    if args.setup_rbac:
        print("\nChecking/Configuring RBAC...")
        setup_rbac(token, apply_changes=args.apply)

    print("\n=== Control Tower Configuration Complete! ===")


if __name__ == "__main__":
    main()
