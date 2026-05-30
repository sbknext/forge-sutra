# Story 3.2: Feature cards grid

- **Epic:** Epic 3 — Realistic Feature Viewer
- **Status:** Draft
- **Priority:** P0
- **Depends on:** 3.1 (viewer app shell), 2.3 (AI feature inference), 2.4 (feature health score)
- **Estimate:** M

## Story
As a developer pointing Sutra at my repo, I want the viewer's landing screen to show every feature as a card — with its name (AI- or heuristic-derived), a health badge, node/edge counts, contract status, and issue count — sortable and filterable by health, so that I can see my product as a set of features at a glance and immediately spot the unhealthy ones without reading code or parsing raw `graph.json`.

## Context
This story builds the first screen of the "realistic feature viewer" — the named North Star of the roadmap (ROADMAP.md, Epic 3 ⭐). Phase 0 already renders a static feature grid inside the self-contained `view.html` (`src/view.ts`, the `cards` block, lines ~143–158), but that grid is a one-shot HTML dump: every card shows only `feat.label`, a single issue-count badge derived from `badgeClass()`, and node/edge counts. It has no health score, no AI name, no contract status, no sorting, and no filtering. ROADMAP.md line 84 specifies 3.2 as "Feature cards grid (name, health badge, node/edge counts, contract status, AI summary)" and the DoD (ROADMAP.md lines 132–141) requires the viewer to "list features as cards" with a clickable health score.

This card grid is the landing view of the SPA introduced by Story 3.1 (viewer app shell), which reads `graph.json` and re-renders without a rebuild (ROADMAP.md line 82). The richer per-feature fields it displays are produced upstream: the AI-derived name/summary by Story 2.3 (AI feature inference — "LLM names + summarizes features from their node cluster — labelled AI", ROADMAP.md line 76) and the composite health score by Story 2.4 (feature health score — "issues + coverage + orphan ratio + contract drift", ROADMAP.md line 77). Contract status traces to the optional `feature.sutra.md` layer from Story 2.1 (ROADMAP.md line 75). This story consumes those fields and renders them honestly; it does not compute them. Per cross-cutting principle 1 (ROADMAP.md line 122), every AI-derived label must be visibly marked as AI, and per principle 2 (line 123) the grid must still render correctly when those optional fields are absent (no contract, no AI name, no health score yet) by falling back to the heuristic `SutraFeature.label` and an "unknown" health state.

## Acceptance Criteria
1. The viewer landing route (the SPA shell from Story 3.1) renders one card per entry in `SutraGraph.features`, reading the live `graph.json` the shell already loads — no separate fetch, no rebuild required to refresh.
2. Each card displays: (a) the feature **name** — the AI-inferred name from Story 2.3 when present, otherwise `SutraFeature.label`; (b) a **health badge** driven by the Story 2.4 health score; (c) **node count** (`SutraFeature.node_ids.length`); (d) **edge count** (edges with at least one endpoint in the feature's node set, matching the existing `edgeCount()` logic in `src/view.ts`); (e) **contract status** (has a `feature.sutra.md` contract vs. none, from Story 2.1); (f) **issue count** (`SutraFeature.issue_count`).
3. When the AI name is shown, the card carries a visible, unambiguous "AI" marker (badge/pill/icon with a tooltip) distinct from the feature label; when no AI name exists, the heuristic `label` is shown with no AI marker. (Honesty principle 1.)
4. The health badge maps the Story 2.4 score to a small, fixed set of states (e.g. `healthy` / `warn` / `unhealthy` / `unknown`). When a feature has no health score (field absent), the badge renders the `unknown` state — never a fabricated "healthy" — and the grid still renders.
5. The grid is **sortable** by at least: health (worst-first and best-first), issue count (desc), and name (A–Z). The default sort is health worst-first so problems surface immediately. Sort state is applied client-side over the already-loaded `graph.json`.
6. The grid is **filterable by health**: the user can show only features in a chosen health state (e.g. only `unhealthy`, or `unhealthy + warn`). Filtering is additive to sorting and updates the visible card set without reloading.
7. Sorting and filtering are deterministic and stable: equal-key cards keep a stable secondary order (by `SutraFeature.id`) so the same `graph.json` always yields the same card order (supports `sutra diff` / regression, ROADMAP.md principle 3).
8. Clicking (or keyboard-activating) a card opens that feature's drill-down (handed off to Story 3.3). This story only wires the click/keyboard affordance and selection contract; it does not implement the drill-down panel.
9. The grid renders correctly and without errors on a Phase-0-shaped `graph.json` (no AI names, no health scores, no contracts present) and on an enriched `graph.json` (all fields present), proving the optional-field fallbacks (principle 2). A footer/disclaimer continues to state results are heuristic/candidate (carried over from `view.ts`).

## Technical Approach
**Where this lives.** Story 3.1 introduces the viewer app shell (a local dev server + SPA that reads `graph.json`). This story implements the feature-cards landing component inside that shell. The legacy static grid in `src/view.ts` (`renderView` → `cards`) is NOT extended in place; it remains the Phase-0 static fallback. The new interactive grid is a component in the 3.1 viewer app (exact framework/dir set by Story 3.1 — this story adds a `FeatureGrid` / `FeatureCard` unit and a pure, framework-agnostic sort/filter module that can be unit-tested without a DOM).

**Pure core, dumb view (principle 5 — renderer is a leaf).** Add a pure module (NEW, e.g. `src/viewer/feature-cards.ts`, final path aligned to Story 3.1's layout) exporting:
- `cardModel(graph: SutraGraph): FeatureCardModel[]` — derives, per `SutraFeature`, the display fields: `name`, `isAiName: boolean`, `nodeCount`, `edgeCount`, `contractStatus`, `issueCount`, `health`. It reuses the existing `edgeCount` computation from `src/view.ts` (extract/share it rather than duplicate).
- `sortCards(models, key, dir)` and `filterByHealth(models, states)` — pure functions, stable secondary sort by feature `id`.

**Contract fields this story READS (defined by dependency stories, not by this one):**
- AI name/summary — from Story 2.3. Expected to surface as additive, clearly-named optional fields on `SutraFeature` (e.g. `ai_name?: string`, `ai_summary?: string`, with an `ai_*` prefix so provenance is self-documenting). This story treats any such field as **optional**; if absent, `isAiName=false` and `name = SutraFeature.label`.
- Health score — from Story 2.4. Expected as an additive optional field on `SutraFeature` (e.g. `health?: { score: number; band: "healthy"|"warn"|"unhealthy" }` or equivalent). If absent → `health = "unknown"`.
- Contract status — from Story 2.1. Expected as an additive optional flag (e.g. `has_contract?: boolean`). If absent → contract status renders "none".

This story MUST NOT invent the upstream computation. It defines only the **viewer-side `FeatureCardModel` type** and the optional-field reads. If, at execution time, stories 2.1/2.3/2.4 are not yet merged, the grid still ships against the current `SutraFeature` contract (label + node_ids + issue_count) with AI/health/contract showing their fallback states — this is the principle-2 graceful-degradation path, and is explicitly an accepted shippable state.

**GRAPH_VERSION.** This story adds NO new fields to `graph.json` and so does NOT bump `GRAPH_VERSION` (currently `0` in `src/types.ts`). Any version bump is owned by the upstream stories (2.1/2.3/2.4) that actually add fields; this story only consumes them and must tolerate `version` being `0` (Phase-0 graph) or higher. If the viewer needs to branch on schema version, it reads `SutraGraph.version` and degrades gracefully — it never hard-fails on an older graph (principle 4: migrate the viewer, don't break it).

**Honesty rules respected.** Candidate stays candidate: the existing `view.ts` heuristic/candidate disclaimer is preserved in the new grid header. AI names always carry the AI marker (AC3). Health `unknown` is a real, displayed state — the grid never upgrades a missing score to "healthy". Card order is deterministic (AC7) so `sutra diff` over two scans stays meaningful.

## Tasks
- [ ] Confirm the Story 3.1 viewer shell module layout + how it exposes the loaded `SutraGraph`; agree the mount point for the landing grid.
- [ ] Extract the `edgeCount(graph, nodeIds)` helper from `src/view.ts` into a shared util so both the static renderer and the new grid use one implementation (no logic divergence).
- [ ] Add the viewer-side `FeatureCardModel` type and `cardModel(graph)` deriver (NEW `src/viewer/feature-cards.ts`), reading optional `ai_*` / `health` / `has_contract` fields with safe fallbacks.
- [ ] Implement pure `sortCards(models, key, dir)` (health, issues, name) with stable secondary sort by feature `id`.
- [ ] Implement pure `filterByHealth(models, states)`.
- [ ] Build the `FeatureCard` view component: name + AI marker, health badge (4 states incl. `unknown`), node/edge counts, contract status, issue-count badge.
- [ ] Build the `FeatureGrid` container: renders cards, hosts the sort control (default: health worst-first) and the health filter control.
- [ ] Wire card click + keyboard activation (Enter/Space) to emit a feature-selected event for Story 3.3 (no drill-down body in this story).
- [ ] Carry over the heuristic/candidate disclaimer banner from `src/view.ts` into the grid header.
- [ ] Verify graceful rendering against a Phase-0 `graph.json` (no AI/health/contract fields) and an enriched one.
- [ ] Run scan on a real repo (e.g. brain-api or echo-ai) via the existing CLI, load the resulting `graph.json` into the viewer, and confirm the grid renders the real feature set.
- [ ] `npm run build` + `vitest` green before commit (ROADMAP.md principle 7).

## Test Plan
New fixtures under `tests/fixtures/` and new `describe` blocks in `tests/sutra.test.ts` (extending the existing 34-test suite). Because the card logic is pure, the bulk of testing is on `cardModel` / `sortCards` / `filterByHealth` with synthetic `SutraGraph` objects (no DOM, no browser needed).

- **Fixture `tests/fixtures/features-phase0/graph.json`** (NEW) — a minimal Phase-0-shaped graph: `version: 0`, several `SutraFeature` entries with only `id`/`label`/`node_ids`/`issue_count`, no AI/health/contract fields. Proves the optional-field fallbacks: every card gets `isAiName=false`, `health="unknown"`, contract "none", and the grid still builds. Can be hand-authored or produced by running the existing `scan` on the `broken`/`clean` fixtures and trimming.
- **Fixture `tests/fixtures/features-enriched/graph.json`** (NEW) — a graph with `ai_name`, `health`, and `has_contract` populated on a subset of features (and deliberately absent on at least one) to prove mixed-state rendering and that absent fields fall back per-feature, not all-or-nothing.

`describe` blocks in `tests/sutra.test.ts`:
- **"feature-cards — cardModel mapping"**: from `features-enriched`, asserts a feature with `ai_name` yields `isAiName=true` and `name===ai_name`; a feature without it yields `isAiName=false` and `name===label`; `nodeCount`/`issueCount` mirror the `SutraFeature`; `edgeCount` equals the shared `edgeCount()` result for the same node set.
- **"feature-cards — health fallback"**: from `features-phase0`, asserts every card's `health==="unknown"` and none is reported `"healthy"`. (Honesty guard.)
- **"feature-cards — sort"**: asserts default sort is health worst-first; asserts name and issue-count sorts; asserts ties break on feature `id` (determinism / regression guard — same input ⇒ same order across two calls, mirroring the existing "deterministic ids" pattern in section 2 of the suite).
- **"feature-cards — filter"**: asserts `filterByHealth(models, ["unhealthy"])` returns only unhealthy cards and that filter composes with sort.
- **Regression guard**: assert that adding the AI/health/contract reads does NOT change the existing `SutraFeature` outputs of `buildFeatures` (the section-6 `buildFeatures` tests must remain green — this story is additive to the viewer, not to the graph builder).

## Out of Scope
- Computing AI feature names/summaries (Story 2.3), the health score (Story 2.4), or contract status (Story 2.1) — this story only reads and displays them with honest fallbacks.
- The feature drill-down panel: interactive flow graph, issue list, traced request paths (Story 3.3). This story stops at emitting the feature-selected event.
- Free-text search across features/endpoints and view export/share (Story 3.6).
- The cross-repo ecosystem map (Story 3.4).
- Live/watch re-scan on filesystem change (Story 3.5); this story refreshes only when the 3.1 shell reloads `graph.json`.
- Any `GRAPH_VERSION` bump or new `graph.json` fields (owned by upstream feature stories).
- Modifying the Phase-0 static `view.html` output beyond extracting the shared `edgeCount` helper; the static renderer remains as the headless fallback (principle 5).
