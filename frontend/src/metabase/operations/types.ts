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
  why_this_plan: string;
  timeline: OrderTimelineItem[];
}

export interface OrderDetailResponse {
  order: OrderDetailItem;
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
  rejection_reason: string | null;
}

export interface OrderAlternativesResponse {
  order_id: string;
  incomplete_evidence: boolean;
  alternatives: OrderAlternative[];
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
