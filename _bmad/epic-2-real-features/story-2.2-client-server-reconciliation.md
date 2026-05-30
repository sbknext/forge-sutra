# Story 2.2: Client↔server reconciliation

- **Epic:** Epic 2 — Real Features
- **Status:** Draft
- **Priority:** P0
- **Depends on:** 1.4 (cross-repo linking — consumes its `linkGraphs`/`LinkResult` resolver and `.sutra/link.json` artifact, its `makeCrossRepoId` id convention, and the destination-bearing PROXY `data_shape`); 1.2 (dynamic-segment route matcher — reuses the same `pathMatches` semantics for in-repo matching). Soft-coupled with 1.3 (confidence model — if 1.3 has landed, each reconciliation row carries its score; if not, the binary `confirmed` flag stands in).
- **Estimate:** L

## Story
As an engineer auditing a product, I want one reconciliation report that classifies every client HTTP call as **matched** (resolves to a real handler, in this repo or across a proxied sibling repo), **orphaned** (no handler anywhere), or pairs a defined handler with its caller — and that additionally flags **dead endpoints** (handlers defined but never called) — so that I can see at a glance whether the product's wiring is intact, instead of reading a flat list of single-repo candidate `orphaned_endpoint` issues that go silent the moment a proxy is involved.

## Context
This story is the heart of the North Star's "is the wiring intact?" promise. ROADMAP.md names it on the minimum path to the goal (`1.1 → 1.2 → 1.3 → 1.4 → 2.2 → 2.4 → 3.1 → …`) and describes it as *"match every client call to a real handler across repos"* (Epic 2). The Definition of Done requires Sutra to *"confirm (not just flag) which echo-ai client calls resolve to real brain-api handlers, and which are genuinely broken."*

Story 1.4 supplies the cross-repo machinery — it productized the `reconcile.mjs` prototype into `src/link.ts` exporting `linkGraphs(graphs): LinkResult`, which resolves each proxied client `http` edge to a `LinkedEdge` with `resolution: "confirmed" | "broken" | "unresolved"`, writes `.sutra/link.json` (its own `LINK_VERSION`), and namespaces cross-repo ids via `makeCrossRepoId(repo, nodeId)` → `<repo>::<relPath#symbol>`. But 1.4 stops at the per-edge link result. It does **not** present a feature-centric reconciliation view, and it does **not** detect the reverse direction at all: NOTES.md and BRIEF.md ("The three drift checks") confirm Phase 0 only ever looks client→server — there is no concept of a **handler-without-caller** (a defined endpoint that nothing reaches). For echo-ai that gap is acute: NOTES.md records its entire `/api/*` + `/auth/*` surface delegated to brain-api (54 candidate `orphaned_endpoint`s), and brain-api's own scan found *320 Express endpoints* — many of which may have no caller in the scanned client set.

This story is the reconciliation layer on top of 1.4: it consumes the single-repo graph plus (optionally) the 1.4 `LinkResult`, produces a single symmetric report — matched / orphaned / dead — with provenance per row, and adds the one genuinely new issue class the tool still lacks, `dead_endpoint`. It deliberately reuses 1.4's resolver instead of re-deriving cross-repo matching, honouring the "one copy" principle that 1.4 itself established when it killed the `reconcile.mjs` fork.

## Acceptance Criteria
1. A new pure function `reconcile(graph, link?)` (NEW `src/reconcile.ts`) produces a `SutraReconciliation` from an already-built `SutraGraph` plus an optional `LinkResult` (from Story 1.4's `linkGraphs`). It executes headless with no rendering and no disk I/O, honouring ROADMAP principle 5 ("graph.json must be generatable headless; the renderer only consumes it").
2. The report partitions client calls and endpoints into four disjoint buckets of `SutraReconItem`: **matched** (a client `http` edge resolves to exactly one handler), **orphaned** (a client call resolves to no handler and is not covered by any proxy prefix), **dead** (an `endpoint`/`route` node with zero resolved inbound callers), and **unresolved** (a proxied call whose destination repo was not supplied to `link`, mirroring 1.4's `resolution: "unresolved"` — never reported as matched or orphaned).
3. In-repo matching reuses the shared matcher Story 1.4 lifted out of `checks.ts` into `src/util/` (`pathMatches`, `parseEndpointDef`, `parseHttpTargetId`, `normalisePath`, `segments`, `isDynamic`), so a dynamic call such as `GET /api/chat/sessions/${id}` (the NOTES.md echo-ai example) matched to a defined `GET /api/chat/sessions/:id` route is bucketed **matched**, not orphaned. `reconcile.ts` MUST NOT contain its own copy of path-matching logic.
4. Cross-repo matching consumes Story 1.4's `LinkResult`: a `LinkedEdge` with `resolution: "confirmed"` becomes a **matched** item whose `handler_node` is the resolved cross-repo id (`<repo>::<relPath#symbol>` from `makeCrossRepoId`) and whose `repo` field is the destination repo name; a `LinkedEdge` with `resolution: "broken"` becomes an **orphaned** item carrying the destination repo; a `LinkedEdge` with `resolution: "unresolved"` becomes an **unresolved** item. When no `LinkResult` is passed (single-repo scan), proxied calls fall into **unresolved**, never matched or orphaned.
5. The **dead** bucket (reverse pass) flags every `endpoint`/`route` node that is never the resolved target of any matched item — in-repo or cross-repo. Synthetic `PROXY ` route nodes (`name` begins `"PROXY "`) are excluded. Each dead item is honestly labelled `confirmed: false`, because absence of a caller in the *scanned* code is not proof the endpoint is unreachable (it may be called by an un-scanned client, e.g. a mobile app or curl) — consistent with ROADMAP principle 1 ("Never overstate").
6. Each `SutraReconItem` records provenance with no AI involvement: the originating client node id (`client_node`, from the `http` edge's `from`, or `null` for a dead item), the resolved handler node id (`handler_node`, or `null` for orphaned/unresolved), the parsed `method` + `path`, the `repo` it resolved in (`"self"` or a destination repo name), and a binary `confirmed` boolean. No field is labelled AI; this is a deterministic structural pass.
7. The failure buckets project onto the existing `SutraIssue` contract: an **orphaned** item maps to the existing `kind: "orphaned_endpoint"` (`severity: "error"`) for backward compatibility, and a **dead** item is emitted under a NEW `IssueKind` value `"dead_endpoint"` (`severity: "warn"`). Cross-repo confirmed-break issues remain Story 1.4's responsibility — `reconcile` MUST NOT double-emit a second `orphaned_endpoint` for a call 1.4 already reported as a confirmed break; it consumes 1.4's result rather than re-running the break detection. **matched** and **unresolved** items are NOT emitted as issues.
8. Adding `"dead_endpoint"` to the `IssueKind` union and attaching a `reconciliation: SutraReconciliation` field to `SutraGraph` is a breaking schema change: `GRAPH_VERSION` is bumped from `0` to `1` in `src/types.ts`, and `view.ts` (the current renderer) is updated to tolerate `version >= 1` and ignore the new field gracefully (it does not need to render it — that is Epic 3).
9. Determinism holds (ROADMAP principle 3): two `reconcile` runs over the same `graph` + `link` inputs produce deep-equal `SutraReconciliation`, with every bucket sorted by `client_node` then `handler_node` (dead items sorted by `handler_node`). This keeps Story 1.6 `sutra diff` stable over the reconciliation field.

## Technical Approach
**New file `src/reconcile.ts`**, exporting `reconcile(graph: SutraGraph, link?: LinkResult): SutraReconciliation`. Pure over its inputs; no `fs`, no `ts-morph`, no rendering. It is wired into the pipeline by `cli.ts`; the renderer never calls it.

**Reuse 1.4's lifted matcher — do not duplicate.** Story 1.4's tasks move `pathMatches`, `normalisePath`, `segments`, `isDynamic`, `parseEndpointDef`, `parseHttpTargetId` out of `checks.ts` into `src/util/` (e.g. `src/util/http-match.ts`). `reconcile.ts` imports from that one module. If 1.4 has not yet landed when this story is executed → STOP and surface to the planner (this story hard-depends on that extraction and on `linkGraphs`). Also reuse `collectProxyPrefixes` / `isCoveredByProxy` to decide whether an unmatched in-repo call is genuinely orphaned (no proxy) versus proxied (defer to the `LinkResult` / unresolved bucket).

**Algorithm.**
1. Build the endpoint-def list once from `graph.nodes` where `type` ∈ `endpoint | route`, excluding synthetic `PROXY ` nodes, via `parseEndpointDef`. Keep a node-id index for the reverse pass.
2. Forward pass over `graph.edges` where `kind === "http"` and `to` starts with `http:` (parse with `parseHttpTargetId`): (a) attempt in-repo match via `pathMatches` → **matched** (`repo: "self"`, `confirmed: true`). (b) If unmatched: consult the `link` `LinkResult` for a `LinkedEdge` covering this `from`+target — `confirmed` → **matched** (cross-repo, `handler_node` = the `LinkedEdge.to`, `repo` = destination), `broken` → **orphaned** (cross-repo, defer issue emission to 1.4 per AC7), `unresolved` → **unresolved**. (c) If unmatched, no link entry, and `isCoveredByProxy` is true → **unresolved** (proxied-out, destination not supplied). (d) If unmatched, no link entry, not proxy-covered → **orphaned** (`repo: "self"`, emit `orphaned_endpoint`).
3. Reverse pass: any endpoint/route node id never recorded as a matched `handler_node` → **dead** (`severity: "warn"`, `confirmed: false`). Default behaviour flags all unreferenced endpoints; do not special-case "public entrypoints" in this story (kept simple + honest; refine in 2.4 if noisy).
4. Sort every bucket deterministically; assemble `SutraReconciliation`.

**New / changed types in `src/types.ts`:**
- Extend `IssueKind`: add `"dead_endpoint"`.
- `export type ReconStatus = "matched" | "orphaned" | "dead" | "unresolved";`
- `export interface SutraReconItem { client_node: string | null; handler_node: string | null; method: string; path: string; repo: string; status: ReconStatus; confirmed: boolean; }` (`repo` = `"self"` or a destination repo name).
- `export interface SutraReconciliation { matched: SutraReconItem[]; orphaned: SutraReconItem[]; dead: SutraReconItem[]; unresolved: SutraReconItem[]; }`
- Add `reconciliation: SutraReconciliation` to `SutraGraph`.
- Bump `export const GRAPH_VERSION = 1;` (AC8 — breaking schema change, per ROADMAP principle 4).

**Wiring in `src/cli.ts` (`cmdScan`):** after `runChecks(...)`, optionally load `.sutra/link.json` if present (so a prior `sutra link` run feeds reconciliation), call `reconcile(graph, link)`, attach `reconciliation` to the `graph` object before write, and append the projected `dead_endpoint` (`warn`) issues to the issue list. The single-repo `orphaned_endpoint` issues already produced by `runChecks` / 1.4 remain the source of truth for orphaned — to avoid double-counting, `reconcile`'s orphaned projection is reconciled against existing issues (dedupe on `method + normalisePath(path)`), OR `cmdScan` makes `reconcile` the single producer of orphaned issues and drops the duplicate from `runChecks` — pick one, document it in the PR, keep all prior tests green. Add a `dead_endpoint` count plus matched/orphaned/unresolved counts to the one-screen stdout summary.

**`src/view.ts`:** bump its tolerated version check to accept `version >= 1` and ignore `reconciliation` without crashing (rendering it is Epic 3.2/3.3).

**Honesty rules respected:** cross-repo `matched` is `confirmed: true` only when 1.4 returned `resolution: "confirmed"`; proxied-but-no-destination is `unresolved` + `confirmed: false` (AC4); dead endpoints are `warn` + `confirmed: false` (AC5); no AI fields; ids stay deterministic via `relPath#symbol` + `makeCrossRepoId`.

## Tasks
- [ ] Confirm Story 1.4 has landed (its `src/util/http-match.ts` extraction, `linkGraphs`/`LinkResult`, `makeCrossRepoId`, and PROXY `data_shape` destination). If not, STOP and surface to planner — do not re-implement cross-repo matching here.
- [ ] Add `"dead_endpoint"` to `IssueKind`; add `ReconStatus`, `SutraReconItem`, `SutraReconciliation`; add `reconciliation` to `SutraGraph`; bump `GRAPH_VERSION` to `1` in `src/types.ts`.
- [ ] Create `src/reconcile.ts` exporting `reconcile(graph, link?)`: forward pass (in-repo → `LinkResult` confirmed/broken/unresolved → proxy-covered-unresolved → orphaned) and reverse dead-endpoint pass, importing the shared matcher from `src/util/`.
- [ ] Wire `reconcile` into `cli.ts` `cmdScan`: load optional `.sutra/link.json`, attach `reconciliation` to the graph, project `dead_endpoint` (warn) into issues, dedupe orphaned against existing issues (or make `reconcile` the single orphaned producer — document the choice).
- [ ] Update `view.ts` to tolerate `version >= 1` and ignore the `reconciliation` field without error.
- [ ] Add matched / orphaned / dead / unresolved counts to the `cmdScan` stdout summary in the existing chalk style.
- [ ] Enforce deterministic ordering of all four buckets (sort by `client_node` then `handler_node`).
- [ ] Update README.md: add `reconciliation` to the graph.json schema section, add `dead_endpoint` to the Structural checks table, and bump the documented `version` to `1`.
- [ ] Add fixtures + describe blocks to `tests/sutra.test.ts` (see Test Plan).
- [ ] Run `npm run build` + `npm run test` (vitest); confirm all prior 34 tests stay green plus the new ones (ROADMAP principle 7).

## Test Plan
New fixtures under `tests/fixtures/` (mirroring the existing `broken` / `clean` / `proxied` / `assets` layout, and the `xrepo-client` / `xrepo-server` pair Story 1.4 introduces):

- **`tests/fixtures/reconcile-self/`** — a Next.js App Router `app/api/chat/sessions/[id]/route.ts` exporting `GET` and `POST`, a client component fetching `` `/api/chat/sessions/${id}` `` with `GET`, and a second fetch to `POST /api/missing`. Proves: the dynamic `GET` call → **matched** (`repo: "self"`); `POST /api/missing` → **orphaned** (`repo: "self"`, `orphaned_endpoint`); the defined `POST /api/chat/sessions/:id` that nothing calls → **dead** (`dead_endpoint`, `warn`, `confirmed: false`).
- **`tests/fixtures/reconcile-dead/`** — defines two endpoints, only one with a client `fetch`. Proves the reverse pass emits exactly one `dead_endpoint` (`warn`) for the uncalled endpoint and zero for the called one.
- **Reuse `tests/fixtures/xrepo-client/` + `xrepo-server/`** (from Story 1.4) — drive `reconcile(clientGraph, linkGraphs([clientGraph, serverGraph]))`. Proves: `POST /api/widgets` → **matched** (cross-repo, `handler_node` = `makeCrossRepoId("xrepo-server", <route id>)`, `repo: "xrepo-server"`, `confirmed: true`); `GET /api/ghost` → **orphaned** (cross-repo, no duplicate `orphaned_endpoint` beyond 1.4's confirmed break — AC7); and `reconcile(clientGraph)` with `link` omitted → both proxied calls land in **unresolved** (`confirmed: false`), never matched and never orphaned (AC4 honesty guard).

New describe blocks in `tests/sutra.test.ts` (continuing the Section-7/8/9 numbering convention; Story 1.4 occupies Sections 10–14, so begin at 15):
- **Section 15 — reconcile in-repo buckets:** assert matched / orphaned / dead membership for `reconcile-self`, including the specific dynamic-route matched item and the `POST /api/missing` orphaned item.
- **Section 16 — dead-endpoint reverse pass:** exactly one `dead_endpoint` `SutraIssue` with `severity: "warn"` and `confirmed: false` from `reconcile-dead`.
- **Section 17 — cross-repo matched vs unresolved:** the `xrepo` pair with the `LinkResult` present yields a cross-repo **matched** item; the same client scanned with `link` omitted yields **unresolved**, `confirmed: false`, and zero added `orphaned_endpoint`.
- **Section 18 — no double-emit (AC7 guard):** with the `LinkResult` present, a `broken` `LinkedEdge` for `GET /api/ghost` produces exactly one `orphaned_endpoint` issue total across `runChecks` + `reconcile`, not two.
- **Section 19 — determinism:** two `reconcile` runs over `reconcile-self` produce deep-equal `SutraReconciliation`.
- **Regression guard:** re-run existing Section 9 (`broken` fixture still yields `orphaned_endpoint` for `POST /api/capture`) and Section 7 (`proxied` fixture still yields zero `orphaned_endpoint`) — confirming the `cmdScan`/issue-projection refactor reintroduced neither the proxy-blindness false positive nor dropped the genuine static orphan.

## Out of Scope
- **Building or modifying the cross-repo resolver** — `linkGraphs`/`LinkResult`/`.sutra/link.json`/`makeCrossRepoId`/the destination-bearing PROXY `data_shape` are all Story 1.4. This story only *consumes* them and adds the matched/dead/unresolved presentation layer.
- **Payload / contract reconciliation** — comparing request/response `data_shape` bodies across a matched client↔handler pair is the `feature.sutra.md` contract layer (Story 2.1). This story stops at METHOD + path wiring.
- **Confidence scoring numerics** — `confirmed` is a binary here; the graded score + provenance object is Story 1.3 (this story degrades gracefully if 1.3 is unshipped).
- **Feature health composition** — rolling matched/orphaned/dead ratios into a per-feature score is Story 2.4.
- **Request flow tracing** — chaining client → component → call → endpoint → handler → DB into a path is Story 2.5; this story stops at the single client-call ↔ handler pair.
- **Viewer rendering** of the reconciliation report (feature cards, cross-repo map) is Epic 3 (3.2/3.4); here `view.ts` is only made to tolerate `version: 1`.
- **Non-HTTP wiring** (events, queues, RPC) and **non-TS/JS handlers** (Python/Frappe, Epic 4.2) — HTTP edges only this story.
