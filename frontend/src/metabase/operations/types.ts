export interface OperationsDisclosures {
  synthetic: boolean;
  proposed_only: boolean;
  no_reservation: boolean;
  no_booking: boolean;
  no_dispatch: boolean;
  shared_trip_available: boolean;
  missing_tables: string[];
  summary: string;
  horizon_summary?: string;
}

export interface OperationsRunSummary {
  run_id: string;
  created_at: string;
  as_of_date: string;
  is_active: boolean;
  horizon_orders: number;
  total_open_orders: number;
  horizon_truncated?: boolean;
  orders_outside_horizon?: number;
  orders_fully_covered: number;
  orders_partially_covered: number;
  orders_uncovered: number;
  kegs_ordered: number;
  kegs_allocated: number;
  total_freight_inr?: number;
  planning_mode?: string;
  source_policy?: string;
  source_policy_label?: string;
  objective_policy?: string;
  split_policy?: string;
  omitted_candidates_total?: number;
  max_candidates_per_order?: number;
}

export interface OrderQueueItem {
  allocation_id: string;
  order_id: string;
  destination_customer_id: string;
  destination_brewer: string;
  region: string;
  keg_size: string;
  ordered_date: string;
  needed_by: string;
  ordered_units: number;
  fulfilled_units: number;
  pending_units: number;
  allocated_units: number;
  uncovered_units: number;
  source_hub: string;
  source_customer_id: string | null;
  distributor: string;
  carrier: string;
  distance_km: number;
  transit_days: number;
  freight_cost_inr: number;
  on_time_feasible: string;
  planning_status: string;
  status: string;
  explanation: string;
  dest_lat?: number | null;
  dest_lng?: number | null;
  src_lat?: number | null;
  src_lng?: number | null;
  src_role?: string | null;
}

export interface OrdersListResponse {
  data: OrderQueueItem[];
  total_matching: number;
  next_cursor: string | null;
  has_more: boolean;
  run: OperationsRunSummary;
  disclosures: OperationsDisclosures;
}

export interface OrderTimelineItem {
  label: string;
  date?: string;
  days?: number;
  feasible?: boolean;
  overdue_vs_as_of?: boolean;
  basis: string;
}

export interface OrderDetailItem extends OrderQueueItem {
  dest_lat: number | null;
  dest_lng: number | null;
  dest_city: string | null;
  dest_state: string | null;
  src_lat: number | null;
  src_lng: number | null;
  src_city: string | null;
  src_state: string | null;
  src_role: string | null;
  dist_lat: number | null;
  dist_lng: number | null;
  dist_role: string | null;
  reconciled: boolean;
  distributor_mode: string;
  selected_candidate_id?: number | null;
  decision_stage?: string | null;
  omitted_candidates_count?: number;
  stop_sequence?: number | null;
  trip_id?: string | null;
  cost_formula?: string | null;
  why_this_plan: string;
  timeline: OrderTimelineItem[];
}

export interface ConsistencyCheck {
  passed: boolean;
  warnings: string[];
}

export interface PlanningPolicy {
  mode: string;
  source_policy?: string | null;
  source_policy_label?: string | null;
  split_policy: string;
  objective_policy: string;
  decision_stage: string;
  trip_capability: boolean;
  shared_trip_message: string;
  map_mode: string;
}

export interface TripSummary {
  trip_id: string;
  trip_code: string;
  source_customer_id: string;
  source_name: string;
  source_role: string;
  carrier_name: string;
  carrier_max_load_kegs: number;
  total_kegs: number;
  utilization_pct: number;
  stop_count: number;
  total_distance_km: number;
  total_freight_inr: number;
  dispatch_date: string;
}

export interface TripStopItem {
  stop_id: string;
  trip_code: string;
  stop_sequence: number;
  order_id: string;
  destination_customer_id: string;
  destination_name: string;
  keg_size: string;
  kegs_delivered: number;
  load_before_stop_kegs: number;
  load_after_stop_kegs: number;
  leg_from_id: string;
  leg_from_name: string;
  leg_distance_km: number;
  cumulative_distance_km: number;
  cumulative_transit_days: number;
  needed_by: string;
  allocated_freight_inr: number;
  dest_lat?: number | null;
  dest_lng?: number | null;
  dest_city?: string | null;
  from_lat?: number | null;
  from_lng?: number | null;
  is_current_order?: boolean;
}

export interface AllocationLineItem {
  line_id: string;
  line_seq: number;
  source_customer_id: string;
  source_name: string;
  source_role: string;
  carrier: string;
  allocated_units: number;
  distance_km: number;
  freight_cost_inr: number;
  transit_days: number;
  trip_code?: string | null;
  stop_sequence?: number | null;
  src_lat?: number | null;
  src_lng?: number | null;
  src_city?: string | null;
}

export interface OrderDetailResponse {
  order: OrderDetailItem;
  trip?: TripSummary | null;
  trip_stops?: TripStopItem[];
  allocation_lines?: AllocationLineItem[];
  consistency_check?: ConsistencyCheck;
  planning_policy?: PlanningPolicy;
  run: OperationsRunSummary;
  disclosures: OperationsDisclosures;
}

export interface OrderAlternative {
  evidence_id: string;
  order_id: string;
  candidate_route_id: number;
  source_customer_id: string;
  source_name: string;
  source_role: string | null;
  src_lat?: number | null;
  src_lng?: number | null;
  src_city?: string | null;
  src_state?: string | null;
  carrier_name: string;
  distance_km: number;
  freight_cost_inr: number;
  transit_days: number;
  slack_days: number;
  is_selected: number;
  selected: boolean;
  feasible?: boolean;
  candidate_quantity?: number | null;
  stock_available_kegs?: number | null;
  stock_remaining_kegs?: number | null;
  carrier_max_load_kegs?: number | null;
  reason_code?: string | null;
  competing_order_ids?: string | null;
  decision_stage?: string | null;
  cost_formula?: string | null;
  rejection_reason: string | null;
}

export interface OrderAlternativesResponse {
  order_id: string;
  evidence_status?: "complete" | "partial" | "empty" | "error";
  incomplete_evidence: boolean;
  evaluated_count?: number;
  returned_count?: number;
  truncated?: boolean;
  omitted_count?: number;
  selected_candidate_id?: number | null;
  alternatives: OrderAlternative[];
  run: OperationsRunSummary;
  disclosures: OperationsDisclosures;
}

export interface CounterfactualAffectedOrder {
  order_id: string;
  destination_brewer: string;
  needed_by?: string;
  allocated_units?: number;
  freight_cost_inr?: number;
  baseline_allocated_kegs?: number;
  scenario_allocated_kegs?: number;
  allocated_delta_kegs?: number;
  baseline_source_name?: string;
  scenario_source_name?: string;
  freight_delta_inr?: number;
}

export interface OrderCounterfactualResponse {
  order_id: string;
  candidate_route_id: number;
  target_source_id: string;
  target_source_name: string;
  carrier_name: string;
  is_solver_reoptimization?: boolean;
  solver_status?: string;
  baseline_kegs?: number;
  scenario_kegs?: number;
  kegs_delta?: number;
  baseline_freight_inr?: number;
  scenario_freight_inr?: number;
  freight_delta_inr?: number;
  baseline_uncovered?: number;
  scenario_uncovered?: number;
  uncovered_delta?: number;
  selected_freight_inr?: number;
  alternative_freight_inr?: number;
  standalone_freight_delta_inr?: number;
  needed_kegs?: number;
  stock_available_kegs?: number | null;
  stock_remaining_kegs?: number;
  shortfall_if_forced_on_competing_kegs?: number;
  affected_orders: CounterfactualAffectedOrder[];
  conclusion: string;
  run: OperationsRunSummary;
  disclosures: OperationsDisclosures;
}

export interface OrderOverrideResponse {
  ok: boolean;
  error?: string;
  active_plan_unchanged: boolean;
  is_solver_reoptimization: boolean;
  solver_status?: string;
  order_id?: string;
  target_source_id?: string;
  target_source_name?: string;
  target_carrier?: string;
  forced_qty?: number;
  baseline_kegs?: number;
  scenario_kegs?: number;
  kegs_delta?: number;
  baseline_uncovered?: number;
  scenario_uncovered?: number;
  uncovered_delta?: number;
  baseline_freight_inr?: number;
  scenario_freight_inr?: number;
  freight_delta_inr?: number;
  affected_orders?: CounterfactualAffectedOrder[];
  affected_orders_total?: number;
  run: OperationsRunSummary;
  disclosures: OperationsDisclosures;
}

export interface InventoryItem {
  customer_id: string;
  facility_name: string;
  facility_role: string;
  region: string;
  city: string;
  keg_size: string;
  snapshot_date: string;
  available_kegs: number;
  lat?: number | null;
  lng?: number | null;
}

export interface InventoryListResponse {
  data: InventoryItem[];
  run: OperationsRunSummary;
  disclosures: OperationsDisclosures;
}

export interface ScenarioRoleBreakdown {
  source_role: string;
  orders_count: number;
  kegs_allocated: number;
  avg_distance_km: number;
}

export interface ScenarioPlanSummary {
  run_id: string;
  is_active: boolean;
  source_policy: string;
  source_policy_label: string;
  orders_total: number;
  orders_fully_covered: number;
  orders_partially_covered: number;
  orders_uncovered: number;
  kegs_ordered: number;
  kegs_allocated: number;
  uncovered_kegs: number;
  total_freight_inr: number;
  source_role_breakdown: ScenarioRoleBreakdown[];
}

export interface ScenariosCompareResponse {
  active_plan: ScenarioPlanSummary | null;
  benchmark_plan: ScenarioPlanSummary | null;
  disclosures: OperationsDisclosures;
}

export interface ScenarioRunResponse {
  scenario_type: string;
  title: string;
  is_simulation: boolean;
  is_solver_reoptimization?: boolean;
  solver_status?: string;
  assumptions?: string[];
  affected_orders_total?: number;
  baseline_kegs: number;
  scenario_kegs: number;
  kegs_delta: number;
  baseline_uncovered: number;
  scenario_uncovered: number;
  uncovered_delta: number;
  baseline_freight_inr: number;
  scenario_freight_inr: number;
  freight_delta_inr: number;
  summary: string;
  disclosures: OperationsDisclosures;
}

export interface OpsAssistantResponse {
  answer: string;
  provider: string;
  is_fallback: boolean;
  cited_ids: string[];
  disclosures?: OperationsDisclosures;
}
