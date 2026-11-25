# Platform verification checkpoint: November 3, 2026

## The completion plan is still open

This is an implementation and validation checkpoint, not a release or completion
certificate. The authoritative plan is
`/Users/apple/.opencode/plan/nubrixai-platform-completion-plan.md`.

Execution policy: deep planning, dependency-level inspection, impact-based
verification, no delegation. Local feature files and isolated VM validation
directories are in scope. Existing local and live VM changes must be preserved.

## Changes verified in this checkpoint

- Nubrix Bot does not submit a new request or rewind a retry after cancellation
  during context collection. Unmounting the conversation surface also cancels
  pending context collection, without stopping an already-running conversation
  stream.
- Context-provider timeout timers and abort listeners are cleaned up after each
  provider resolves, rejects, times out, or is cancelled.
- An older conversation snapshot cannot overwrite messages from a newer local
  turn that started and completed while the snapshot request was pending.
- Report ribbon cancellation uses the header's existing unsaved-change
  confirmation and recovery path instead of directly discarding edit state.
- Read-only report viewers are not offered ribbon mutation commands. Insertion
  while already editing does not reset the original edit snapshot.
- Narrative insertion targets the selected report page. Ribbon tabs connect to
  their command panel and support arrow, Home, and End key focus navigation.
- Map rendering filters nonnumeric, non-finite, and out-of-range coordinates,
  validates metric values for heat/grid input, and preserves caller-owned rows.
- Normalized settings reach child map renderers. Renderer tests cover markers,
  tiles, legacy grid, and legacy heat settings. Existing region-map tests pass.
- Grid bin calculation uses coordinate positions in normalized point tuples,
  rather than source-column indexes. Repeated identical renderer errors are
  reported once per error state.

## Observed validation results

| Check                             | Observed result                                                       |
| --------------------------------- | --------------------------------------------------------------------- |
| VM ClojureScript compilation      | 492 files compiled, zero compiler warnings                            |
| Local production JavaScript build | Rspack and iframe SDK compiled successfully                           |
| Local TypeScript check            | Passed after cancellation, map, and report changes                    |
| Local frontend regression run     | 36 suites, 346 tests passed                                           |
| VM frontend regression run        | 20 suites, 189 tests passed on an earlier snapshot of this checkpoint |
| VM backend tests                  | 42 tests, 149 assertions, zero failures or errors                     |
| Live backend health               | HTTP 200                                                              |
| Public health                     | HTTP 200                                                              |

The local frontend regression command covered the complete Metabot test folder,
report ribbon/header/panes, dashboard click behavior, pin/region maps, map
normalization, and performance marks. Some existing Metabot tests emit React
`act` warnings and a test-router 404 despite passing assertions; the run is not
console-clean.

Backend namespaces tested through `./bin/test-agent --oss`:

- `metabase.metabot.scope-test`
- `metabase.metabot.agent.scope-enforcement-test`
- `metabase.metabot.tools.save-entity-test`

These existing tests establish the tested permission/save behavior. They do not
prove completion of the plan's proposed action families, rollback, or durable
idempotency requirements.

## VM validation is isolated from the live checkout

The live checkout is `/home/rauhan/metabase` at commit
`6864800c4e2517bfdffb84a9607adc87bb610adc`, with pre-existing uncommitted
changes. The local base commit is
`94113c1e7991341bb45f13f6f8ddfa0241d9a573`, also with pre-existing changes.
Neither checkout was reset or replaced.

The complete validation workspace is
`/home/rauhan/nubrix-validation-complete`. Its source archive SHA-256 is
`b0d7e92dbfb678a450a04f74278635ddf01e09c300ae663a1843a5e9c0102baf`.
Later local edits require another overlay before claiming remote validation.

Java 25 exists under the VM's managed toolchain. The backend test alias requests
a 12 GB initial heap, exceeding this VM's approximately 8 GB RAM. Only the
isolated validation copy of `deps.edn` was adjusted to `-Xms256m -Xmx1800m`;
its original is saved as `deps.edn.validation-original`. The live configuration
was not changed. The full remote TypeScript check was killed with exit 137;
the full check passes locally instead.

Earlier packaging attempts created partial validation directories. Do not use
them as release artifacts. The successful complete-workspace regression result
above supersedes those failed packaging attempts.

## Performance marks have limited meaning

Marks are recorded once per browser document, not once per interaction.
`cross-filter-state-updated` measures synchronous parameter-state dispatch,
not refreshed chart results. `report-content-ready` waits for dashboard card
loading completion. AI turn start/completion marks describe the submission
lifecycle, not a durable server-side artifact mutation. No large-data latency
budget or result-applied measurement has been verified.

## Remaining acceptance work

| Plan phase                   | Remaining evidence or implementation                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: Unified analysis editor   | Complete the unified shell and verify create/edit/filter/save/reopen/delete workflows, dirty-state handling, and route/API compatibility end to end |
| 2: Reports and documents     | Verify page CRUD/reordering, mixed-content persistence, filter scopes, recovery, and another permitted viewer                                       |
| 3: Cross-filtering           | Verify visual/page/report scopes, selected-state feedback, cross-highlighting or explicit fallback, and multi-visual/map E2E flows                  |
| 4: Typed artifact actions    | Implement and test all required action families, durable idempotency, confirmation, cancellation semantics, undo/rollback, and permissions          |
| 5: Maps                      | Verify true heat behavior, all map click interactions, region settings, renderer error recovery, and representative visual/E2E baselines            |
| 6: Accessibility             | Audit the complete editor/report/AI workflows, contrast, live regions, dialogs, and automated accessibility results                                 |
| 7: Performance               | Measure large reports/results/maps, result-applied latency, stale saves, and agreed performance budgets                                             |
| 8: E2E and visual regression | Implement and run the plan's deterministic authoring, cross-filter, AI create/edit/cancel/retry/undo, and visual workflows                          |
| 9: Release acceptance        | Full security/token/module validation, production artifact, rollback-safe deployment, authenticated live acceptance                                 |

Routing heat settings to the grid renderer is not proof of a distinct heatmap
implementation. The current save tool creates saved cards for collection,
dashboard, or document destinations; it is not a general report/document
authoring, renaming, moving, undo, or publishing API.

The earlier module-boundary run reported 11 violations in files outside this
checkpoint's changes. The full completion plan remains unsatisfied even if
those pre-existing failures are accepted as unrelated.

## No new release was deployed

The existing service stayed healthy during isolated validation. No source from
this checkpoint was installed into the live checkout, and no authenticated live
acceptance workflow was run. Health responses alone must not be described as
acceptance of this checkpoint or completion of the platform.
