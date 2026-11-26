"""Preflight Snapshot Validator & Coherence Checker for MicroStar Supply Chain.

Validates canonical identity, coordinate provenance, order quantity reconciliation,
role coherence (Brewer destinations), carrier rates/capacities, and lane consistency
before optimization or publication.
"""

from dataclasses import dataclass, field
import math
from typing import Any, Dict, List, Set, Tuple


VALID_ROLES = {"Brewer", "Distributor", "Maintenance Facility"}


@dataclass
class SnapshotValidationResult:
    ok: bool
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    summary: Dict[str, Any] = field(default_factory=dict)


def validate_snapshot(snapshot: Dict[str, Any]) -> SnapshotValidationResult:
    """Validate snapshot data quality and coherence before solving or publishing."""
    errors: List[str] = []
    warnings: List[str] = []

    customers = snapshot.get("customers", {})
    orders = snapshot.get("orders", [])
    stock = snapshot.get("stock", [])
    carriers = snapshot.get("carriers", {})
    lanes = snapshot.get("lanes", [])
    legs = snapshot.get("legs", [])

    # 1. Customer & Facility checks
    seen_names: Dict[str, List[str]] = {}
    missing_coords = 0
    invalid_roles = 0
    for cid, cust in customers.items():
        if not cid or not isinstance(cid, str):
            errors.append(f"Invalid customer ID: {cid!r}")
            continue
        name = str(cust.get("name") or "").strip()
        if not name:
            warnings.append(f"Customer {cid} has empty display name")
        else:
            seen_names.setdefault(name, []).append(cid)

        ctype = cust.get("type")
        if ctype not in VALID_ROLES:
            invalid_roles += 1
            warnings.append(f"Customer {cid} has non-standard role {ctype!r}")

        lat = cust.get("lat")
        lon = cust.get("lon")
        try:
            lat_f = float(lat)
            lon_f = float(lon)
            if not (math.isfinite(lat_f) and math.isfinite(lon_f)) or (lat_f == 0.0 and lon_f == 0.0):
                missing_coords += 1
        except (TypeError, ValueError):
            missing_coords += 1

    duplicate_names = {n: cids for n, cids in seen_names.items() if len(cids) > 1}
    if duplicate_names:
        warnings.append(
            f"Duplicate customer display names detected ({len(duplicate_names)}); canonical joins must use CustomerId only."
        )
    if missing_coords > 0:
        warnings.append(f"{missing_coords} facilities have missing or zero coordinates.")

    # 2. Order checks & coherence
    seen_order_ids: Set[str] = set()
    dup_order_ids: List[str] = []
    non_brewer_dest = 0
    reconciliation_errors = 0
    missing_dates = 0

    for o in orders:
        oid = str(o.get("id") or "").strip()
        if not oid:
            errors.append("Order with empty OrderId")
            continue
        if oid in seen_order_ids:
            dup_order_ids.append(oid)
        seen_order_ids.add(oid)

        dest_id = o.get("customer_id")
        dest_cust = customers.get(dest_id)
        if not dest_cust:
            errors.append(f"Order {oid} references unknown destination {dest_id!r}")
        elif dest_cust.get("type") != "Brewer":
            non_brewer_dest += 1
            warnings.append(f"Order {oid} destination {dest_id} has role {dest_cust.get('type')!r} instead of Brewer")

        q_ord = int(o.get("quantity_ordered", 0) or 0)
        q_ful = int(o.get("fulfilled_units", 0) or 0)
        q_pend = int(o.get("pending", 0) or 0)
        if q_ord <= 0 or q_pend < 0 or q_ful < 0 or (q_ord != q_ful + q_pend):
            reconciliation_errors += 1
            errors.append(
                f"Order {oid} quantity reconciliation failed: ordered={q_ord}, fulfilled={q_ful}, pending={q_pend}"
            )

        if not o.get("ordered_date") or not o.get("needed_by_date"):
            missing_dates += 1
            errors.append(f"Order {oid} missing ordered_date or needed_by_date")

    if dup_order_ids:
        errors.append(f"Duplicate OrderIds detected: {dup_order_ids[:5]}")

    # 3. Stock checks
    seen_stock_keys: Set[Tuple[str, str]] = set()
    dup_stock_keys = 0
    missing_stock_date = 0
    for s in stock:
        src = s.get("source")
        sku = s.get("sku")
        avail = int(s.get("available", 0) or 0)
        if src not in customers:
            errors.append(f"Stock row references unknown facility {src!r}")
        if avail < 0:
            errors.append(f"Stock row ({src}, {sku}) has negative available quantity {avail}")
        if (src, sku) in seen_stock_keys:
            dup_stock_keys += 1
        seen_stock_keys.add((src, sku))
        if not s.get("as_of_date"):
            missing_stock_date += 1

    if dup_stock_keys > 0:
        errors.append(f"Duplicate stock rows after deduplication: {dup_stock_keys}")
    if missing_stock_date > 0:
        warnings.append(f"{missing_stock_date} stock rows lack as_of_date.")

    # 4. Carrier checks
    for cid, car in carriers.items():
        rate = float(car.get("rate_inr", 0) or 0)
        max_load = int(car.get("max_load", 0) or 0)
        if rate <= 0:
            errors.append(f"Carrier {cid} has non-positive rate {rate}")
        if max_load <= 0:
            errors.append(f"Carrier {cid} has non-positive max_load {max_load}")

    # 5. Lane distance conflicts
    seen_lanes: Dict[Tuple[str, str], int] = {}
    conflicting_lanes = 0
    for row in (legs or lanes):
        orig = row.get("origin")
        dest = row.get("destination")
        km = int(row.get("km", 0) or 0)
        if km < 0:
            errors.append(f"Negative lane distance {km} for {orig} -> {dest}")
        prev_km = seen_lanes.get((orig, dest))
        if prev_km is not None and prev_km != km:
            conflicting_lanes += 1
        seen_lanes[(orig, dest)] = km

    if conflicting_lanes > 0:
        warnings.append(f"{conflicting_lanes} directed lane pairs had multiple conflicting distance values.")

    summary = {
        "customers_count": len(customers),
        "duplicate_customer_names": len(duplicate_names),
        "missing_coords_count": missing_coords,
        "invalid_roles_count": invalid_roles,
        "orders_count": len(orders),
        "non_brewer_destinations": non_brewer_dest,
        "reconciliation_errors": reconciliation_errors,
        "stock_rows": len(stock),
        "carriers_count": len(carriers),
        "conflicting_lanes": conflicting_lanes,
    }
    return SnapshotValidationResult(
        ok=(len(errors) == 0),
        errors=errors,
        warnings=warnings,
        summary=summary,
    )
