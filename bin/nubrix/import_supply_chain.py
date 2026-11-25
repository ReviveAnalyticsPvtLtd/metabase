"""Back up Railway and stage the supplied workbook; never replace live tables."""

import argparse
from collections import defaultdict
from datetime import datetime
import getpass
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.parse import unquote, urlparse

from openpyxl import load_workbook
import pymysql


PREFIX = "nubrix_stage_"
EXCLUDED = {"README Assumptions", "KPI Dashboard"}
RELATIONS = [
    ("dimCustomer", "ShipAddressUUID", "dimAddress", "id"),
    ("KegOrder", "CustomerAccountUUID", "dimCustomer", "id"),
    ("KegOrder", "CustomerId", "dimCustomer", "CustomerId"),
    ("KegOrder", "ShipAddressUUID", "dimAddress", "id"),
    ("KegOrder", "SizeId", "dimProductSize", "Code"),
    ("Order", "OrderId", "KegOrder", "OrderId"),
    ("Order", "ItemSkuId", "dimProductSize", "Code"),
    ("ReportedInventory", "CustomerAccountUUID", "dimCustomer", "id"),
    ("ReportedInventory", "CustomerId", "dimCustomer", "CustomerId"),
    ("ReportedInventory", "ReportDateId", "dimDate", "id"),
    ("ReportedInventory", "SizeId", "dimProductSize", "Code"),
    ("Truck", "CarrierId", "dimCarrier", "id"),
    ("TruckRoute", "TruckId", "Truck", "TruckId"),
    ("TruckRoute", "CarrierId", "dimCarrier", "id"),
    ("InventoryReservation", "ReportedInventoryId", "ReportedInventory", "Id"),
    ("InventoryReservation", "RouteId", "TruckRoute", "RouteId"),
    ("InventoryReservation", "SizeId", "dimProductSize", "Code"),
    ("RouteStop", "RouteId", "TruckRoute", "RouteId"),
    ("RouteStop", "AddressId", "dimAddress", "id"),
    ("RouteStop", "CustomerId", "dimCustomer", "CustomerId"),
    ("Freight", "RouteId", "TruckRoute", "RouteId"),
    ("Freight", "CarrierId", "dimCarrier", "id"),
    ("Freight", "RepresentativeOrderId", "KegOrder", "OrderId"),
    ("ShipmentOrderAllocation", "RouteId", "TruckRoute", "RouteId"),
    ("ShipmentOrderAllocation", "ShipmentId", "Freight", "ShipmentId"),
    ("ShipmentOrderAllocation", "OrderId", "KegOrder", "OrderId"),
    ("ShipmentOrderAllocation", "OrderLineId", "Order", "id"),
    ("ShipmentOrderAllocation", "SizeId", "dimProductSize", "Code"),
    ("Movement", "ShipmentId", "Freight", "ShipmentId"),
    ("Movement", "RouteId", "TruckRoute", "RouteId"),
    ("Movement", "AddressId", "dimAddress", "id"),
    ("Movement", "CustomerId", "dimCustomer", "CustomerId"),
    ("Movement", "SizeId", "dimProductSize", "Code"),
    ("DeliveryAcknowledgment", "ShipmentId", "Freight", "ShipmentId"),
    ("DeliveryAcknowledgment", "RouteId", "TruckRoute", "RouteId"),
    ("DeliveryAcknowledgment", "OrderId", "KegOrder", "OrderId"),
    ("DeliveryAcknowledgment", "SizeId", "dimProductSize", "Code"),
    ("DeliveryAcknowledgment", "CustomerId", "dimCustomer", "CustomerId"),
    ("FreightRoadDistance", "AddressAUUID", "dimAddress", "id"),
    ("FreightRoadDistance", "AddressBUUID", "dimAddress", "id"),
]


def quoted(name):
    return "`" + name.replace("`", "``") + "`"


def read_workbook(path):
    workbook = load_workbook(path, read_only=True, data_only=True)
    tables = {}
    for sheet in workbook:
        if sheet.title in EXCLUDED:
            continue
        rows = iter(sheet.values)
        headers = next(rows)
        if not all(isinstance(h, str) and h for h in headers):
            raise ValueError(f"Invalid headers: {sheet.title}")
        tables[sheet.title] = [dict(zip(headers, row)) for row in rows if any(v is not None for v in row)]
    workbook.close()
    return tables


def validate(tables):
    errors = []
    for name, rows in tables.items():
        keys = [next(iter(row.values())) for row in rows]
        if None in keys or len(keys) != len(set(keys)):
            errors.append(f"{name}: missing or duplicate primary key")
    for table, field, parent, key in RELATIONS:
        valid = {row[key] for row in tables[parent]}
        if any(row[field] not in valid for row in tables[table]):
            errors.append(f"{table}.{field}: orphan reference")
    customers = {r["CustomerId"]: r for r in tables["dimCustomer"]}
    for name in ["KegOrder", "ReportedInventory", "RouteStop", "Movement", "DeliveryAcknowledgment"]:
        for row in tables[name]:
            customer = customers.get(row["CustomerId"])
            if not customer:
                errors.append(f"{name}: unknown CustomerId")
            elif "CustomerAccountUUID" in row and row["CustomerAccountUUID"] != customer["id"]:
                errors.append(f"{name}: inconsistent customer UUID")
    inventory = {r["Id"]: r for r in tables["ReportedInventory"]}
    reserved = defaultdict(int)
    for row in tables["InventoryReservation"]:
        reserved[row["ReportedInventoryId"]] += row["QuantityReserved"]
        if row["SizeId"] != inventory[row["ReportedInventoryId"]]["SizeId"]:
            errors.append("InventoryReservation: incompatible size")
    if any(quantity > inventory[key]["Quantity"] for key, quantity in reserved.items()):
        errors.append("InventoryReservation: inventory overallocated")
    trucks = {r["TruckId"]: r for r in tables["Truck"]}
    routes = {r["RouteId"]: r for r in tables["TruckRoute"]}
    for route in routes.values():
        if route["CarrierId"] != trucks[route["TruckId"]]["CarrierId"]:
            errors.append("TruckRoute: truck/carrier mismatch")
        stops = sorted((r for r in tables["RouteStop"] if r["RouteId"] == route["RouteId"]), key=lambda r: r["StopSequence"])
        onboard = 0
        for stop in stops:
            onboard += stop["PickupQuantity"] - stop["DeliveryQuantity"]
            if onboard != stop["OnboardQuantity"] or not 0 <= onboard <= route["CapacityKegs"]:
                errors.append("RouteStop: onboard quantity/capacity mismatch")
        if onboard:
            errors.append("RouteStop: undelivered onboard inventory")
    orders = {r["OrderId"]: r for r in tables["KegOrder"]}
    allocated = defaultdict(int)
    acknowledged = defaultdict(int)
    for row in tables["ShipmentOrderAllocation"]:
        allocated[row["OrderId"]] += row["QuantityAllocated"]
        if row["SizeId"] != orders[row["OrderId"]]["SizeId"]:
            errors.append("ShipmentOrderAllocation: incompatible size")
    for row in tables["DeliveryAcknowledgment"]:
        acknowledged[row["OrderId"]] += row["AcknowledgedQuantity"]
        if not 0 <= row["AcknowledgedQuantity"] <= row["DeliveredQuantity"]:
            errors.append("DeliveryAcknowledgment: invalid acknowledged quantity")
        if row["DiscrepancyQuantity"] != row["DeliveredQuantity"] - row["AcknowledgedQuantity"]:
            errors.append("DeliveryAcknowledgment: invalid discrepancy")
    for key, order in orders.items():
        if not 0 <= order["QuantityFulfilled"] <= order["QuantityPlanned"] <= order["QuantityOrdered"]:
            errors.append("KegOrder: invalid quantity balance")
        if order["QuantityPending"] != order["QuantityOrdered"] - order["QuantityFulfilled"]:
            errors.append("KegOrder: pending quantity mismatch")
        if allocated[key] != order["QuantityPlanned"] or acknowledged[key] != order["QuantityFulfilled"]:
            errors.append("KegOrder: allocation/acknowledgment mismatch")
    for freight in tables["Freight"]:
        route = routes[freight["RouteId"]]
        if freight["CarrierId"] != route["CarrierId"] or freight["Quantity"] != route["QuantityAllocated"]:
            errors.append("Freight: route mismatch")
    if errors:
        raise ValueError("; ".join(sorted(set(errors))))


def correct_carriers(tables):
    trucks = {r["TruckId"]: r for r in tables["Truck"]}
    corrections = []
    for route in tables["TruckRoute"]:
        carrier = trucks[route["TruckId"]]["CarrierId"]
        if route["CarrierId"] != carrier:
            corrections.append({"RouteId": route["RouteId"], "oldCarrierId": route["CarrierId"], "newCarrierId": carrier})
            route["CarrierId"] = carrier
    routes = {r["RouteId"]: r for r in tables["TruckRoute"]}
    for freight in tables["Freight"]:
        freight["CarrierId"] = routes[freight["RouteId"]]["CarrierId"]
    return corrections


def sql_type(values):
    present = [value for value in values if value is not None]
    if present and all(isinstance(value, int) for value in present):
        return "BIGINT"
    if present and all(isinstance(value, (int, float)) for value in present):
        return "DECIMAL(24,10)"
    if present and all(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) for value in present):
        return "DATE"
    return "VARCHAR(255)"


def backup(connection, destination):
    partial = destination.with_suffix(destination.suffix + ".partial")
    connection.commit()
    with connection.cursor() as cursor, gzip.open(partial, "wt", encoding="utf-8") as output:
        cursor.execute("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        cursor.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT")
        cursor.execute("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")
        names = [row[0] for row in cursor.fetchall()]
        for name in names:
            cursor.execute("SHOW CREATE TABLE " + quoted(name))
            ddl = cursor.fetchone()[1]
            cursor.execute("SELECT * FROM " + quoted(name))
            output.write(json.dumps({"table": name, "ddl": ddl, "columns": [r[0] for r in cursor.description]}) + "\n")
            while rows := cursor.fetchmany(1000):
                output.write(json.dumps({"table": name, "rows": rows}, default=str) + "\n")
        connection.commit()
    partial.rename(destination)


def stage(connection, tables):
    with connection.cursor() as cursor:
        cursor.execute("SHOW TABLES")
        existing = {r[0] for r in cursor.fetchall()}
        if any(PREFIX + name in existing for name in tables):
            raise ValueError("Staging tables already exist; inspect them before another import")
        for name, rows in tables.items():
            columns = list(rows[0])
            definitions = [quoted(column) + " " + sql_type([r[column] for r in rows]) for column in columns]
            definitions.append("PRIMARY KEY (" + quoted(columns[0]) + ")")
            if name == "dimProductSize":
                definitions.append("UNIQUE KEY (Code)")
            if name == "dimCustomer":
                definitions.append("UNIQUE KEY (CustomerId)")
            cursor.execute("CREATE TABLE " + quoted(PREFIX + name) + " (" + ",".join(definitions) + ") ENGINE=InnoDB")
        for name, rows in tables.items():
            columns = list(rows[0])
            cursor.executemany("INSERT INTO " + quoted(PREFIX + name) + " (" + ",".join(map(quoted, columns)) + ") VALUES (" + ",".join(["%s"] * len(columns)) + ")", [tuple(row[c] for c in columns) for row in rows])
        connection.commit()
        for table, field, parent, key in RELATIONS:
            cursor.execute("ALTER TABLE " + quoted(PREFIX + table) + " ADD FOREIGN KEY (" + quoted(field) + ") REFERENCES " + quoted(PREFIX + parent) + " (" + quoted(key) + ")")
        for name, rows in tables.items():
            cursor.execute("SELECT COUNT(*) FROM " + quoted(PREFIX + name))
            if cursor.fetchone()[0] != len(rows):
                raise ValueError(f"Row count mismatch: {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--stage", action="store_true", help="Back up database and create new staging tables")
    args = parser.parse_args()
    tables = read_workbook(args.workbook)
    corrections = correct_carriers(tables)
    validate(tables)
    args.output.mkdir(parents=True, exist_ok=True, mode=0o700)
    report = {"source": str(args.workbook), "sourceSHA256": hashlib.sha256(args.workbook.read_bytes()).hexdigest(), "rows": {n: len(r) for n, r in tables.items()}, "carrierCorrections": corrections, "limitations": ["Synthetic demonstration only", "Original cost proxies preserved; not calibrated carrier rates", "Approximate distances; shared coordinates may yield zero distance", "No customer roles, full-keg inventory, or transit SLA provided", "No global optimization or deadline-feasibility claim"]}
    (args.output / "validated-data.json").write_text(json.dumps(tables, indent=2, default=str))
    if args.stage:
        url = urlparse(os.environ.get("NUBRIX_MYSQL_URL") or getpass.getpass("MySQL connection URL: "))
        if url.scheme != "mysql" or not url.hostname or not url.path.strip("/"):
            raise ValueError("Expected mysql://user:password@host:port/database")
        connection = pymysql.connect(host=url.hostname, port=url.port or 3306, user=unquote(url.username or ""), password=unquote(url.password or ""), database=url.path.lstrip("/"), connect_timeout=15, read_timeout=120, write_timeout=120, charset="utf8mb4")
        try:
            destination = args.output / ("railway-backup-" + datetime.now().strftime("%Y%m%d-%H%M%S") + ".jsonl.gz")
            backup(connection, destination)
            report["backup"] = str(destination)
            stage(connection, tables)
            report["staged"] = True
        finally:
            connection.close()
    (args.output / "validation-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"rows": report["rows"], "carrierCorrections": len(corrections), "staged": report.get("staged", False), "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
