"""Data adapters for MicroStar Supply Chain snapshots.

Supports:
1. WorkbookStageAdapter: ingests the 17-sheet Excel workbook, applies reservations,
   calculates As-Of Available-To-Promise (ATP), and creates immutable snapshots.
2. RailwayWarehouseAdapter: extracts live tables from Railway MySQL into the same
   immutable snapshot contract with full lineage.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
import hashlib
import json
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import openpyxl

from domain_contract import (
    PAISE_PER_INR,
    SPEED_KM_PER_DAY,
    compute_transit_days,
    evaluate_deadline_feasibility,
)


@dataclass
class AdapterResult:
    status: str  # "ready", "partial", "blocked"
    snapshot: Dict[str, Any]
    provenance: Dict[str, Any]
    warnings: List[str] = field(default_factory=list)
    missing_fields: List[str] = field(default_factory=list)


class WorkbookStageAdapter:
    """Ingests Keg_Demand_Fulfillment_Phase1_Dataset.xlsx into an immutable snapshot."""

    def __init__(self, workbook_path: Path):
        self.workbook_path = Path(workbook_path)
        if not self.workbook_path.exists():
            raise FileNotFoundError(f"Workbook not found: {self.workbook_path}")

    def load_snapshot(self, as_of_date: Optional[date] = None) -> AdapterResult:
        file_bytes = self.workbook_path.read_bytes()
        sha256_hash = hashlib.sha256(file_bytes).hexdigest()

        wb = openpyxl.load_workbook(self.workbook_path, data_only=True)
        tables = {}
        for sheet_name in wb.sheetnames:
            if sheet_name in ["KPI Dashboard", "README Assumptions"]:
                continue
            sheet = wb[sheet_name]
            rows = list(sheet.iter_rows(values_only=True))
            if not rows or len(rows) < 2:
                continue
            headers = [str(h).strip() if h is not None else f"col_{i}" for i, h in enumerate(rows[0])]
            data_rows = []
            for row in rows[1:]:
                if any(v is not None for v in row):
                    data_rows.append(dict(zip(headers, row)))
            tables[sheet_name] = data_rows
        wb.close()

        warnings = []
        missing_fields = []

        # 1. Customers and Facilities
        customers = {}
        addresses = {r["id"]: r for r in tables.get("dimAddress", [])}
        for cust in tables.get("dimCustomer", []):
            cid = f"CUST-{int(cust['CustomerId']):04d}"
            addr = addresses.get(cust.get("ShipAddressUUID"), {})
            cname = cust.get("Name") or f"Customer {cust['CustomerId']}"
            city = cust.get("ShippingCity") or addr.get("City") or "Unknown"
            state = cust.get("ShippingState") or addr.get("State") or "Unknown"
            lat = float(addr.get("Lat", 19.076))
            lon = float(addr.get("Lon", 72.878))

            # Derive type from name if missing
            ctype = "Brewer"
            if "Distributor" in cname:
                ctype = "Distributor"
            elif "Maintenance" in cname or "Facility" in cname:
                ctype = "Maintenance Facility"

            customers[cid] = {
                "id": cid,
                "name": cname,
                "type": ctype,
                "city": city,
                "state": state,
                "lat": lat,
                "lon": lon,
            }

        # 2. As-Of Available-To-Promise Inventory
        # ATP = Latest reported inventory - Active reservations
        active_reservations = defaultdict(int)
        for rsv in tables.get("InventoryReservation", []):
            if str(rsv.get("Status")).lower() in ["active", "reserved", "in transit"]:
                inv_id = rsv.get("ReportedInventoryId")
                qty = int(rsv.get("QuantityReserved", 0))
                active_reservations[inv_id] += qty

        # Group by customer & SKU, take latest snapshot
        inventory_records = defaultdict(list)
        for inv in tables.get("ReportedInventory", []):
            cid = f"CUST-{int(inv['CustomerId']):04d}"
            sku = str(inv.get("SizeId", "50L")).strip()
            rdate = inv.get("ReportDate")
            if isinstance(rdate, str):
                rdate = datetime.strptime(rdate[:10], "%Y-%m-%d").date()
            elif isinstance(rdate, datetime):
                rdate = rdate.date()
            raw_qty = int(inv.get("Quantity", 0))
            reserved_qty = active_reservations.get(inv.get("Id"), 0)
            atp_qty = max(0, raw_qty - reserved_qty)
            inventory_records[(cid, sku)].append((rdate, atp_qty, inv.get("Id")))

        stock_snapshot = []
        for (cid, sku), reports in inventory_records.items():
            reports.sort(key=lambda x: x[0] if x[0] else date.min)
            latest_date, latest_atp, inv_id = reports[-1]
            if latest_atp > 0:
                stock_snapshot.append({
                    "source": cid,
                    "sku": sku,
                    "available": latest_atp,
                    "as_of_date": str(latest_date) if latest_date else None,
                    "evidence_id": inv_id,
                })

        # 3. Orders
        orders_snapshot = []
        for o in tables.get("KegOrder", []):
            cid = f"CUST-{int(o['CustomerId']):04d}"
            oid = str(o["OrderId"]).strip()
            sku = str(o.get("SizeId", "50L")).strip()
            ordered = int(o.get("QuantityOrdered", 0))
            pending = int(o.get("QuantityPending", ordered))
            fulfilled = int(o.get("QuantityFulfilled", 0))

            needed_by = o.get("DateNeeded")
            ordered_date = o.get("DateOrdered")
            if isinstance(needed_by, str):
                needed_by = datetime.strptime(needed_by[:10], "%Y-%m-%d").date()
            elif isinstance(needed_by, datetime):
                needed_by = needed_by.date()
            if isinstance(ordered_date, str):
                ordered_date = datetime.strptime(ordered_date[:10], "%Y-%m-%d").date()
            elif isinstance(ordered_date, datetime):
                ordered_date = ordered_date.date()

            # Minutes relative to reference baseline (2026-07-01 = minute 0)
            base_date = date(2026, 7, 1)
            rel_minutes_needed = ((needed_by - base_date).days * 1440) if needed_by else 14400
            rel_minutes_ordered = ((ordered_date - base_date).days * 1440) if ordered_date else 0

            orders_snapshot.append({
                "id": oid,
                "customer_id": cid,
                "sku": sku,
                "destination": cid,
                "released": rel_minutes_ordered,
                "due": rel_minutes_needed,
                "ordered_date": str(ordered_date) if ordered_date else None,
                "needed_by_date": str(needed_by) if needed_by else None,
                "quantity_ordered": ordered,
                "pending": pending,
                "committed": 0,
            })

        # 4. Carriers & Vehicles
        carriers = {}
        for c in tables.get("dimCarrier", []):
            cid = int(c["id"])
            cname = c.get("CarrierName", f"Carrier {cid}")
            carriers[cid] = {"id": cid, "name": cname, "rate_paise": 200}  # ~2.00 INR/keg-km

        vehicles_snapshot = []
        for trk in tables.get("Truck", []):
            tid = str(trk["TruckId"])
            carrier_id = int(trk.get("CarrierId", 1))
            carrier_name = carriers.get(carrier_id, {}).get("name", "Standard Carrier")
            cap = int(trk.get("CapacityKegs", 300))
            # Default home base is first maintenance facility or distributor
            vehicles_snapshot.append({
                "id": tid,
                "carrier": carrier_name,
                "origin": "CUST-0001",
                "free_from": 0,
                "free_until": 100000,
                "capacity": cap,
            })

        # 5. Distance Matrix & Lanes
        legs = []
        lanes = []
        for dist in tables.get("FreightRoadDistance", []):
            aid = f"CUST-{int(dist['AddressAId']):04d}"
            bid = f"CUST-{int(dist['AddressBId']):04d}"
            km = int(dist.get("RoadDistance", 100))
            minutes = int((km / 50.0) * 60)  # ~50 km/h truck speed

            for carrier_info in carriers.values():
                cname = carrier_info["name"]
                legs.append({"carrier": cname, "origin": aid, "destination": bid, "km": km, "minutes": minutes})
                legs.append({"carrier": cname, "origin": bid, "destination": aid, "km": km, "minutes": minutes})
                lanes.append({
                    "carrier": cname,
                    "origin": aid,
                    "destination": bid,
                    "coordinator": "CUST-0002",
                    "via": None,
                    "km": km,
                    "minutes": minutes,
                    "rate_paise": 200,
                    "handling_minutes": 60,
                })

        snapshot = {
            "as_of": 0,
            "provenance": {
                "source": "WorkbookStageAdapter",
                "file": str(self.workbook_path.name),
                "sha256": sha256_hash,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            "orders": orders_snapshot,
            "stock": stock_snapshot,
            "vehicles": vehicles_snapshot,
            "lanes": lanes,
            "legs": legs,
            "customers": customers,
        }

        status = "ready" if orders_snapshot and stock_snapshot else "partial"
        return AdapterResult(
            status=status,
            snapshot=snapshot,
            provenance=snapshot["provenance"],
            warnings=warnings,
            missing_fields=missing_fields,
        )


class RailwayWarehouseAdapter:
    """Extracts live operational/staging snapshot from Railway MySQL database."""

    def __init__(self, connection_params: Dict[str, Any]):
        self.params = connection_params

    def load_snapshot(self, as_of_date: Optional[date] = None) -> AdapterResult:
        import pymysql

        conn = pymysql.connect(
            host=self.params.get("host", "switchyard.proxy.rlwy.net"),
            port=int(self.params.get("port", 32007)),
            user=self.params.get("user", "root"),
            password=self.params.get("password", ""),
            database=self.params.get("database", "railway"),
            connect_timeout=15,
            charset="utf8mb4",
        )

        try:
            with conn.cursor() as cursor:
                # 1. Customers
                cursor.execute("""
                    SELECT CustomerId, CustomerName, CustomerType, Region,
                           ShippingCity, ShippingState, Country, Latitude, Longitude, CustomerStatus
                    FROM dimCustomer
                """)
                customers = {}
                for row in cursor.fetchall():
                    cid, name, ctype, region, city, state, country, lat, lon, status = row
                    customers[cid] = {
                        "id": cid, "name": name, "type": ctype, "region": region,
                        "city": city, "state": state, "country": country,
                        "lat": float(lat), "lon": float(lon), "status": status,
                    }

                # 2. Carriers
                cursor.execute("SELECT CarrierId, CarrierName, CostPerKegKmINR, MaxLoadKegs FROM dimCarrier")
                carriers = {}
                for row in cursor.fetchall():
                    cid, name, rate, max_load = row
                    carriers[str(cid)] = {
                        "id": str(cid),
                        "name": name,
                        "rate_inr": float(rate),
                        "rate_paise": int(round(float(rate) * PAISE_PER_INR)),
                        "max_load": int(max_load),
                    }

                # 3. Stock / Reported Inventory (deduplicate to latest SnapshotDate <= as_of_date per CustomerId, SizeCode)
                cursor.execute("""
                    SELECT InventorySnapshotId, CustomerId, CustomerName, CustomerType,
                           Region, SizeCode, SnapshotDate, AvailableQuantity
                    FROM ReportedInventory
                """)
                all_inv_rows = cursor.fetchall()
                latest_inv: Dict[Tuple[str, str], Tuple[date, int, str, str, str, str]] = {}
                inv_date_mismatch = False
                for row in all_inv_rows:
                    inv_id, cid, name, ctype, region, sku, snap_date, qty = row
                    if isinstance(snap_date, str):
                        snap_d = datetime.strptime(snap_date[:10], "%Y-%m-%d").date()
                    elif isinstance(snap_date, datetime):
                        snap_d = snap_date.date()
                    elif isinstance(snap_date, date):
                        snap_d = snap_date
                    else:
                        snap_d = date.min
                    if as_of_date is not None and snap_d > as_of_date:
                        continue
                    key = (cid, sku)
                    prev = latest_inv.get(key)
                    if prev is None or snap_d >= prev[0]:
                        latest_inv[key] = (snap_d, int(qty), name, ctype, region, inv_id)

                if not latest_inv and all_inv_rows and as_of_date is not None:
                    inv_date_mismatch = True
                    for row in all_inv_rows:
                        inv_id, cid, name, ctype, region, sku, snap_date, qty = row
                        if isinstance(snap_date, str):
                            snap_d = datetime.strptime(snap_date[:10], "%Y-%m-%d").date()
                        elif isinstance(snap_date, datetime):
                            snap_d = snap_date.date()
                        elif isinstance(snap_date, date):
                            snap_d = snap_date
                        else:
                            snap_d = date.min
                        key = (cid, sku)
                        prev = latest_inv.get(key)
                        if prev is None or snap_d >= prev[0]:
                            latest_inv[key] = (snap_d, int(qty), name, ctype, region, inv_id)

                stock = []
                for (cid, sku), (snap_d, qty, name, ctype, region, inv_id) in latest_inv.items():
                    if qty > 0:
                        stock.append({
                            "source": cid,
                            "sku": sku,
                            "available": qty,
                            "customer_name": name,
                            "customer_type": ctype,
                            "region": region,
                            "as_of_date": str(snap_d),
                            "evidence_id": inv_id,
                        })

                # 4. Open Orders
                cursor.execute("""
                    SELECT OrderId, CustomerId, SizeCode, OrderedDate, NeededByDate,
                           QuantityOrdered, QuantityFulfilled, QuantityPending, OrderStatus
                    FROM KegOrder
                    WHERE QuantityPending > 0
                    ORDER BY NeededByDate ASC
                """)
                orders = []
                base_date = date(2026, 7, 1)
                for row in cursor.fetchall():
                    oid, cid, sku, o_date, n_date, q_ord, q_ful, q_pend, o_status = row
                    if isinstance(o_date, str):
                        o_date = datetime.strptime(o_date[:10], "%Y-%m-%d").date()
                    if isinstance(n_date, str):
                        n_date = datetime.strptime(n_date[:10], "%Y-%m-%d").date()

                    rel_ordered = (o_date - base_date).days * 1440 if o_date else 0
                    rel_due = (n_date - base_date).days * 1440 if n_date else 14400

                    orders.append({
                        "id": oid,
                        "customer_id": cid,
                        "sku": sku,
                        "destination": cid,
                        "released": rel_ordered,
                        "due": rel_due,
                        "ordered_date": str(o_date),
                        "needed_by_date": str(n_date),
                        "quantity_ordered": int(q_ord),
                        "fulfilled_units": int(q_ful),
                        "pending": int(q_pend),
                        "committed": 0,
                        "status": o_status,
                    })

                # 5. Distances & Lanes (load full directed/undirected distance matrix)
                cursor.execute("""
                    SELECT DistanceId, OriginCustomerId, DestCustomerId, RoadDistanceKm
                    FROM FreightRoadDistance
                """)
                legs = []
                lanes = []
                # Pick a representative default carrier for initial candidates
                primary_carrier = next(iter(carriers.values())) if carriers else {
                    "name": "SwiftHaul Logistics", "rate_paise": 210, "max_load": 900
                }

                seen_pairs = set()
                frd_count = 0
                for row in cursor.fetchall():
                    dist_id, orig, dest, km = row
                    km = int(km)
                    minutes = int((km / 50.0) * 60)
                    seen_pairs.add((orig, dest))
                    frd_count += 1
                    legs.append({
                        "carrier": primary_carrier["name"],
                        "origin": orig,
                        "destination": dest,
                        "km": km,
                        "minutes": minutes,
                        "lane_source": "FreightRoadDistance",
                    })
                    lanes.append({
                        "carrier": primary_carrier["name"],
                        "origin": orig,
                        "destination": dest,
                        "coordinator": orig,
                        "via": None,
                        "km": km,
                        "minutes": minutes,
                        "rate_paise": primary_carrier["rate_paise"],
                        "handling_minutes": 60,
                        "lane_source": "FreightRoadDistance",
                    })

                # Also load any derived synthetic proxy lanes from nubrix_poc_distance_matrix
                # (never mutates FreightRoadDistance; only fills missing directed pairs)
                proxy_count = 0
                cursor.execute("""
                    SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nubrix_poc_distance_matrix'
                """)
                if cursor.fetchone()[0] > 0:
                    cursor.execute("""
                        SELECT OriginCustomerId, DestCustomerId, RoadDistanceKm, lane_source
                        FROM nubrix_poc_distance_matrix
                    """)
                    for orig, dest, km, lsrc in cursor.fetchall():
                        if (orig, dest) in seen_pairs:
                            continue
                        km = int(km)
                        minutes = int((km / 50.0) * 60)
                        seen_pairs.add((orig, dest))
                        proxy_count += 1
                        legs.append({
                            "carrier": primary_carrier["name"],
                            "origin": orig,
                            "destination": dest,
                            "km": km,
                            "minutes": minutes,
                            "lane_source": lsrc or "synthetic_haversine_proxy",
                        })
                        lanes.append({
                            "carrier": primary_carrier["name"],
                            "origin": orig,
                            "destination": dest,
                            "coordinator": orig,
                            "via": None,
                            "km": km,
                            "minutes": minutes,
                            "rate_paise": primary_carrier["rate_paise"],
                            "handling_minutes": 60,
                            "lane_source": lsrc or "synthetic_haversine_proxy",
                        })

                # 6. Vehicle fleet table is absent in the 7-table Railway schema; do not fabricate trucks
                vehicles = []

        finally:
            conn.close()

        warnings = [
            "Railway 7-table schema has no Truck/vehicle availability or InventoryReservation table; "
            "carrier MaxLoadKegs is enforced per allocation and distances are synthetic India road proxies."
        ]
        if inv_date_mismatch:
            warnings.append(
                f"ReportedInventory SnapshotDate is later than planning as-of ({as_of_date}); "
                "using latest synthetic inventory snapshot as simulated opening stock."
            )
        missing_fields = ["Truck", "InventoryReservation"]

        provenance = {
            "source": "RailwayWarehouseAdapter",
            "host": self.params.get("host"),
            "database": self.params.get("database"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "as_of_date": str(as_of_date) if as_of_date else None,
            "orders_count": len(orders),
            "stock_count": len(stock),
            "customers_count": len(customers),
            "lanes_count": len(lanes),
            "freight_road_distance_count": frd_count,
            "supplemental_proxy_lanes_count": proxy_count,
        }

        snapshot = {
            "as_of": 0,
            "provenance": provenance,
            "orders": orders,
            "stock": stock,
            "vehicles": vehicles,
            "lanes": lanes,
            "legs": legs,
            "customers": customers,
            "carriers": carriers,
        }

        status = "partial" if orders and stock and missing_fields else ("ready" if orders and stock else "blocked")
        return AdapterResult(
            status=status,
            snapshot=snapshot,
            provenance=provenance,
            warnings=warnings,
            missing_fields=missing_fields,
        )
