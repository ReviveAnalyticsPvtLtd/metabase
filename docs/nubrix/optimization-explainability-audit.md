# MicroStar Optimization Explainability & Route Audit (Phase 0)

**Date:** 2026-11-27  
**Scope:** Active POC Run `RUN-20261124-211506-7F7FBE` on Railway (`railway`) and `metabase/bin/nubrix/` + `metabase/src/metabase/operations/api.clj`.  
**Status Legend:** `Verified locally` | `Verified against Railway` | `Verified in Metabase` | `Verified on VPS` | `Historical report only` | `Unverified` | `Blocked`.

---

## 1. Manager Example Reproduced (`ORD-000663`) — Verified against Railway

- **Order (`KegOrder`):** `ORD-000663`, destination `CUST-0232` (`Chandigarh Brewer 0232`, North, Brewer), SKU `50L`, `ordered_units = 100`, `fulfilled_units = 70`, `pending_units = 30`, `ordered_date = 2026-01-01`, `needed_by = 2026-01-03`.
- **Selected Allocation (`nubrix_poc_allocations`):**
  - `allocation_id`: `RUN-20261124-211506-7F7FBE-A00002`
  - `source_customer_id`: `CUST-0039` (`Ludhiana Brewer 0039`)
  - `distributor_customer_id`: `CUST-0373` (`Delhi Distributor 0373`, `coordinator` mode)
  - `carrier`: `EastWest Transport`
  - `allocated_units`: `30` (`uncovered_units = 0`, `planning_status = Fully covered`)
  - `distance_km = 123`, `transit_days = 1`, `on_time_feasible = Y`, `freight_cost_inr = 6088.50`
- **Candidate Evidence (`nubrix_poc_candidate_evidence`):** `31` rows total (`1` selected, `1` `missing_lane`, `29` with `rejection_reason = NULL`).
  - Selected row: `EVID-00002-449-BEA2`, `candidate_route_id = 57`, `source_customer_id = "Ludhiana Brewer 0039"` (**display name stored in ID column**), `EastWest Transport`, `123 km`, `₹6,088.50`, `is_selected = 1`, `rejection_reason = NULL`.
  - Cheaper non-selected row shown in screenshot: `EVID-00002-425-0A74`, `candidate_route_id = 33`, `source_customer_id = "Chandigarh Brewer 0024"` (**display name**), `EastWest Transport`, `5 km`, `₹247.50`, `is_selected = 0`, `rejection_reason = NULL`.
- **Global Trade-off Proof (`Verified against Railway`):**
  - `CUST-0024` (`Chandigarh Brewer 0024`) had `90` `50L` kegs in latest `ReportedInventory`.
  - In `RUN-20261124-211506-7F7FBE`, all `90` `50L` kegs from `CUST-0024` were allocated to `ORD-009783` (`Chandigarh Brewer 0168`, `needed_by = 2026-01-07`, `freight = ₹2,821.50`), leaving `0` `50L` kegs remaining at `CUST-0024`.

## 2. Additional Cases Reproduced — Verified against Railway

- **Status Distribution (`RUN-20261124-211506-7F7FBE`, `1,000` horizon orders):**
  - `Fully covered`: `720`
  - `Partially covered`: `84` (e.g., `ORD-007394`, pending `350`, allocated `80` from `CUST-0047`, uncovered `270`; `ORD-004745`, pending `70`, allocated `20` from `CUST-0050`, uncovered `50`)
  - `No allocation`: `196` (e.g., `ORD-009536`, pending `180`, uncovered `180`, `source_customer_id = NULL`, `carrier = Unassigned`)
- **Consistency Totals (`Verified against Railway`):**
  - `MULTI SELECTED ORDERS`: `0`
  - `ZERO EVIDENCE ORDERS`: `0`
  - `EVID source_customer_id FORMAT`: `870 / 30,870` rows use `CUST-*`; `30,000 / 30,870` rows store display names instead of `CUST-*` IDs.
  - `dimCustomer`: `480` rows (`Brewer: 360`, `Distributor: 80`, `Maintenance Facility: 40`), `0` duplicate `CustomerName` rows, `10,000 / 10,000` orders in `KegOrder` point to `Brewer` destinations.

## 3. Root Causes Identified — Verified locally & against Railway

1. **Corrupted `source_customer_id` in Evidence (`run_snapshot_pipeline.py`):** `ev.get("source")` held `src_name` instead of `src_id`, writing `"Chandigarh Brewer 0024"` into `nubrix_poc_candidate_evidence.source_customer_id`.
2. **Ambiguous SQL Join (`api.clj`):** `LEFT JOIN dimCustomer c ON c.CustomerId = e.source_customer_id OR c.CustomerName = e.source_customer_id` compensated for the ID bug via `ID OR Name`.
3. **Inferred Selection & Missing Stage/Quantity Trace:** Selection (`is_selected`) was matched on `source` + `carrier` rather than `selected_candidate_id`; `candidate_quantity`, `stock_before`, `stock_after`, `carrier_max_load`, `decision_stage`, and `competing_order_ids` were not persisted.
4. **Silent `rejection_reason` & Freight-Comparison Inference:** Globally rejected feasible candidates had `rejection_reason = NULL`, and `api.clj` inferred capacity contention solely by comparing freight numbers.
5. **Candidate Cap (`max_candidates_per_order = 5`):** Truncated sources by distance before carrier/objective comparison without persisting `omitted_candidates_count` or disclosing bounded candidate scope.
6. **Stage 2 Residual & Freight Normalization:** Stage 2 residual allocations could reduce `allocated_units` below `c.quantity`, while evidence kept full `c.quantity` freight.
7. **Mode A vs Mode B Honesty:** Railway lacks `Truck`, `InventoryReservation`, persisted `trips`, `trip_stops`, and road polyline geometry (`vehicles = []` in `RailwayWarehouseAdapter`). Therefore, published Railway plans operate strictly in **Mode A: order-level allocation** (no shared-trip or road-route claims).

## 4. Verification Status Summary

- `Verified against Railway`: Active pointer, `ORD-000663` allocation + evidence + `CUST-0024` competing allocation (`ORD-009783`), customer/order coherence, status counts.
- `Verified locally`: `run_snapshot_pipeline.py`, `fulfillment_planner.py`, `adapters.py`, `poc_storage.py`, `api.clj` code inspection.
- `Unverified`: Non-admin RBAC isolation (`--setup-rbac --apply` withheld pending owner approval).
