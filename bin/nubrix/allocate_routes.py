"""Allocate validated route candidates to keg orders with shared stock and vehicles."""

from collections import defaultdict
from time import monotonic

from ortools.sat.python import cp_model


def allocate(orders, stock, routes, *, time_limit_seconds=30):
    """Select whole route candidates with integer keg quantities and freight in paise.

    orders maps line IDs to (needed_by, outstanding_quantity). Stock is keyed by
    (source ID, SKU). Each route supplies a unique id, absolute start/end minutes,
    vehicle ID, freight_paise, and shipments of (line ID, stock key, quantity).
    The caller validates each route's stops, load profile, and deadlines first.
    """
    model = cp_model.CpModel()
    routes = sorted(routes, key=lambda route: route["id"])
    selected = []
    stock_use = defaultdict(list)
    line_use = defaultdict(list)
    vehicle_intervals = defaultdict(list)
    for index, route in enumerate(routes):
        choice = model.new_bool_var(f"route_{index}")
        selected.append(choice)
        start, end = route["start"], route["end"]
        vehicle_intervals[route["vehicle"]].append(
            model.new_optional_fixed_size_interval_var(start, end - start, choice, f"trip_{index}")
        )
        for line, stock_key, quantity in route["shipments"]:
            line_use[line].append(quantity * choice)
            stock_use[stock_key].append(quantity * choice)

    for stock_key, uses in stock_use.items():
        model.add(sum(uses) <= stock.get(stock_key, 0))
    for intervals in vehicle_intervals.values():
        model.add_no_overlap(intervals)

    deadlines = defaultdict(list)
    for index, (line, (due, outstanding)) in enumerate(sorted(orders.items())):
        covered = model.new_int_var(0, outstanding, f"covered_{index}")
        model.add(covered == sum(line_use[line]))
        if outstanding:
            full = model.new_bool_var(f"full_{index}")
            model.add(covered == outstanding).only_enforce_if(full)
            model.add(covered < outstanding).only_enforce_if(full.Not())
            deadlines[due].append((full, covered))

    objectives = []
    for due in sorted(deadlines):
        completed, quantities = zip(*deadlines[due])
        objectives.extend((-sum(completed), -sum(quantities)))
    objectives.append(sum(route["freight_paise"] * choice for route, choice in zip(routes, selected)))

    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    expires = monotonic() + time_limit_seconds
    chosen = []
    for objective in objectives:
        remaining = expires - monotonic()
        if remaining <= 0:
            return {"status": "time_limit", "route_ids": chosen}
        solver.parameters.max_time_in_seconds = remaining
        model.minimize(objective)
        status = solver.solve(model)
        if status == cp_model.UNKNOWN:
            return {"status": "time_limit", "route_ids": chosen}
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            raise RuntimeError(f"Route selection failed: {solver.status_name(status)}")
        chosen = [route["id"] for route, choice in zip(routes, selected) if solver.value(choice)]
        if status == cp_model.FEASIBLE:
            return {"status": "time_limit", "route_ids": chosen}
        model.add(objective == solver.value(objective))
    return {"status": "optimal_over_candidates", "route_ids": chosen}
