"""Create an isolated, query-validated dashboard from staged Excel data."""

import argparse
import json
from pathlib import Path
import ssl
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import certifi


DEMAND = """
SELECT c.CustomerId, c.Name AS Customer, c.ShippingCity AS City,
       a.Lat AS Latitude, a.Lon AS Longitude,
       SUM(o.QuantityOrdered) AS OrderedKegs,
       SUM(o.QuantityPending) AS PendingKegs,
       MIN(o.DateNeeded) AS EarliestNeededDate
FROM nubrix_stage_KegOrder o
JOIN nubrix_stage_dimCustomer c ON c.id = o.CustomerAccountUUID
JOIN nubrix_stage_dimAddress a ON a.id = o.ShipAddressUUID
WHERE 1=1 [[AND c.CustomerId = {{customer}}]]
GROUP BY c.CustomerId, c.Name, c.ShippingCity, a.Lat, a.Lon
"""

ORDERS = """
SELECT o.OrderId, c.CustomerId, c.Name AS Customer, c.ShippingCity AS City,
       o.SizeId AS KegSize, 'Empty' AS KegState, o.DateOrdered, o.DateNeeded,
       o.QuantityOrdered, o.QuantityPlanned, o.QuantityFulfilled,
       o.QuantityPending, o.FulfillmentFlag
FROM nubrix_stage_KegOrder o
JOIN nubrix_stage_dimCustomer c ON c.id = o.CustomerAccountUUID
WHERE 1=1 [[AND c.CustomerId = {{customer}}]]
ORDER BY o.DateNeeded, o.OrderId
"""

INVENTORY = """
SELECT c.CustomerId, c.Name AS Customer, c.ShippingCity AS City,
       i.SizeId AS KegSize, i.InventoryTypeId AS KegState, i.ReportDate,
       i.Quantity AS ReportedKegs, COALESCE(r.ReservedKegs,0) AS CommittedKegs,
       GREATEST(i.Quantity - COALESCE(r.ReservedKegs,0),0) AS UncommittedKegs
FROM nubrix_stage_ReportedInventory i
JOIN nubrix_stage_dimCustomer c ON c.id = i.CustomerAccountUUID
LEFT JOIN (
  SELECT ReportedInventoryId, SUM(QuantityReserved) AS ReservedKegs
  FROM nubrix_stage_InventoryReservation
  GROUP BY ReportedInventoryId
) r ON r.ReportedInventoryId = i.Id
WHERE NOT EXISTS (
  SELECT 1 FROM nubrix_stage_ReportedInventory newer
  WHERE newer.CustomerId = i.CustomerId AND newer.SizeId = i.SizeId
    AND newer.InventoryTypeId = i.InventoryTypeId AND newer.ReportDate > i.ReportDate
) [[AND c.CustomerId = {{customer}}]]
ORDER BY c.CustomerId, i.SizeId
"""

ALLOCATIONS = """
SELECT o.OrderId, c.CustomerId, c.Name AS Destination, c.ShippingCity AS City,
       a.SizeId AS KegSize, a.QuantityAllocated, a.RouteId, a.ShipmentId,
       f.Status, f.ShipDate, o.DateNeeded, carrier.CarrierName,
       t.TruckId, t.CapacityKegs, f.RoadDistance AS EstimatedRouteKm,
       f.CarrierCost AS WholeRouteCostProxyINR,
       ROUND(f.CarrierCost * a.QuantityAllocated / NULLIF(f.Quantity,0),2) AS AllocatedCostProxyINR,
       'Not evaluated: transit SLA unavailable' AS DeadlineFeasibility
FROM nubrix_stage_ShipmentOrderAllocation a
JOIN nubrix_stage_KegOrder o ON o.OrderId = a.OrderId
JOIN nubrix_stage_dimCustomer c ON c.id = o.CustomerAccountUUID
JOIN nubrix_stage_Freight f ON f.ShipmentId = a.ShipmentId
JOIN nubrix_stage_TruckRoute t ON t.RouteId = a.RouteId
JOIN nubrix_stage_dimCarrier carrier ON carrier.id = f.CarrierId
WHERE 1=1 [[AND c.CustomerId = {{customer}}]]
ORDER BY o.DateNeeded, o.OrderId, a.RouteId
"""

SOURCE_CANDIDATES = """
WITH commitments AS (
  SELECT ReportedInventoryId, SUM(QuantityReserved) AS Quantity
  FROM nubrix_stage_InventoryReservation GROUP BY ReportedInventoryId
), stock AS (
  SELECT i.*, GREATEST(i.Quantity-COALESCE(r.Quantity,0),0) AS AvailableKegs
  FROM nubrix_stage_ReportedInventory i
  LEFT JOIN commitments r ON r.ReportedInventoryId=i.Id
  WHERE i.InventoryTypeId='Empty' AND NOT EXISTS (
    SELECT 1 FROM nubrix_stage_ReportedInventory newer
    WHERE newer.CustomerId=i.CustomerId AND newer.SizeId=i.SizeId
      AND newer.InventoryTypeId=i.InventoryTypeId AND newer.ReportDate>i.ReportDate
  )
)
SELECT o.OrderId, destination.CustomerId, destination.Name AS Destination,
       destination.ShippingCity AS DestinationCity, o.SizeId AS KegSize,
       o.DateNeeded, o.QuantityOrdered-o.QuantityPlanned AS UnplannedKegs,
       source.CustomerId AS SourceCustomerId, source.Name AS Source,
       source.ShippingCity AS SourceCity, s.AvailableKegs,
       LEAST(s.AvailableKegs,o.QuantityOrdered-o.QuantityPlanned) AS CandidateQuantity,
       d.RoadDistance AS ApproximateKm,
       ROW_NUMBER() OVER (PARTITION BY o.OrderId ORDER BY d.RoadDistance, s.AvailableKegs DESC, source.CustomerId) AS ProximityRank,
       'Candidate only; shared stock not reserved; deadline not evaluated' AS Limitation
FROM nubrix_stage_KegOrder o
JOIN nubrix_stage_dimCustomer destination ON destination.id=o.CustomerAccountUUID
JOIN stock s ON s.SizeId=o.SizeId AND s.CustomerId<>o.CustomerId AND s.AvailableKegs>0
JOIN nubrix_stage_dimCustomer source ON source.id=s.CustomerAccountUUID
JOIN nubrix_stage_FreightRoadDistance d ON
  (d.AddressAUUID=source.ShipAddressUUID AND d.AddressBUUID=o.ShipAddressUUID)
  OR (d.AddressBUUID=source.ShipAddressUUID AND d.AddressAUUID=o.ShipAddressUUID)
WHERE o.QuantityOrdered>o.QuantityPlanned
  [[AND destination.CustomerId = {{customer}}]]
ORDER BY o.DateNeeded, o.OrderId, ProximityRank
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="https://mstar.nubrixai.com")
    parser.add_argument("--session-file", type=Path, required=True)
    parser.add_argument("--database", type=int, default=2)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    session = json.loads(args.session_file.read_text())["id"]
    context = ssl.create_default_context(cafile=certifi.where())

    def api(path, method="GET", body=None):
        request = Request(args.url + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={"X-Metabase-Session": session, "Content-Type": "application/json"})
        try:
            with urlopen(request, context=context, timeout=120) as response:
                data = response.read()
                return json.loads(data) if data else None
        except HTTPError as error:
            raise RuntimeError(f"{method} {path}: HTTP {error.code}: {error.read().decode()[:1000]}") from None

    name = "Keg Demand & Inventory — Excel Simulation"
    if args.output.exists():
        raise ValueError("Dashboard manifest exists; inspect it before creating duplicates")
    existing = api("/api/dashboard")
    if any(d["name"] == name for d in existing):
        raise ValueError("Dashboard already exists; inspect it instead of creating duplicates")
    specs = [
        ("Customer demand map", DEMAND, "map", {"map.type": "pin", "map.latitude_column": "Latitude", "map.longitude_column": "Longitude"}),
        ("Orders — quantities and dates", ORDERS, "table", {}),
        ("Latest inventory — net of commitments", INVENTORY, "table", {}),
        ("Existing shipment allocations — synthetic cost proxies", ALLOCATIONS, "table", {}),
        ("Source candidates — proximity, not reserved allocations", SOURCE_CANDIDATES, "table", {}),
    ]
    datasets = []
    for title, sql, display, settings in specs:
        dataset = {"database": args.database, "type": "native", "native": {"query": sql, "template-tags": {"customer": {"id": "customer", "name": "customer", "display-name": "Customer ID", "type": "number", "required": False}}}}
        result = api("/api/dataset", "POST", dataset)
        if result.get("status") != "completed" or (sql != SOURCE_CANDIDATES and not result.get("data", {}).get("rows")):
            raise ValueError(f"Query failed or empty: {title}: {result.get('error', result.get('status'))}")
        filtered = dict(dataset, parameters=[{"type": "number/=", "target": ["variable", ["template-tag", "customer"]], "value": 1}])
        selected = api("/api/dataset", "POST", filtered)
        columns = [c["name"] for c in selected.get("data", {}).get("cols", [])]
        if selected.get("status") != "completed" or "CustomerId" not in columns:
            raise ValueError(f"Filtered query failed: {title}")
        if not all(row[columns.index("CustomerId")] == 1 for row in selected["data"]["rows"]):
            raise ValueError(f"Customer filter leaked rows: {title}")
        datasets.append(dataset)
        print(title, "rows", len(result["data"]["rows"]), "filtered rows", len(selected["data"]["rows"]))
    description = "Synthetic Excel demonstration, July 2026. Empty kegs only; customer roles not supplied. Distances approximate; cost proxies are not carrier rates. Existing allocations are not globally optimized; delivery feasibility is not evaluated. Inventory uses latest snapshots minus all recorded commitments."
    dashboard = api("/api/dashboard", "POST", {"name": name, "description": description, "parameters": [{"id": "customer", "name": "Customer ID", "slug": "customer", "type": "number/=", "sectionId": "number"}]})
    manifest = {"dashboardId": dashboard["id"], "url": args.url + "/dashboard/" + str(dashboard["id"]), "cards": []}
    args.output.write_text(json.dumps(manifest, indent=2))
    dashcards = []
    for index, ((title, _sql, display, settings), dataset) in enumerate(zip(specs, datasets)):
        card = api("/api/card", "POST", {"name": title, "description": description, "dataset_query": dataset, "display": display, "visualization_settings": settings})
        manifest["cards"].append(card["id"])
        args.output.write_text(json.dumps(manifest, indent=2))
        visualization_settings = {}
        if index == 0:
            visualization_settings = {"click_behavior": {"type": "crossfilter", "parameterMapping": {"customer": {"id": "customer", "source": {"type": "column", "id": "CustomerId", "name": "CustomerId"}, "target": {"type": "parameter", "id": "customer"}}}}}
        dashcards.append({"id": -index-1, "card_id": card["id"], "row": 0 if index < 2 else 9+(index-2)*8, "col": 0 if index != 1 else 9, "size_x": 9 if index == 0 else 15 if index == 1 else 24, "size_y": 9 if index < 2 else 8, "series": [], "parameter_mappings": [{"parameter_id": "customer", "card_id": card["id"], "target": ["variable", ["template-tag", "customer"]]}], "visualization_settings": visualization_settings})
    api("/api/dashboard/" + str(dashboard["id"]), "PUT", {"dashcards": dashcards, "auto_apply_filters": True})
    saved = api("/api/dashboard/" + str(dashboard["id"]))
    if len(saved["dashcards"]) != len(specs):
        raise ValueError("Saved dashboard card count mismatch")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
