# Story 2.5: Request flow tracing

- **Epic:** Epic 2 — Real Features
- **Status:** Draft
- **Priority:** P1
- **Depends on:** 1.2 (dynamic-segment route matcher), 1.4 (cross-repo linking); soft dependency on 1.3 (confidence model). Feeds 3.3 (feature drill-down).
- **Estimate:** L

## Story
As a developer pointing Sutra at my product, I want it to trace a real request flow — from an entry point (a route page or a component) through the renders/calls/http chain to the endpoint, its handler, and any database or external call the handler makes — so that I can answer "what actually happens when a user clicks X?" by reading code-derived structure instead of guessing.

## Context
Phase 0 produces a flat bag of `nodes` and `edges`. The viewer renders a Mermaid sub-graph per feature, but there is no notion of an *ordered path* through the graph: the edges exist (`renders`, `calls`, `http`, `imports`), but nothing walks them end-to-end to say "this entry leads to that handler." The ROADMAP names this gap directly — Epic 2.5 "Request flow tracing (entry → component → call → endpoint → handler → DB, as a path)" — and the Definition of Done requires the viewer to "drill into a real traced request flow." This story produces the data layer for that; the rendering of it is Story 3.3.

This is only honest once the graph stops lying about where an http edge lands. NOTES.md (echo-ai, Repo 1) documents that echo-ai delegates its entire `/api/*` surface to brain-api via a `next.config` rewrite, so an http edge's target may be a *cross-repo* handler, not a local one. A flow that stopped at `http:POST /api/chat/sessions` and called it "the end" would be useless and misleading. Therefore tracing must consume the cross-repo resolution from Story 1.4 and the dynamic-segment matcher from Story 1.2 — otherwise the terminal hop of most real flows would be a dangling http target or a false `orphaned_endpoint`. Per the cross-cutting principles, an unresolved terminal hop must be labelled a *candidate* boundary, never silently dropped or asserted as confirmed.

## Acceptance Criteria
1. A new optional top-level array `flows: SutraFlow[]` is added to the `SutraGraph` interface in `src/types.ts`, with a new exported `SutraFlow` type. `GRAPH_VERSION` is bumped from `0` to `1` because this is an additive-but-schema-changing field that downstream consumers (the Story 3.3 viewer) must branch on.
2. Each `SutraFlow` is an **ordered** structure: it carries `steps: SutraFlowStep[]` where every step references a real `SutraNode.id` (the `node` field) and the `edge` (a `{ from, to, kind }` matching an existing `SutraEdge`, or `null` for the first/entry step). The first step's node must be of type `route` or `component`; the ordering of steps reflects the traversal direction entry → terminal.
3. Edge kinds are traversed in their natural request direction only: `renders` (component → child component), `calls` (module/fn → fn), `http` (caller → `http:METHOD /path` target). An `imports` edge is **not** a flow hop (it is a static dependency, not a runtime step) and must never appear as a step's `edge.kind`.
4. When a flow reaches an `http` edge whose target resolves (via the Story 1.4 cross-repo link or a local endpoint match using Story 1.2's `pathMatches`) to a concrete endpoint/handler node, the flow continues into that handler and, if the handler contains a recognised DB/external call, emits a terminal step of a new node form (see Technical Approach). When the target does **not** resolve, the flow ends with `terminal: "unresolved"` and is marked as a candidate boundary — it must NOT be presented as confirmed.
5. Each `SutraFlow` carries a `confidence: "confirmed" | "candidate"` field. A flow is `"confirmed"` only if every hop is backed by a deterministic edge AND every `http` hop resolved to a real handler (locally or cross-repo); any unresolved http hop, any dynamic-segment guess, or any external-host terminal forces `"candidate"`. (If Story 1.3's confidence model has landed, reuse its provenance vocabulary rather than inventing a parallel one.)
6. Flow ids are deterministic and stable across re-scans: `flow:<entryNodeId>` (e.g. `flow:app/login/page.tsx#LoginPage`). Re-running `scan` on an unchanged repo produces byte-identical `flows` ordering (sorted by `id`), preserving the `relPath#symbol` id contract so `sutra diff` (Story 1.6) can diff flows later.
7. Tracing is bounded: cycles are detected and broken (a node already on the current path is not re-entered), and a maximum depth is enforced so a pathological graph cannot produce unbounded output. Hitting the depth cap ends the flow with `terminal: "truncated"`.
8. Every emitted DB/external terminal is **code-derived and labelled** — no AI inference in this story. A terminal is only emitted when a handler statically contains a recognised data-access call (e.g. a `.query(`/`.execute(` style DB call, `prisma.*`, `knex`, `fetch`/`axios` to an external host). The detection heuristic and its limits are documented in NOTES.md; uncertain terminals are `candidate`.
9. `view.ts` is updated only enough to not crash on the new `flows` field and `GRAPH_VERSION = 1` (it may ignore `flows` for now; rich rendering is Story 3.3). The CLI summary in `cli.ts` prints a one-line `N flows traced (M confirmed, K candidate)` count.

## Technical Approach
**New file: `src/flows.ts`** — exports `buildFlows(nodes: SutraNode[], edges: SutraEdge[], crossRepoIndex?): SutraFlow[]`. This is the analogue of `features.ts:buildFeatures` and `checks.ts:runChecks`: a pure function over the already-built `nodes`/`edges`, called from `cli.ts:cmdScan` after `runChecks` and `buildFeatures`. It must not re-parse source — it consumes the existing graph, honouring principle 5 ("renderer is a leaf"; the graph stays headless-generatable).

**Traversal:** Build adjacency maps from `edges` keyed by `from`, but only for the request-direction kinds (`renders`, `calls`, `http`) — reusing the same edge vocabulary already produced by `scanner.ts` Pass 2 (the `fetch`/`axios` http edges built around `httpTargetId`, the JSX `renders` edges, and the identifier `calls` edges). Entry points = nodes of type `route` or `component` that are not themselves the `to` of any `renders` edge (i.e. top-of-tree). Walk depth-first from each entry, recording a `SutraFlowStep` per hop.

**Resolving the http terminal:** when a step's edge is `http`, parse the target with the existing `http:METHOD /path` convention (`util/ids.ts:httpTargetId`, mirrored by `checks.ts:parseHttpTargetId`). Match it against endpoint/route nodes using `checks.ts:pathMatches` / `isDynamic` (extracted to a shared helper if needed so `flows.ts` and `checks.ts` don't drift) — this is the Story 1.2 dependency. If unmatched locally, consult the Story 1.4 cross-repo index to resolve to a handler in the linked repo; the resolved handler's id becomes the next step's node. If still unmatched, end with `terminal: "unresolved"` (candidate). Proxy-covered paths (`checks.ts:collectProxyPrefixes` / `isCoveredByProxy`) are NOT orphans here — they are cross-repo boundaries and must route through the 1.4 index, not be flagged.

**New types in `src/types.ts`:**
```ts
export const GRAPH_VERSION = 1; // bumped from 0 — adds flows[]

export type FlowTerminal = "handler" | "db" | "external" | "unresolved" | "truncated";

export interface SutraFlowStep {
  node: string;                 // a SutraNode.id
  edge: SutraEdge | null;       // the edge taken into this node; null for entry
}

export interface SutraFlow {
  id: string;                   // "flow:<entryNodeId>" — deterministic
  entry: string;                // entry SutraNode.id
  steps: SutraFlowStep[];       // ordered entry -> terminal
  terminal: FlowTerminal;
  confidence: "confirmed" | "candidate";
}

export interface SutraGraph {
  // ...existing fields...
  flows: SutraFlow[];           // NEW — ordered request paths
}
```
The DB/external terminal does NOT introduce a new `NodeType`; it is captured by `SutraFlowStep.terminal`-adjacent metadata on the flow, keeping `NodeType` stable. (Adding a `db` NodeType would be a larger contract change — push to Epic 4 if a real node is wanted.)

**Honesty rules respected:** deterministic ids (`flow:` prefix over the stable entry id); candidate vs confirmed made explicit on every flow; no AI fields (terminal detection is static/heuristic and documented); `GRAPH_VERSION` bumped because the contract changed.

## Tasks
- [ ] Add `SutraFlow`, `SutraFlowStep`, `FlowTerminal` types and `flows: SutraFlow[]` to `SutraGraph` in `src/types.ts`; bump `GRAPH_VERSION` 0 → 1.
- [ ] Extract `pathMatches` / `isDynamic` / `parseHttpTargetId` from `checks.ts` into a shared helper (e.g. `src/util/http-match.ts`) and re-import in both `checks.ts` and the new `flows.ts` so matching logic cannot drift.
- [ ] Create `src/flows.ts` with `buildFlows(nodes, edges, crossRepoIndex?)`: adjacency build (request-direction kinds only), entry-point detection, DFS with cycle + depth guards.
- [ ] Implement http-terminal resolution: local endpoint match (1.2), then cross-repo index (1.4), else `terminal: "unresolved"`.
- [ ] Implement static DB/external terminal detection inside resolved handlers (`.query`/`.execute`/`prisma.*`/`knex`/external `fetch`/`axios`); document heuristic + limits.
- [ ] Compute `confidence` per flow (confirmed only if all hops backed + all http resolved); sort flows by `id` for determinism.
- [ ] Wire `buildFlows` into `cli.ts:cmdScan` (after `buildFeatures`); add `flows` to the written graph; print `N flows traced (M confirmed, K candidate)` summary line.
- [ ] Update `src/view.ts` to tolerate `GRAPH_VERSION = 1` and the presence of `flows` without crashing (no rich render yet).
- [ ] Add fixtures + describe blocks to `tests/sutra.test.ts` (see Test Plan).
- [ ] Update `README.md` graph.json schema section (new `flows[]`, `version: 1`) and `NOTES.md` (terminal-detection heuristic + its candidate boundaries).
- [ ] Run build + full vitest suite green before commit; confirm existing `broken` / `proxied` / `assets` regression sections still pass.

## Test Plan
New fixtures under `tests/fixtures/` plus new describe blocks in `tests/sutra.test.ts` (following the existing Section-N convention used for `proxied`/`assets`/`broken`):

- **`tests/fixtures/flow-local/`** — a self-contained Next.js-style repo: `app/widget/page.tsx` (a `route`) renders `<WidgetButton/>` (a `component`) which `fetch('/api/widget', { method: 'POST' })`, and `app/api/widget/route.ts` exports `POST` whose body calls `db.query(...)`. **Proves:** one `SutraFlow` is emitted with ordered steps entry(route) → renders(component) → http → handler → db terminal; `terminal: "db"`, `confidence: "confirmed"`; flow id `flow:app/widget/page.tsx#...`.
- **`tests/fixtures/flow-dynamic/`** — client `fetch(\`/api/item/${id}\`)` against `app/api/item/[id]/route.ts`. **Proves:** the Story 1.2 matcher lets the flow continue through the dynamic segment to the handler, and the resulting flow is `candidate` (dynamic-segment guess) not `confirmed`.
- **`tests/fixtures/flow-unresolved/`** — a component `fetch('/api/ghost')` with no matching route and no proxy/cross-repo link. **Proves:** the flow ends `terminal: "unresolved"`, `confidence: "candidate"`, and is NOT dropped from `flows`.
- **`tests/fixtures/flow-cycle/`** — two components that render each other. **Proves:** cycle detection terminates the walk (no infinite loop, bounded `steps`), and depth-cap behaviour yields `terminal: "truncated"` when applicable.
- **Determinism test:** call `buildFlows` twice on the same fixture and `expect` deep-equal output, and assert `flows` is sorted by `id` — guards the stable-id / diff requirement (AC 6).
- **Regression guard:** assert the existing `proxied` fixture still yields zero `orphaned_endpoint` issues AND that a proxied http hop in a flow routes to a cross-repo/unresolved boundary rather than being flagged — confirming Story 2.5 did not reintroduce the proxy-blindness false positive eliminated in NOTES.md (2026-05-29).
- **Schema test:** assert the written graph has `version === 1` and a `flows` array, and that `view.ts:renderView` does not throw on it.

## Out of Scope
- **Rendering** the traced flows in the viewer (interactive flow graph, clickable steps) — that is Story 3.3 (feature drill-down). This story stops at the `flows[]` data in `graph.json`.
- **AI naming / summarising** of flows — Story 2.3 owns LLM inference; all terminal/flow labels here are code-derived only.
- **Building the cross-repo index itself** — that is Story 1.4; this story *consumes* it via an optional `crossRepoIndex` parameter and degrades to single-repo (more `unresolved` terminals) when absent.
- **Non-TS/JS handlers** (Python/Frappe DocType events, whitelisted methods) — Epic 4.2. DB-terminal detection here covers only JS/TS data-access call shapes.
- **Test-coverage overlay** on flows ("which flows are untested") — Story 2.6.
- **Persisting / diffing flows over time** — `sutra diff` is Story 1.6; this story only guarantees the deterministic ids that make that diff possible later.
