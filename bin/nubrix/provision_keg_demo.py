#!/usr/bin/env python3
"""Create a native Metabase demo dashboard for the synthetic keg dataset.

Requires MB_TOKEN_FILE (default /tmp/mb_token.txt) on the host running it.
The script is idempotent by dashboard name and never deletes existing content.
"""
import json
import os
import ssl
import urllib.error
import urllib.request
from pathlib import Path

BASE = os.environ.get("METABASE_URL", "https://mstar.nubrixai.com")
DATABASE_ID = int(os.environ.get("METABASE_DATABASE_ID", "2"))
TOKEN_FILE = Path(os.environ.get("MB_TOKEN_FILE", "/tmp/mb_token.txt"))
DASHBOARD_NAME = "Keg Supply Chain — Demand & Fulfillment"
DESCRIPTION = (
    "Synthetic India demonstration dataset. Distances, rates, inventory and "
    "allocations are estimates for scenario analysis, not operational truth."
)

CARDS = [
    {
        "name": "Customer map — Brewers and Distributors",
        "display": "map",
        "sql": """
SELECT CustomerId, CustomerName, CustomerType, Region, ShippingCity,
       Latitude, Longitude
FROM dimCustomer
WHERE CustomerType IN ('Brewer', 'Distributor')
ORDER BY CustomerType, Region, CustomerName
""",
        "settings": {
            "map.type": "pin",
            "map.latitude_column": "Latitude",
            "map.longitude_column": "Longitude",
            "map.name_column": "CustomerName",
            "map.color_dimension": "CustomerType",
        },
        "position": {"row": 0, "col": 0, "size_x": 18, "size_y": 12},
    },
    {
        "name": "Fulfillment plan — deadline and cost",
        "display": "table",
        "sql": """
SELECT a.AllocationId, a.OrderId, o.OrderedDate, o.NeededByDate,
       a.DestinationCustomerName, a.SourceCustomerName,
       a.DistributorCustomerName, a.SizeCode, a.QuantityAllocated,
       a.RoadDistanceKm, a.CarrierName, a.EstimatedTransportCostINR,
       a.DeliveryFeasibleFlag, a.AllocationStatus
FROM FulfillmentAllocation a
JOIN KegOrder o ON o.OrderId = a.OrderId
ORDER BY o.NeededByDate, a.DeliveryFeasibleFlag, a.EstimatedTransportCostINR DESC
LIMIT 1000
""",
        "settings": {},
        "position": {"row": 0, "col": 18, "size_x": 18, "size_y": 12},
    },
    {
        "name": "Open demand by region",
        "display": "bar",
        "sql": """
SELECT c.Region, c.CustomerType,
       SUM(o.QuantityOrdered) AS OrderedKegs,
       SUM(o.QuantityPending) AS PendingKegs,
       COUNT(*) AS OrderCount
FROM KegOrder o
JOIN dimCustomer c ON c.CustomerId = o.CustomerId
GROUP BY c.Region, c.CustomerType
ORDER BY c.Region, c.CustomerType
""",
        "settings": {},
        "position": {"row": 12, "col": 0, "size_x": 12, "size_y": 9},
    },
    {
        "name": "Inventory by region and keg size",
        "display": "bar",
        "sql": """
SELECT Region, SizeCode, SUM(AvailableQuantity) AS AvailableKegs
FROM ReportedInventory
GROUP BY Region, SizeCode
ORDER BY Region, SizeCode
""",
        "settings": {},
        "position": {"row": 12, "col": 12, "size_x": 12, "size_y": 9},
    },
    {
        "name": "Carrier cost and deadline status",
        "display": "table",
        "sql": """
SELECT CarrierName, DeliveryFeasibleFlag,
       COUNT(*) AS AllocationCount,
       SUM(QuantityAllocated) AS KegsAllocated,
       ROUND(SUM(EstimatedTransportCostINR), 2) AS EstimatedCostINR,
       ROUND(AVG(RoadDistanceKm), 1) AS AvgRoadDistanceKm
FROM FulfillmentAllocation
GROUP BY CarrierName, DeliveryFeasibleFlag
ORDER BY CarrierName, DeliveryFeasibleFlag
""",
        "settings": {},
        "position": {"row": 21, "col": 0, "size_x": 24, "size_y": 8},
    },
]


def api(token, method, path, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        BASE + path,
        data=body,
        method=method,
        headers={"X-Metabase-Session": token, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, context=ssl.create_default_context(), timeout=120) as res:
            raw = res.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:1000]
        raise RuntimeError(f"{method} {path} HTTP {exc.code}: {detail}") from exc


def main():
    token = TOKEN_FILE.read_text().strip()
    if not token:
        raise RuntimeError(f"Empty session token file: {TOKEN_FILE}")
    dashboards = api(token, "GET", "/api/dashboard")
    existing = next((d for d in dashboards if d.get("name") == DASHBOARD_NAME), None)
    if existing:
        raise RuntimeError(f"Dashboard already exists (id={existing['id']}); refusing duplicate creation")

    cards = []
    for spec in CARDS:
        query = {"database": DATABASE_ID, "type": "native", "native": {"query": spec["sql"], "template-tags": {}}}
        result = api(token, "POST", "/api/dataset", query)
        if result.get("status") != "completed":
            raise RuntimeError(f"Query validation failed for {spec['name']}: {result}")
        card = api(token, "POST", "/api/card", {
            "name": spec["name"],
            "description": DESCRIPTION,
            "dataset_query": query,
            "display": spec["display"],
            "visualization_settings": spec["settings"],
        })
        cards.append((spec, card["id"]))
        print(f"card {card['id']}: {spec['name']}", flush=True)

    dashboard = api(token, "POST", "/api/dashboard", {"name": DASHBOARD_NAME, "description": DESCRIPTION})
    dashcards = []
    for index, (spec, card_id) in enumerate(cards):
        pos = spec["position"]
        dashcards.append({"id": -(index + 1), "card_id": card_id, "row": pos["row"], "col": pos["col"], "size_x": pos["size_x"], "size_y": pos["size_y"], "series": []})
    saved = api(token, "PUT", f"/api/dashboard/{dashboard['id']}", {"dashcards": dashcards})
    print(json.dumps({"dashboard_id": dashboard["id"], "card_count": len(saved.get("dashcards", [])), "url": f"{BASE}/dashboard/{dashboard['id']}"}, indent=2), flush=True)


if __name__ == "__main__":
    main()
