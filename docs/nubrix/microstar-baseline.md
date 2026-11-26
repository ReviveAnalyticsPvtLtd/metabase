# MicroStar Nubrix Control Tower — Evidence Freeze & Baseline

**Generated:** 2026-11-25
**Scope:** Simulated India Keg Logistics MVP (synthetic Railway dataset + isolated `nubrix_poc_*` schema).

## 1. Codebase & Artifact Inventory (Local)

- **Workspace:** `/Users/apple/Downloads/Metabase Clone/metabase`
- **Core Planner & Pipeline (`metabase/bin/nubrix/`):**
  - `domain_contract.py` — canonical schemas, India freight constants (`400.0 km/day`), `as_of_date` deadline feasibility, and Phase 4 integration `Protocol` contracts (`OrderSource`, `InventorySource`, `LaneProvider`, `CarrierCapacityProvider`, `PlanPublisher`, `ReservationAdapter`, `ExecutionAdapter`, `AuditStore`).
  - `adapters.py` — `WorkbookStageAdapter` and `RailwayWarehouseAdapter` (loads all `23,999` directed lanes, deduplicates `ReportedInventory` by latest `SnapshotDate` per `(CustomerId, SizeCode)`, discloses missing `Truck` and `InventoryReservation` tables as `status="partial"`).
  - `fulfillment_planner.py` — authoritative `OrToolsFulfillmentPlanner` (staged lexicographic objective, physical distributor legs, vehicle interval non-overlap, Stage 2 residual revalidation, fail-closed `InvariantValidationError`, honest solver status labels) + `NearestSourceBaselinePlanner` on identical constraints/cost basis.
  - `poc_storage.py` — isolated `nubrix_poc_*` tables (`nubrix_poc_runs`, `nubrix_poc_run_pointer`, `nubrix_poc_allocations`, `nubrix_poc_evidence`, `nubrix_poc_route_legs`) with transactional pointer updates.
  - `run_snapshot_pipeline.py` — 5-stage extraction, benchmark, dry-run default, `--publish` promotion.
  - `what_if_simulator.py` — isolated what-if scenario runner (`carrier_unavailable`, `source_stock_reduced`, `changed_needed_by_date`, `no_distributor_capacity`, `split_policy_toggle`).
  - `grounded_ai.py` — `DeterministicExplanationEngine`, `GroundedAssistant`, `NubrixBotPolicy`, `validate_numeric_fidelity`.
- **Frontend Security & Map Fixes (`metabase/frontend/`):**
  - `LeafletMarkerPinMap.tsx` — DOM-safe (`document.createElement` + `textContent`) legend and tooltip rendering, allowlisted `GENERIC_CATEGORY_PALETTE`, `role="img"` + `aria-label` on markers.
  - `PinMap.tsx` — strict numeric coordinate/metric validation (restored `PinMap.unit.spec.tsx` 27/27 pass).
  - `ErrorBoundary.tsx` — replaced raw end-user stack traces with safe recovery UI while preserving controlled `reportFrontendError` telemetry.

## 2. Railway Schema & Active Run Lineage

- **Source Tables (Read-Only, Untouched):** `dimCustomer`, `dimProductSize`, `dimCarrier`, `KegOrder`, `ReportedInventory`, `FreightRoadDistance`, `FulfillmentAllocation`.
- **Isolated Planning Tables (`nubrix_poc_*`):**
  - Active Run Pointer (verified during Step 2/3 promotion): `RUN-20261124-211506-7F7FBE` (`is_active=1`).
  - Prior Run (preserved for rollback): `RUN-20261124-185722-0BCF42` (`is_active=0`).
  - Run Totals: `1,000`-order horizon (out of `9,899` open orders), `62,030` allocated kegs, `720` fully covered, `84` partial, `196` uncovered, `₹4,565,913.00` modeled freight, `30,870` evidence rows (`804` selected), solver status `FEASIBLE (time_limit_or_bounded)`.
- **Known Data Limitations (Disclosed in UI & Output):**
  - Synthetic India dataset; no authoritative `Truck` or `InventoryReservation` tables exist in Railway.
  - Plans are **proposed simulations**, not booked carrier dispatches or reserved inventory.

## 3. Dashboard 23 Lineage & RBAC State

- **Dashboard 23:** `6` dashcards (Banner, Card 141 Map, Card 142 Ledger, Card 143 Demand, Card 144 Inventory, Card 145 Carrier Summary).
- **Recovery Backups:** `deliverables/pre_promotion_backups/dashboard_23_backup_20261124_210106.json` and `dashboard_23_backup_20261124_211819.json`.
- **RBAC Gap (Pending Step 4 Approval & Execution):**
  - Dashboard 23 currently resides in root collection (`Our analytics`), where `All Users` (group `1`) has `write` collection access and `unrestricted` / `query-builder-and-native` / `download: full` on Database `2` (`railway`).
  - Target least-privilege state: move Dashboard 23 + cards to dedicated `MicroStar Control Tower` collection, grant `read` to `MicroStar Viewers` group, restrict `All Users` to `none` on that collection and `segmented` / `no-self-service` / `none` download on Database `2`, then verify with a real non-admin viewer across browser, API, native SQL, and download endpoints.

## 4. Security & Credential Rotation Status

- Hardcoded credentials and predictable `/tmp/mb_token.txt` writes were removed from `run_snapshot_pipeline.py`, `configure_control_tower.py`, `inject_metabot_prompts.py`, and `verify_dashboard_native.mjs`.
- **Action Required by Owners:** Any Railway or Metabase credentials previously exposed in earlier commits or chat transcripts must be rotated/revoked by the infrastructure owners; removing literals from source does not rotate active secrets.

## 5. Order-First Implementation & Verification Status (2026-11-26)

- **Backend Endpoints (`metabase/src/metabase/operations/api.clj`, mounted in `api_routes/routes.clj`):**
  - Authenticated (`+auth`), read-only, parameterized endpoints against Database `2` (`railway`): `/api/operations/run`, `/api/operations/overview`, `/api/operations/orders` (keyset cursor pagination on `(needed_by, order_id, allocation_id)` using `metabase.request.core/limit`), `/api/operations/orders/:order-id` (reconciliation check, coordinates, timeline, deterministic explanation), `/api/operations/orders/:order-id/alternatives`, `/api/operations/exceptions`, and `/api/operations/inventory`.
- **Frontend Workspace (`metabase/frontend/src/metabase/operations/` & `PbiRail.tsx`):**
  - Routes `/operations/overview` (redirects to `/dashboard/23`), `/operations/orders`, `/operations/orders/:orderId`, `/operations/exceptions`, `/operations/inventory`, and `/operations/analytics` (redirects to `/collection/root`), plus `Overview`, `Orders`, `Exceptions`, `Inventory`, and `Analytics` left-rail navigation (`Routes` intentionally omitted since no real trip legs exist).
  - Dashboard 23 banner updated to `Simulated scenario · Proposed plan — not a booking` with direct links to `/operations/orders` and `/operations/exceptions`.
- **Verification Ledger:**
  - **Verified locally:** Jest (`operations.unit.spec.tsx`, `PbiRail.unit.spec.tsx`, `PinMap.unit.spec.tsx`), Python `unittest` (`metabase/bin/nubrix/test_*.py`), and local `rspack` release bundle (`bun run build-release:js`).
  - **Verified against Railway:** Active run `RUN-20261124-211506-7F7FBE` (`1,000` horizon orders out of `9,899` open orders, `219,420` ordered, `93,600` fulfilled, `125,820` pending, `62,030` proposed allocated, `63,790` uncovered, `280` attention orders, `₹4,565,913` modeled freight).
  - **Verified on VPS / in Metabase:** `https://mstar.nubrixai.com/api/health` (`200 ok`), all 7 `/api/operations/*` endpoints (unauthenticated `401`, keyset pagination, `reconciled: true`, `404` on missing order), and Dashboard 23 + `/operations/*` live browser E2E (`verify_dashboard_native.mjs`).
  - **Unverified:** Non-admin viewer RBAC isolation (`--setup-rbac --apply` intentionally withheld pending explicit owner approval; non-admin user end-to-end verification remains unverified).

## 6. Security & Credential Rotation Note

- Active VPS/Railway/Metabase credentials used during authorized deployment are not stored in this repository. Owners should rotate any credentials previously shared in session transcripts before external demos.
