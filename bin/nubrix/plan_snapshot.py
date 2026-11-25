#!/usr/bin/env python3
"""Build an order-driven plan from a normalized, immutable warehouse snapshot.

All times are absolute minutes and all tariffs are integer paise per keg-km.
See plan_snapshot() for the input and output contract.
"""

import argparse
from collections import Counter, defaultdict
from itertools import permutations
import json

from allocate_routes import allocate


def plan_snapshot(snapshot, *, max_candidates=20000, time_limit_seconds=30):
    """Plan a snapshot with orders, net stock, and carrier-specific lane data.

    Orders are one row per order/SKU with unique id, destination, released,
    due, pending, and committed quantities. Stock is one net row per source/SKU.
    Vehicles provide id, carrier, origin, free_from, free_until, and capacity.
    Lanes provide carrier, origin, destination, km, minutes, rate_paise, and
    coordinator, with an optional physical via stop and handling_minutes.
    Directed legs provide carrier, origin, destination, km and minutes.
    """
    now = snapshot["as_of"]
    orders = {order["id"]: order for order in snapshot["orders"]}
    stock = {(row["source"], row["sku"]): row["available"] for row in snapshot["stock"]}
    vehicles = {row["id"]: row for row in snapshot["vehicles"]}
    if (len(orders) != len(snapshot["orders"]) or len(stock) != len(snapshot["stock"])
            or len(vehicles) != len(snapshot["vehicles"])):
        raise ValueError("Duplicate order, stock, or vehicle identifier")
    if any(value < 0 for value in stock.values()):
        raise ValueError("Net stock cannot be negative")
    if any(not 0 <= order["committed"] <= order["pending"] for order in orders.values()):
        raise ValueError("Committed quantity must be within pending demand")
    if any(vehicle["capacity"] <= 0 or vehicle["free_until"] < vehicle["free_from"]
           for vehicle in vehicles.values()):
        raise ValueError("Invalid vehicle capacity or availability")
    demand = {key: (order["due"], order["pending"] - order["committed"])
              for key, order in orders.items()}
    open_orders = sorted(orders.values(), key=lambda order: (order["due"], order["id"]))
    legs = {(leg["carrier"], leg["origin"], leg["destination"]): leg
            for leg in snapshot["legs"]}
    lanes = defaultdict(list)
    for lane in snapshot["lanes"]:
        lanes[lane["carrier"], lane["origin"], lane["destination"]].append(lane)
    for options in lanes.values():
        options.sort(key=lambda lane: (lane["rate_paise"], lane.get("minutes", 0), lane["coordinator"], lane.get("via") or ""))

    candidates = []
    eligible = set()
    exhausted = False
    for vehicle_id, vehicle in sorted(vehicles.items()):
        source = vehicle["origin"]
        carrier = vehicle["carrier"]
        choices = []
        for order in open_orders:
            key = source, order["sku"]
            quantity = min(stock.get(key, 0), demand[order["id"]][1], vehicle["capacity"])
            if quantity > 0 and order["due"] >= now:
                for lane in lanes[carrier, source, order["destination"]]:
                    choices.append((order, lane, quantity))
        for size in (1, 2, 3):
            for group in permutations(choices, size):
                if len({order["id"] for order, _, _ in group}) != size:
                    continue
                route = build_candidate(now, vehicle, group, legs, stock)
                if route is None:
                    continue
                eligible.update(order["id"] for order, _, _ in group)
                route["id"] = len(candidates)
                candidates.append(route)
                if len(candidates) >= max_candidates:
                    exhausted = True
                    break
            if exhausted:
                break
        if exhausted:
            break

    result = allocate(demand, stock, candidates, time_limit_seconds=time_limit_seconds)
    selected_by_id = {route["id"]: route for route in candidates}
    selected = [selected_by_id[route_id] for route_id in result["route_ids"]]
    proposed = Counter()
    used_stock = Counter()
    intervals = defaultdict(list)
    for route in selected:
        intervals[route["vehicle"]].append((route["start"], route["end"]))
        for order_id, key, quantity in route["shipments"]:
            proposed[order_id] += quantity
            used_stock[key] += quantity
    if any(used > stock[key] for key, used in used_stock.items()):
        raise RuntimeError("Plan exceeds available stock")
    if any(a[1] > b[0] for trips in intervals.values()
           for a, b in zip(sorted(trips), sorted(trips)[1:])):
        raise RuntimeError("Vehicle routes overlap")
    outcomes = []
    for order in open_orders:
        key = order["id"]
        uncovered = demand[key][1] - proposed[key]
        if uncovered < 0:
            raise RuntimeError("Plan exceeds outstanding demand")
        reason = None
        if uncovered:
            if order["due"] < now:
                reason = "overdue"
            elif not any(sku == order["sku"] and value > 0 for (_, sku), value in stock.items()):
                reason = "no_available_stock_for_sku"
            elif exhausted or result["status"] == "time_limit":
                reason = "search_limit"
            elif key not in eligible:
                reason = "no_candidate_meets_lane_vehicle_and_deadline_constraints"
            else:
                reason = "shared_capacity_or_stock_allocated_to_other_orders"
        outcomes.append({**order, "proposed": proposed[key], "uncovered": uncovered, "reason": reason})
    return {"as_of": now, "provenance": snapshot["provenance"], "solver_status": result["status"],
            "candidate_limit_reached": exhausted, "candidate_count": len(candidates),
            "orders": outcomes, "routes": selected}


def build_candidate(now, vehicle, group, legs, stock):
    """Load at the vehicle origin, optionally stop at a common cross-dock, then deliver."""
    source = vehicle["origin"]
    carrier = vehicle["carrier"]
    vias = {lane.get("via") for _, lane, _ in group}
    if len(vias) != 1:
        return None
    via = next(iter(vias))
    load = sum(quantity for _, _, quantity in group)
    if load > vehicle["capacity"]:
        return None
    by_sku = Counter()
    for order, _, quantity in group:
        by_sku[order["sku"]] += quantity
    if any(quantity > stock[source, sku] for sku, quantity in by_sku.items()):
        return None
    start = max(now, vehicle["free_from"], *(order["released"] for order, _, _ in group))
    elapsed = 0
    distance = 0
    current = source
    stops = [{"location": source, "arrival": start, "kind": "pickup", "onboard": load}]
    if via:
        leg = legs.get((carrier, source, via))
        if not leg:
            return None
        elapsed += leg["minutes"]
        distance += leg["km"]
        stops.append({"location": via, "arrival": start + elapsed, "kind": "cross_dock", "onboard": load})
        elapsed += max(lane.get("handling_minutes", 0) for _, lane, _ in group)
        current = via
    details = []
    for order, lane, quantity in group:
        destination = order["destination"]
        if current != destination:
            leg = legs.get((carrier, current, destination))
            if not leg:
                return None
            elapsed += leg["minutes"]
            distance += leg["km"]
        arrival = start + elapsed
        if arrival > order["due"] or arrival > vehicle["free_until"]:
            return None
        load -= quantity
        stops.append({"location": destination, "arrival": arrival, "kind": "delivery", "onboard": load})
        details.append({"order_id": order["id"], "source": source, "destination": destination,
                        "coordinator": lane["coordinator"], "quantity": quantity, "arrival": arrival,
                        "km": distance, "freight_paise": quantity * distance * lane["rate_paise"]})
        current = destination
    # Return to the modeled vehicle base before it can be assigned another route.
    if current != source:
        leg = legs.get((carrier, current, source))
        if not leg or start + elapsed + leg["minutes"] > vehicle["free_until"]:
            return None
        elapsed += leg["minutes"]
        distance += leg["km"]
        stops.append({"location": source, "arrival": start + elapsed, "kind": "return", "onboard": 0})
    return {"vehicle": vehicle["id"], "carrier": carrier, "start": start, "end": start + max(1, elapsed),
            "freight_paise": sum(row["freight_paise"] for row in details), "km": distance,
            "stops": stops, "details": details,
            "shipments": [(order["id"], (source, order["sku"]), quantity) for order, _, quantity in group]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=argparse.FileType("r"))
    args = parser.parse_args()
    print(json.dumps(plan_snapshot(json.load(args.snapshot)), indent=2))


if __name__ == "__main__":
    main()
