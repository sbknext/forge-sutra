# Story 1.3: Confidence model & provenance

- **Epic:** Epic 1 — Truthful Graph
- **Status:** Draft
- **Priority:** P0
- **Depends on:** none (independent of 1.1/1.2/1.4, but designed to consume their signals when present)
- **Estimate:** M

## Story
As a developer reviewing a Sutra scan, I want every node, edge, and issue to carry a **confidence score (0..1)** plus a **provenance** label that says *how* the finding was derived, so that I can tell a near-certain broken link apart from a static-approximation guess and triage candidates honestly instead of trusting a flat `error/warn/info` severity.

## Context
Phase 0 expresses certainty with one coarse field only: `SutraIssue.severity` (`error | warn | info` in `src/types.ts`). The ROADMAP "Where we are" section names this directly as a Phase-0 honest limit: *"No confidence score — error/warn/info is coarse; can't say '80% sure'."* The cost is visible in `NOTES.md`: the brain-api `/bot` template-literal finding and the echo-ai 54 proxied `/api/*` findings were all emitted at `severity: "error"` — identical weight to the genuinely broken brain-dashboard `ProviderToggle.jsx` import. The viewer (`src/view.ts`) and the CLI summary (`src/cli.ts`) therefore cannot rank a confirmed break above a known-noisy heuristic guess; a human has to re-derive the certainty by hand from the prose caveats in `NOTES.md`.

This story adds the missing dimension. It introduces a per-element `confidence` number and a `provenance` enum (`ast-exact | heuristic | template-prefix | ai-inferred`) on the graph.json contract, so the truthfulness the ROADMAP demands ("honest about its own uncertainty", cross-cutting principle 1: *Never overstate*) becomes a structured, machine-readable field rather than a footnote. It is the third item on the minimum path to the named goal (1.1 → 1.2 → **1.3** → 1.4 → …) and the substrate later stories (2.4 feature health, 1.6 diff, 3.6 confidence filter) will read.

## Acceptance Criteria
1. `src/types.ts` defines a new exported `Provenance` union type with exactly these members: `"ast-exact" | "heuristic" | "template-prefix" | "ai-inferred"`. A doc comment states the meaning of each (ast-exact = resolved directly from the parsed AST with no guessing; heuristic = directory/name-based inference; template-prefix = only the static prefix of a template literal was extractable; ai-inferred = produced by an LLM, never asserted as fact).
2. `SutraNode`, `SutraEdge`, and `SutraIssue` each gain two **optional** fields: `confidence?: number` (documented as 0..1 inclusive) and `provenance?: Provenance`. Fields are optional so that older `graph.json` files and not-yet-annotated producers remain valid; consumers must treat absence as "unknown confidence".
3. `GRAPH_VERSION` is bumped from `0` to `1` in `src/types.ts` (cross-cutting principle 4: *Graph.json is the contract — bump on any schema change*), and the bump is reflected in the README "graph.json schema" section.
4. `checks.ts:checkOrphanedEndpoints` sets `provenance` + `confidence` per issue using only information already available to it: an orphaned-endpoint issue whose target path was extracted from a complete static string literal gets `provenance: "ast-exact"` with high confidence (e.g. `0.9`); one whose target was a truncated template literal (the `/bot` and `/api/chat/sessions/${id}` classes described in `NOTES.md`) gets `provenance: "template-prefix"` with markedly lower confidence (e.g. `0.4`).
5. `checks.ts:checkMissingHandlers` and `checks.ts:checkDanglingTestRefs` set `provenance: "ast-exact"` with high confidence, because both resolve a concrete local id against the node set (the brain-dashboard `ProviderToggle.jsx` bug is exactly this near-certain class).
6. The scanner's heuristic `feature` grouping (`src/features.ts` / scanner) and any directory-prefix-derived node grouping carry `provenance: "heuristic"`; deterministic AST-extracted nodes (routes, handlers, components with a resolved symbol) carry `provenance: "ast-exact"`. No node is assigned `ai-inferred` in this story (no LLM runs here — that is Epic 2.3).
7. Determinism is preserved: confidence values are computed from fixed rules (no randomness, no timestamps), so two scans of the same commit produce byte-identical `confidence`/`provenance` for the same element — required for `sutra diff` (1.6) and history (4.5), and verified by a regression test.
8. The CLI summary (`src/cli.ts`) and the HTML view (`src/view.ts`) surface confidence non-deceptively: at minimum the issue lines/badges show the provenance label and confidence (e.g. `[ERROR · template-prefix · 0.40]`), and `template-prefix` / low-confidence items are visually distinguished from `ast-exact` ones so a reader is not misled into treating a guess as a confirmed break.
9. All existing tests continue to pass and the build is green; new fixtures + describe blocks prove the confidence/provenance assignment (see Test Plan). The needs-no-network, single-user, local-first constraints (BRIEF.md hard constraints) are untouched.

## Technical Approach
**Contract (`src/types.ts`)** — the load-bearing change:
- Add `export type Provenance = "ast-exact" | "heuristic" | "template-prefix" | "ai-inferred";`
- Add `confidence?: number;` and `provenance?: Provenance;` to `SutraNode`, `SutraEdge`, and `SutraIssue`. Keep them **optional** — additive, non-breaking for any producer that hasn't been updated, but the version bump signals the schema grew.
- `export const GRAPH_VERSION = 1;` (was `0`).
- Optionally add a small `export const CONFIDENCE` rules object (named constants like `AST_EXACT = 0.9`, `TEMPLATE_PREFIX = 0.4`, `HEURISTIC = 0.6`) so the magic numbers live in one place and stay deterministic + auditable. Do **not** invent a calibration model — these are honest, documented heuristics, not statistics.

**Checks (`src/checks.ts`)**:
- `checkOrphanedEndpoints`: it already parses the http target via `parseHttpTargetId`. Thread through whether the source URL was a full literal or a template-prefix. The simplest honest signal available today: a path that is a bare prefix with no further segments and originated from a template literal is lower-confidence. Since the current `scanner` collapses template literals to their static prefix before emitting the `http:` edge, the cleanest place to carry this is a marker on the edge (e.g. the scanner sets `edge.provenance = "template-prefix"` when it truncated a template literal, `"ast-exact"` for a complete string literal). `checkOrphanedEndpoints` then copies the originating edge's provenance onto the issue and picks confidence from `CONFIDENCE`. This keeps the check honest about what it actually knows.
- `checkMissingHandlers` / `checkDanglingTestRefs`: set `provenance: "ast-exact"`, `confidence: CONFIDENCE.AST_EXACT`. Both already resolve a concrete id against `nodeMap`.

**Scanner** (the producer of edges/nodes): when emitting an `http:` edge, record whether the URL came from a complete `StringLiteral` (`ast-exact`) or a truncated `TemplateExpression` prefix (`template-prefix`) by setting the new optional `provenance` on the edge. When emitting nodes, set `provenance: "ast-exact"` for AST-resolved symbols. The directory-prefix `feature` grouping path stays `heuristic`.

**Features (`src/features.ts`)**: features are heuristic groupings; if a confidence/provenance is surfaced at feature level later (2.4), it is out of scope here — this story only annotates nodes/edges/issues. No `SutraFeature` field change.

**View + CLI (`src/view.ts`, `src/cli.ts`)**: render `provenance` + `confidence` alongside severity. In `view.ts` extend `buildDetailPanel`'s issue `<li>` to include a small provenance/confidence chip and add CSS so `template-prefix`/low-confidence reads visibly less alarming than `ast-exact`. In `cli.ts` extend the per-issue summary line. The renderer stays a leaf (cross-cutting principle 5) — it only *reads* the new optional fields and degrades gracefully when they are absent (older graphs).

**Honesty rules respected**: candidate stays candidate — low confidence is shown, never hidden; no element is labelled `ai-inferred` because no AI runs in this story; ids stay deterministic (`relPath#symbol` via `src/util/ids.ts`) and confidence is rule-derived so scans are reproducible.

## Tasks
- [ ] Add `Provenance` type + optional `confidence`/`provenance` fields to `SutraNode`, `SutraEdge`, `SutraIssue` in `src/types.ts`, with doc comments.
- [ ] Bump `GRAPH_VERSION` to `1` and add a `CONFIDENCE` constants object in `src/types.ts`.
- [ ] In the scanner, set `provenance` (`ast-exact` vs `template-prefix`) on each emitted `http:` edge based on whether the URL was a full literal or a truncated template literal; set `ast-exact` on AST-resolved nodes.
- [ ] In `checks.ts:checkOrphanedEndpoints`, copy the originating edge's provenance onto the issue and assign confidence from `CONFIDENCE`.
- [ ] In `checks.ts:checkMissingHandlers` and `checkDanglingTestRefs`, set `provenance: "ast-exact"` + high confidence.
- [ ] Ensure heuristic feature/directory grouping is tagged `provenance: "heuristic"` where it produces node grouping signal.
- [ ] Update `src/cli.ts` issue summary lines to show provenance + confidence.
- [ ] Update `src/view.ts` issue rendering (chip + CSS) so low-confidence/`template-prefix` items are visually distinct and non-deceptive.
- [ ] Update the README "graph.json schema" section: document `version: 1`, the new `confidence`/`provenance` fields, and the four provenance values.
- [ ] Add new fixtures + describe block(s) in `tests/sutra.test.ts`; run full build + test suite green before commit (cross-cutting principle 7; one fix / small diff per AGENT_PLAYBOOK).

## Test Plan
New fixtures under `tests/fixtures/` (alongside existing `clean/`, `broken/`, `proxied/`, `assets/`):
- `tests/fixtures/template-url/` — a client file with a fetch to a **template-literal** URL (e.g. `fetch(\`/api/widgets/${id}\`)`) and no matching route. **Proves**: the resulting `orphaned_endpoint` issue gets `provenance: "template-prefix"` and a confidence strictly below the ast-exact value.
- Reuse `tests/fixtures/broken/` (its `POST /api/capture` fetch is a complete string literal). **Proves**: that `orphaned_endpoint` gets `provenance: "ast-exact"` and the higher confidence — and, critically, that confidence ranks the `broken` finding **above** the `template-url` finding.

New describe block(s) in `tests/sutra.test.ts` (continuing the existing Section 7/8/9 numbering scheme described in `NOTES.md`):
- **Section 10 — confidence & provenance**: asserts `GRAPH_VERSION === 1`; asserts every issue from `runChecks` has a defined `provenance` ∈ the `Provenance` union and a `confidence` in `[0,1]`; asserts the `missing_handler` issue on the `broken`/dashboard-style fixture is `ast-exact`; asserts the `template-url` orphan is `template-prefix` with lower confidence than the `broken` orphan.
- **Regression guard**: scan the same fixture twice and assert the produced `confidence`/`provenance` for each element are byte-identical across runs (determinism, AC7) — protects `sutra diff` (1.6) and history (4.5).
- **Back-compat guard**: feed `renderView`/CLI a graph object *without* `confidence`/`provenance` on its elements (simulating a `version: 0` graph) and assert it renders without throwing — fields are optional and consumers degrade gracefully.

## Out of Scope
- **AI-inferred confidence** — no LLM call happens here. The `ai-inferred` provenance value is *defined* in the type but **not assigned** by any producer in this story; populating it is Epic 2.3 (AI feature inference).
- **Cross-repo confirmation** raising a `template-prefix` candidate to a confirmed link — that is Epic 1.4 (cross-repo linking) and 2.2 (reconciliation); this story only labels, it does not resolve.
- **Feature-level health/confidence aggregation** (`SutraFeature` scoring) — Epic 2.4.
- **A confidence calibration / statistical model** — the values here are documented deterministic heuristics, deliberately not a learned model.
- **Confidence-based filtering UI** in the viewer (slider/filter) — Epic 3.6; this story only displays the values honestly.
- **Dynamic-segment matching changes** to reduce template-literal false positives — Epic 1.2; this story labels the uncertainty rather than removing it.
