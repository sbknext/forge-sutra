# Story 3.3: Feature drill-down

- **Epic:** Epic 3 — Realistic Feature Viewer
- **Status:** Draft
- **Priority:** P0
- **Depends on:** 3.1 (Viewer app shell), 3.2 (Feature cards grid), 2.5 (Request flow tracing), 1.3 (Confidence model)
- **Estimate:** L

## Story
As a developer pointing Sutra at my repo, I want to click a feature card and drop into an interactive drill-down — a real flow graph I can pan/zoom and click through, the feature's issue list with each issue's confidence and provenance, and the actual traced request paths through that feature — so that I can see *how a feature is wired and where it is honestly broken* instead of squinting at a static Mermaid dump.

## Context
Phase 0 shipped exactly one form of drill-down: in `view.ts`, clicking a feature reveals a pre-rendered, static Mermaid sub-graph plus that feature's issue list (BRIEF.md "Two commands only" §2: *"Click a feature → sub-graph (Mermaid) + its issues"*; README.md `sutra view` section). That view is a one-shot HTML document — it cannot pan, zoom, expand a node, follow an edge, or show anything the graph learned after Phase 0. The ROADMAP names this gap directly: Epic 3 *"Replaces the static `view.html` dump with a real viewer"* and Story 3.3 is *"Feature drill-down (interactive flow graph + issue list + traced request paths)"*.

This story is the third rung of the viewer (after 3.1 shell, 3.2 cards) and the first place the viewer pays back the truthfulness work of Epics 1–2. The drill-down is where `SutraIssue` confidence + provenance from Story 1.3 becomes visible, and where the entry→component→call→endpoint→handler→DB paths from Story 2.5 become a thing you can actually trace with your eyes. Per the ROADMAP "renderer is a leaf" principle (cross-cutting #5) and the BRIEF Phase-0 constraint (#3 local-first, single-user), the drill-down consumes `graph.json` and adds **zero** new analysis — it must render whatever 1.3/2.5 put in the contract, and degrade gracefully when those fields are absent (e.g. a graph from an older `GRAPH_VERSION`).

## Acceptance Criteria
1. Clicking a feature card from the Story 3.2 grid navigates to a drill-down view for exactly that `SutraFeature.id`, reading the feature's `node_ids` from `graph.json` (no re-scan, no rebuild — consistent with the 3.1 shell that serves the static `graph.json`).
2. The drill-down renders an **interactive** flow graph (pan, zoom, and node-click) of that feature's induced sub-graph: the nodes in `SutraFeature.node_ids` plus every `SutraEdge` whose `from` and `to` are both in that set, including the synthetic `http:` and `PROXY` targets that Phase-0 scanning already emits. This replaces the static Mermaid block produced by `renderView` in `src/view.ts`.
3. Edges are visually distinguished by `SutraEdge.kind` (`calls | imports | renders | tests | http`) — at minimum a legend mapping kind → line style/color — so a reader can tell a `renders` edge from an `http` edge without reading code.
4. The drill-down shows the feature's issue list: every `SutraIssue` whose `feature` equals the current feature id, grouped by `SutraIssue.kind` (`orphaned_endpoint | missing_handler | dangling_test_ref`) and ordered by `severity` (error → warn → info), with each issue's `message` and `node`.
5. When the loaded `graph.json` carries the confidence fields defined by Story 1.3 (`SutraIssue.confidence?: number` 0..1 and `SutraIssue.provenance?: Provenance` ∈ `ast-exact | heuristic | template-prefix | ai-inferred`), each issue displays its confidence score and provenance, and a `template-prefix`/low-confidence issue is visually distinguished from an `ast-exact` one (mirroring the non-deceptive treatment Story 1.3 added to `view.ts`). When those fields are absent (a `version: 0` graph predating 1.3), the issue still renders using `severity` alone and shows no fabricated confidence number. The UI must never invent a confidence value.
6. When the loaded `graph.json` carries the `flows: SutraFlow[]` array defined by Story 2.5, the drill-down renders the flows whose `entry` node belongs to the current feature as ordered, readable sequences of `SutraFlowStep` (entry → component → call → endpoint → handler → DB terminal), surfacing each flow's `confidence: "confirmed" | "candidate"` and its `terminal` state (`db`/`unresolved`/`truncated`/etc.); when `flows` is absent, a neutral "no traced paths in this graph" empty state is shown — not an error.
7. Every result remains labelled per the claim bounds: candidate findings stay marked "heuristic / candidate", and any AI-derived label that reaches the viewer (e.g. an AI feature summary from Story 2.3, if present) is explicitly badged "AI" — the drill-down never presents heuristic or AI output as confirmed fact (ROADMAP cross-cutting #1; README "Claim Bounds").
8. Clicking a node in the flow graph reveals that node's `SutraNode` detail (`type`, `name`, `file`, `line`, `data_shape`) and its inbound/outbound edges within the feature; the `id` shown is the stable deterministic `relPath#symbol` id so it round-trips with `sutra diff` (cross-cutting #3).
9. The drill-down works on a real graph: opening it on the brain-dashboard scan resolves the feature containing `src/pages/SettingsPage.jsx` and shows the still-detected `missing_handler` for `ProviderToggle` (NOTES.md "Confirmed REAL bug"), and opening it on echo-ai shows a feature whose issue list is dominated by proxied `orphaned_endpoint` candidates without crashing on the 54-issue volume.

## Technical Approach
**Files changed / added.** The drill-down is a viewer-app concern, so it lives in the Story 3.1 viewer app (the local dev-server + SPA introduced by 3.1), not in `src/view.ts`. Concretely:
- The Phase-0 `src/view.ts` `renderView(graph: SutraGraph)` static path is **superseded** for the interactive viewer; it stays as the headless fallback (`sutra view` keeps working — renderer-is-a-leaf) but is no longer the drill-down surface. Do not delete it in this story.
- **NEW** drill-down module/component inside the 3.1 viewer app (e.g. `viewer/src/FeatureDrilldown.*` — exact path inherits whatever framework 3.1 chose; this story does not re-decide the stack). It receives a `SutraFeature` + the full `SutraGraph` and renders three panes: flow graph, issue list, traced paths.
- A small pure helper to compute the induced sub-graph: given `feature.node_ids` and `graph.edges`, return the node set + the edges with both endpoints in the set. Put this in a **NEW** `viewer/src/lib/subgraph.ts` (or co-located util) so it is unit-testable without a DOM.

**Graph library.** Use a real interactive graph lib (e.g. Cytoscape.js or React Flow) rather than static Mermaid, satisfying AC-2 "pan, zoom, node-click". Mermaid remains acceptable only inside the headless `renderView` fallback. The choice must be a runtime dependency of the viewer app, not of the `sutra` scanner core (keep the scanner dependency-light per BRIEF "Forge subcommand").

**Contract / `GRAPH_VERSION`.** This story adds **no** new fields to `graph.json` and therefore does **not** bump `GRAPH_VERSION` itself. It is a pure consumer. The fields it reads are owned upstream: Story 1.3 adds the optional `confidence?`/`provenance?` fields and the `Provenance` type and bumps `GRAPH_VERSION` `0 → 1`; Story 2.5 adds `flows: SutraFlow[]` (with `SutraFlowStep`, `FlowTerminal`) to `SutraGraph` and also bumps to `1`. Story 3.3 must read all of these **defensively** (presence-checked, optional) so it renders correctly against a `version: 0` graph (no confidence, no flows) and a post-1.3/2.5 graph alike. Reference the upstream shapes by name only (`Provenance`, `SutraFlow`, `SutraFlowStep`); do not redefine them here.

**Honesty rules respected.** Candidate vs confirmed: the issue list and any cross-process/proxied edge stay labelled candidate exactly as Phase 0 does. AI-labelled: if a `SutraFeature` label or summary is AI-derived (Story 2.3), badge it "AI". Deterministic ids: node detail shows the raw `relPath#symbol` id from `SutraNode.id`. No new claim language — reuse the README "heuristic / candidate" wording.

## Tasks
- [ ] In the Story 3.1 viewer app, add a route/view for a single feature keyed on `SutraFeature.id`, reachable by clicking a 3.2 card.
- [ ] Implement `subgraph(feature, graph)` pure helper: induced node set from `feature.node_ids` + edges with both endpoints in set; include synthetic `http:`/`PROXY` targets.
- [ ] Integrate an interactive graph lib (Cytoscape.js or React Flow) and render the induced sub-graph with pan/zoom.
- [ ] Style edges per `SutraEdge.kind` and add a kind legend (`calls/imports/renders/tests/http`).
- [ ] Render the feature issue list: filter `graph.issues` by `feature`, group by `kind`, order by `severity`, show `message` + `node`.
- [ ] Add defensive rendering of Story 1.3 confidence + provenance per issue, with a clean fallback to `severity`-only when absent.
- [ ] Add a "traced request paths" pane that renders Story 2.5 `flows` whose `entry` is in this feature as ordered `SutraFlowStep` sequences, surfacing each flow's `confidence` + `terminal`, with a neutral empty state when `flows` is absent.
- [ ] Implement node-click → node detail panel (`type`, `name`, `file`, `line`, `data_shape`, raw `id`, inbound/outbound feature edges).
- [ ] Badge AI-derived feature labels/summaries (if present) and keep all candidate findings labelled "heuristic / candidate".
- [ ] Keep `src/view.ts` `renderView` working as the headless fallback; confirm `sutra view` still emits `.sutra/view.html`.
- [ ] Add fixtures + tests (see Test Plan); ensure full suite + build stay green before commit (cross-cutting #7).

## Test Plan
New fixtures under `tests/fixtures/` and new describe blocks in `tests/sutra.test.ts` (current suite: 34 tests, Sections 1–9). Because the drill-down is UI, the *deterministic* logic to test is the induced-subgraph helper and the defensive field-reading; pure functions get unit tests, DOM behavior gets a thin component/snapshot test in the viewer app.

- **Fixture `drilldown-basic`** (NEW): a tiny repo with one feature whose nodes form a known chain (component → http call → route → handler) plus one in-feature `renders` edge and one cross-feature edge that must be **excluded**. Proves `subgraph(feature, graph)` returns exactly the in-feature nodes and only edges with both endpoints in the set, and that an `http:` synthetic target is retained.
- **Fixture `drilldown-confidence`** (NEW): a `version: 1` `graph.json` whose issues carry Story 1.3 `confidence`/`provenance` (one `ast-exact`, one `template-prefix`). Proves the drill-down surfaces the score/provenance and visually distinguishes the low-confidence item. Pair it with a `version: 0` graph (reuse an existing fixture's emitted graph) to prove the **fallback**: no confidence shown, no fabricated number, issue still renders by `severity`.
- **Fixture `drilldown-flow`** (NEW): a `version: 1` graph containing a `flows` array with one `confirmed` flow ending in a `db` terminal and one `candidate` flow ending `unresolved`, both with `entry` in the feature. Proves ordered `SutraFlowStep` rendering and that `confidence`/`terminal` reach the UI. Pair with a `flows`-less graph to prove the neutral empty state (no thrown error).
- **describe block "Section 10 — feature sub-graph induction"**: unit tests for `subgraph()` against `drilldown-basic` (node count, edge inclusion/exclusion, synthetic-target retention).
- **describe block "Section 11 — drill-down field tolerance"**: asserts the drill-down render input layer reads confidence (1.3) and paths (2.5) when present and degrades cleanly when absent.
- **Regression guard**: a test that loads the brain-dashboard-style fixture (or a minimal stand-in reproducing the `SettingsPage.jsx → ProviderToggle.jsx` `missing_handler`) and asserts the drill-down for that feature still lists the `missing_handler` issue — guarding against the drill-down filter accidentally dropping real bugs (NOTES.md regression guard parity).

## Out of Scope
- **Cross-repo edges** in the drill-down (echo-ai → brain-api): the ecosystem map is Story 3.4; this story renders a single feature within a single `graph.json`.
- **Live / watch refresh** of the drill-down on file change: Story 3.5.
- **Search/filter/share** of features and endpoints from within the drill-down: Story 3.6.
- **Producing** confidence scores or traced paths: owned by Stories 1.3 and 2.5 respectively. This story only consumes them; it must not compute or estimate either.
- **Any `GRAPH_VERSION` bump or new `graph.json` field** — Story 3.3 is a pure consumer.
- **Removing or rewriting** the Phase-0 `renderView`/static `view.html` path — it stays as the headless leaf renderer.
