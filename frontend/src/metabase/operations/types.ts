export interface OperationsDisclosures {
  synthetic: boolean;
  proposed_only: boolean;
  no_reservation: boolean;
  no_booking: boolean;
  no_dispatch: boolean;
  shared_trip_available: boolean;
  missing_tables: string[];
  summary: string;
}

export interface OperationsRunSummary {
  run_id: string;
  created_at: string;
  as_of_date: string;
  is_active: boolean;
  horizon_orders: number;
  total_open_orders: number;
  orders_fully_covered: number;
  orders_partially_covered: number;
  orders_uncovered: number;
  kegs_ordered: number;
  kegs_allocated: number;
  planning_mode?: string;
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
  split_policy: string;
  objective_policy: string;
  decision_stage: string;
  trip_capability: boolean;
  shared_trip_message: string;
  map_mode: string;
}

export interface OrderDetailResponse {
  order: OrderDetailItem;
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
  needed_by: string;
  allocated_units: number;
  freight_cost_inr: number;
}

export interface OrderCounterfactualResponse {
  order_id: string;
  candidate_route_id: number;
  target_source_id: string;
  target_source_name: string;
  carrier_name: string;
  selected_freight_inr: number;
  alternative_freight_inr: number;
  standalone_freight_delta_inr: number;
  needed_kegs: number;
  stock_available_kegs: number | null;
  stock_remaining_kegs: number;
  shortfall_if_forced_on_competing_kegs: number;
  affected_orders: CounterfactualAffectedOrder[];
  conclusion: string;
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
}

export interface InventoryListResponse {
  data: InventoryItem[];
  run: OperationsRunSummary;
  disclosures: OperationsDisclosures;
}
