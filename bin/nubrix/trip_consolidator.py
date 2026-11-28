"""Multi-Order Shared-Trip Consolidation & Route Sequencing Optimizer.

Consolidates multiple compatible orders from the same source facility onto
shared carrier trips respecting:
- Directed leg distances (FreightRoadDistance + nubrix_poc_distance_matrix)
- Exact cumulative transit deadlines at every stop on the route
- Carrier truck capacity (MaxLoadKegs) and finite carrier truck dispatch caps
- Exact leg-by-leg physical keg-km freight calculation (no invented costs)
"""

from collections import defaultdict
from datetime import date
from itertools import permutations
import math
from typing import Any, Dict, List, Optional, Tuple

from ortools.sat.python import cp_model

from domain_contract import (
    PAISE_PER_INR,
    compute_transit_days,
    evaluate_deadline_feasibility,
)


def _haversine_km_approx(c1: Dict[str, Any], c2: Dict[str, Any]) -> float:
    try:
        lat1, lon1 = float(c1.get("lat", 0) or 0), float(c1.get("lon", 0) or 0)
        lat2, lon2 = float(c2.get("lat", 0) or 0), float(c2.get("lon", 0) or 0)
    except (TypeError, ValueError):
        return 9999.0
    if (lat1 == 0 and lon1 == 0) or (lat2 == 0 and lon2 == 0):
        return 9999.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def _evaluate_trip_sequence(
    src_id: str,
    src_name: str,
    seq_orders: List[Dict[str, Any]],
    customers: Dict[str, Any],
    distance_map: Dict[Tuple[str, str], int],
    directed_lanes: bool,
    as_of_d: Optional[date],
    rate_inr: float,
    fixed_trip_charge_paise: int = 0,
) -> Optional[Dict[str, Any]]:
    """Verify directed legs and deadlines for an ordered sequence of stops and compute physical keg-km cost."""
    total_kegs = sum(o["allocated_units"] for o in seq_orders)
    rem_load = total_kegs
    prev_id = src_id
    prev_name = src_name
    cum_km = 0
    total_keg_km = 0
    stops = []

    for idx, o in enumerate(seq_orders, start=1):
        dest_id = o["destination_customer_id"]
        if prev_id == dest_id:
            leg_km = 0
        elif (prev_id, dest_id) in distance_map:
            leg_km = distance_map[(prev_id, dest_id)]
        elif not directed_lanes and (dest_id, prev_id) in distance_map:
            leg_km = distance_map[(dest_id, prev_id)]
        else:
            return None

        cum_km += int(leg_km)
        cum_transit = compute_transit_days(cum_km)
        is_feas, slack = evaluate_deadline_feasibility(
            o["ordered_date_d"], o["needed_by_d"], cum_transit, as_of_date=as_of_d
        )
        if not is_feas:
            return None

        total_keg_km += rem_load * int(leg_km)
        qty = int(o["allocated_units"])
        load_after = rem_load - qty
        dest_name = customers.get(dest_id, {}).get("name", o["destination_brewer"])

        stops.append({
            "stop_sequence": idx,
            "line_id": o["line_id"],
            "order_id": o["order_id"],
            "destination_customer_id": dest_id,
            "destination_name": dest_name,
            "keg_size": o["keg_size"],
            "kegs_delivered": qty,
            "load_before_stop_kegs": rem_load,
            "load_after_stop_kegs": load_after,
            "leg_from_id": prev_id,
            "leg_from_name": prev_name,
            "leg_distance_km": int(leg_km),
            "cumulative_distance_km": cum_km,
            "cumulative_transit_days": cum_transit,
            "needed_by": o["needed_by"],
            "on_time_feasible": "Y",
            "slack_days": slack,
        })
        rem_load = load_after
        prev_id = dest_id
        prev_name = dest_name

    total_freight_paise = int(round(total_keg_km * rate_inr * PAISE_PER_INR)) + fixed_trip_charge_paise
    total_freight_inr = round(total_freight_paise / float(PAISE_PER_INR), 2)

    # Allocate total_freight_paise proportionally by delivered kegs (exact paise sum)
    allocated_paise = 0
    for i, st in enumerate(stops):
        if i == len(stops) - 1:
            p = total_freight_paise - allocated_paise
        else:
            p = int(round(total_freight_paise * (st["kegs_delivered"] / float(total_kegs))))
            allocated_paise += p
        st["allocated_freight_inr"] = round(p / float(PAISE_PER_INR), 2)

    return {
        "total_kegs": total_kegs,
        "total_distance_km": cum_km,
        "total_keg_km": total_keg_km,
        "total_freight_paise": total_freight_paise,
        "total_freight_inr": total_freight_inr,
        "stops": stops,
    }


def _find_best_trip_sequence(
    src_id: str,
    src_name: str,
    group_orders: List[Dict[str, Any]],
    customers: Dict[str, Any],
    distance_map: Dict[Tuple[str, str], int],
    directed_lanes: bool,
    as_of_d: Optional[date],
    rate_inr: float,
) -> Optional[Dict[str, Any]]:
    """Evaluate all exact stop permutations (for group size 1..4) and pick lowest physical keg-km."""
    if len(group_orders) == 1:
        return _evaluate_trip_sequence(
            src_id, src_name, group_orders, customers, distance_map, directed_lanes, as_of_d, rate_inr
        )

    best_eval: Optional[Dict[str, Any]] = None
    for perm in permutations(group_orders):
        ev = _evaluate_trip_sequence(
            src_id, src_name, list(perm), customers, distance_map, directed_lanes, as_of_d, rate_inr
        )
        if ev is not None:
            if best_eval is None or (ev["total_keg_km"], ev["total_distance_km"]) < (
                best_eval["total_keg_km"],
                best_eval["total_distance_km"],
            ):
                best_eval = ev
    return best_eval


def consolidate_trips_cpsat(
    outcomes: List[Any],
    snapshot: Dict[str, Any],
    distance_map: Dict[Tuple[str, str], int],
    directed_lanes: bool,
    as_of_d: Optional[date],
    carrier_truck_limits: Optional[Dict[str, int]] = None,
    time_limit_seconds: float = 30.0,
    max_stops_per_trip: int = 4,
) -> Tuple[List[Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    """Consolidate covered orders at each source into multi-order trips via CP-SAT set partitioning.

    Preserves exact source assignments, SKU stock conservation, deadlines, and carrier caps
    while minimizing declared carrier freight. A fixed-trip charge is included only
    when the carrier explicitly provides one in the snapshot.
    Returns (selected_trips, order_trip_updates_map).
    """
    customers = snapshot.get("customers", {})
    carriers = snapshot.get("carriers", {})
    carrier_list = sorted(
        [c for c in carriers.values() if int(c.get("max_load", 0) or 0) > 0],
        key=lambda c: (float(c.get("rate_inr", 2.0)), -int(c.get("max_load", 0) or 0)),
    )
    if not carrier_list:
        return [], {}

    fixed_charges = {}
    for carrier in carrier_list:
        charge = float(carrier.get("fixed_trip_charge_inr", 0) or 0)
        if not math.isfinite(charge) or charge < 0:
            raise ValueError(f"Invalid fixed trip charge for {carrier['name']}")
        fixed_charges[carrier["id"]] = round(charge * PAISE_PER_INR)

    max_carrier_cap = max(int(c["max_load"]) for c in carrier_list)
    by_line_raw: Dict[str, Any] = {}
    lines_by_source: Dict[str, List[Dict[str, Any]]] = defaultdict(list)

    for out in outcomes:
        if out.allocated_units <= 0:
            continue
        lines = getattr(out, "allocation_lines", None) or []
        if not lines and out.source_customer_id:
            lines = [{
                "line_id": f"{out.order_id}#S1",
                "order_id": out.order_id,
                "source_customer_id": out.source_customer_id,
                "allocated_units": int(out.allocated_units),
                "distance_km": int(out.distance_km),
            }]
        ord_d = date.fromisoformat(str(out.ordered_date)[:10])
        nb_d = date.fromisoformat(str(out.needed_by)[:10])
        dest_cust = customers.get(out.destination_customer_id, {})
        for idx_l, ln in enumerate(lines, start=1):
            qty_l = int(ln["allocated_units"])
            src_l = ln["source_customer_id"]
            if qty_l <= 0 or not src_l:
                continue
            lid = ln.get("line_id") or f"{out.order_id}#S{idx_l}"
            by_line_raw[lid] = (out, ln)
            lines_by_source[src_l].append({
                "line_id": lid,
                "order_id": out.order_id,
                "source_customer_id": src_l,
                "destination_customer_id": out.destination_customer_id,
                "destination_brewer": out.destination_brewer,
                "region": out.region,
                "city": dest_cust.get("city", ""),
                "keg_size": out.keg_size,
                "ordered_date": str(out.ordered_date)[:10],
                "needed_by": str(out.needed_by)[:10],
                "ordered_date_d": ord_d,
                "needed_by_d": nb_d,
                "allocated_units": qty_l,
                "base_distance_km": int(ln.get("distance_km", out.distance_km)),
            })

    if not by_line_raw:
        return [], {}

    candidate_trips: List[Dict[str, Any]] = []
    trips_covering_line: Dict[str, List[int]] = defaultdict(list)

    def _add_trip_candidate(
        src_id: str,
        src_name: str,
        src_role: str,
        seq_eval: Dict[str, Any],
        car: Dict[str, Any],
    ) -> None:
        tid = len(candidate_trips)
        line_ids = [s["line_id"] for s in seq_eval["stops"]]
        order_ids = [s["order_id"] for s in seq_eval["stops"]]
        line_set = set(line_ids)
        dispatch_d = max(
            [o["ordered_date_d"] for o in (lines_by_source[src_id]) if o["line_id"] in line_set]
            + ([as_of_d] if as_of_d else [])
        )
        max_load = int(car["max_load"])
        util_pct = round(100.0 * seq_eval["total_kegs"] / float(max_load), 1) if max_load > 0 else 0.0
        trip_obj = {
            "cand_trip_id": tid,
            "source_customer_id": src_id,
            "source_name": src_name,
            "source_role": src_role,
            "carrier_id": str(car["id"]),
            "carrier_name": car["name"],
            "carrier_max_load_kegs": max_load,
            "rate_inr": float(car["rate_inr"]),
            "total_kegs": seq_eval["total_kegs"],
            "utilization_pct": util_pct,
            "stop_count": len(seq_eval["stops"]),
            "total_distance_km": seq_eval["total_distance_km"],
            "total_keg_km": seq_eval["total_keg_km"],
            "fixed_trip_charge_paise": fixed_charges[car["id"]],
            "total_freight_paise": seq_eval["total_freight_paise"],
            "total_freight_inr": seq_eval["total_freight_inr"],
            "dispatch_date": str(dispatch_d),
            "line_ids": line_ids,
            "order_ids": order_ids,
            "stops": seq_eval["stops"],
        }
        candidate_trips.append(trip_obj)
        for lid in line_ids:
            trips_covering_line[lid].append(tid)

    # Generate 1-stop direct trips AND 2..4-stop consolidated trips per source
    for src_id, src_orders in lines_by_source.items():
        src_cust = customers.get(src_id, {})
        src_name = src_cust.get("name", src_id)
        src_role = src_cust.get("type", "Unknown")

        # 1. Always generate valid 1-stop candidates for all eligible carriers (guarantees feasibility)
        for o in src_orders:
            for car in carrier_list:
                if int(car["max_load"]) < o["allocated_units"]:
                    continue
                ev = _evaluate_trip_sequence(
                    src_id, src_name, [o], customers, distance_map, directed_lanes, as_of_d,
                    float(car["rate_inr"]), fixed_charges[car["id"]],
                )
                if ev is not None:
                    _add_trip_candidate(src_id, src_name, src_role, ev, car)

        # 2. Cluster lines at this source by proximity & delivery window to build 2..max_stops multi-order trips
        sorted_src_orders = sorted(
            src_orders,
            key=lambda x: (x["needed_by_d"], x["region"], x["city"], -x["allocated_units"], x["line_id"]),
        )
        seen_line_sets = set()
        for idx_a, o_a in enumerate(sorted_src_orders):
            neighbors = []
            dest_a = customers.get(o_a["destination_customer_id"], {})
            for idx_b, o_b in enumerate(sorted_src_orders):
                if idx_b <= idx_a or o_b["order_id"] == o_a["order_id"]:
                    continue
                if abs((o_b["needed_by_d"] - o_a["needed_by_d"]).days) > 3:
                    continue
                if o_a["allocated_units"] + o_b["allocated_units"] > max_carrier_cap:
                    continue
                dest_b = customers.get(o_b["destination_customer_id"], {})
                km_ab = _haversine_km_approx(dest_a, dest_b)
                neighbors.append((km_ab, o_b))
            neighbors.sort(key=lambda x: (x[0], x[1]["needed_by_d"], x[1]["line_id"]))

            top_neighbors = [nb for _km, nb in neighbors[:6]]
            for o_b in top_neighbors:
                grp2 = [o_a, o_b]
                key2 = tuple(sorted(x["line_id"] for x in grp2))
                if key2 in seen_line_sets:
                    continue
                seen_line_sets.add(key2)
                comb_qty2 = sum(x["allocated_units"] for x in grp2)
                direct_keg_km2 = sum(x["allocated_units"] * x["base_distance_km"] for x in grp2)
                base_ev2 = _find_best_trip_sequence(
                    src_id, src_name, grp2, customers, distance_map, directed_lanes, as_of_d, 1.0
                )
                if base_ev2 is None:
                    continue
                if base_ev2["total_keg_km"] <= max(direct_keg_km2 * 1.25, direct_keg_km2 + 500):
                    for car in carrier_list:
                        if int(car["max_load"]) >= comb_qty2:
                            ev_c = _evaluate_trip_sequence(
                                src_id, src_name,
                                [next(x for x in grp2 if x["line_id"] == s["line_id"]) for s in base_ev2["stops"]],
                                customers, distance_map, directed_lanes, as_of_d,
                                float(car["rate_inr"]), fixed_charges[car["id"]],
                            )
                            if ev_c is not None:
                                _add_trip_candidate(src_id, src_name, src_role, ev_c, car)

            if max_stops_per_trip >= 3 and len(top_neighbors) >= 2:
                pack = [o_a]
                pack_qty = o_a["allocated_units"]
                pack_orders = {o_a["order_id"]}
                for o_n in top_neighbors:
                    if len(pack) >= max_stops_per_trip:
                        break
                    if o_n["order_id"] in pack_orders:
                        continue
                    if pack_qty + o_n["allocated_units"] <= max_carrier_cap:
                        pack.append(o_n)
                        pack_qty += o_n["allocated_units"]
                        pack_orders.add(o_n["order_id"])
                        if len(pack) >= 3:
                            key_p = tuple(sorted(x["line_id"] for x in pack))
                            if key_p in seen_line_sets:
                                continue
                            seen_line_sets.add(key_p)
                            direct_keg_km_p = sum(x["allocated_units"] * x["base_distance_km"] for x in pack)
                            base_ev_p = _find_best_trip_sequence(
                                src_id, src_name, list(pack), customers, distance_map, directed_lanes, as_of_d, 1.0
                            )
                            if base_ev_p is not None and base_ev_p["total_keg_km"] <= max(direct_keg_km_p * 1.25, direct_keg_km_p + 800):
                                for car in carrier_list:
                                    if int(car["max_load"]) >= pack_qty:
                                        ev_pc = _evaluate_trip_sequence(
                                            src_id, src_name,
                                            [next(x for x in pack if x["line_id"] == s["line_id"]) for s in base_ev_p["stops"]],
                                            customers, distance_map, directed_lanes, as_of_d,
                                            float(car["rate_inr"]), fixed_charges[car["id"]],
                                        )
                                        if ev_pc is not None:
                                            _add_trip_candidate(src_id, src_name, src_role, ev_pc, car)

    # 3. CP-SAT Set-Partitioning Model over Candidate Trips
    model = cp_model.CpModel()
    y_vars = [model.NewBoolVar(f"trip_{t['cand_trip_id']}") for t in candidate_trips]

    # Exactly one trip serves each covered shipment line
    for lid, tids in trips_covering_line.items():
        model.Add(sum(y_vars[t] for t in tids) == 1)

    # Carrier truck dispatch caps (when configured)
    if carrier_truck_limits:
        by_car = defaultdict(list)
        for t in candidate_trips:
            by_car[t["carrier_name"]].append(y_vars[t["cand_trip_id"]])
        for car_name, max_trucks in carrier_truck_limits.items():
            if car_name in by_car and max_trucks is not None:
                model.Add(sum(by_car[car_name]) <= int(max_trucks))

    # Minimize the declared carrier freight basis. Do not invent a dispatch
    # penalty because several short trips can be cheaper than one long trip.
    total_obj = sum(
        t["total_freight_paise"] * y_vars[t["cand_trip_id"]]
        for t in candidate_trips
    )
    model.Minimize(total_obj)

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 4
    solver.parameters.max_time_in_seconds = max(5.0, float(time_limit_seconds))
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError(
            f"Multi-order trip consolidation failed with status {solver.StatusName(status)} (check carrier truck caps)"
        )

    selected_trips: List[Dict[str, Any]] = []
    line_trip_updates: Dict[str, Dict[str, Any]] = {}
    for t in candidate_trips:
        if solver.Value(y_vars[t["cand_trip_id"]]) == 1:
            t_out = dict(t)
            selected_trips.append(t_out)

    selected_trips.sort(key=lambda x: (-x["stop_count"], x["source_customer_id"], x["line_ids"][0]))
    for idx, t in enumerate(selected_trips, start=1):
        trip_code = f"TRP-{idx:04d}"
        t["trip_code"] = trip_code
        for st in t["stops"]:
            line_trip_updates[st["line_id"]] = {
                "trip_code": trip_code,
                "stop_sequence": st["stop_sequence"],
                "stop_count": t["stop_count"],
                "carrier": t["carrier_name"],
                "carrier_id": t["carrier_id"],
                "distance_km": st["cumulative_distance_km"],
                "transit_days": st["cumulative_transit_days"],
                "freight_cost_inr": st["allocated_freight_inr"],
                "trip_total_kegs": t["total_kegs"],
                "carrier_max_load_kegs": t["carrier_max_load_kegs"],
            }

    return selected_trips, line_trip_updates


def validate_consolidated_trips(
    trips: List[Dict[str, Any]],
    outcomes: List[Any],
    distance_map: Dict[Tuple[str, str], int],
    directed_lanes: bool,
    as_of_d: Optional[date],
    carrier_max_load: Dict[str, int],
    carrier_truck_limits: Optional[Dict[str, int]] = None,
) -> None:
    """Independently validate every consolidated trip, stop sequence, capacity, leg distance, deadline, and freight total."""
    outcome_by_id = {o.order_id: o for o in outcomes}
    expected_line_qtys: Dict[str, int] = {}
    for o in outcomes:
        if o.allocated_units <= 0:
            continue
        lines = getattr(o, "allocation_lines", None) or []
        if not lines and o.source_customer_id:
            expected_line_qtys[f"{o.order_id}#S1"] = int(o.allocated_units)
        else:
            for idx_l, ln in enumerate(lines, start=1):
                if int(ln["allocated_units"]) > 0:
                    expected_line_qtys[ln.get("line_id") or f"{o.order_id}#S{idx_l}"] = int(ln["allocated_units"])

    seen_lines = set()
    carrier_dispatch_counts: Dict[str, int] = defaultdict(int)

    for t in trips:
        car_name = t["carrier_name"]
        carrier_dispatch_counts[car_name] += 1
        max_load = int(carrier_max_load.get(car_name, t["carrier_max_load_kegs"]) or 0)
        if t["total_kegs"] <= 0 or t["total_kegs"] > max_load:
            raise ValueError(f"Trip {t.get('trip_code')} total kegs {t['total_kegs']} violates carrier max load {max_load}")

        stops = sorted(t["stops"], key=lambda s: s["stop_sequence"])
        if len(stops) != t["stop_count"]:
            raise ValueError(f"Trip {t.get('trip_code')} stop count mismatch")

        rem = t["total_kegs"]
        cum_km = 0
        sum_keg_km = 0
        for idx, st in enumerate(stops, start=1):
            if st["stop_sequence"] != idx:
                raise ValueError(f"Trip {t.get('trip_code')} non-contiguous stop_sequence {st['stop_sequence']}")
            lid = st.get("line_id") or f"{st['order_id']}#S1"
            oid = st["order_id"]
            if lid in seen_lines:
                raise ValueError(f"Shipment line {lid} assigned to multiple trips")
            seen_lines.add(lid)
            exp_qty = expected_line_qtys.get(lid)
            o = outcome_by_id.get(oid)
            if not o or exp_qty is None or exp_qty != st["kegs_delivered"]:
                raise ValueError(f"Shipment line {lid} kegs mismatch with trip stop")
            if st["load_before_stop_kegs"] != rem:
                raise ValueError(f"Trip {t.get('trip_code')} stop {idx} load_before mismatch")

            prev_id = st["leg_from_id"]
            dest_id = st["destination_customer_id"]
            expected_km = 0 if prev_id == dest_id else (
                distance_map.get((prev_id, dest_id))
                if (prev_id, dest_id) in distance_map
                else (distance_map.get((dest_id, prev_id)) if not directed_lanes else None)
            )
            if expected_km is None or int(expected_km) != int(st["leg_distance_km"]):
                raise ValueError(f"Trip {t.get('trip_code')} stop {idx} invalid leg {prev_id} -> {dest_id}")

            sum_keg_km += rem * int(expected_km)
            cum_km += int(expected_km)
            cum_transit = compute_transit_days(cum_km)
            ord_d = date.fromisoformat(str(o.ordered_date)[:10])
            nb_d = date.fromisoformat(str(o.needed_by)[:10])
            feas, _ = evaluate_deadline_feasibility(ord_d, nb_d, cum_transit, as_of_date=as_of_d)
            if not feas:
                raise ValueError(f"Trip {t.get('trip_code')} misses deadline at stop {idx} ({oid})")

            rem -= st["kegs_delivered"]
            if st["load_after_stop_kegs"] != rem:
                raise ValueError(f"Trip {t.get('trip_code')} stop {idx} load_after mismatch")

        if rem != 0:
            raise ValueError(f"Trip {t.get('trip_code')} residual load {rem} != 0")

        expected_paise = round(sum_keg_km * float(t["rate_inr"]) * PAISE_PER_INR)
        expected_paise += t.get("fixed_trip_charge_paise", 0)
        expected_freight = expected_paise / PAISE_PER_INR
        if abs(expected_freight - float(t["total_freight_inr"])) > 0.05:
            raise ValueError(
                f"Trip {t.get('trip_code')} freight mismatch: {t['total_freight_inr']} vs {expected_freight}"
            )
        stops_freight = sum(float(s["allocated_freight_inr"]) for s in stops)
        if abs(stops_freight - float(t["total_freight_inr"])) > 0.05:
            raise ValueError(f"Trip {t.get('trip_code')} stop freight allocation mismatch")

    if seen_lines != set(expected_line_qtys.keys()):
        missing = set(expected_line_qtys.keys()) - seen_lines
        raise ValueError(f"Consolidated trips missing {len(missing)} shipment line(s)")

    if carrier_truck_limits:
        for car_name, cnt in carrier_dispatch_counts.items():
            cap = carrier_truck_limits.get(car_name)
            if cap is not None and cnt > int(cap):
                raise ValueError(f"Carrier {car_name} used {cnt} trips > cap {cap}")
