# Project Prism — the Power BI-aligned NubrixAI Experience

**Design Document — v1.1 (Draft for team review)**
**Owner:** Platform / Frontend guild · **Status:** Awaiting team feedback (see §17 Open Questions)
**Scope:** Frontend IA, navigation, editors, terminology, AI experience. Backend intentionally untouched (except a thin, additive list in §13.4).
**Product:** NubrixAI (white-labeled Metabase fork, per-customer deployment — see §1.1)
**Supersedes:** the v1.0 copy exported to `docs/POWERBI_EXPERIENCE_REDESIGN_OPENCODE.md`

**v1.1 changelog (addressing the team review):**
1. §1.1 — NubrixAI platform identity, AI-sovereignty constraints, and the default-Metabase-backend stance (star-schema/pushdown framing deliberately removed — no customer-schema-specific engineering).
2. §7.6 — Instant cross-filtering (Power BI's most-loved interaction) specified in full: default-on runtime auto-wiring, edit-interactions, selection chips — making the Nubrix board report's "click-anywhere cross-filtering" promise literally true (verified in code: it is not true today).
3. §8.4 — **Transform Studio**: a complete Power Query-parity spec — Applied Steps pane, per-step preview caching, formula bar, column-header transformation menus — plus the Dataflows mapping onto the existing Transforms materialization subsystem (§9.3).
4. §10.5–10.6 — the three AI gaps: in-canvas Q&A visual, filter-aware dynamic Smart Narrative cards, and right-click outlier analysis ("Explain the increase/decrease"), all grounded in existing Metabot/interestingness machinery; plus AI sovereignty guardrails per Nubrix deployment rules.

---

## 0. How to use this document

This document is written so your team can mark it up directly. Every section ends with what is **decided** vs. what is **open**. Sections 14–17 are the ones to fill in during the team review workshop. Appendix A maps every new UX element to the *exact existing component in this codebase*, so engineers can estimate against reality, not against hope.

A note on what this codebase is: this checkout is a **heavily restructured Metabase fork** (namespace-per-module backend, a new Data Studio area, a Metabot agent stack with ~35 tools, MCP server, Agent API, semantic search). Some of the "Power BI-like" things we need already exist in embryo here (Data Studio ≈ Fabric data experiences; `metrics-viewer` ≈ Power BI Metrics; Metabot ≈ Copilot; content verification ≈ Certified datasets). The plan below is therefore mostly **recomposition and re-skinning of existing machinery**, not a rewrite.

---

## 1. Executive summary

**Problem.** A team of long-time Power BI users finds Metabase's navigation and editing model disorienting. The pain is not capability — Metabase matches or exceeds Power BI on visualization depth, AI, and openness — it is **wayfinding and mental model**: where things live, what things are called, and where the editing controls sit.

**Proposal.** Introduce a **Power BI-aligned experience layer** over the existing product:

1. **A Power BI-style global left rail** (Home / Browse / Data / Create / Apps / Workspaces / Metrics / Copilot / Learn) replacing the current "everything-is-a-collection-tree" sidebar.
2. **"Workspaces"** — a Power BI-style workspace landing experience on top of Collections (tabbed content lists: Reports, Semantic models, Queries, Automations…), with the four PBI roles (Admin/Member/Contributor/Viewer) surfaced explicitly.
3. **A Report Designer** — dashboards become "Reports", edited in a Power BI Desktop-style surface: a **ribbon** on top, **left view rail** (Report / Model / Table / SQL), **right panes** (Visualizations, Format, Fields, Filters with visual/page/report-level hierarchy), drag-drop canvas, and **instant cross-filtering on by default** — click a bar, every visual re-slices, zero configuration (§7.6; the Nubrix board report already promises this — today the code requires per-card setup).
4. **A Visual Editor** — questions become "Visuals", edited with a Power BI-style right pane: chart-type gallery, **field wells** (X / Y / Legend / Values / Tooltips), a deep Format pane built on the existing ChartSettings widget system, and **Transform Studio** — a full Power Query experience: Applied Steps pane, per-step preview caching, formula bar, and column-header transformation menus (§8.4).
5. **A Copilot experience** — the already-impressive Metabot agent (streaming chat, ~35 tools, NL→SQL, chart analysis, insight generation, semantic search) surfaced as a persistent, context-aware **Copilot pane** in the Power BI style, with "Summarize this visual", "Build me a page", and smart-narrative text cards.
6. **A terminology layer** — Power BI terms ("Report", "Workspace", "Semantic model") delivered **without renaming a single msgid**, via a ttag pseudo-locale pack (§4). Fully reversible, zero backend change, works for all English UI.

**Non-goals.** No backend data model changes, no API rewrites, no removal of existing features, embeds stay on the current chrome (§13.3), the command palette stays for power users.

**Cost shape.** 6 phases, ~70–80% frontend, using a per-user feature flag so both experiences coexist during transition. Backend work is limited to two optional items (§13.4).

### 1.1 Platform context — this is NubrixAI, not stock Metabase

This design targets **NubrixAI** — Revive Analytics' white-labeled, per-customer deployment of the Metabase codebase (deployed for MicroStar Logistics; see `docs/nubrix/NUBRIX_BOARD_REPORT.md`). Three platform facts become design constraints:

1. **Sovereignty is a promise to clients.** NubrixAI ships as one container in the customer's VPC, talking only to their database and — optionally — a customer-chosen AI endpoint (self-hosted OpenAI-compatible servers such as vLLM are first-class: `src/metabase/metabot/self/vllm.clj`; provider registry in `src/metabase/llm/provider.clj`). **Every AI feature in this plan routes exclusively through the admin-configured provider** — no external SaaS calls, ever (§10.6). This is also a sales asset: "Copilot inside your VPC" is something Power BI's cloud cannot offer.
2. **The board report's promises must be true on screen.** `NUBRIX_BOARD_REPORT.md` advertises "click-anywhere cross-filtering", AI answers with a **"Show SQL" verification badge**, dashboard summarization / chart explanation, and the MCP bridge to GitHub Copilot/Claude/Cursor. The code audit shows cross-filtering today requires per-card configuration plus pre-wired parameters (§7.6) — this redesign closes that gap and makes the brochure real.
3. **Default Metabase backend, deliberately.** Per product decision: **no star-schema-specific, pushdown-specific, or customer-schema-specific engineering**. The board report's "star schema pushdown" language describes MicroStar's schema shape and the standard MBQL→SQL compilation — not an engine feature we build on. This design compiles everything through Metabase's standard query pipeline, so it stays valid for **every** Nubrix client (MySQL today, the other 20+ drivers tomorrow) and keeps upstream mergeability intact.

Where the board report's framing and this design differ, this design wins — the board narrative describes outcomes; we specify the mechanics that produce them.

---

## 2. Context: assessment of the codebase as it stands

### 2.1 Architecture snapshot

| Area | Where it lives | State |
|---|---|---|
| Global chrome | `frontend/src/metabase/AppComponent.tsx`, `app/nav/AppBar.tsx`, `app/nav/Navbar.tsx`, visibility brain in `app/selectors.ts` (`getIsNavBarEnabled`, `PATHS_WITHOUT_NAVBAR`, `getIsCollectionPathVisible`) | Two toggleable layers (top `AppBar` + left `Navbar`), driven by URL selectors. Clean seams for replacement. |
| Left sidebar today | `nav/containers/MainNavbar/MainNavbarContainer/MainNavbarView.tsx` | IA: Home → Getting started → Bookmarks → Library → **Collections tree** → Data apps → Data (Browse) → Trash. Width 324px (`nav/constants.ts`). The tree is the main source of "navigation is confusing" complaints: content, admin surfaces and data are interleaved in one endless tree. |
| Search | kbar command palette (`AppKBarProvider.tsx`, `palette/`), full-page `/search` (`search/containers/SearchApp.tsx`), `SearchButton` in app bar | Powerful, but **hidden behind a modal** — PBI users expect a visible search box. |
| Collections | `collections/components/CollectionLanding/`, `CollectionContent/CollectionContentView.tsx`, `CollectionItemsTable.tsx`, `CollectionHeader/` | Flat list + pinned grid. No PBI-style tabbed content segregation, no role surface. |
| Dashboards | `dashboard/containers/DashboardApp/`, `Dashboard.tsx`, editing actions in `dashboard/components/DashboardHeader/DashboardHeaderButtonRow/constants.ts` (verified: `ADD_QUESTION, ADD_HEADING_OR_TEXT, ADD_LINK_CARD, ADD_SECTION, ADD_FILTER_PARAMETER, ADD_ACTION_ELEMENT` …), right sidebars via `DashboardSidebars.tsx` + `common/components/Sidebar/Sidebar.tsx` (384px), grid via `react-grid-layout` (`dashboard/components/grid/GridLayout.tsx`) | Canvas engine (drag/resize/snap) is **already PBI-grade**. Editing controls are a floating button row, not a ribbon; per-card formatting opens in a 95%-width modal (`DashboardChartSettings.tsx`) instead of a pane. Filters are parameters wired per-card — functionally equivalent to PBI levels, but presented as a different mental model. |
| Questions | `query_builder/containers/QueryBuilder.tsx` → `view/View/View.tsx`; left sidebar = ChartType (`ChartTypeSidebar/`) + Chart Settings (`ChartSettingsSidebar.tsx`, tabs Data → Columns → Display → Axes → Ranges → Formatting via `useChartSettingsSections`); right sidebar = Summarize / Data reference / Snippets / Tags; notebook steps in `querying/notebook/` (data, join, expression, filter, summarize, sort, limit); SQL editor in `querying/components/NativeQueryEditor/` (CodeMirror 6) | All the machinery for a PBI-style editor exists; the **layout is inverted vs. Power BI** (chart type on the left, toggled from the footer) and split across footer buttons + two sidebars. |
| AI | `frontend/src/metabase/metabot/` (`Metabot.tsx` right sidebar, `MetabotChat/`, inline SQL prompt in `ViewNativeQueryEditor.tsx`, `FixSqlQueryButton`, `MetabotAsk`, page-context registry `metabot/context.tsx`); backend `src/metabase/metabot/` (agent streaming SSE, ~35 tools incl. `sql/*`, `construct`, `analyze_chart`, `autogen_dashboard`, `generate_insights`, `entity_retrieval`, `save_entity`), `src/metabase/llm/` (provider abstraction: Anthropic/OpenAI/Bedrock/Azure/…), `src/metabase/mcp/` (MCP server), `src/metabase/agent_api/`, EE semantic search (pgvector), `src/metabase/contextual_interestingness/` | **Best-in-class foundations**. The gap vs. Copilot is presentation: context is registered but not *shown*; tools exist but aren't packaged as PBI-style affordances. |
| Data | Data Studio area (`frontend/src/metabase/data-studio/`: data-model, measures, segments, query-builder, transforms, glossary, guide, settings), `browse/` pages, EE `schema_viewer` (ER diagrams), backend `src/metabase/typed_schemas/` | A PBI "Model view" experience is **already 70% built** across these surfaces — it needs unification, not creation. |
| Metrics | `metrics/` app + `metrics-viewer/` (dimension pickers, breakout pickers, chart layout controls) | `metrics-viewer` is already a credible PBI Metrics-style analyzer. |

### 2.2 Why Power BI users struggle today (diagnosis)

1. **One infinite tree.** PBI separates *navigation* (rail) from *content* (workspace list) from *data* (OneLake/Data hub). Metabase blends all three in one scrolling sidebar.
2. **Terminology mismatch.** PBI: Workspace / Report / Semantic model / Measure. Metabase: Collection / Dashboard / Model / Metric. Every conversation requires translation.
3. **Editor layout inverted.** PBI Desktop puts Visualizations + Fields on the right, always visible, with the chart-type gallery as icons at the top of the pane. Metabase hides chart type behind a footer button opening a *left* sidebar.
4. **No filter hierarchy.** PBI's Filters pane (Report / Page / Visual levels) is the single most-used editor surface. Metabase scatters this across parameter sidebars and per-card modals.
5. **No ribbon.** PBI's ribbon (Home / Insert / contextual Format) gives predictable, discoverable commands. Metabase's edit mode uses a floating button row + hover menus on cards.
6. **Search is hidden.** PBI has an always-visible search box; Metabase's is a modal command palette (great for power users, invisible to newcomers).
7. **No instant cross-filtering.** PBI's signature interaction — click any visual, siblings re-slice — requires, in this codebase, pre-created parameters, per-card click-behavior config, and parameter mappings (§7.6). Notably, the Nubrix board report already promises "click-anywhere cross-filtering" to clients — the product must catch up to its own brochure.
8. **No Power Query.** The team's bread-and-butter surface — Applied Steps, per-step data previews, formula bar, column-header transformation menus (Split Column, Replace Values, Change Type, Fill Down) — has no equivalent presentation. The machinery (notebook steps + per-step `Lib.previewQuery`) exists, but it is hidden behind a mode toggle with no step-preview loop, no formula bar, and no column menus (§8.4).

### 2.3 What already maps beautifully to Power BI (inventory to build on)

| Power BI concept | Already in this codebase |
|---|---|
| Workspaces + roles | Collections + granular permissions (`CollectionPermissionsModal`, admin permissions app) + EE official collections & tenants |
| Certified datasets | Content verification (`content_verification`, `PLUGIN_CONTENT_VERIFICATION` verified badges) |
| Apps | Metabase Apps (EE data apps) |
| Metrics scorecards | `metrics-viewer/` |
| Copilot | Metabot agent stack (streaming, tools, MCP, Agent API, Slack) |
| Semantic model relationships | EE `schema_viewer` ER diagrams + `typed_schemas` REST + joins metadata |
| Power Query | Notebook steps (filter/join/expression/summarize/sort/limit) |
| DAX query view | SQL editor with snippets, autocomplete, AI NL→SQL |
| Smart narratives | `metabot` document `generate-content` + rich-text Documents |
| Anomaly/insight nudges | `interestingness` + `contextual_interestingness` (LLM-scored) + X-ray auto-dashboards |

---

## 3. Goals, non-goals, principles

### 3.1 Goals

1. A Power BI-literate analyst can find, open, edit, and publish content **without training** — validated by a usability test with the team (§15.3).
2. 100% of current functionality remains reachable in the new experience (feature-parity checklist as exit criterion per phase).
3. Power BI terminology as the default user-facing language for this deployment, without forking the translation system.
4. Editing surfaces match PBI Desktop's pane model: ribbon + left view rail + right panes (Visualizations / Format / Fields / Filters).
5. Copilot visible and useful in every surface, with the existing agent backend.

### 3.2 Non-goals

- No changes to query processor, permissions engine, or storage (the "backend majorly same" constraint).
- No reimplementation of the dashboard grid, chart renderers, or CodeMirror editor.
- No breaking of embeds, SDK, public links, or the classic experience (both coexist under a flag).
- No rename of URL slugs or API entities — **URLs stay identical** (`/dashboard/…`, `/question/…`, `/collection/…`), so links, bookmarks, and Slack posts never break.

### 3.3 Principles

1. **Recompose, don't rewrite.** Every new pane must name the existing component it wraps (Appendix A enforces this).
2. **Muscle memory over novelty.** Where PBI has a convention (ribbon tabs, pane order, filter levels), copy it — even where Metabase's current UX is arguably cleaner.
3. **Reversibility.** Per-user flag (`navigation-experience`: `classic` | `pbi`), default `classic` until the team opts in. Terminology, chrome, and editors each ship behind the same flag.
4. **EE via plugins.** Anything touching official collections, tenants, verification, schema viewer goes through `PLUGIN_*` slots (`frontend/src/metabase/plugins/oss/`), never OSS→EE imports.
5. **Repo rules are law.** Mantine style props only, every new `metabase/ui` component gets a Storybook story, module-boundaries entries for new modules, colocated `*.unit.spec.tsx`, ttag for all strings.

---

## 4. Terminology system — "the language pack"

### 4.1 The mapping

| Power BI term | This deployment displays | Underlying Metabase entity | Notes |
|---|---|---|---|
| Workspace | **Workspace** | Collection | Top-level collections are "Workspaces"; nested are "Folders" |
| Report | **Report** | Dashboard | PBI Reports = multi-page canvases; Metabase dashboard tabs = report pages |
| Page | **Page** | Dashboard tab | Already supported (`DashboardTabs`) |
| Visual | **Visual** | Question / Card | "Saved question" → "Visual"; "chart" informally |
| Semantic model | **Semantic model** | Model (`Card` with `type: model`) | Matches current Power BI marketing language |
| Measure | **Measure** | Measure (`data-studio/measures`) + Metric | The new Measure entity exists already |
| Transform data (Power Query) | **Transform** | Notebook steps | |
| DAX query / SQL | **SQL query** | Native question | |
| Fields | **Fields** | Table columns / model fields | |
| Filters (Visual/Page/Report) | **Filters** | Card top-level filters / tab-scoped parameters / dashboard parameters | §7.4 |
| Certified | **Verified** | Content verification (EE) | PBI "certified dataset" ≈ verified model |
| Metrics (scorecards) | **Metrics** | `metrics-viewer` + Metric definitions | |
| Copilot | **Copilot** | Metabot | Rename display only; keep "AI" settings naming consistent |
| Apps | **Apps** | Metabase Apps (EE) | |
| Get data | **Add data** | `AddDataModal` | Existing name is fine |
| Lineage view | **Lineage** | EE dependencies | |
| Data hub / OneLake | **Data** | Data Studio + `/browse` | §9 |
| Refresh | **Refresh** | Model persistence / sync | |
| Admin portal | **Admin** | `/admin` | |
| Alerts, Subscriptions | **Alerts**, **Subscriptions** | Same entities | No change |

### 4.2 Implementation: terminology as a pseudo-locale (no msgid changes)

The repo's i18n is ttag (`t\`\`` everywhere; localization loaded in `frontend/src/metabase/utils/i18n.ts` via `setLocalization()`). **There is no terminology-override mechanism** — and we will not add string renames in code, because that would orphan every existing translation and violate the "translate phrases, not words" rule.

Instead: a **terminology pack is a locale.** ttag resolves translations by msgid; a locale can override the *English* msgstrs for a curated list of msgids ("Dashboard" → "Report", "Saved question" → "Saved visual", …). What we build:

1. `frontend/terminology/powerbi.yaml` — reviewed list of overrides (msgid + optional ttag context → new msgstr).
2. `bin/i18n/build-terminology-locale.mjs` — compiles the YAML into a ttag locale object; run in the FE build pipeline (extends the existing i18n build family in `bin/i18n/`).
3. `frontend/src/metabase/utils/i18n.ts` — after `setLocalization()`, if the user's `navigation-experience` is `pbi`, apply the pack via ttag's `addLocale`/`useLocale` (same mechanism already used for site/user locale switching).
4. Gaps where a PBI word requires *different UI copy* (not just a noun swap) are handled per-screen in the redesigned components themselves (new `t\`\`` strings written PBI-first; the pack maps *old* screens).

**Why this wins:** zero backend change; existing translations unaffected (the pack only overrides the `en` base); per-user reversible; the pack is reviewable in one YAML file your team can edit; and the classic experience keeps Metabase terminology.

**Decided:** pseudo-locale approach. **Open:** exact override list (workshop item #1 — fill Appendix B with your team's preferred words).

---

## 5. Target information architecture — the global shell

### 5.1 The left rail (Power BI Service model)

Mirrors the PBI service navigation pane (verified against Microsoft Learn, Sept 2026: Home, Browse, OneLake, Create, Apps, Workspaces, Metrics, Copilot, Learn):

```
┌─────────────────────────────┐
│  ⌂ Home                     │ → `/`            (existing HomePage, restyled §6.4)
│  ⌗ Browse                    │ → `/search`      (PBI "Browse": recents/favorites/shared tabs)
│  ◫ Data                     │ → Data hub §9    (semantic models, databases, lineage)
│  ＋ Create ▸                │ → NewItemMenu    (Report / Visual / SQL / Semantic model / Upload)
│  ▦ Apps                     │ → EE data apps
│  ▤ Workspaces               │ → pinned workspaces list + “All workspaces” page
│     ├ Sales                 │
│     ├ Finance               │
│     └ …                      │
│  📈 Metrics                 │ → `/explore`     (existing metrics-viewer)
│  ✨ Copilot                 │ → opens Copilot pane (§10)
│  🎓 Learn                   │ → `/getting-started` + docs
├─────────────────────────────┤
│  ⚙ Admin  ·  ♻ Trash        │ → `/admin`, `/trash`
│  [avatar]  Aisha            │ → profile menu (existing AppSwitcher content)
└─────────────────────────────┘
   (collapsible: 56px icon rail ↔ 220px expanded; persisted user setting,
    same pattern as current `expand-*` user settings)
```

Key structural decisions vs. today:

- **The collection tree disappears from the rail.** Workspaces appear as a flat, pinned, drag-reorderable list (reuse `BookmarkList.tsx` drag machinery). Deep hierarchy lives *inside* the workspace page (§6), like PBI — PBI has no tree in the rail.
- **Bookmarks fold into Browse/Home** (PBI treats "Favorites" as a Browse tab + Home section). The `BookmarkList` component is reused for "Favorites" content.
- **"Getting started" and examples move under Learn**, out of the main flow.
- **Trash and Admin pin to the rail bottom** (PBI users expect the gear at the bottom edge).

### 5.2 Top bar

Keep the existing `AppBarLarge.tsx` skeleton (logo, breadcrumbs, user menu) with three PBI-style changes:

1. **Persistent omnibox**: replace `SearchButton` with an inline search input (`SearchBar.tsx` already exists for embeds — promote it to OSS chrome) that, on focus, opens the existing kbar `Palette`. Typeahead results come from the same `useSearchQuery` pipeline; if EE semantic search is enabled, it enriches results. ⌘K still works.
2. **"Create" (＋ New)** stays top-right, but the menu is reorganized PBI-style with grouping and icons: *Blank report / Blank visual / SQL query / Semantic model / Upload data* — backed by the existing `NewItemMenu` + `NewModals` infrastructure.
3. **Copilot button** (`MetabotAppBarButton` already exists) promoted next to Create.

Breadcrumbs stay (`CollectionBreadcrumbs` — with the terminology pack they read "Workspaces / Sales / Revenue report").

### 5.3 What does NOT change

- All routes/URLs (`frontend/src/metabase/routes.tsx` untouched as a tree — the rail only links to existing routes, plus one new page §6.2).
- Visibility logic in `app/selectors.ts` — the new rail is a drop-in replacement rendered by `Navbar`, behind the same `getIsNavBarEnabled` gates, so all the embed/admin/edit-mode exceptions keep working.
- The admin navbar, Data Studio/Monitor/Embedding-hub areas keep their `AreaLayout` shells — they already follow the PBI pattern (icon rail + collapsible nav + tabs).

### 5.4 Component plan (rail)

| New component | Wraps / reuses |
|---|---|
| `nav/containers/PbiRail/PbiRail.tsx` (+ `.unit.spec.tsx`) | `SidebarLink`, `SidebarCollectionLink` (workspace list), `BookmarkList` drag logic, `useUserSetting` for collapsed state |
| `nav/containers/PbiRail/RailSection.tsx`, `RailItem.tsx` | Mantine `NavLink`, `Tooltip` (display-only → candidates for `metabase/ui` promotion with stories) |
| Omnibox | `SearchBar.tsx` + `AppKBarProvider` + `palette/useCommandPalette` |

`MainNavbar` stays for `classic` mode. The flag switch lives in `app/nav/Navbar.tsx` — a one-file diff.

---

## 6. Workspace experience (Collections → Workspaces)

### 6.1 Workspace landing (PBI workspace list view)

Power BI workspace pages are tabbed content lists with filter chips and list/grid toggles. Metabase has the raw materials (`CollectionContentView`, `CollectionItemsTable`, `CollectionItemsToolbar`, `CollectionTypeFilter`, `PinnedItemsGrid`, `CollectionBulkActions`). We add:

```
┌─ Sales ───────────────────────────────────────────────────────────────┐
│ Sales                                    [Verified] ⭐  ⊕ New ▾  ⋯    │
│ All company revenue reporting                     [Admins: Ana, Dan] │
├───────────────────────────────────────────────────────────────────────┤
│ Reports | Visuals | Semantic models | Queries | Automations | Files    │
│ 🔍 Search…   ◫ All types   ✓ Verified only   ↕ Sorted by: Modified    │
│ [⧉ Grid] [☰ List]                                                    │
├───────────────────────────────────────────────────────────────────────┤
│ ▣ Revenue report            Report   Modified 2h ago   by Ana    ⋯    │
│ ▣ Pipeline by region        Report   Modified yesterday by Dan   ⋯    │
│ ▣ Orders (semantic model)   Model    Verified ✓         by Ana    ⋯    │
│ ▣ Churn SQL                 Query    …                         ⋯    │
└───────────────────────────────────────────────────────────────────────┘
```

- **Tabs** = content-type filters on the existing items query (backend already supports type filtering — `useListCollectionItemsQuery`).
- **Filter chips + sort + list/grid toggle** rewrap existing toolbar components.
- **Workspace info header**: reuse `CollectionHeader` + EE `CollectionCaption` (verified/official badges become the PBI "certified" surface), plus the contact list concept — surfaced from existing permissions data.
- **Roles**: an explicit "Manage access" entry point mapping PBI's Admin/Member/Contributor/Viewer onto existing permission groups — presented with the PBI labels *in the UI copy* while writing native Metabase permissions underneath (translation table in the modal; the underlying permission model is untouched).
- Sub-collections display as "Folders" rows; the tree lives here, not in the rail.

### 6.2 "All workspaces" page

One new page — `WorkspacesListPage` (new route `/workspaces`): card grid of top-level collections with role badges, pinned/recent first, "＋ New workspace" (existing `CreateCollectionModal`). Reuses `BrowseGrid`/`BrowseCard` components.

### 6.3 Home (PBI Home)

The existing `HomePage` restyled into PBI Home sections: **Favorites** (bookmarks), **Recents** (`useListRecentsQuery` — already exists for search), **Recommended** (X-ray suggestions — `/auto/dashboard` infra), **Shared with me** (personal collections of others — exists via "Other users' personal collections"). Mostly composition of existing data hooks.

### 6.4 Decided vs open

**Decided:** tabbed workspace list, folders-not-tree, roles surfacing. **Open:** whether Automations tab includes scheduled subscriptions + alerts together; whether Files (CSV uploads) deserve their own tab (workshop item #2).

---

## 7. The Report Designer (PBI Desktop-style editing)

*The centerpiece. "Report" = Metabase dashboard. Nothing about persistence changes: `dashboard/actions/save.ts → updateDashboardAndCards → PUT /api/dashboard/:id` stays exactly as is.*

### 7.1 Layout — PBI Desktop model

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Ribbon:  File | Home | Insert | View | Format*            [Reading ▾] [Save] │
├───┬──────────────────────────────────────────────────────┬───────────────────┤
│ V │  Report: Revenue ─ Pages: [Overview][Q3][Detail][＋]  │ PBI RIGHT PANES   │
│ i │                                                       │ ┌───────────────┐ │
│ e │                                                       │ │ Visualizations│ │
│ w │              ╔═══════════════╗   ╔═══════════════╗    │ │ ▤ ▥ ◫ ▤ ▥ ◫ … │ │
│ s │              ║  Bar chart     ║   ║  KPI card      ║   │ ├───────────────┤ │
│   │              ║  (selected)    ║   ║               ║    │ │ Format / Fields│ │
│ R │              ╚═══════════════╝   ╚═══════════════╝    │ │ / Filters tabs │ │
│ e │                                                       │ │ (§7.3)        │ │
│ p │                                                       │ └───────────────┘ │
│ o │                                                       │ ┌───────────────┐ │
│ r │                                                       │ │ Fields pane   │ │
│ t │                                                       │ │ ▸ Orders      │ │
│ M │                                                       │ │ ▸ Products    │ │
│ o │  [ ✨ Copilot: “Add a page comparing Q3 vs Q2” ]       │ └───────────────┘ │
│ d │                                                       │                   │
├───┴──────────────────────────────────────────────────────┴───────────────────┤
│ status: saved 12:04 · refresh · auto-refresh · zoom                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Left view rail** (PBI's Report/Model/Table/DAX selector): **Report** (dashboard canvas) · **Model** (§9.1 semantic model of this report's sources) · **Table** (§9.2 data view of underlying model) · **SQL** (open the report's underlying native question in the SQL view). This is a thin navigator over existing pages — a new `ViewRail.tsx`, not new functionality.
- **Reading/Edit toggle** = PBI's Reading view vs. Edit — replaces the current "You're editing this dashboard" bar. Existing `isEditing` context (`dashboard/context/context.tsx`) is the state; only presentation changes.
- **Pages** = existing `DashboardTabs`.
- **Copilot dock** at the canvas edge (§10).

### 7.2 Ribbon

A `Ribbon.tsx` with tab groups; contextual **Format** tab appears when a visual is selected (PBI behavior). All commands are rebindings of existing actions:

| Ribbon tab | Commands (source action) |
|---|---|
| Home | New visual (`toggleSidebar(addQuestion)` → new blank visual), Text, Image, Link card, Section, Filter, Action, Undo/Redo, Save (`saveDashboard`) |
| Insert | Same insert set + "Copilot visual" (AI-generated), Buttons (link cards), Text box |
| View | Reading/Edit toggle, Fullscreen, Auto-refresh indicator, Tab bar visibility, Performance overlay |
| Format *(contextual)* | Opens the right panes scoped to selection: Format (viz settings), Filters (§7.4), Click behavior (`showClickBehaviorSidebar`) |
| File *(menu)* | Rename (dashboard settings sidebar), Move, Duplicate, Archive, Subscriptions, Embed, History (all existing modal routes under `/dashboard/:slug/*`) |

Data source: extend `DashboardHeaderButtonRow/constants.ts`'s `DASHBOARD_EDITING_ACTIONS` pattern into a ribbon schema (pure data structure → renders via one `RibbonTab` component; buttons remain the same connected components where possible).

### 7.3 Right panes (the PBI pane stack)

One new shell — `ReportPanes.tsx` — replacing today's scattered combination of `DashboardSidebars.tsx` (384px `Sidebar`), the `DashboardChartSettings` 95% modal, and hover-only `DashCardActionsPanel`. PBI ordering: **Visualizations (chart gallery) → Format → Filters**, with **Fields** below:

1. **Visualizations pane** — icon gallery = `ChartTypeSidebar`'s `ChartTypeList` content (`getSensibleVisualizations` from `viz-core/lib/sensibility.ts`), restyled as PBI's icon grid, with the "clear + build from scratch" area underneath.
2. **Format pane** — the big win. `DashboardChartSettings` currently opens as a modal; its left half (`BaseChartSettings`) becomes the **Format pane body** with a live preview canvas beside it (reuse `ChartSettingsVisualization`). PBI's collapsible section groups (Visual → General → Title → Colors…) map 1:1 onto `useChartSettingsSections` tabs (Data / Columns / Display / Axes / Ranges / Formatting) — restyled as PBI-style nested accordions. **Zero new settings widgets** — the ~40 controls in `visualizations/components/settings/` render as-is.
3. **Filters pane** — §7.4.
4. **Fields pane** — the report's available data: models/tables feeding its cards (from `useListCollectionItemsQuery` + card query metadata), powering drag-to-add. `AddCardSidebar` (existing question picker) is the "Your visuals" tab; a new "Semantic models" tab lists usable models (existing `QuestionPicker`/`DataPicker` components).
5. On selection of a visual: panes scope to it (selection state already exists via `setDashCardAttributes`); unselected: report-level (PBI "Format report background" ≈ existing `DashboardSettingsSidebar`).

### 7.4 Filters pane — the three levels

Power BI's most-missed surface. We present Metabase's existing filtering machinery in PBI's hierarchy — **backend unchanged**, and parameter semantics are exactly what PBI levels mean:

| PBI level | Metabase mechanism (existing) | UX |
|---|---|---|
| **Visual-level filters** | The card's own query top-level filters (MBQL `:filter`, or native `WHERE`) | Shown when a visual is selected: "Filters on this visual"; edit via existing filter popovers |
| **Page-level filters** | Dashboard parameters scoped to the current tab | "Filters on this page"; the existing `ParameterSidebar` + `ParameterLinkedFilters` content, restyled |
| **Report-level filters** | Dashboard parameters on all tabs | "Filters on all pages"; same components |

- The **Fields pane drag-to-filter** affordance reuses `auto-wire-parameters` (`dashboard/actions/auto-wire-parameters/`) for the "drop a field here to filter everything using it" behavior.
- View mode keeps the current `DashboardParameterPanel` filter bar (familiar and good).
- ⚠️ **Verify during Phase 4:** whether tab-scoped parameters are fully supported in this build (`DashboardTabs` + parameter `tab_id` scoping). If partial, page-level filters degrade gracefully to explicit per-tab mapping via the existing mapper UI (`DashCardParameterMapper`).

### 7.5 Canvas & interactions

- Keep `react-grid-layout` (`GridLayout.tsx`) — do not touch the engine.
- PBI-style polish (all display-layer): selection outline + handles, multi-select (shift-click), align/distribute toolbar on multi-select, snapping guides (visual overlay computed from grid positions), card zoom (PBI "focus mode" ≈ existing zoom-in-row / `ObjectDetailSidesheet` patterns).
- Drill-through stays as-is (`ClickActionsPopover` + drills in `querying/drills/` — already better than PBI's drill-through for exploration).
- **Smart narrative**: a new "AI summary" text card type — implemented as a rich-text Document card pre-filled by the metabot `document/generate-content` endpoint, analyzing the selected visual(s). Backend exists; the card type is FE composition.

### 7.6 Instant cross-filtering & canvas interactions (Power BI's most-loved feature)

Power BI users expect: *click a bar → every visual on the page instantly re-slices; click again → unfiltered.* This is the single most-missed interaction in the team's feedback — and, per §1.1, a promise the Nubrix board report already makes to clients.

**What exists today (verified in code).** Crossfilter is a *configured* click behavior: it requires (a) a dashboard filter parameter to already exist (`TypeSelector.tsx` disables the crossfilter option when the dashboard has zero parameters), (b) per-card `crossfilter` config via the Click Behavior sidebar (`CrossfilterOptions.tsx` + `ClickMappings.tsx`), and (c) `parameter_mappings` from the parameter to each target card's field. The virtual default for a card with no click behavior is the drill menu (`actionMenu`). Crucially, the right primitives already exist: **toggle semantics** (click sets, click-again clears — `setOrUnsetParameterValues` in `dashboard/actions/parameters.tsx`), the **card refetch pipeline** (`fetchDashboardCardData` with dedup/stale-abort), **empty-region clearing** (`ChoroplethMap.utils.ts`), and the **auto-wire matcher** (`dashboard/actions/auto-wire-parameters/`) — though that matcher today only runs in edit mode as a toast.

**The design — "Live cross-filtering", default-on in pbi mode:**

1. **Zero-config click → filter.** In view mode, clicking a data point (chart mark, table cell, map region) runs the **auto-wire matcher at read-time**: the clicked column is matched against mappable fields on sibling visuals, and cards with a confident match receive a **transient filter value** through the existing parameter-value pipeline → refetch. No parameter widget needs to exist; nothing is persisted; no backend.
2. **Click-again-to-clear.** Reuses the existing toggle semantics in `setOrUnsetParameterValues` (identical values clicked → unset; required parameters fall back to their default — PBI's exact behavior).
3. **Selection chips.** A slim chip bar above the canvas shows each live filter ("Customer = Acme ✕"), individually dismissible and collectively clearable — PBI's cross-highlight bar. If a real dashboard parameter already exists for the field, the click routes to it via the existing `crossfilter` path instead, so the filter also appears in the persistent filter bar.
4. **Edit interactions** (PBI: Format → Edit interactions). An editing mode that draws target icons on each visual — **Filter / Highlight / None** per source — giving authors control over over-eager filtering. Stored as opaque display config in the dashcard's `visualization_settings` (the backend stores visualization_settings verbatim — no schema change); the runtime matcher respects it.
5. **Visual feedback.** Refetch is the mechanism (today's engine); for chart types whose full result set is client-side we additionally dim non-matching marks — pure display layer, no extra query.
6. **Left-click behavior is preserved.** The drill-through menu (`ClickActionsPopover` + the full drill suite in `querying/drills/` — already richer than PBI's drill-through) still opens on click; the live filter applies alongside it. Where an author has configured an explicit click behavior, that behavior wins — live cross-filter only *replaces the default `actionMenu`-and-nothing-else behavior* in pbi mode.

**Backend: zero.** Parameter values, toggle semantics, refetch, auto-wire matching, and settings storage all exist today — this is a presentation + runtime-composition change over existing actions.

### 7.7 What this means for the existing dashboard code

| Existing | Fate |
|---|---|
| `DashboardHeaderButtonRow` | Replaced by ribbon (constants schema reused) |
| `DashboardSidebars.tsx` | Becomes `ReportPanes.tsx` — same switch, new shell; existing sidebars become pane bodies |
| `DashboardChartSettings` modal | Splits: settings body → Format pane; keep modal for narrow screens |
| `AddCardSidebar` | Becomes Fields pane tab |
| `ParameterSidebar`/`ParameterLinkedFilters` | Become Filters pane content |
| `ClickBehaviorSidebar` | Becomes a Format-tab drawer (content unchanged) |
| `DashboardApp`, grid, save pipeline, tabs, undo | **Untouched** |

---

## 8. The Visual Editor (Questions → Visuals)

*"Visual" = saved question. The Query Builder's machinery stays; the chrome becomes PBI's single-right-pane model.*

### 8.1 Layout

```
┌────────────────────────────────────────────────────────────────────┐
│ Ribbon: Home (Run ▸ Save ▸ Download) | Transform | View            │
├──────────────────────────────────────────────┬─────────────────────┤
│  Orders by month (Visual)                    │ [Build|Format|Filters]│
│                                              │ ┌───────────────────┐ │
│        ╔════════════════════════╗            │ │ Build:           │ │
│        ║   chart canvas         │            │ │ ▤ ▥ ◫ … gallery  │ │
│        ║   (QueryVisualization) │            │ │ ───────────────  │ │
│        ╚════════════════════════╝            │ │ X: [Created At]  │ │
│                                              │ │ Y: [Count]       │ │
│  [ ✨ Copilot: “Explain the dip in June” ]    │ │ Legend: —        │ │
│                                              │ │ Tooltips: —       │ │
│                                              │ └───────────────────┘ │
├──────────────────────────────────────────────┴─────────────────────┤
│ SQL/Notebook editor (collapsible bottom drawer) · rows 1–200 · ⏱ 0.4s │
└────────────────────────────────────────────────────────────────────┘
```

- **One right pane, three tabs** (PBI's Visualizations pane tabs: *Build / Format / Filters-ish*): replaces today's left sidebar (ChartType + ChartSettings) + right sidebar (Summarize) split. `View.tsx`'s `ViewSidebar` infra (left/right sliding asides) is re-composed into one right `aside`; the left sidebar is retired in `pbi` mode.
- **Bottom drawer** for the notebook or SQL editor (currently the SQL editor sits above the chart): a resizable drawer (reuse `ResizableArea` from `NativeQueryEditor/`) gives PBI Desktop's "the canvas is king" feel.

### 8.2 The Build tab — chart gallery + field wells

- **Gallery**: `ChartTypeList` as icon grid (sensible first, "More charts" below — same `getSensibleVisualizations` logic).
- **Field wells**: PBI's signature. Each viz type declares wells (X, Y, Legend, Values, Tooltips…) which map directly onto MBQL slots. This is a **pure presentation layer** over `metabase-lib`:

| PBI well | MBQL/Notebook slot (existing) |
|---|---|
| Y / Values | Summarize → Aggregation (`SummarizeSidebar` content) |
| X / Axis / Legend / Category | Summarize → Breakout |
| Filters | top-level filter clauses (the `FilterHeaderButton` flow) |
| Tooltips | viz settings column props (`viz-core/lib/settings/column.ts`) |
| Sort | notebook Sort step |

`FieldWell.tsx` = drag target (drop from the new **Fields sub-pane**, fed by `DataReference`/model metadata) + click-to-pick (existing pickers). Wells read/write through the existing `updateQuestion` pipeline — no query-model changes.

### 8.3 Format tab

`QuestionChartSettings`/`BaseChartSettings` body, restyled into PBI's nested accordion sections (Data / Columns / Display / Axes / Ranges / Formatting → "Visual formatting / General / Title / Colors / Effects" grouping — a mapping table over `section` keys). All ~40 settings widgets render unchanged.

### 8.4 Transform Studio — the Power Query experience (Applied Steps)

Power BI analysts think in Power Query: an **Applied Steps** list, a data grid previewing *at that step*, a **formula bar**, and **column-header transformation menus**. The notebook already has the machinery — steps (data/join/expression/filter/summarize/sort/limit in `querying/notebook/utils/steps.ts`) and per-step preview (`Lib.previewQuery(query, stageIndex)`, truncated by `NotebookStepPreview.tsx`) — but presents it as horizontal cells hidden behind a mode toggle. Transform Studio is the PBI presentation over the same MBQL engine: **"preserve the engine, reinvent the cockpit."** The underlying query object, `updateQuestion` pipeline, and compilation to SQL are untouched.

```
┌───────────────────────────────────────────────────────────────────────┐
│ Ribbon: Home | Transform | View            [Run preview ⟳] [Done]      │
├──────────────┬────────────────────────────────────────────────────────┤
│ APPLIED      │  Preview at step: "Split Customer"       100 rows ▾ ⟳    │
│ STEPS        │ ┌────────────────────────────────────────────────────┐ │
│ Ⓢ Source     │ │ Order ID ▾│ Created At ▾│ Customer ▾│ Region ▾     │ │
│   Orders     │ │        1  │ 2026-10-02  │ Acme–East │ APAC         │ │
│ ▸ Split col  │ └────────────────────────────────────────────────────┘ │
│   Customer ✓ │  Formula bar: [Split Column ▾] on [Customer]            │
│ ▸ Filtered ✓ │  = splitPart([Customer], "–", 1)         [Apply] [✨]     │
│ ▸ Sorted ✓   │                                                          │
│ ＋ Add step   │  3 steps applied · preview cached 12s · ran in 0.38s     │
└──────────────┴────────────────────────────────────────────────────────┘
```

**A. Applied Steps pane** — a vertical re-skin of `NotebookStepList` (`querying/notebook/components/`), mirroring PBI's Queries & Settings pane:
- Each step is a named chip (auto-named "Split column: Customer", "Filtered rows"; **renameable**), with per-step **delete/revert** (existing notebook actions) and **preview-on-click** (`previewQuery` is already attached per visible step).
- Step reordering where MBQL stage order permits; dependency-locked steps show a locked state — presented honestly, as PBI does when a step can't move.
- "＋ Add step" is the notebook's addable-steps list, grouped PBI-style: *Filter rows · Transform columns · Add formula · Join · Group by · Sort · Keep top N*.
- The classic horizontal notebook stays one toggle away — **both views render the same query object**, so there's no fork in state and no retraining cliff for existing users.

**B. Step preview grid with caching** — the PBI "see the data at this step" loop:
- `NotebookStepPreview` today re-executes on every click at `LIMIT 10`. We add a **client-side preview cache** keyed by (query-through-stage-N hash + connection): instant stepping between steps, a dirty indicator + refresh button when an upstream step changes (the existing pattern), and a row-count selector (10 / 100 / 1000, default 100). All execution remains on the existing `/api/dataset` endpoint — no backend change.
- Column profile on demand (click a column → mini stats) rides the existing field-stats endpoints (the same data behind the metabot `field_stats` tool).

**C. Column-header transformation menus** — PBI's single most-used surface, on every column in the preview grid. Each menu action *generates the corresponding notebook step* — pure frontend over MBQL:

| PBI operation | Generated step (existing engine) | Honest notes |
|---|---|---|
| Rename column | field-ref update in the step | |
| Change Type | **expression step** with MLv2 cast/coercion (or field-metadata coercion when editing a semantic model) | MBQL casts are explicit and inspectable — better than PQ's silent coercion, and they *show in the formula bar* |
| Split Column | **expression step** using MLv2 string functions (split/substring), optionally hiding the source column | |
| Replace Values | expression (`replace`) or filter step | |
| Filter Column | `FilterStep` (value / range / not-null), menu mirrors PBI's Text/Number/Date filter menus | |
| Group By (Aggregate) | `Summarize` step | |
| Add Column from Formula | `ExpressionStep` + the existing expression editor | the PBI "Custom Column" |
| Fill Down / Merge / Append | expression where MLv2 supports it; otherwise **Copilot-authored SQL** with a visible fallback | the honest gaps — see E below |

**D. Formula bar** — PBI's M formula bar, MLv2-flavored:
- Expression steps show the generated expression inline-editable in the existing expression editor (`querying/expressions/`), with a **[✨] Copilot button** — "describe the transformation in words" → the `construct` agent tool drafts the expression.
- Non-expression steps show a readable sentence ("Filter where Region = 'APAC'") that opens the step's editor on click.
- **"View Native Query" toggle** (PBI's formula-bar equivalent for our SQL-first story): shows the compiled SQL for the query *up to the selected step* via the existing compile pipeline — the same "AI/data with receipts" transparency the board report promises for NL answers.

**E. Honest gaps, handled honestly.** Power Query is an ETL language; MBQL is a query language. Three families don't map 1:1 — **Fill Down** (window-fill), **Append/Union** (query union), and certain column mutations. Stance per §3.3 (no engine rewrites): (1) expression recipes where MLv2 supports them; (2) otherwise the menu offers *"Do it with SQL — ✨ Copilot drafts it"* handing off to the native editor with equivalent SQL pre-filled; (3) the gaps are **listed in the UI**, never hidden, so the team never fights the tool. (Open question #11 asks the team to ratify this stance.)

**F. Where Transform Studio appears.** From the Visual editor ribbon ("Transform data" → the §8.1 bottom drawer), as the default authoring surface for semantic models, and from the workspace "Queries" tab. It edits *queries*. Scheduled materialization is a different, already-built thing — **Dataflows** (§9.3).

**SQL editor (the DAX query view analog).** Stays CodeMirror 6 with snippets, autocomplete, and right-click run/save — opened from the same ribbon and sharing the preview grid. The inline NL→SQL prompt (`MetabotInlineSQLPrompt`) and `FixSqlQueryButton` are kept and visually tied to the Copilot identity (§10). Data reference / snippets / variables (`DataReference`, `SnippetSidebar`, `TagEditorSidebar`) become tabs in the Fields pane region.

### 8.5 Model / metric editors

`DatasetEditor` (model editor) and `MetricEditor` get the same pane treatment so the family feels coherent: right panes, PBI "semantic model" terminology, Format pane for model display options. Both are re-skins of existing containers.

---

## 9. Data experiences (PBI Model view, Table view, Data hub)

### 9.1 Model view — semantic model designer (PBI's biggest differentiator)

Power BI's Model view (schema diagram, relationships, manage measures) is what your team will probe first. This fork already owns the pieces:

- **EE `schema_viewer`** renders ER diagrams (premium `:schema-viewer`) — but only in Data Studio today.
- Backend `src/metabase/typed_schemas/` exposes `/api/typed-schemas` (schemas/questions/metrics/tables).
- Joins metadata (`metabase-lib` joins, FK sync) provides the relationship graph.

**Plan:** a unified **Model designer** page per semantic model — `ModelViewPage` under the Data area:

```
┌ Ribbon: Home | Manage relationships | Manage measures ┐
├──────────────┬──────────────────────────────┬─────────┤
│ Tables list   │  ER diagram canvas           │ Manage: │
│ ▸ Orders      │  (Orders)──⟨customer_id⟩──(Customers)   │ fields /│
│ ▸ Products    │        │                       │ measures│
│ ＋ Add data   │     ⟨product_id⟩                │ /roles  │
└──────────────┴──────────────────────────────┴─────────┘
```

- Canvas = schema_viewer's diagram component, opened up for edit (drag tables, draw join lines → creates join metadata via existing notebook join APIs — **no new backend**; if the schema_viewer's read-only EE component can't be extended, an OSS diagram shell reusing it via plugin slot, with edit actions emitting existing join-update endpoints).
- Right pane: **Manage fields** (metadata editor = `data-studio/data-model/components/TableSection/TableMetadata.tsx` content), **Manage measures** (`data-studio/measures/MeasureEditor`), **AI context** (`osi_ai_context` — synonyms/instructions that feed Metabot; the API exists at `/api/osi/ai-context`).
- **Decided:** build on schema_viewer + typed_schemas. **Open:** OSS build cannot use EE schema_viewer — decide ship-scope (workshop item #3): (a) minimal OSS diagram + full pane experience, EE diagram; or (b) everything as EE.

### 9.2 Table view (data browsing)

Existing `/browse` pages restyled under the Data hub: databases → schemas → tables with a PBI-hub-like landing (recents, certified/verified models first, lineage links). The model detail page gets a "View data" grid = existing table data browsing.

### 9.3 Data hub & Dataflows (PBI dataflow parity — already built)

`Data` rail item opens a hub: **Semantic models** (verified first — reuse `BrowseModels.tsx` + EE verified filter), **Databases**, **Dataflows** (the existing Transforms subsystem — below), **Lineage** (EE dependencies), **Glossary** (exists in data-studio). This is a navigation page over existing routes.

**Dataflows = the existing Transforms subsystem** (`/data-studio/transforms`, backend `src/metabase/transforms/`). In Power BI terms this feature is *dataflows*: saved materializations that run on a schedule and write a real table back to the database. The fork already supports query (MBQL/SQL) *and* Python sources; full-replace vs. incremental targets (append / merge-on-key / checkpoint watermarking); cron jobs; DAG ordering across dependencies (`POST /:id/run-dag`); run history; target indexes; plus an EE **Inspector** (data-summary, join-match-rate, column-comparison, unmatched-rows lenses) and an EE Python shared library with a 100-row test-run preview. Our work here is **naming and placement only**: present it as "Dataflows" in the Data hub and workspace tabs with PBI-style flow cards (source → target, last-run status), zero backend. Transform Studio (§8.4) edits the query inside a dataflow through the exact same standard editor it already uses (`TransformEditor.tsx` wraps `QueryEditorWithParameters`).

---

## 10. Copilot — the AI experience

**Goal:** make the already-strong Metabot stack feel like PBI Copilot — visible everywhere, context-aware, one click from every edit surface.

### 10.1 The Copilot pane (everywhere)

- Promote `metabot/components/Metabot.tsx` (already a right-side, hotkey-toggled chat) to the standard **Copilot pane**: rail item + top-bar button + ribbon Copilot command all open it; pinned alongside the editing panes (not covering them).
- **Context chip** (PBI-style "This report / This visual"): the context registry already exists (`metabot/context.tsx`; QB registers chart config for `analyze_chart`). We *visualize* it — a chip on the pane header showing what the agent sees, with a dropdown to change scope (this visual / this page / this workspace / anywhere).
- **Suggested prompts** are already generated per-surface by the backend (`suggested_prompts.clj` + `/api/metabot/:id/prompt-suggestions`) — surface as PBI-style prompt chips above the editor.

### 10.2 Copilot affordances mapped to existing backend tools (no new AI backend)

| PBI Copilot feature | Our implementation (existing tool) |
|---|---|
| "Summarize this visual" | `analyze_chart` tool + `contextual_interestingness/score-and-describe-chart` → narrative card (§7.5) |
| "Create a report page" | `autogen_dashboard` tool (agent drafts page; user approves; `save_entity` persists) |
| "Explain this data / suggest insights" | `generate_insights` → X-ray `/auto/dashboard` links |
| NL→visual authoring | `construct` (notebook construction) — the `/question/ask` flow (`MetabotAsk`) becomes "New visual with Copilot" |
| NL→SQL | `sql/create`/`edit`/`replace` — inline prompt in the SQL editor (exists) |
| "Fix this SQL" | `sql/validation` → `FixSqlQueryButton` (exists) |
| Q&A over the workspace | NLQ + `search` + EE `entity_retrieval` (pgvector) — the omnibox gets an "Ask Copilot" row |
| "Why did this change?" (anomalies) | `interestingness` outliers + LLM descriptions (exists, `contextual_interestingness`) → new "Explain this point" drill entry |
| Create alerts/subscriptions | `create_alert`, `create_dashboard_subscription` tools (exist) |
| Glossary-aware answers | `glossary` API + `osi_ai_context` (exist) |
| External agents (Copilot in VS Code, Claude, Cursor) | **MCP server** (`/api/metabase-mcp`) + **Agent API** — already built; exposed in admin AI page (already there: `MCPServerUrlSection`, `CursorInstallLink`) |

### 10.3 AI features beyond PBI (to impress the team — all grounded in existing code)

1. **Smart narrative cards** in reports (§7.5) — PBI has this; ours also updates from live query context.
2. **Semantic search in the omnibox** (EE pgvector) — PBI search is keyword-only.
3. **Slack Copilot** (slackbot agent exists) — answer/visualize in Slack directly.
4. **MCP/Agent API headless access** — the team can drive Metabase from any AI IDE; PBI has no equivalent for self-hosted BI.
5. **Per-user AI permission scopes** (`:permission/metabot{-sql-generation,-nlq,-other-tools}`) — enterprise Copilot governance.

### 10.4 Admin experience

Admin AI page already has provider configuration, model pickers, Metabot settings, suggested-prompt management, MCP URLs, OAuth authorizations. Add: "Terminology for Copilot" — site-prompt guidance that the assistant uses the workspace's Power BI vocabulary (a metabot system-prompt setting already exists: `metabot-chat-system-prompt`).

### 10.5 The three Power BI-parity AI affordances (the team's explicit asks)

**A. In-canvas Q&A visual (PBI: the Q&A visual).** A new dashboard card type — a natural-language input *living on the canvas* that renders its answer as a chart in place:
- Type "revenue by depot in October" → runs the existing NLQ agent tools (`construct` / `sql/*` — the same tools behind `/question/ask`) scoped to the workspace's semantic models; the result renders through the existing ad-hoc run path (`MetabotInlineChart.tsx` already renders agent-generated charts read-only).
- **"Convert to visual"** pins it: the `SaveQuestionModal` flow *already supports saving straight into a dashboard and tab* (`dashboard_id`, `dashboard_tab_id`).
- **Double-click empty canvas → "Ask Copilot"** overlay: same engine, click-to-place the resulting chart.
- Every answer carries the **"Show SQL" badge** — the board report's "AI with receipts" promise; the tools already return the SQL, we surface it on the card.

**B. Dynamic Smart Narrative cards (filter-aware).** PBI's smart narrative recomputes when slicers change; Metabase text cards are static, and the fork's LLM chart-description engine (`contextual_interestingness/score-and-describe-chart`) is only surfaced in Explorations today. Design: a **Narrative card** = prompt template + source-card ids, stored as a text-card variant:
- On load — and **whenever dashboard filters change** — the source cards refetch with the new parameters (existing behavior); the narrative card reads their *result data from the existing redux card-data cache* and asks the configured model to summarize, rendering markdown in place. Filter-state hash = cache key, so idle re-renders don't re-ask.
- **Graceful degradation:** if AI is off/slow/failed, the card shows the last good text with a refresh affordance — reporting never depends on AI (the board report's "AI decoupled from the reporting layer" promise).
- Backend: `POST /api/metabot/document/generate-content` already generates prose; only if its payload can't serve card-result inputs unchanged does this become the **one thin endpoint addition** permitted by §13.4 — everything else here is frontend composition.

**C. Outlier analysis — "Explain the increase/decrease" (PBI: right-click → Analyze).** Today there are *no context menus on visualizations* (verified), and "insights" means the left-click drill popover's X-ray / compare-to-the-rest entries. Design: a right-click **Analyze** menu on data points (a new interaction layer; left-click behavior unchanged per §7.6):
- **"Explain this point"** → a side sheet with two parts: (1) *statistical decomposition* — the existing X-ray **comparison dashboard** ("Compare to the rest") showing which dimensions drive the change; (2) *LLM narrative* — the `analyze_chart` agent tool over the clicked chart's data. One frontend prerequisite, flagged for Phase 6: dashboards today register only `{type: "dashboard", id}` as Metabot context (the query builder already registers `chart_configs`), so we extend dashboard context registration to include the clicked dashcard's chart config — mirroring `use-register-query-builder-metabot-context.tsx`. FE-only.
- **"X-ray this" / "Compare to the rest"** — the existing automatic-insights drills, promoted into this menu.
- Anomaly seeds: `interestingness` outliers and the LLM contextual scoring (both exist) surface as subtle markers on flagged points in pbi mode.

### 10.6 AI sovereignty guardrails (Nubrix deployment rules — §1.1)

Every feature in §10.1–10.5 routes through the admin-configured provider (`src/metabase/llm/provider.clj` — Anthropic, OpenAI, Azure, Bedrock, Google, Mistral, DeepSeek, Moonshot, OpenRouter, … and self-hosted vLLM). Concretely: the Q&A visual, narrative cards, outlier analysis, the formula-bar Copilot, and the omnibox "Ask Copilot" row all execute against the same stack as Metabot chat — per-user permission scopes (`:permission/metabot{-nlq,-sql-generation,-other-tools}`), instance usage limits (`ai_usage_log`), and the `ai-features-enabled?` master switch. **No feature may introduce an external SaaS call.** This is the MicroStar procurement posture, and it is a *differentiator*: Copilot inside the customer's VPC is something Power BI's cloud cannot offer. The admin AI page (§10.4) gains a short "Data boundary" panel showing exactly which provider/endpoint serves each AI surface.

---

## 11. Design system additions (`metabase/ui`)

All display-only, each with a Storybook story (repo rule), Mantine style props only, tokens via `var(--mb-color-*)`:

| Component | Purpose | PBI counterpart |
|---|---|---|
| `RailNav` / `RailNavGroup` / `RailNavItem` | Icon+label rail with collapse | Service nav pane |
| `Ribbon` / `RibbonTab` / `RibbonGroup` / `RibbonCommand` | Command strip | Desktop ribbon |
| `PaneStack` / `PaneHeader` / `PaneTab` | Right pane chrome | Visualizations/Format panes |
| `FieldWell` / `FieldWellList` | Drop targets for MBQL slots | Field wells |
| `FilterLevelTree` | Visual/page/report hierarchy | Filters pane |
| `ContextChip` | AI context display | Copilot context chip |
| `DensityToggle` | Compact/cozy density (PBI reports feel denser than Metabase; offer both) | — |

Plus: a **density token pass** (spacing/radius/font-size tweaks in `ui/theme.ts` overrides) to give the `pbi` mode PBI's tighter visual rhythm without forking the theme.

---

## 12. Architecture & engineering compliance

1. **New modules** (`nav/pbi-rail/`, `dashboard/report-designer/`, `query_builder/visual-editor/`, `data/model-view/`) each get: an element in `frontend/lint/module-boundaries.mjs` (ordered before carved-from elements, `enforcePublicApi: true`), an `index.ts` barrel, and correct tier placement (feature tier; imports only downward). Run `bun run module-boundaries` before/after every phase; zero new violations is an exit criterion.
2. **EE stays plugin-shaped:** verified badges, official collections, tenants, schema viewer, semantic search all through existing `PLUGIN_*` slots in `frontend/src/metabase/plugins/oss/`. No OSS→EE imports, ever.
3. **State:** no new global Redux. Selection/pane state lives in the dashboard/QB contexts that already exist (`dashboard/context/context.tsx`, QB store slices); user prefs via `useUserSetting` (generic user-settings KV — no backend migration).
4. **API:** no new endpoints except §13.4; new code consumes RTK Query hooks from `metabase/api` only.
5. **Strings:** every new string via ttag; the terminology pack (§4) carries the PBI nouns.
6. **Analytics:** new nav/pane interactions emit Snowplow events per the analytics-events conventions (rail item clicked, pane opened, ribbon command, copilot invoked + context type) so we can measure whether the new IA actually fixes wayfinding.
7. **Performance:** rail and panes are lazy chunks; pane bodies reuse existing connected components (no duplicated data fetching); Loki visual baselines added for new ui components.

---

## 13. Rollout, flags, embeds

### 13.1 The switch

- **Per-user setting** `navigation-experience` (`classic` | `pbi`), default `classic`; stored in the existing generic user-settings KV via `useUserSetting` → **zero backend migration**. Admin can set instance default later via a settings flag (one-line `settings` addition in the backend — additive, behind the "thin backend" allowance).
- The flag gates: rail vs. `MainNavbar`, report designer vs. classic dashboard edit, visual editor layout, terminology pack, density tokens. Terminology could additionally be gated by its own instance setting if the team wants org-wide PBI words for both modes.

### 13.2 Migration & training for the team

- "What's new" tour on first `pbi` activation (existing `WhatsNewNotification` pattern), PBI→Metabase cheat-sheet page under Learn.
- Classic mode remains available indefinitely for stragglers; docs cover both.

### 13.3 Embeds & SDK (protected)

- Embeds, static/public routes, and the SDK keep the current chrome and terminology (embed options like `side_nav`/`top_nav` already gate this in `app/selectors.ts`). The `pbi` flag simply never applies in embed contexts. No changes to `routes-embed.tsx`/`routes-public.tsx`.

### 13.4 The complete backend change list (intentionally tiny)

1. *(optional)* Instance setting `navigation-experience-default` — declarative settings addition.
2. *(optional, Phase 6)* Narrative-card summarize endpoint — **only if** the existing `document/generate-content` payload cannot serve card-result inputs unchanged (first attempt reuses it as-is).
3. *(optional, Phase 7)* `GET /api/…/workspace-summary` — pre-aggregated counts per content type for workspace tabs (only if client-side counting proves slow; first attempt is pure FE with existing items endpoints).
4. Nothing else. No migrations. No permission changes. No API renames. Live cross-filtering (§7.6), Transform Studio (§8.4), the Q&A visual, and right-click analysis are all pure frontend over existing engines — verified against code, not assumed.

---

## 14. Delivery plan

| Phase | Deliverable | Key components | Estimate* | Exit criteria |
|---|---|---|---|---|
| **0. Foundations** | Terminology pack pipeline + `navigation-experience` flag + density tokens + ui primitives (`RailNav`, `Ribbon`, `PaneStack`, `FieldWell`, `ContextChip`) with stories & Loki baselines | §4, §11 | 2 wk | Pack switches terms live; classic mode byte-identical |
| **1. Global shell** | PBI rail + omnibox + Create menu + flag switch in `Navbar.tsx` | §5 | 2–3 wk | Rail navigates 100% of routes; parity checklist green; analytics events fire |
| **2. Workspaces** | Workspace landing (tabs/chips/list-grid), All-workspaces page, Home restyle, roles modal | §6 | 3 wk | All CRUD flows (create/move/permissions/archive) work via new page |
| **3. Report Designer I** | Ribbon, view rail, reading/edit toggle, pane shell, Visualizations + Fields panes | §7.1–7.3 | 3–4 wk | Build a PBI-parity report end-to-end; save pipeline untouched & verified |
| **4. Report Designer II** | Format pane (modal→pane), Filters pane levels, canvas polish (multi-select/align/focus), **live cross-filtering default-on + edit interactions + selection chips (§7.6)** | §7.4–7.6 | 4 wk | PBI filter hierarchy demo passes; **click-any-visual cross-filters with zero config** (makes the board-report promise true); dashcard settings lossless vs. modal |
| **5. Visual Editor + Transform Studio** | Right-pane Build/Format/Filters, field wells, bottom drawer, **Transform Studio: applied steps, preview caching, formula bar, column-header menus (§8.4)**, model/metric editor reskins | §8 | 4–5 wk | Author a visual without footer buttons; **split a column via header menu in < 30s**; MBQL fidelity suite passes |
| **6. Data + Copilot** | Data hub + Dataflows placement, Model designer, Copilot pane + context chips + prompt chips, **Q&A visual, dynamic narrative cards, right-click Analyze/outlier menu (§10.5)** | §9–10 | 4–5 wk | Copilot actions work in report context; **Q&A visual pinned to canvas; narrative recomputes on filter change**; model diagram browses + edits joins |
| **7. Polish & rollout** | Usability test with your team, perf pass, docs, tours, instance-default flag, (optional) workspace-summary endpoint | §13, §15 | 2 wk | Team sign-off; flag flip for the team |

\* Estimates assume 3–4 FE engineers + 1 designer + occasional BE support. Phases 3–6 can partly overlap across two workstreams (designer vs. editor). Total: ~5–6 months to full rollout; **team-visible wins from Phase 1 onward** (rail + terminology, ~1 month in).

**Sequence rationale:** shell first (immediate wayfinding relief), editors second (bigger surface, higher risk), data/AI last (highest existing-machinery reuse, lowest risk).

---

## 15. Testing & quality strategy

1. **Unit**: colocated `*.unit.spec.tsx` per new component (`setup()` + `renderWithProviders` + `__support__/server-mocks`); pane/ribbon components tested against existing redux/context fixtures.
2. **Fidelity tests**: for every re-skinned surface, a test asserting identical persisted payloads (dashboard save diff, card `visualization_settings`, parameter wiring) — proves "backend untouched" continuously.
3. **Parity checklist**: a living doc mapping every classic-mode capability to its new-mode entry point; CI-checked Cypress scenarios in `e2e/test/scenarios/` (extend the existing suites; new dir for the pbi mode) covering rail → workspace → report edit → filter → save → copilot.
4. **Visual regression**: Loki stories for all new `metabase/ui` components in both density modes and both color schemes.
5. **Usability test (Phase 7 gate)**: 5 Power BI-experienced colleagues attempt: *find workspace → open report → change chart type via gallery → add page filter → add visual from field drop → **click a bar and verify sibling visuals cross-filter → split a column via the Transform Studio header menu → double-click canvas and ask the Q&A visual a question, then pin the answer** → ask Copilot to summarize a visual*. Target: unassisted completion; time-to-first-edit < 5 min.
6. **A11y & perf**: keyboard parity for ribbon/panes (PBI users are keyboard-heavy: Alt-H sequences optional), focus management in panes, rail Lighthouse pass.

---

## 16. Risk register

| # | Risk | L×I | Mitigation |
|---|---|---|---|
| 1 | Two experiences diverge as Metabase upstream merges | H×M | PBI mode is composition-heavy (wraps existing components), flag-gated; upstream merge cost bounded to Phase 0–1 primitives |
| 2 | Terminology pack drift (new strings added without pack entries) | M×M | CI check: extract msgids used in pbi-mode surfaces and diff against pack YAML |
| 3 | Modal→pane conversion loses settings (dashcard) | M×H | Fidelity suite (§15.2) runs on every PR of Phases 3–5 |
| 4 | Page-level filters need tab-scoped parameters not fully in this build | M×M | §7.4 graceful degradation; verify in Phase 4 week 1 |
| 5 | EE schema_viewer can't be extended OSS-side for Model view | M×M | Two scoped options prepared (§9.1, workshop item #3) |
| 6 | Cypress suite churn (nav selectors) | H×M | Add pbi-mode scenarios rather than rewriting existing; classic stays default in e2e |
| 7 | Loki baseline churn | L×L | Accept once, at Phase 0 freeze |
| 8 | Team rejects a mapping (e.g., "Visual" feels wrong) | M×M | Terminology is a YAML file; instant re-wording (§4.2) |
| 9 | Scope creep into backend ("just one more endpoint") | M×H | §13.4 is the contract; every addition needs doc amendment |
| 10 | kbar/palette regressions | L×M | Palette untouched; omnibox only *triggers* it |
| 11 | Runtime auto-wire matches the wrong field (false-positive cross-filters) | M×H | Confidence threshold + per-visual Edit-interactions toggles (§7.6) + selection chips make every live filter visible/dismissible; falls back to drill menu on ambiguity |
| 12 | PQ primitives not expressible in MBQL (fill down, append/union) frustrate the team | H×M | §8.4E: expression recipes where possible, visible Copilot-SQL handoff otherwise; gaps listed in-UI, not hidden; open question #11 for the team to ratify |
| 13 | Narrative-card LLM recomputes add load on every filter change | M×M | Filter-state-hash cache; existing per-user AI usage limits apply; graceful degradation to last good text |
| 14 | Right-click menu collides with drill popover / OS gestures | L×M | Right-click only; left-click behavior unchanged; suppressible per-visual via Edit interactions |

---

## 17. Open questions — team workshop agenda

1. **Terminology pass over Appendix B** (30 min): confirm or amend every PBI term. Special cases: "Visual" vs "Chart"; "Semantic model" vs "Dataset"; do we call Metabase "Metrics" the same as PBI "Metrics"?
2. Workspace tabs: exact set & order (Reports / Visuals / Semantic models / Queries / Automations / Files?).
3. Model view ship-scope: OSS-minimal vs EE-full (§9.1).
4. Ribbon keyboard accelerators: PBI Alt-key scheme worth it?
5. Density default: compact (PBI-like) or cozy (current) for `pbi` mode?
6. Does the team want the **instance** default flipped to `pbi` at Phase 7, or user-by-user?
7. Which 3 Copilot affordances ship first (recommend: summarize visual, NL→visual, smart narrative)?
8. Timeline sanity: any hard deadline (fiscal quarter, exec demo) that reorders phases?
9. Live cross-filtering default: on globally in pbi mode, or per-workspace opt-in for the first rollout?
10. Q&A visual: everyone with NLQ permission, or a more restricted rollout first?
11. Transform Studio gaps stance (§8.4E): accept expression-recipes + Copilot-SQL handoff for fill-down/append/union, or invest in new MBQL step primitives (the only path that touches the query engine — currently out of scope)?
12. Narrative cards under self-hosted vLLM deployments (model quality varies by client) — ship behind per-instance enablement?

---

## Appendix A — Component mapping (engineering appendix)

### A.1 Global shell

| New | Built on |
|---|---|
| `PbiRail` | `nav/containers/MainNavbar/MainNavbarContainer/{MainNavbarContainer,MainNavbarView}.tsx`, `SidebarItems/SidebarLink.tsx`, `SidebarCollectionLink.tsx`, `BookmarkList/BookmarkList.tsx` (drag), `BrowseNavSection.tsx`, `useUserSetting` (`expand-*` pattern) |
| Omnibox | `nav/components/search/SearchBar/SearchBar.tsx` (embed variant promoted), `AppKBarProvider.tsx`, `palette/hooks/useCommandPalette.tsx`, `palette/components/Palette.tsx` |
| Create menu | `nav/components/NewItemMenu/NewItemMenu.tsx` + `NewItemMenuView.tsx`, `new/components/NewModals/NewModals.tsx`, `AddDataModal/` |
| Flag switch | `app/nav/Navbar.tsx` + `app/selectors.ts` (untouched logic) |

### A.2 Workspace

| New | Built on |
|---|---|
| Workspace landing | `collections/components/CollectionContent/{CollectionContentView,CollectionItemsTable,CollectionItemsToolbar,CollectionTypeFilter,PinnedItemsGrid}.tsx`, `CollectionHeader/CollectionHeader.tsx`, `CollectionEmptyState` |
| Roles modal copy | `admin/permissions/components/CollectionPermissionsModal/` (mounted via existing `permissions` modal route) |
| All-workspaces page | `browse/components/{BrowseGrid,BrowseCard,BrowseDataHeader}.tsx`, `common/collections/containers/CreateCollectionModal` |
| Home | `home/components/HomePage*`, `useListRecentsQuery`, `BookmarkList`, X-ray `/auto/dashboard` links |

### A.3 Report designer

| New | Built on |
|---|---|
| `Ribbon` + schema | `dashboard/components/DashboardHeader/DashboardHeaderButtonRow/{constants.ts,action-buttons.tsx}` (verified contents: ADD_QUESTION…ADD_ACTION_ELEMENT), `buttons/` components re-hosted |
| `ViewRail` | links to existing routes (`/browse/…`, model detail, SQL question) |
| `ReportPanes` shell | `dashboard/components/DashboardSidebars.tsx` switch + `common/components/Sidebar/Sidebar.tsx` |
| Visualizations pane | `query_builder/components/chart-type-selector/ChartTypeSettings/ChartTypeSettings.tsx` + `ChartTypeList` |
| Format pane | `dashboard/components/DashboardChartSettings/DashboardChartSettings.tsx` body: `visualizations/components/ChartSettings/BaseChartSettings/BaseChartSettings.tsx`, `useChartSettingsSections`, `ChartSettingsVisualization` (live preview), widgets in `visualizations/components/settings/` (~40 controls, untouched) |
| Filters pane | `dashboard/components/{AddFilterParameterMenu,ParameterSidebar/ParameterSidebar.tsx,ParameterLinkedFilters}`, `DashCard/DashCardParameterMapper/`, `dashboard/actions/auto-wire-parameters/` |
| Fields pane | `dashboard/components/AddCardSidebar/AddCardSidebar.tsx`, `metabase/common/components/Pickers/{QuestionPicker,DataPicker}.tsx` |
| Click behavior drawer | `dashboard/components/ClickBehaviorSidebar/` (content unchanged) |
| Narrative card | `metabase/metabot/components/editor-extensions/MetabotEmbed/` (documents) + `/api/metabot/document/generate-content` |
| Canvas polish | `dashboard/components/DashboardGrid.tsx`, `grid/GridLayout.tsx` (engine untouched), `DashCardActionsPanel` |

### A.4 Visual editor

| New | Built on |
|---|---|
| Pane shell | `query_builder/components/view/View/View.tsx` recomposition + `view/ViewSidebar/ViewSidebar.tsx` (right side) |
| Build tab (wells) | `view/sidebars/{ChartTypeSidebar,ChartSettingsSidebar}.tsx`, `SummarizeSidebar/SummarizeSidebar.tsx` content, `viz-core/lib/sensibility.ts` |
| Format tab | `visualizations/components/ChartSettings/QuestionChartSettings/QuestionChartSettings.tsx` |
| Filters tab | `view/ViewHeader/components/…/FilterHeaderButton` flow + top-level MBQL filters |
| Bottom drawer | `querying/components/NativeQueryEditor/ResizableArea`, `NotebookContainer/`, `querying/notebook/components/Notebook/Notebook.tsx` |
| Fields sub-pane | `querying/components/DataReference/DataReference.tsx`, `SnippetSidebar`, `parameters/components/TagEditor/TagEditorSidebar.tsx` |
| SQL AI | `metabot/components/MetabotInlineSQLPrompt/useInlineSQLPrompt.tsx`, `FixSqlQueryButton/` |
| Model/metric editors | `query_builder/components/DatasetEditor/DatasetEditorInner.tsx`, `querying/metrics/components/MetricEditor` |

### A.5 Data + Copilot

| New | Built on |
|---|---|
| Data hub | `browse/{databases,schemas,tables,models,metrics}/Browse*.tsx`, `data-studio/` sections, EE `schema_viewer`, `typed_schemas` REST |
| Model designer | EE schema_viewer diagram + `data-studio/data-model/components/TableSection/{TableMetadata,MeasureList}.tsx`, `data-studio/measures/MeasureEditor`, `/api/osi/ai-context` |
| Copilot pane | `metabot/components/{Metabot,MetabotAppBarButton,MetabotChat/*}.tsx`, `metabot/context.tsx`, `hooks/use-user-metabot-permissions.ts`; backend tools: `analyze_chart`, `autogen_dashboard`, `generate_insights`, `construct`, `sql/*`, `entity_retrieval`, `create_alert`, `create_dashboard_subscription` |

### A.6 Transform Studio, live interactions & new AI surfaces (v1.1 additions)

| New | Built on |
|---|---|
| Applied Steps pane | `querying/notebook/components/Notebook/Notebook.tsx`, `NotebookStepList`, `NotebookStep.tsx`, `utils/steps.ts` (step defs + per-step `previewQuery`) — vertical re-skin |
| Step preview + cache | `NotebookStep/NotebookStepPreview/NotebookStepPreview.tsx`, `Lib.previewQuery` (metabase-lib), `metabase/querying/run-query`; cache added client-side |
| Column-header menus | `ExpressionStep/` + `querying/expressions/` expression editor, `FilterStep/`, `Summarize`/`Sort` steps — menu actions emit existing notebook steps |
| Formula bar | `querying/expressions/` + metabot `construct` tool (`src/metabase/metabot/tools/construct.clj`); "View Native Query" via existing compile pipeline |
| Dataflows surface | `frontend/src/metabase/transforms/` (routes; `TransformEditor.tsx` wrapping `QueryEditorWithParameters`; `TransformOutput`, `RunButton`, `IncrementalTransform/`, `TransformRevisionHistorySidebar`); backend `src/metabase/transforms/` + REST `src/metabase/transforms_rest/api/transform.clj`; EE inspector `enterprise/frontend/src/metabase-enterprise/transforms-inspector/`; EE Python `transforms-python/` |
| Live cross-filtering | `dashboard/actions/auto-wire-parameters/` (matcher reused read-only at runtime), `dashboard/actions/parameters.tsx` `setOrUnsetParameterValues` (toggle semantics), `dashboard/actions/data-fetching.tsx` (refetch/dedup/abort), `dashboard/click-behavior/{dashboard-click-drill.ts,DashboardClickAction.tsx}`, `visualizations/components/ChoroplethMap.utils.ts` (clear-on-empty-region), `CrossfilterOptions.tsx` + `ClickMappings.tsx` (Edit-interactions UI), `visualization_settings.cljc` `crossfilter-click-action` builder |
| Q&A visual | `metabot/components/MetabotAsk/`, `MetabotInlineChart.tsx` (ad-hoc render of agent cards), `SaveQuestionModal` (dashboard_id / dashboard_tab_id persistence — verified), agent tools `construct` / `sql/*` |
| Dynamic narrative cards | `visualizations/Text/Text.tsx` (card variant), dashboard card-data redux cache, `POST /api/metabot/document/generate-content` (or the single thin additive endpoint, §13.4) |
| Right-click Analyze | new interaction layer on `Visualization`; `querying/drills/utils/automatic-insights-drill.tsx` (X-ray / compare), metabot `analyze_chart` tool, `src/metabase/interestingness/` + `contextual_interestingness/`; dashboard context registration extension mirroring `query_builder/containers/use-register-query-builder-metabot-context.tsx` (FE-only) |

## Appendix B — Terminology override worksheet (fill during workshop #1)

| msgid (ttag, with context) | Current display | Proposed (PBI) | Decision |
|---|---|---|---|
| "Dashboard" (noun, all contexts) | Dashboard | Report | ☐ |
| "Saved question" | Saved question | Saved visual | ☐ |
| "Question" (noun) | Question | Visual | ☐ |
| "Collection" | Collection | Workspace | ☐ |
| "Model" | Model | Semantic model | ☐ |
| "New dashboard" | New dashboard | New report | ☐ |
| "Add a question" | Add a question | Add a visual | ☐ |
| "Edit dashboard" | Edit dashboard | Edit report | ☐ |
| "Notebook editor" | Notebook | Transform data | ☐ |
| "Metric" | Metric | Measure *(or keep Metric?)* | ☐ |
| "Sub-collection" | Sub-collection | Folder | ☐ |
| *(…generate full msgid inventory with `bin/i18n` extract at Phase 0)* | | | |

## Appendix C — Glossary for reviewers

**PBI service** = app.powerbi.com (browser). **PBI Desktop** = Windows authoring app (ribbon + right panes + left view rail: Report/Table/Model/DAX). **Workspace** = team container. **Report** = multi-page interactive canvas of visuals. **Semantic model** = governed dataset with measures/relationships. **Measure** = reusable DAX aggregation. **Visual** = a single chart. **Copilot pane** = right-side AI assistant with page/visual context. **Filters pane** = Visual/Page/Report filter hierarchy. **Certified** = promoted, trusted dataset. **OneLake/Data hub** = data discovery surface.