# AGENTS.md — Metabase

Full-stack BI app: Clojure backend (`src/`) + React 18/TS frontend (`frontend/src/metabase`) built into one JAR. Real repo root is `metabase/` (has `deps.edn`, `package.json`, `.git`).

## Setup

- Toolchain managed by `mise` (`mise.toml`): Java temurin-25, Clojure CLI, Babashka, Bun, Node 22 (`.nvmrc` = `v22.23.2`).
- New machine: `./bin/dev-install`, then `./bin/mage doctor`. Frontend deps: `bun install`.
- **Always use `bun`, never npm/yarn** (`preinstall` script exits otherwise). All `bun run` scripts auto-run `bun install` first; the `-pure` variants skip it.
- Dev servers: `bun run dev` (BE+FE hot reload), `bun run dev-ee` for Enterprise (`MB_EDITION=ee`). Split: `clojure -M:run` (BE, `:3000`) + `bun run build-hot` (FE, Rspack on `:8088`). EE backend: `clojure -M:run:ee:dev:dev-start --hot`.

## Backend (Clojure)

- Sources: `src/metabase/`, EE: `enterprise/backend/src/`, drivers: `modules/drivers/*/src`, tests colocated under `test/`, `enterprise/backend/test/`, `modules/drivers/*/test`.
- **Tests: never call `clj -X:dev:test` directly** (progress-bar output is unparseable). Use `./bin/test-agent`:
  ```bash
  ./bin/test-agent :only '[metabase.foo-test]'            # namespace
  ./bin/test-agent :only '[metabase.foo-test/some-test]'  # single test
  ./bin/test-agent :module query-processor                # module blast radius
  ./bin/test-agent --drivers=mysql,h2,postgres :module enterprise/workspaces
  ./bin/test-agent --oss :only '[metabase.foo-test]'      # without EE
  ```
- Driver tests default to `:h2` only; set `DRIVERS=h2,postgres,...` (or `--drivers=` flag) + `modules/drivers` aliases. Most drivers need live DBs — see `metabase.test.data.<driver>` for `MB_*_TEST_*` env vars.
- **Module boundaries are enforced** by `metabase.core.modules-test` against `.clj-kondo/config/modules/config.edn`. After adding/renaming a `src` ns or changing a cross-module `require`, run `./bin/mage fix-modules-config` (no-op if nothing drifted). Inspect with `./bin/mage modules-tree`. Child may use ancestor internals; parents/siblings must use target's `:api` (`:uses` required).
- Repo automation lives in `bb.edn` ("MAGE", Babashka): `./bin/mage ls` lists all tasks, every task supports `-h`. Key ones used below: `kondo`, `fix-modules-config`, `project-tests`, `kondo-ratchets`, `cljfmt-files`.
- Ratchets: after touching Kondo suppressions, run `./bin/mage kondo-ratchets`. Explain budget increases in PR; never record reductions in feature PRs. Merge conflicts in ratchet files: `./bin/merge-kondo-ratchets`.
- Checks: `./bin/mage kondo [path]`, `./bin/mage lint-migrations`, `./bin/mage project-tests [backend|migrations|modules|ratchets]`.
- Migrations: legacy `resources/migrations/*_update_migrations.yaml` (custom YAML merge driver via `.gitconfig`) + directory-based `resources/migrations/<major>/*_<description>.yaml` per migration. Scaffold with `./bin/mage new-migration <major> <snake_name>`.
- CI failures: `./bin/mage ci-report [PR|branch|sha] --detailed` pulls failed job logs + parsed test diffs from GitHub Actions. Local quick loop: `./bin/mage run-tests <ns|dir|test>` (uses dev nREPL; `ls` tasks via `./bin/mage ls`).
- Formatting via lint-staged: `./bin/mage cljfmt-files <path>` + `./bin/mage fix-unused-requires <path>`.
- REPL-first workflow; see `docs/developers-guide/devenv.md`. Clojure skills in `.claude/skills/` (`clojure-write`, `clojure-review`) hold style rules.

## Frontend (TypeScript)

- Read `frontend/CLAUDE.md` + `docs/developers-guide/frontend.md` before FE work. Load applicable `.claude/skills/` (`typescript-write` for any `.ts/.tsx` edit, `e2e-test-create`/`e2e-test` for Cypress, `analytics-events` for tracking, `emotion-migrate` when touching Emotion).
- Layout: app `frontend/src/metabase`, `frontend/src/metabase-lib`, `frontend/src/metabase-types`, `metabase/api` (RTK Query defs only — no business logic), `metabase/ui` (pure Mantine v8 display components, every addition needs a Storybook story). EE: `enterprise/frontend/src/` — **must use plugin system, never import EE code from OSS**.
- Styling: Mantine style props > CSS Modules. Emotion `styled`, global utility classes, literal colors (`black`, `#FFF`, `color-mix`) are banned — use `c`/`bg` props or `var(--mb-color-*)`. All user strings via `ttag` (`t\`\``), translate phrases not words.
- Verify (all need a prior `bun run build:cljs` unless using `-pure`/`-keep-cljs` in iteration):
  ```bash
  bun run test-unit-keep-cljs path/to/file.unit.spec.ts   # single FE unit test (colocated *.unit.spec.*)
  bun run test-unit-keep-cljs -t "pattern"
  bun run type-check-pure                                 # tsc --noEmit (full `type-check` rebuilds CLJS, slow)
  bun run lint-eslint-pure && bun run lint-format-pure    # full `lint` also runs doc-links/yaml/type-check
  bun run module-boundaries                               # FE import boundary check
  ```
- Unit tests colocated with source, `setup()` + `renderWithProviders` + `__support__/server-mocks` pattern. E2E in `e2e/test/scenarios/**/*.cy.spec.js` (never `*.unit.spec.js`).

## E2E (Cypress)

- Flow: `bun run build-hot` in one terminal, `bun run test-cypress [--spec <path>]` in another (runner builds its own backend on `:4000` with a temp H2 db). Headless: `CYPRESS_GUI=false`. EE: `MB_EDITION=ee` + premium tokens via `cypress.env.json`. Most suites need Docker (QA DBs, maildev, Snowplow micro); Apple Silicon Mongo needs OrbStack or `EXPERIMENTAL_DOCKER_DESKTOP_FORCE_QEMU=1`. Translation tests: `./bin/i18n/build-translation-resources` first. Flake-fix stress-testing: `.github/workflows/e2e-stress-test-flake-fix.yml` (workflow_dispatch).
- Never hardcode Sample DB IDs — import `SAMPLE_DATABASE` from `e2e/support/cypress_sample_database`. Reset state with `before(restore)` / `restore("blank")`. Translation tests need `./bin/i18n/build-translation-resources` first.

## CI / Hooks

- `bun run ci` = `ci-frontend` (`lint` + `test`) + `ci-backend` (eastwood + tests). `lint-staged` runs eslint + `oxfmt --write` + `verify-doc-links` (FE), `cljfmt-files` + `fix-unused-requires` (Clj), `validate-e2e-test-files.js` (scenarios), `mage -token-scan` on everything — do not commit suspected secrets.

## Nubrix / MicroStar Control Tower (`bin/nubrix/`)

- **Planner & Pipeline:** `bin/nubrix/fulfillment_planner.py` (`OrToolsFulfillmentPlanner`, `NearestSourceBaselinePlanner`), `adapters.py`, `domain_contract.py`, `poc_storage.py`, `run_snapshot_pipeline.py` (dry-run by default; `--publish` to write `nubrix_poc_*`), `what_if_simulator.py`, `grounded_ai.py`, `configure_control_tower.py` (dry-run by default; `--apply` for Dashboard 23).
- **Tests:**
  - Python suite: `../.venv/bin/python -m unittest discover -s bin/nubrix -p "test_*.py" -v`
  - Frontend map/legend safety: `bun run test-unit-keep-cljs frontend/src/metabase/visualizations/components/PinMap.unit.spec.tsx`
- **Safeguards:** Never mutate the 7 original Railway tables (`dimCustomer`, `dimProductSize`, `dimCarrier`, `KegOrder`, `ReportedInventory`, `FreightRoadDistance`, `FulfillmentAllocation`), never commit credentials/tokens, and build production JS locally (`bun run build-release:js`) before syncing `resources/frontend_client/app/dist` and `resources/frontend_client/*.html` to the VPS.
