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

## 5. Current Session Environment Blockers for Live VPS/Railway Actions

- **VPS SSH:** No SSH private key present in `~/.ssh` (`Permission denied (publickey,password)` for `rauhan@167.86.83.116` and `root@167.86.83.116`).
- **Metabase / Railway Live Credentials:** `METABASE_USER`/`METABASE_PASS`/`METABASE_SESSION` and `RAILWAY_*` env vars are not set in this shell, so live VPS frontend deployment (`metabase-dev` restart) and live RBAC application require authorized credentials/SSH access.
- **Health Check Verified:** `https://mstar.nubrixai.com/api/health` returned `{"status":"ok"}`.
