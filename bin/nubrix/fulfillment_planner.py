"""Explainable Keg Demand & Fulfillment Optimization Engine for MicroStar Logistics.

Provides:
1. OrToolsFulfillmentPlanner: Multi-objective CP-SAT solver prioritizing earliest due
   deadlines, maximizing on-time covered kegs, and minimizing total freight.
2. NearestSourceBaselinePlanner: Deterministic greedy benchmark comparing against CP-SAT.
3. Independent Post-Solve Invariant Validator: Verifies conservation laws and fails closed.
4. Structured Candidate Evidence & Explanation Engine: Generates human-readable and audit-proof
   explanations for every allocated, partially covered, or rejected order.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
import math
from typing import Any, Dict, List, Optional, Set, Tuple

from ortools.sat.python import cp_model

from domain_contract import (
    PAISE_PER_INR,
    SPEED_KM_PER_DAY,
    calculate_freight_cost_inr,
    compute_transit_days,
    evaluate_deadline_feasibility,
)


@dataclass
class CandidateOption:
    candidate_id: int
    order_id: str
    source_customer_id: str
    source_name: str
    distributor_id: str
    distributor_name: str
    destination_customer_id: str
    destination_name: str
    sku: str
    quantity: int
    distance_km: int
    transit_days: int
    carrier_id: str
    carrier_name: str
    cost_per_keg_km: float
    freight_cost_inr: float
    freight_paise: int
    is_feasible: bool
    slack_days: int
    rejection_reason: Optional[str] = None
    vehicle_id: Optional[str] = None
    trip_start: int = 0
    trip_end: int = 0
    distributor_mode: str = "coordinator"
    selected_candidate_id: Optional[int] = None
    decision_stage: str = "UNALLOCATED"
    omitted_candidates_count: int = 0
    omitted_reason: Optional[str] = None
    route_legs: List[Tuple[str, str, int]] = field(default_factory=list)


@dataclass
class PlannerOutcome:
    order_id: str
    destination_customer_id: str
    destination_brewer: str
    region: str
    customer_type: str
    keg_size: str
    ordered_date: str
    needed_by: str
    ordered_units: int
    fulfilled_units: int
    pending_units: int
    allocated_units: int
    proposed_on_time_units: int
    uncovered_units: int
    source_hub: str
    source_customer_id: Optional[str]
    distributor: str
    distributor_customer_id: Optional[str]
    carrier: str
    distance_km: int
    freight_cost_inr: float
    transit_days: int
    on_time_feasible: str
    planning_status: str
    explanation: str
    evidence: List[Dict[str, Any]] = field(default_factory=list)
    vehicle_id: Optional[str] = None
    trip_start: int = 0
    trip_end: int = 0
    distributor_mode: str = "coordinator"
    selected_candidate_id: Optional[int] = None
    decision_stage: str = "UNALLOCATED"
    omitted_candidates_count: int = 0
    omitted_reason: Optional[str] = None


class InvariantValidationError(Exception):
    """Raised when post-solve validation fails."""
    pass


def _parse_date(val: Any) -> Optional[date]:
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    if isinstance(val, str) and val.strip():
        return datetime.strptime(val.strip()[:10], "%Y-%m-%d").date()
    return None


def _resolve_lane_km(
    distance_map: Dict[Tuple[str, str], int],
    orig: str,
    dest: str,
    directed_lanes: bool = False,
) -> Optional[int]:
    if orig == dest:
        return 0
    if (orig, dest) in distance_map:
        return distance_map[(orig, dest)]
    if not directed_lanes and (dest, orig) in distance_map:
        return distance_map[(dest, orig)]
    return None


def _resolve_route_legs(
    distance_map: Dict[Tuple[str, str], int],
    src_id: str,
    coord_dist_id: str,
    dest_id: str,
    distributor_mode: str = "coordinator",
    directed_lanes: bool = False,
) -> Optional[Tuple[int, List[Tuple[str, str, int]]]]:
    if distributor_mode == "physical_stop" and coord_dist_id not in (src_id, dest_id):
        km1 = _resolve_lane_km(distance_map, src_id, coord_dist_id, directed_lanes=directed_lanes)
        km2 = _resolve_lane_km(distance_map, coord_dist_id, dest_id, directed_lanes=directed_lanes)
        if km1 is None or km2 is None:
            return None
        return km1 + km2, [(src_id, coord_dist_id, km1), (coord_dist_id, dest_id, km2)]
    km = _resolve_lane_km(distance_map, src_id, dest_id, directed_lanes=directed_lanes)
    if km is None:
        return None
    return km, [(src_id, dest_id, km)]


class OrToolsFulfillmentPlanner:
    """Enterprise-grade, order-driven CP-SAT fulfillment optimizer."""

    def __init__(
        self,
        time_limit_seconds: int = 15,
        max_candidates_per_order: int = 20,
        source_policy: str = "depot_first",
    ):
        self.time_limit_seconds = time_limit_seconds
        self.max_candidates_per_order = max_candidates_per_order
        self.source_policy = source_policy

    def plan(self, snapshot: Dict[str, Any]) -> Dict[str, Any]:
        """Execute complete optimization workflow with candidate generation, CP-SAT solve, and validation."""
        orders = snapshot["orders"]
        stock_list = snapshot["stock"]
        customers = snapshot.get("customers", {})
        carriers = snapshot.get("carriers", {})
        distances = snapshot.get("legs", []) or snapshot.get("distances", [])

        # Build lookup tables
        stock_by_source_sku = defaultdict(int)
        for s in stock_list:
            stock_by_source_sku[(s["source"], s["sku"])] = s["available"]

        # Build distance map (orig, dest) -> km
        distance_map = {}
        for leg in distances:
            orig = leg.get("origin") or leg.get("OriginCustomerId")
            dest = leg.get("destination") or leg.get("DestCustomerId")
            km = leg.get("km") if "km" in leg else leg.get("RoadDistanceKm", 0)
            if orig and dest:
                distance_map[(orig, dest)] = int(km)

        # Planning policy flags
        as_of_d = _parse_date(snapshot.get("as_of_date"))
        directed_lanes = bool(snapshot.get("directed_lanes", False))
        distributor_mode = str(snapshot.get("distributor_mode", "coordinator"))
        handling_days = int(snapshot.get("distributor_handling_days", 0) or 0)
        source_policy = str(snapshot.get("source_policy", self.source_policy) or "depot_first")
        vehicles = list(snapshot.get("vehicles") or [])
        base_date = date(2026, 7, 1)

        # Build distributor list by region
        distributors_by_region = defaultdict(list)
        for cid, cust in customers.items():
            if cust.get("type") == "Distributor":
                distributors_by_region[cust.get("region", "West")].append(cid)

        # 1. Candidate Generation
        all_candidates: List[CandidateOption] = []
        candidates_by_order: Dict[str, List[CandidateOption]] = defaultdict(list)
        evidence_by_order: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        order_urgency: Dict[str, int] = {}
        candidates_truncated = False
        omitted_by_order: Dict[str, int] = {}

        # Compute earliest valid needed_by date for true due-date prioritization
        valid_needed_dates = []
        for order in orders:
            nb = _parse_date(order.get("needed_by_date"))
            if nb:
                valid_needed_dates.append(nb)
        min_needed_by = min(valid_needed_dates) if valid_needed_dates else date(2026, 7, 1)

        candidate_counter = 0
        for order in orders:
            oid = order["id"]
            dest_id = order["customer_id"]
            sku = order["sku"]
            pending_qty = order["pending"]
            needed_by_str = order.get("needed_by_date")
            ordered_str = order.get("ordered_date")

            if not needed_by_str or not ordered_str or pending_qty <= 0:
                continue

            needed_by_d = _parse_date(needed_by_str)
            ordered_d = _parse_date(ordered_str)
            if not needed_by_d or not ordered_d:
                continue
            dispatch_start = max(ordered_d, as_of_d) if as_of_d else ordered_d

            days_out = max(0, (needed_by_d - min_needed_by).days)
            order_urgency[oid] = max(1, 1000 - min(days_out, 999))
            dest_cust = customers.get(dest_id, {})
            dest_region = dest_cust.get("region", "West")
            dest_name = dest_cust.get("name", dest_id)

            if needed_by_d < dispatch_start:
                evidence_by_order[oid].append({
                    "reason": "overdue",
                    "details": f"Needed-by date {needed_by_d} is earlier than dispatch start {dispatch_start}",
                })
                continue

            # Identify candidate sources holding this SKU and enforce source eligibility policy
            all_stock_sources = [
                (src_id, avail)
                for (src_id, s_sku), avail in stock_by_source_sku.items()
                if s_sku == sku and avail > 0 and src_id != dest_id
            ]

            if not all_stock_sources:
                evidence_by_order[oid].append({
                    "reason": "no_stock_for_sku",
                    "details": f"No facility currently holds available inventory for {sku}",
                })
                continue

            if source_policy == "depot_first":
                eligible_roles = {"Maintenance Facility", "Distributor"}
                eligible_sources = [
                    (src_id, avail)
                    for src_id, avail in all_stock_sources
                    if customers.get(src_id, {}).get("type") in eligible_roles
                ]
                excluded_peers = [
                    (src_id, avail)
                    for src_id, avail in all_stock_sources
                    if customers.get(src_id, {}).get("type") == "Brewer"
                ]
                # Record up to 2 nearest excluded peer Brewers in evidence for transparency
                peer_with_km = []
                for p_id, p_avail in excluded_peers:
                    p_km = _resolve_lane_km(distance_map, p_id, dest_id, directed_lanes=directed_lanes)
                    if p_km is not None:
                        peer_with_km.append((p_id, p_avail, p_km))
                peer_with_km.sort(key=lambda x: x[2])
                for p_id, p_avail, p_km in peer_with_km[:2]:
                    p_name = customers.get(p_id, {}).get("name", p_id)
                    evidence_by_order[oid].append({
                        "reason": "Not eligible under the Depot-First policy. Available only in the approved peer-transfer scenario.",
                        "reason_code": "POLICY_EXCLUDED_PEER_BREWER",
                        "source_customer_id": p_id,
                        "source": p_name,
                        "source_name": p_name,
                        "carrier_id": "CAR-NONE",
                        "carrier": "Unassigned",
                        "carrier_name": "Unassigned",
                        "distance_km": p_km,
                        "candidate_quantity": min(pending_qty, p_avail),
                        "stock_available_kegs": p_avail,
                        "is_feasible": False,
                        "details": "Peer Brewer excluded by Depot-First source eligibility constraint.",
                    })
                if not eligible_sources:
                    evidence_by_order[oid].append({
                        "reason": "policy_no_eligible_depot",
                        "details": f"No approved Maintenance Facility or Distributor holds available {sku} inventory under Depot-First policy",
                    })
                    continue
            else:
                eligible_sources = all_stock_sources

            # Find matching distributor
            dist_list = distributors_by_region.get(dest_region, [])
            coord_dist_id = dist_list[0] if dist_list else eligible_sources[0][0]
            coord_dist_name = customers.get(coord_dist_id, {}).get("name", coord_dist_id)

            sources_with_dist: List[Tuple[str, int, int, List[Tuple[str, str, int]]]] = []
            for src_id, avail_qty in eligible_sources:
                resolved = _resolve_route_legs(
                    distance_map,
                    src_id,
                    coord_dist_id,
                    dest_id,
                    distributor_mode=distributor_mode,
                    directed_lanes=directed_lanes,
                )
                if resolved is None:
                    src_name = customers.get(src_id, {}).get("name", src_id)
                    evidence_by_order[oid].append({
                        "reason": "missing_lane",
                        "reason_code": "MISSING_LANE",
                        "source_customer_id": src_id,
                        "source": src_name,
                        "source_name": src_name,
                        "distributor_customer_id": coord_dist_id,
                        "distributor_name": coord_dist_name,
                        "carrier_id": "CAR-NONE",
                        "carrier": "Unassigned",
                        "carrier_name": "Unassigned",
                        "candidate_quantity": pending_qty,
                        "stock_available_kegs": avail_qty,
                        "is_feasible": False,
                        "details": f"No verified {'directed ' if directed_lanes else ''}road distance lane for {src_id} -> {dest_id} (mode={distributor_mode})",
                    })
                else:
                    km, r_legs = resolved
                    sources_with_dist.append((src_id, avail_qty, km, r_legs))

            if not sources_with_dist:
                continue

            def _source_sort_key(item: Tuple[str, int, int, List[Tuple[str, str, int]]]) -> Tuple[int, int]:
                s_id, _, s_km, _ = item
                s_type = customers.get(s_id, {}).get("type", "")
                if source_policy in ("depot_first", "approved_peer_brewer"):
                    tier = 0 if s_type == "Maintenance Facility" else (1 if s_type == "Distributor" else 2)
                    return (tier, s_km)
                return (0, s_km)

            sources_with_dist.sort(key=_source_sort_key)
            if len(sources_with_dist) > self.max_candidates_per_order:
                candidates_truncated = True
                omitted_by_order[oid] = len(sources_with_dist) - self.max_candidates_per_order
            else:
                omitted_by_order[oid] = 0

            # Available carriers
            carrier_items = list(carriers.values()) if carriers else [
                {"id": "CAR-01", "name": "SwiftHaul Logistics", "rate_inr": 2.10, "rate_paise": 210, "max_load": 900},
                {"id": "CAR-02", "name": "Deccan Freight", "rate_inr": 1.85, "rate_paise": 185, "max_load": 700},
            ]

            for src_id, avail_qty, km, r_legs in sources_with_dist[:self.max_candidates_per_order]:
                src_cust = customers.get(src_id, {})
                src_name = src_cust.get("name", src_id)
                transit_days = compute_transit_days(km) + (handling_days if distributor_mode == "physical_stop" and coord_dist_id not in (src_id, dest_id) else 0)
                is_feasible, slack = evaluate_deadline_feasibility(ordered_d, needed_by_d, transit_days, as_of_date=as_of_d)
                trip_start_min = (dispatch_start - base_date).days * 1440
                trip_end_min = trip_start_min + max(1, transit_days) * 1440

                for car in carrier_items:
                    car_id = str(car.get("id", "CAR-01"))
                    car_name = car.get("name", "Standard Carrier")
                    max_load = int(car.get("max_load", 0) or 0)
                    if max_load <= 0:
                        evidence_by_order[oid].append({
                            "reason": "carrier_capacity_zero",
                            "source": src_name,
                            "carrier": car_name,
                            "details": f"Carrier {car_name} has non-positive capacity ({max_load})",
                        })
                        continue
                    rate_inr = float(car.get("rate_inr", 2.0))

                    # If vehicles are provided, enforce vehicle availability & capacity per vehicle
                    matching_vehicles = [
                        v for v in vehicles
                        if v.get("carrier") == car_name
                        and (not snapshot.get("strict_vehicle_origin", False) or v.get("origin") in (None, src_id))
                    ] if vehicles else [None]

                    if vehicles and not matching_vehicles:
                        evidence_by_order[oid].append({
                            "reason": "vehicle_unavailable",
                            "source": src_name,
                            "carrier": car_name,
                            "details": f"No vehicle assigned to carrier {car_name} for source {src_id}",
                        })
                        continue

                    for veh in matching_vehicles:
                        veh_id = veh["id"] if veh else None
                        veh_cap = int(veh.get("capacity", max_load)) if veh else max_load
                        if veh:
                            if trip_start_min < int(veh.get("free_from", 0)) or trip_end_min > int(veh.get("free_until", 10**9)):
                                evidence_by_order[oid].append({
                                    "reason": "vehicle_window_conflict",
                                    "source": src_name,
                                    "carrier": car_name,
                                    "vehicle": veh_id,
                                    "details": f"Trip [{trip_start_min}, {trip_end_min}] outside vehicle {veh_id} window",
                                })
                                continue

                        alloc_qty = min(pending_qty, avail_qty, max_load, veh_cap)
                        if alloc_qty <= 0:
                            continue

                        freight_inr = calculate_freight_cost_inr(alloc_qty, km, rate_inr)
                        freight_paise = int(round(freight_inr * PAISE_PER_INR))

                        candidate = CandidateOption(
                            candidate_id=candidate_counter,
                            order_id=oid,
                            source_customer_id=src_id,
                            source_name=src_name,
                            distributor_id=coord_dist_id,
                            distributor_name=coord_dist_name,
                            destination_customer_id=dest_id,
                            destination_name=dest_name,
                            sku=sku,
                            quantity=alloc_qty,
                            distance_km=km,
                            transit_days=transit_days,
                            carrier_id=car_id,
                            carrier_name=car_name,
                            cost_per_keg_km=rate_inr,
                            freight_cost_inr=freight_inr,
                            freight_paise=freight_paise,
                            is_feasible=is_feasible,
                            slack_days=slack,
                            rejection_reason=None if is_feasible else f"Transit time ({transit_days}d) exceeds deadline slack ({slack}d)",
                            vehicle_id=veh_id,
                            trip_start=trip_start_min,
                            trip_end=trip_end_min,
                            distributor_mode=distributor_mode,
                            route_legs=r_legs,
                        )
                        candidate_counter += 1
                        all_candidates.append(candidate)
                        candidates_by_order[oid].append(candidate)

                        evidence_by_order[oid].append({
                            "candidate_id": candidate.candidate_id,
                            "source_customer_id": src_id,
                            "source": src_name,
                            "source_name": src_name,
                            "distributor_customer_id": coord_dist_id,
                            "distributor_name": coord_dist_name,
                            "carrier_id": car_id,
                            "carrier": car_name,
                            "carrier_name": car_name,
                            "vehicle": veh_id,
                            "candidate_quantity": alloc_qty,
                            "stock_available_kegs": avail_qty,
                            "carrier_max_load_kegs": max_load,
                            "distributor_mode": distributor_mode,
                            "cost_formula": f"{alloc_qty} kegs * {km} km * INR {rate_inr:.2f}/keg-km",
                            "distance_km": km,
                            "transit_days": transit_days,
                            "is_feasible": is_feasible,
                            "slack_days": slack,
                            "freight_cost_inr": freight_inr,
                            "reason_code": None if is_feasible else "DEADLINE_EXCEEDED",
                            "reason": candidate.rejection_reason,
                            "route_legs": r_legs,
                        })

        # 2. CP-SAT Integer Programming Optimization (Stage 1: pure BoolVar over feasible candidates)
        feasible_candidates = [c for c in all_candidates if c.is_feasible]
        model = cp_model.CpModel()
        choice_vars = {}
        vehicle_intervals = defaultdict(list)
        for c in feasible_candidates:
            bvar = model.NewBoolVar(f"cand_{c.candidate_id}")
            choice_vars[c.candidate_id] = bvar
            if c.vehicle_id is not None and c.trip_end > c.trip_start:
                vehicle_intervals[c.vehicle_id].append(
                    model.NewOptionalFixedSizeIntervalVar(
                        c.trip_start, c.trip_end - c.trip_start, bvar, f"veh_{c.candidate_id}"
                    )
                )

        # Constraint 1: At most one primary fulfillment candidate per order
        for oid, c_list in candidates_by_order.items():
            feas_list = [c for c in c_list if c.is_feasible]
            if feas_list:
                model.Add(sum(choice_vars[c.candidate_id] for c in feas_list) <= 1)

        # Constraint 2: Source stock capacity conservation
        stock_consumption = defaultdict(list)
        for c in feasible_candidates:
            stock_consumption[(c.source_customer_id, c.sku)].append(c.quantity * choice_vars[c.candidate_id])

        for (src_id, sku), uses in stock_consumption.items():
            max_avail = stock_by_source_sku.get((src_id, sku), 0)
            model.Add(sum(uses) <= max_avail)

        # Constraint 3: Vehicle non-overlap when vehicles are modeled
        for intervals in vehicle_intervals.values():
            model.AddNoOverlap(intervals)

        # Multi-Objective Lexicographic Setup:
        # 1. Maximize on-time feasible orders (weighted by due-date urgency)
        # 2. Maximize fulfilled keg volume
        # 3. Minimize total freight cost (paise)
        feasible_cover_terms = []
        volume_cover_terms = []
        freight_cost_terms = []

        for c in feasible_candidates:
            bvar = choice_vars[c.candidate_id]
            urgency = order_urgency.get(c.order_id, 1)
            feasible_cover_terms.append(urgency * bvar)
            volume_cover_terms.append(c.quantity * bvar)
            freight_cost_terms.append(c.freight_paise * bvar)

        max_per_keg_paise = max(
            (int(round(c.distance_km * c.cost_per_keg_km * PAISE_PER_INR)) for c in feasible_candidates),
            default=0,
        )
        vol_weight = max(100_000, max_per_keg_paise * 2 + 10_000)
        order_weight = vol_weight * 10

        primary_obj = (
            sum(feasible_cover_terms) * order_weight
            + sum(volume_cover_terms) * vol_weight
            - sum(freight_cost_terms)
        )
        model.Maximize(primary_obj)

        solver = cp_model.CpSolver()
        solver.parameters.num_search_workers = 1
        solver.parameters.max_time_in_seconds = self.time_limit_seconds

        status = solver.Solve(model)
        raw_solver_status = solver.StatusName(status)

        # Fail closed on invalid or unknown solver states before Stage 2 or outcome emission
        if feasible_candidates and status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            raise InvariantValidationError(
                f"CP-SAT solver failed closed with status {raw_solver_status} (status_code={status})"
            )

        # 3. Build Outcomes & Residual Partial-Allocation Pass
        selected_candidates: Dict[str, Tuple[CandidateOption, int]] = {}
        selected_stage_by_order: Dict[str, str] = {}
        allocations_by_source_sku: Dict[Tuple[str, str], List[Tuple[str, int]]] = defaultdict(list)
        remaining_stock = dict(stock_by_source_sku)
        used_vehicle_intervals: Dict[str, List[Tuple[int, int]]] = defaultdict(list)
        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            for c in feasible_candidates:
                if solver.Value(choice_vars[c.candidate_id]) == 1:
                    selected_candidates[c.order_id] = (c, c.quantity)
                    selected_stage_by_order[c.order_id] = "STAGE_1_CPSAT"
                    allocations_by_source_sku[(c.source_customer_id, c.sku)].append((c.order_id, c.quantity))
                    remaining_stock[(c.source_customer_id, c.sku)] = (
                        remaining_stock.get((c.source_customer_id, c.sku), 0) - c.quantity
                    )
                    if c.vehicle_id is not None:
                        used_vehicle_intervals[c.vehicle_id].append((c.trip_start, c.trip_end))

        # Stage 2: Allocate any stranded residual stock to uncovered orders (respecting capacity, vehicle non-overlap & deadlines)
        stage2_modified = False
        for order in orders:
            oid = order["id"]
            if oid in selected_candidates:
                continue
            feas_cands = [c for c in candidates_by_order.get(oid, []) if c.is_feasible]
            if not feas_cands:
                continue
            feas_cands.sort(key=lambda c: (c.distance_km, c.cost_per_keg_km))
            for c in feas_cands:
                rem = remaining_stock.get((c.source_customer_id, c.sku), 0)
                if rem <= 0:
                    continue
                if c.vehicle_id is not None:
                    conflict = any(
                        not (c.trip_end <= s or e <= c.trip_start)
                        for s, e in used_vehicle_intervals.get(c.vehicle_id, [])
                    )
                    if conflict:
                        continue
                alloc_qty = min(c.quantity, rem)
                if alloc_qty > 0:
                    selected_candidates[oid] = (c, alloc_qty)
                    selected_stage_by_order[oid] = "STAGE_2_RESIDUAL"
                    allocations_by_source_sku[(c.source_customer_id, c.sku)].append((oid, alloc_qty))
                    remaining_stock[(c.source_customer_id, c.sku)] = rem - alloc_qty
                    if c.vehicle_id is not None:
                        used_vehicle_intervals[c.vehicle_id].append((c.trip_start, c.trip_end))
                    stage2_modified = True
                    break

        planning_mode = "MODE_B_TRIP_LEVEL" if vehicles else "MODE_A_ORDER_LEVEL"
        objective_policy = "lexicographic_equivalent_weighted_v2"
        split_policy = "single_source_per_order"
        omitted_total = sum(omitted_by_order.values())

        # Annotate every candidate evidence record with exact post-solve selection, remaining stock, competing orders, and reason code
        for order in orders:
            oid = order["id"]
            sku = order["sku"]
            chosen_pair = selected_candidates.get(oid)
            chosen_cand = chosen_pair[0] if chosen_pair else None
            chosen_qty = chosen_pair[1] if chosen_pair else 0
            chosen_freight = (
                calculate_freight_cost_inr(chosen_qty, chosen_cand.distance_km, chosen_cand.cost_per_keg_km)
                if chosen_cand and chosen_qty > 0
                else None
            )
            order_stage = selected_stage_by_order.get(oid, "UNALLOCATED")

            for ev in evidence_by_order.get(oid, []):
                if "candidate_id" not in ev:
                    ev.setdefault("decision_stage", order_stage)
                    ev.setdefault("is_selected", False)
                    continue
                cid_ev = ev["candidate_id"]
                src_cid = ev.get("source_customer_id", "")
                cand_qty = int(ev.get("candidate_quantity", 0) or 0)
                avail_qty = int(ev.get("stock_available_kegs", 0) or 0)
                rem_qty = int(remaining_stock.get((src_cid, sku), 0))
                competing = [o2 for o2, _ in allocations_by_source_sku.get((src_cid, sku), []) if o2 != oid]
                is_sel = bool(chosen_cand and chosen_qty > 0 and cid_ev == chosen_cand.candidate_id)

                ev["is_selected"] = is_sel
                ev["decision_stage"] = order_stage
                ev["stock_remaining_kegs"] = rem_qty
                ev["competing_order_ids"] = competing[:5]

                if is_sel:
                    if chosen_qty != cand_qty:
                        ev["candidate_quantity"] = chosen_qty
                        ev["freight_cost_inr"] = chosen_freight
                        ev["cost_formula"] = f"{chosen_qty} kegs * {ev['distance_km']} km * INR {chosen_cand.cost_per_keg_km:.2f}/keg-km (Stage 2 residual)"
                    ev["reason_code"] = "SELECTED_RESIDUAL" if order_stage == "STAGE_2_RESIDUAL" else "SELECTED_PRIMARY"
                    ev["reason"] = f"Selected in {order_stage} ({chosen_qty} kegs from {src_cid} via {ev.get('carrier_name')})."
                elif ev.get("is_feasible") is False:
                    ev["reason_code"] = ev.get("reason_code") or "DEADLINE_EXCEEDED"
                elif rem_qty < cand_qty and competing:
                    ev["reason_code"] = "STOCK_COMMITTED_COMPETING_ORDERS"
                    used_by_others = max(0, avail_qty - rem_qty)
                    sample_comp = ", ".join(competing[:3])
                    suffix = f" (+{len(competing) - 3} more)" if len(competing) > 3 else ""
                    ev["reason"] = (
                        f"Source {src_cid} had {avail_qty} {sku} kegs; {used_by_others} committed to "
                        f"{sample_comp}{suffix}, leaving {rem_qty} kegs (needed {cand_qty})."
                    )
                elif chosen_cand and chosen_freight is not None and float(ev.get("freight_cost_inr", 0)) > chosen_freight:
                    ev["reason_code"] = "HIGHER_MODELED_FREIGHT"
                    ev["reason"] = (
                        f"Feasible, but modeled freight (INR {float(ev['freight_cost_inr']):,.2f} for {cand_qty} kegs) "
                        f"exceeds selected option (INR {chosen_freight:,.2f} for {chosen_qty} kegs)."
                    )
                elif chosen_cand and cand_qty < chosen_qty:
                    ev["reason_code"] = "LOWER_COVERAGE_QUANTITY"
                    ev["reason"] = f"Selected option covers more demand ({chosen_qty} vs {cand_qty} kegs)."
                elif chosen_cand:
                    ev["reason_code"] = "GLOBAL_OBJECTIVE_TRADEOFF"
                    ev["reason"] = (
                        f"Not selected under {objective_policy} "
                        f"({len(competing)} competing orders on {src_cid}, {rem_qty} {sku} kegs remaining)."
                    )
                else:
                    ev["reason_code"] = "SOLVER_UNALLOCATED"
                    ev["reason"] = "Order unallocated under CP-SAT and Stage 2 residual constraints."

        horizon_truncated = bool(snapshot.get("provenance", {}).get("horizon_truncated", False))
        if status == cp_model.OPTIMAL:
            if not candidates_truncated and not stage2_modified and not horizon_truncated:
                solver_status_name = "OPTIMAL_OVER_CANDIDATES"
            else:
                solver_status_name = "FEASIBLE (bounded_candidates_and_residual)"
        elif status == cp_model.FEASIBLE:
            solver_status_name = "FEASIBLE (time_limit_or_bounded)"
        elif status == cp_model.INFEASIBLE:
            solver_status_name = "INFEASIBLE"
        else:
            solver_status_name = raw_solver_status

        outcomes: List[PlannerOutcome] = []
        used_stock_counter = Counter()

        for order in orders:
            oid = order["id"]
            dest_id = order["customer_id"]
            sku = order["sku"]
            pending = order["pending"]
            ordered = order["quantity_ordered"]
            fulfilled = order.get("fulfilled_units", 0)
            needed_by_str = order.get("needed_by_date", "")
            ordered_str = order.get("ordered_date", "")
            dest_cust = customers.get(dest_id, {})
            region = dest_cust.get("region", "West")
            cust_type = dest_cust.get("type", "Brewer")
            dest_name = dest_cust.get("name", dest_id)

            chosen = None
            sel_qty = 0
            if oid in selected_candidates:
                chosen, sel_qty = selected_candidates[oid]

            if chosen and sel_qty > 0:
                used_stock_counter[(chosen.source_customer_id, chosen.sku)] += sel_qty
                uncovered = max(0, pending - sel_qty)
                is_on_time = chosen.is_feasible
                actual_freight_inr = calculate_freight_cost_inr(
                    sel_qty, chosen.distance_km, chosen.cost_per_keg_km
                )
                planning_status = (
                    "Fully covered"
                    if sel_qty >= pending and is_on_time
                    else ("Partially covered" if sel_qty > 0 else "No allocation")
                )
                explanation = (
                    f"Proposed {sel_qty} kegs ({sku}) from {chosen.source_name} via {chosen.distributor_name}. "
                    f"Modeled carrier {chosen.carrier_name} over {chosen.distance_km} km ({chosen.transit_days}d transit). "
                    f"Within deadline window with {chosen.slack_days}d slack."
                    if is_on_time
                    else f"Source {chosen.source_name} allocated {sel_qty} kegs, but transit time ({chosen.transit_days}d) "
                    f"exceeds deadline slack by {-chosen.slack_days}d."
                )

                outcomes.append(
                    PlannerOutcome(
                        order_id=oid,
                        destination_customer_id=dest_id,
                        destination_brewer=dest_name,
                        region=region,
                        customer_type=cust_type,
                        keg_size=sku,
                        ordered_date=ordered_str,
                        needed_by=needed_by_str,
                        ordered_units=ordered,
                        fulfilled_units=fulfilled,
                        pending_units=pending,
                        allocated_units=sel_qty,
                        proposed_on_time_units=sel_qty if is_on_time else 0,
                        uncovered_units=uncovered,
                        source_hub=chosen.source_name,
                        source_customer_id=chosen.source_customer_id,
                        distributor=chosen.distributor_name,
                        distributor_customer_id=chosen.distributor_id,
                        carrier=chosen.carrier_name,
                        distance_km=chosen.distance_km,
                        freight_cost_inr=actual_freight_inr,
                        transit_days=chosen.transit_days,
                        on_time_feasible="Y" if is_on_time else "N",
                        planning_status=planning_status,
                        explanation=explanation,
                        evidence=evidence_by_order.get(oid, []),
                        vehicle_id=chosen.vehicle_id,
                        trip_start=chosen.trip_start,
                        trip_end=chosen.trip_end,
                        distributor_mode=chosen.distributor_mode,
                        selected_candidate_id=chosen.candidate_id,
                        decision_stage=selected_stage_by_order.get(oid, "STAGE_1_CPSAT"),
                        omitted_candidates_count=omitted_by_order.get(oid, 0),
                        omitted_reason=(
                            f"Evaluated top {self.max_candidates_per_order} nearest sources; {omitted_by_order.get(oid, 0)} farther sources omitted."
                            if omitted_by_order.get(oid, 0) > 0
                            else None
                        ),
                    )
                )
            else:
                # Analyze why order was not allocated
                reason = "shared_capacity_or_stock_allocated_to_other_orders"
                ev_list = evidence_by_order.get(oid, [])
                if any(e.get("reason") == "overdue" for e in ev_list):
                    reason = "Order is overdue (NeededByDate is earlier than OrderedDate)"
                elif any(e.get("reason") == "no_stock_for_sku" for e in ev_list):
                    reason = f"No available warehouse stock for SKU {sku}"
                elif any(e.get("reason") == "missing_lane" for e in ev_list) and not candidates_by_order.get(oid):
                    reason = "No verified road distance lane from available stock sources"
                elif not candidates_by_order.get(oid):
                    reason = "No candidate route met transit deadline and vehicle constraints"
                else:
                    feasible_cands = [c for c in candidates_by_order.get(oid, []) if c.is_feasible]
                    if not feasible_cands:
                        reason = "Transit distance from all available sources exceeds NeededByDate"
                    else:
                        reason = "Eligible sources exhausted by higher-priority earlier deadline orders"

                outcomes.append(
                    PlannerOutcome(
                        order_id=oid,
                        destination_customer_id=dest_id,
                        destination_brewer=dest_name,
                        region=region,
                        customer_type=cust_type,
                        keg_size=sku,
                        ordered_date=ordered_str,
                        needed_by=needed_by_str,
                        ordered_units=ordered,
                        fulfilled_units=fulfilled,
                        pending_units=pending,
                        allocated_units=0,
                        proposed_on_time_units=0,
                        uncovered_units=pending,
                        source_hub="Unallocated",
                        source_customer_id=None,
                        distributor="Unassigned",
                        distributor_customer_id=None,
                        carrier="Unassigned",
                        distance_km=0,
                        freight_cost_inr=0.0,
                        transit_days=0,
                        on_time_feasible="N",
                        planning_status="No allocation",
                        explanation=f"Shortfall: {reason}.",
                        evidence=evidence_by_order.get(oid, []),
                        selected_candidate_id=None,
                        decision_stage="UNALLOCATED",
                        omitted_candidates_count=omitted_by_order.get(oid, 0),
                        omitted_reason=(
                            f"Evaluated top {self.max_candidates_per_order} nearest sources; {omitted_by_order.get(oid, 0)} farther sources omitted."
                            if omitted_by_order.get(oid, 0) > 0
                            else None
                        ),
                    )
                )

        # 4. Independent Invariant Validation (fail closed)
        carrier_max_load = {
            car.get("name", ""): int(car.get("max_load", 0) or 0)
            for car in carriers.values()
        }
        carrier_rates = {
            car.get("name", ""): float(car.get("rate_inr", 2.0))
            for car in carriers.values()
        }
        vehicles_by_id = {v["id"]: v for v in vehicles if "id" in v}
        self.validate_invariants(
            outcomes,
            stock_by_source_sku,
            used_stock_counter,
            carrier_max_load=carrier_max_load,
            carrier_rates=carrier_rates,
            as_of_date=as_of_d,
            handling_days=handling_days if distributor_mode == "physical_stop" else 0,
            distance_map=distance_map,
            directed_lanes=directed_lanes,
            vehicles_by_id=vehicles_by_id,
        )

        return {
            "solver_status": solver_status_name,
            "planning_mode": planning_mode,
            "source_policy": source_policy,
            "objective_policy": objective_policy,
            "split_policy": split_policy,
            "max_candidates_per_order": self.max_candidates_per_order,
            "omitted_candidates_total": omitted_total,
            "stage2_modified": stage2_modified,
            "vehicle_mode": "interval_no_overlap" if vehicles else "carrier_max_load_only (no_truck_table)",
            "distributor_mode": distributor_mode,
            "directed_lanes": directed_lanes,
            "provenance": snapshot.get("provenance", {}),
            "orders_total": len(outcomes),
            "fully_covered": sum(1 for o in outcomes if o.planning_status == "Fully covered"),
            "partially_covered": sum(1 for o in outcomes if o.planning_status == "Partially covered"),
            "uncovered": sum(1 for o in outcomes if o.planning_status == "No allocation"),
            "total_ordered_kegs": sum(o.ordered_units for o in outcomes),
            "total_pending_kegs": sum(o.pending_units for o in outcomes),
            "total_allocated_kegs": sum(o.allocated_units for o in outcomes),
            "total_on_time_kegs": sum(o.proposed_on_time_units for o in outcomes),
            "total_freight_cost_inr": sum(o.freight_cost_inr for o in outcomes),
            "outcomes": outcomes,
            "selected_candidates_count": len(selected_candidates),
        }

    def validate_invariants(
        self,
        outcomes: List[PlannerOutcome],
        initial_stock: Dict[Tuple[str, str], int],
        used_stock: Counter,
        carrier_max_load: Optional[Dict[str, int]] = None,
        carrier_rates: Optional[Dict[str, float]] = None,
        as_of_date: Optional[date] = None,
        handling_days: int = 0,
        distance_map: Optional[Dict[Tuple[str, str], int]] = None,
        directed_lanes: bool = False,
        vehicles_by_id: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> None:
        """Fail closed if any conservation law, capacity, leg distance, vehicle window/non-overlap, timing, or cost invariant is violated."""
        seen_orders: Set[str] = set()
        vehicle_schedules: Dict[str, List[Tuple[int, int, str]]] = defaultdict(list)
        recomputed_stock: Counter = Counter()

        for o in outcomes:
            if o.order_id in seen_orders:
                raise InvariantValidationError(f"Duplicate order outcome for {o.order_id}")
            seen_orders.add(o.order_id)

            if o.allocated_units < 0:
                raise InvariantValidationError(f"Negative allocation on order {o.order_id}")
            if o.allocated_units > o.pending_units:
                raise InvariantValidationError(
                    f"Allocation {o.allocated_units} exceeds pending {o.pending_units} for {o.order_id}"
                )
            if o.proposed_on_time_units > o.allocated_units:
                raise InvariantValidationError(
                    f"On-time units {o.proposed_on_time_units} exceeds allocated {o.allocated_units}"
                )
            if o.uncovered_units != o.pending_units - o.allocated_units:
                raise InvariantValidationError(
                    f"Uncovered mismatch on {o.order_id}: {o.uncovered_units} != {o.pending_units} - {o.allocated_units}"
                )
            if o.distance_km < 0 or o.freight_cost_inr < 0:
                raise InvariantValidationError(f"Negative distance or freight on {o.order_id}")
            if o.allocated_units > 0:
                if o.source_customer_id:
                    recomputed_stock[(o.source_customer_id, o.keg_size)] += o.allocated_units

                if distance_map is not None and o.source_customer_id:
                    resolved = _resolve_route_legs(
                        distance_map,
                        o.source_customer_id,
                        o.distributor_customer_id or o.destination_customer_id,
                        o.destination_customer_id,
                        distributor_mode=o.distributor_mode,
                        directed_lanes=directed_lanes,
                    )
                    if resolved is None:
                        raise InvariantValidationError(
                            f"Missing physical route leg(s) for {o.order_id} (mode={o.distributor_mode})"
                        )
                    expected_km, _ = resolved
                    if o.distance_km != expected_km:
                        raise InvariantValidationError(
                            f"Route distance mismatch on {o.order_id}: {o.distance_km} != {expected_km}"
                        )

                expected_transit = compute_transit_days(o.distance_km) + (
                    handling_days if o.distributor_mode == "physical_stop" and o.distributor_customer_id not in (o.source_customer_id, o.destination_customer_id) else 0
                )
                if o.transit_days != expected_transit:
                    raise InvariantValidationError(
                        f"Transit days mismatch on {o.order_id}: {o.transit_days} != {expected_transit}"
                    )
                if carrier_max_load and o.carrier in carrier_max_load:
                    cap = carrier_max_load[o.carrier]
                    if cap > 0 and o.allocated_units > cap:
                        raise InvariantValidationError(
                            f"Carrier capacity exceeded on {o.order_id}: {o.allocated_units} > {cap}"
                        )
                if carrier_rates and o.carrier in carrier_rates:
                    expected_cost = calculate_freight_cost_inr(o.allocated_units, o.distance_km, carrier_rates[o.carrier])
                    if abs(o.freight_cost_inr - expected_cost) > 0.02:
                        raise InvariantValidationError(
                            f"Freight cost mismatch on {o.order_id}: {o.freight_cost_inr} != {expected_cost}"
                        )
                ord_d = _parse_date(o.ordered_date)
                nb_d = _parse_date(o.needed_by)
                if ord_d and nb_d:
                    feas, _ = evaluate_deadline_feasibility(ord_d, nb_d, o.transit_days, as_of_date=as_of_date)
                    expected_flag = "Y" if feas else "N"
                    if o.on_time_feasible != expected_flag:
                        raise InvariantValidationError(
                            f"Feasibility flag mismatch on {o.order_id}: {o.on_time_feasible} != {expected_flag}"
                        )
                if vehicles_by_id and o.vehicle_id is not None:
                    veh = vehicles_by_id.get(o.vehicle_id)
                    if not veh:
                        raise InvariantValidationError(f"Unknown vehicle {o.vehicle_id} on {o.order_id}")
                    veh_cap = int(veh.get("capacity", 0) or 0)
                    if veh_cap > 0 and o.allocated_units > veh_cap:
                        raise InvariantValidationError(
                            f"Vehicle {o.vehicle_id} capacity exceeded on {o.order_id}: {o.allocated_units} > {veh_cap}"
                        )
                    if o.trip_start < int(veh.get("free_from", 0)) or o.trip_end > int(veh.get("free_until", 10**9)):
                        raise InvariantValidationError(
                            f"Vehicle {o.vehicle_id} window violated on {o.order_id}: [{o.trip_start},{o.trip_end}]"
                        )
                if o.vehicle_id is not None and o.trip_end > o.trip_start:
                    for s, e, prev_oid in vehicle_schedules[o.vehicle_id]:
                        if not (o.trip_end <= s or e <= o.trip_start):
                            raise InvariantValidationError(
                                f"Vehicle {o.vehicle_id} overlap between {prev_oid} [{s},{e}] and {o.order_id} [{o.trip_start},{o.trip_end}]"
                            )
                    vehicle_schedules[o.vehicle_id].append((o.trip_start, o.trip_end, o.order_id))

        # Stock conservation: check both caller counter and independently recomputed stock usage
        for stock_map in (used_stock, recomputed_stock):
            for (src_id, sku), used in stock_map.items():
                avail = initial_stock.get((src_id, sku), 0)
                if used > avail:
                    raise InvariantValidationError(
                        f"Stock overallocated for source {src_id}, SKU {sku}: used {used} > available {avail}"
                    )


class NearestSourceBaselinePlanner:
    """Greedy benchmark using identical constraints, denominators, and cost basis as OrToolsFulfillmentPlanner."""

    def plan(self, snapshot: Dict[str, Any]) -> Dict[str, Any]:
        orders = sorted(snapshot["orders"], key=lambda o: (o.get("needed_by_date", ""), o["id"]))
        as_of_d = _parse_date(snapshot.get("as_of_date"))
        directed_lanes = bool(snapshot.get("directed_lanes", False))
        distributor_mode = str(snapshot.get("distributor_mode", "coordinator"))
        handling_days = int(snapshot.get("distributor_handling_days", 0) or 0)
        vehicles = list(snapshot.get("vehicles") or [])
        base_date = date(2026, 7, 1)

        stock_remaining = defaultdict(int)
        for s in snapshot["stock"]:
            stock_remaining[(s["source"], s["sku"])] = s["available"]

        distances = {}
        for leg in (snapshot.get("legs") or snapshot.get("distances") or []):
            orig = leg.get("origin") or leg.get("OriginCustomerId")
            dest = leg.get("destination") or leg.get("DestCustomerId")
            km = leg.get("km") if "km" in leg else leg.get("RoadDistanceKm", 0)
            if orig and dest:
                distances[(orig, dest)] = int(km)

        customers = snapshot.get("customers", {})
        distributors_by_region = defaultdict(list)
        for cid, cust in customers.items():
            if cust.get("type") == "Distributor":
                distributors_by_region[cust.get("region", "West")].append(cid)

        carriers = [
            c for c in (snapshot.get("carriers", {}) or {}).values()
            if int(c.get("max_load", 0) or 0) > 0
        ]
        if not carriers:
            carriers = [{"name": "Standard Carrier", "rate_inr": 2.0, "max_load": 900}]
        carriers.sort(key=lambda c: float(c.get("rate_inr", 2.0)))

        used_vehicle_intervals: Dict[str, List[Tuple[int, int]]] = defaultdict(list)
        outcomes = []
        fully_covered = 0
        partially_covered = 0
        uncovered = 0
        total_ordered_kegs = 0
        total_pending_kegs = 0

        for o in orders:
            oid = o["id"]
            dest_id = o["customer_id"]
            sku = o["sku"]
            ordered = int(o.get("quantity_ordered", o["pending"]))
            pending = int(o["pending"])
            total_ordered_kegs += ordered
            total_pending_kegs += pending
            needed_by_d = _parse_date(o.get("needed_by_date"))
            ordered_d = _parse_date(o.get("ordered_date"))
            if not needed_by_d or not ordered_d or pending <= 0:
                uncovered += 1
                outcomes.append({"order_id": oid, "allocated_units": 0, "distance_km": 0, "freight_cost_inr": 0.0, "is_on_time": False, "transit_days": 0})
                continue

            dispatch_start = max(ordered_d, as_of_d) if as_of_d else ordered_d
            dest_region = customers.get(dest_id, {}).get("region", "West")
            dist_list = distributors_by_region.get(dest_region, [])
            coord_dist_id = dist_list[0] if dist_list else dest_id

            # Find nearest source with remaining stock and verified route legs
            eligible = []
            for (src_id, s_sku), avail in stock_remaining.items():
                if s_sku == sku and avail > 0 and src_id != dest_id:
                    resolved = _resolve_route_legs(
                        distances, src_id, coord_dist_id, dest_id,
                        distributor_mode=distributor_mode, directed_lanes=directed_lanes,
                    )
                    if resolved is not None:
                        km, _ = resolved
                        eligible.append((src_id, avail, km))
            eligible.sort(key=lambda s: s[2])

            allocated_this_order = False
            for src_id, avail, km in eligible:
                t_days = compute_transit_days(km) + (
                    handling_days if distributor_mode == "physical_stop" and coord_dist_id not in (src_id, dest_id) else 0
                )
                is_feasible, _ = evaluate_deadline_feasibility(ordered_d, needed_by_d, t_days, as_of_date=as_of_d)
                if not is_feasible:
                    continue
                trip_start_min = (dispatch_start - base_date).days * 1440
                trip_end_min = trip_start_min + max(1, t_days) * 1440

                for car in carriers:
                    car_name = car.get("name", "Standard Carrier")
                    max_load = int(car.get("max_load", 900) or 900)
                    veh_cap = max_load
                    chosen_veh_id = None
                    if vehicles:
                        matching_vehs = [
                            v for v in vehicles
                            if v.get("carrier") == car_name
                            and (not snapshot.get("strict_vehicle_origin", False) or v.get("origin") in (None, src_id))
                            and trip_start_min >= int(v.get("free_from", 0))
                            and trip_end_min <= int(v.get("free_until", 10**9))
                            and not any(
                                not (trip_end_min <= s or e <= trip_start_min)
                                for s, e in used_vehicle_intervals.get(v["id"], [])
                            )
                        ]
                        if not matching_vehs:
                            continue
                        chosen_veh_id = matching_vehs[0]["id"]
                        veh_cap = int(matching_vehs[0].get("capacity", max_load))

                    alloc_qty = min(pending, avail, max_load, veh_cap)
                    if alloc_qty <= 0:
                        continue
                    stock_remaining[(src_id, sku)] -= alloc_qty
                    if chosen_veh_id is not None:
                        used_vehicle_intervals[chosen_veh_id].append((trip_start_min, trip_end_min))
                    freight = calculate_freight_cost_inr(alloc_qty, km, float(car.get("rate_inr", 2.0)))
                    if alloc_qty >= pending:
                        fully_covered += 1
                    else:
                        partially_covered += 1
                    outcomes.append({
                        "order_id": oid,
                        "allocated_units": alloc_qty,
                        "distance_km": km,
                        "freight_cost_inr": freight,
                        "is_on_time": True,
                        "transit_days": t_days,
                    })
                    allocated_this_order = True
                    break
                if allocated_this_order:
                    break

            if not allocated_this_order:
                uncovered += 1
                outcomes.append({
                    "order_id": oid,
                    "allocated_units": 0,
                    "distance_km": 0,
                    "freight_cost_inr": 0.0,
                    "is_on_time": False,
                    "transit_days": 0,
                })

        return {
            "name": "NearestSourceBaseline",
            "orders_total": len(outcomes),
            "fully_covered": fully_covered,
            "partially_covered": partially_covered,
            "uncovered": uncovered,
            "total_ordered_kegs": total_ordered_kegs,
            "total_pending_kegs": total_pending_kegs,
            "allocated_kegs": sum(o["allocated_units"] for o in outcomes),
            "total_allocated_kegs": sum(o["allocated_units"] for o in outcomes),
            "on_time_orders": sum(1 for o in outcomes if o["is_on_time"]),
            "total_on_time_kegs": sum(o["allocated_units"] for o in outcomes if o["is_on_time"]),
            "total_freight_inr": sum(o["freight_cost_inr"] for o in outcomes),
            "total_freight_cost_inr": sum(o["freight_cost_inr"] for o in outcomes),
            "outcomes": outcomes,
        }
