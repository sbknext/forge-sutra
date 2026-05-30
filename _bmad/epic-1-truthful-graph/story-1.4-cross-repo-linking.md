# Story 1.4: Cross-repo linking

- **Epic:** Epic 1 — Truthful Graph
- **Status:** Draft
- **Priority:** P0
- **Depends on:** 1.2 (dynamic-segment route matcher — its `pathMatches` semantics are reused for cross-repo matching); soft-coupled with 1.3 (confidence model — if 1.3 lands first, cross-repo resolution emits provenance; if not, this story degrades gracefully). Not blocked by 1.1, 1.5, 1.6.
- **Estimate:** L

## Story
As an engineer scanning the echo-ai + brain-api pair, I want Sutra to resolve a proxied client call (e.g. `POST /api/auth/send-otp` in echo-ai) against the actual route handler in the destination repo (brain-api) so that the finding is **confirmed** — either a real cross-repo link or a real cross-repo break — instead of being silently swallowed as a `candidate` proxied path.

## Context
Phase 0 is single-repo. NOTES.md ("Repo 1: echo-ai", lines on the full-delegation finding) documents the central limitation: echo-ai defines essentially **zero local API route handlers** — its entire `/api/*` and `/auth/*` surface is delegated to brain-api via a single `next.config` rewrite. The Fix-1 proxy work (`scanner.ts:detectProxyNodes`, `checks.ts:isCoveredByProxy`) stopped the 54 false-positive `orphaned_endpoint` issues by **skipping** any path covered by a proxy prefix — but skipping is not confirming. As NOTES.md says verbatim: "Whether each of these 54 paths actually exists on brain-api is a Phase-1 cross-repo reconciliation (brain-api's own scan found 320 Express endpoints)." Today a proxied call that targets a path brain-api does **not** define is invisible: Sutra neither flags it nor confirms it.

FIXES.md line 19 names the exact gap this story closes: "**The destination URL is parsed away.** `rewriteSourceToPrefix` keeps only the `source` prefix; the `destination` (`http://localhost:3457/...`) is discarded. Cross-repo linking (Phase 1) will need to read the destination to know WHICH repo to resolve against." A throwaway prototype already exists — `reconcile.mjs` at the repo root — which loads two `graph.json` files and matches client `http` edges against server endpoint nodes; it is explicitly "NOT wired into CLI." This story productizes that prototype, reads the rewrite **destination** the scanner currently throws away, and turns proxy-covered candidates into confirmed cross-repo edges or confirmed cross-repo breaks. This is the gate the ROADMAP names in the minimum path to the goal (`1.1 → 1.2 → 1.3 → 1.4 → 2.2 → …`) and in the Definition of Done: "Sutra **confirms** (not just flags) which echo-ai client calls resolve to real brain-api handlers, and which are genuinely broken."

## Acceptance Criteria

1. `scanner.ts:detectProxyNodes` (and the `extractNextRewrites` helper it calls) MUST preserve the rewrite **destination**, not only the `source` prefix. Each emitted proxy node carries the destination it routes to, so a later resolver knows which repo to check. Concretely, `extractNextRewrites` returns `{ sourcePrefix: string; destination: string }[]` (or the proxy node gains a `data_shape` of the form `"PROXY /api -> http://localhost:3457/api/:path*"`), and the existing `collectProxyPrefixes`/`isCoveredByProxy` path in `checks.ts` continues to work unchanged for the single-repo case.

2. A new CLI command `sutra link <graph-a.json> <graph-b.json> [...more]` resolves cross-repo `http` edges: for every `http` edge in graph A whose target path is covered by one of A's proxy prefixes, attempt to match it (method + path, using the same `pathMatches` segment semantics as `checks.ts`) against an `endpoint`/`route` node in the graph whose repo the destination points to. The command is additive — neither `scan` nor `view` change behaviour.

3. Resolution produces, per cross-repo `http` edge, exactly one of three labelled outcomes: **confirmed link** (a destination-repo endpoint matches), **confirmed break** (the path is proxied to a known destination repo, but no endpoint in that repo matches → a real cross-repo orphan), or **unresolved** (destination repo graph not supplied, or proxy target host is external/unknown → stays `candidate`, never silently dropped).

4. A confirmed link is materialised as a new edge in the merged output with `kind: "http"` and a `to` that is the **resolved destination-repo endpoint node id** (not the `http:METHOD /path` synthetic id). The edge MUST be distinguishable as cross-repo (e.g. its `to` id is namespaced by repo, see Technical Approach) so the viewer (Epic 3.4) and reconciliation (Epic 2.2) can render the echo-ai↔brain-api map.

5. A confirmed break emits a `SutraIssue` with `kind: "orphaned_endpoint"`, `severity: "error"`, and a message that states it is **cross-repo confirmed** (e.g. `"Client calls POST /api/foo, proxied to brain-api, but brain-api defines no matching handler."`). This is the first issue class in the tool that is genuinely **confirmed**, not candidate — the message MUST say so and MUST name the destination repo.

6. Honesty rule (ROADMAP cross-cutting principle 1): an unresolved cross-repo edge MUST remain explicitly labelled `candidate` in any output and MUST NOT be reported as a break. Absence of the destination graph is never evidence of a break. No silent fallback (CLAUDE.md "No silent fallbacks") — if a destination cannot be resolved, say "unresolved: destination graph not provided", do not guess.

7. Determinism (ROADMAP principle 3): cross-repo resolution uses the existing deterministic node ids (`relPath#symbol` via `makeNodeId`) plus a stable repo namespace; re-running `sutra link` on the same inputs produces byte-identical output. No timestamps in the per-edge resolution result beyond the top-level `linked_at`.

8. `GRAPH_VERSION` (currently `0` in `types.ts`) is bumped to `1` **only if** the on-disk `graph.json` shape changes (i.e. if proxy nodes gain a destination field that lands in `graph.json`). If the destination is carried only in the new `link` command's separate output artifact and `graph.json` is untouched, `GRAPH_VERSION` stays `0` and the new artifact gets its own `LINK_VERSION` constant. The story MUST pick one and the executor MUST honour ROADMAP principle 4 ("Graph.json is the contract. Bump `GRAPH_VERSION` on any breaking schema change").

9. The `reconcile.mjs` root-level prototype is either deleted or reduced to a one-line pointer to the new command — it MUST NOT remain as a second, divergent code path for the same logic (CLAUDE.md "One fix, one commit"; avoid drift).

## Technical Approach

**Files that change:**

- `src/scanner.ts` — `extractNextRewrites` and `detectProxyNodes`: stop discarding the rewrite `destination`. The current regex `source\s*:\s*['"`]([^'"`]+)['"`]` captures only `source`; add a companion capture for `destination` (parse each rewrite object, not just loose `source:` strings, so source↔destination stay paired). `rewriteSourceToPrefix` is unchanged. The PROXY route node gains its destination in `data_shape` (e.g. `"PROXY /api -> http://localhost:3457/api/:path*"`), reusing the existing `data_shape` field — no new node field, so `graph.json` shape is additive-compatible.

- `src/cli.ts` — register a third `commander` command `link` alongside `scan`/`view`, with a `cmdLink(graphPaths: string[])` handler mirroring `cmdScan`/`cmdView` structure (read files, run resolver, write artifact, print one-screen summary). The summary prints confirmed-link / confirmed-break / unresolved counts in the same chalk style as `cmdScan`.

- **NEW** `src/link.ts` — the resolver. Exports `linkGraphs(graphs: SutraGraph[]): LinkResult`. Internally it: (a) builds a repo registry keyed on `SutraGraph.repo`; (b) for each graph, reads its proxy nodes' destinations (parsed from `data_shape`) to map `sourcePrefix → destinationHostPath`; (c) maps a destination host/port to a repo in the registry (Phase-1 heuristic: match on the destination path prefix against another graph's endpoint set, OR an explicit `--map <prefix>=<repo>` flag — destination host/port → repo mapping is itself a candidate unless the user confirms it, see AC6); (d) for each cross-repo `http` edge, reuse `pathMatches`/`parseHttpTargetId`/`parseEndpointDef` semantics (lift the shared helpers out of `checks.ts` into `src/util/` so both `checks.ts` and `link.ts` import one copy — no duplication, ROADMAP principle, and kills the `reconcile.mjs` fork). Emits confirmed links, confirmed breaks, unresolved.

- **NEW types in `src/types.ts`** — `LinkResult` / `LinkedEdge` / `LinkVersion`. A `LinkedEdge` carries `from` (client node id, repo-namespaced), `to` (destination endpoint node id, repo-namespaced), `kind: "http"`, and `resolution: "confirmed" | "broken" | "unresolved"`. Repo-namespaced id format: `<repo>::<relPath#symbol>` (the `::` separator is new; document it next to `makeNodeId` in `util/ids.ts` with a `makeCrossRepoId(repo, nodeId)` helper so it is deterministic and centralised). Add `LINK_VERSION = 0`. Do **not** mutate `SutraGraph` unless AC8's graph-shape branch is taken; per AC8 default, keep the destination in `data_shape` (already part of the v0 schema), so `GRAPH_VERSION` stays `0`.

- `reconcile.mjs` — delete (its logic now lives in `src/link.ts`, imported by tests and CLI). Per AC9.

**Honesty rules respected:** confirmed vs candidate is explicit in `LinkedEdge.resolution`; a destination-repo mapping that the user did not confirm is itself treated as candidate (the break is only "confirmed" once both the proxy destination → repo mapping AND the no-matching-endpoint fact hold). AI is not involved in this story, so no AI-labelled fields. Ids stay deterministic via `makeNodeId` + `makeCrossRepoId`.

## Tasks
- [ ] In `scanner.ts`, extend `extractNextRewrites` to capture each rewrite's `destination` paired with its `source`; keep `rewriteSourceToPrefix` behaviour intact.
- [ ] In `detectProxyNodes`, write the destination into the PROXY node's `data_shape` as `"PROXY <prefix> -> <destination>"`; verify single-repo `checks.ts:isCoveredByProxy` still passes (prefix parsing must tolerate the new `data_shape` — it reads `name`, not `data_shape`, so confirm no regression).
- [ ] Lift `pathMatches`, `normalisePath`, `segments`, `isDynamic`, `parseEndpointDef`, `parseHttpTargetId` from `checks.ts` into `src/util/` (e.g. `src/util/http-match.ts`); re-import them in `checks.ts` so there is exactly one copy.
- [ ] Add `makeCrossRepoId(repo, nodeId)` to `src/util/ids.ts` with the `<repo>::<nodeId>` convention; document determinism.
- [ ] Add `LinkResult`, `LinkedEdge`, `LINK_VERSION` to `src/types.ts`; do NOT bump `GRAPH_VERSION` (AC8 default branch — graph.json shape unchanged).
- [ ] Create `src/link.ts` exporting `linkGraphs(graphs, opts)` implementing repo registry → destination mapping → per-edge resolution (confirmed/broken/unresolved).
- [ ] Support an explicit `--map <destPrefix>=<repo>` option so the destination→repo mapping is user-confirmable (AC6); when absent, attempt the heuristic match but label the result candidate/unresolved if ambiguous.
- [ ] Register `sutra link <graph-a> <graph-b> [...]` in `cli.ts` with a one-screen chalk summary (confirmed links, confirmed breaks, unresolved counts).
- [ ] Write the link artifact to `.sutra/link.json` (separate file, own `LINK_VERSION`); do not overwrite `graph.json`.
- [ ] Delete `reconcile.mjs` (or replace with a one-line pointer to `sutra link`).
- [ ] Update README.md "Commands" + "Claim Bounds" to add `sutra link` and to state that cross-repo breaks are confirmed only when the destination repo graph is supplied; everything else stays candidate.
- [ ] Add NOTES.md entry recording the first **confirmed** echo-ai → brain-api resolution counts, mirroring the existing per-repo validation tables.

## Test Plan

New fixtures under `tests/fixtures/`:

- `tests/fixtures/xrepo-client/` — a mini Next.js client with a `next.config.js` (match the existing `proxied` fixture, which uses `.js`, not `.mjs`) rewriting `{ source: '/api/:path*', destination: 'http://localhost:9999/api/:path*' }` and a `src/client.ts` that does `fetch('/api/widgets', { method: 'POST' })` (exists on server) **and** `fetch('/api/ghost', { method: 'GET' })` (does NOT exist on server). Proves the destination is parsed and two distinct outcomes are produced.
- `tests/fixtures/xrepo-server/` — a mini Express/Next server defining `POST /api/widgets` (an `app.post('/api/widgets', …)` or `app/api/widgets/route.ts` with `export function POST`) but NOT `/api/ghost`. Proves confirmed-link vs confirmed-break.

New `describe` blocks in `tests/sutra.test.ts` (continuing the Section-7/8/9 convention from NOTES.md):

- **Section 10 — destination preserved:** scan `xrepo-client`, assert the PROXY node's `data_shape` contains the destination `http://localhost:9999/...` (and that `name` still starts with `"PROXY "` so the existing Section-7 assertion on PROXY-node `name` is unaffected), and that single-repo `runChecks` on `xrepo-client` still returns zero `orphaned_endpoint` (proxy-cover regression guard — must match Fix-1 behaviour).
- **Section 11 — confirmed link:** `scan` both fixtures, `linkGraphs([client, server])`, assert `POST /api/widgets` resolves to `resolution: "confirmed"` with a `to` equal to `makeCrossRepoId("xrepo-server", "<route id>")`.
- **Section 12 — confirmed break:** same inputs, assert `GET /api/ghost` resolves to `resolution: "broken"` and that a `SutraIssue` with `kind: "orphaned_endpoint"`, `severity: "error"`, and a message naming the destination repo is produced.
- **Section 13 — unresolved stays candidate (honesty guard):** call `linkGraphs([client])` with the server graph omitted; assert every proxied edge is `resolution: "unresolved"`, zero `"broken"` issues are emitted, and nothing is reported as confirmed. This is the regression guard for ROADMAP principle 1 / AC6.
- **Section 14 — determinism:** run `linkGraphs` twice on identical inputs; assert deep-equal output (no nondeterministic ordering, no per-edge timestamps).
- **Regression guard:** re-run the existing Section 7 (`proxied` fixture) assertions to confirm Fix-1 single-repo proxy suppression is untouched by the `data_shape`/helper-extraction changes.

## Out of Scope
- **Client↔server payload/contract reconciliation** (matching `data_shape` request/response bodies across the link) — that is Epic 2.2.
- **Non-proxy cross-repo calls** (absolute-URL fetches to another repo's host without a `next.config` rewrite) — only rewrite-declared proxy destinations are resolved this story.
- **Dynamic / external-host destinations** beyond marking them `unresolved` — the external-host allowlist is Story 1.1; the dynamic-segment matcher is Story 1.2 (reused, not built here).
- **The cross-repo viewer map** (rendering repos as clusters with edges between them) — Epic 3.4 consumes this story's `link.json`; this story does not touch `view.ts` rendering beyond what AC4 requires for id namespacing.
- **A confidence score** on the resolution — if Story 1.3 has not landed, `resolution` is the three-state enum only; 1.3 later layers a score on top.
- **Python/Frappe destinations** — TS/JS only this phase (BRIEF.md hard constraint); a rewrite pointing at a Frappe backend resolves to `unresolved` until Epic 4.2.
