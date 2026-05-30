# Story 3.5: Live / Watch Mode

- **Epic:** Epic 3 — Realistic Feature Viewer ⭐
- **Status:** Draft
- **Priority:** P1
- **Depends on:** 3.1 (viewer app shell — `sutra viewer` local server + SPA), 1.5 (incremental scan cache)
- **Estimate:** L

## Story
As a developer iterating on an unfamiliar repo, I want `sutra watch` to keep an incremental re-scan
running and push fresh graphs into the already-open viewer SPA, so that the feature view updates live
as I edit code — turning Sutra from a one-shot snapshot into a feedback loop without me re-running
`scan` and clicking "Reload graph" by hand.

## Context
`sutra watch` is currently a Phase-0 stub. In `src/cli.ts`, `scan` carries a `--watch` flag and
`cmdScan` short-circuits with `console.log("watch mode: not implemented in Phase 0")` then
`process.exit(0)`. `README.md` documents `--watch` as reserved for Phase 1, and `BRIEF.md` ("Hard
constraints") states verbatim: "`--watch` flag exists but exits 'not implemented in Phase 0'". This
story implements it.

`_bmad/ROADMAP.md` Epic 3 line 86 defines 3.5 as "Live / watch mode (implements the Phase-0 `--watch`
stub; re-scan on FS change, push to viewer)" and the sequencing diagram (line 106) marks "3.5 live
(needs 1.5)". The two dependencies are load-bearing:

- **1.5 (incremental scan cache).** A full ts-morph scan of echo-ai (~638 nodes) takes ~10s on a cold
  run (`NOTES.md` "Missing Forge Primitives" #2; quoted in Story 1.5's Context). Story 1.5 keeps
  `scan(repoRoot)`'s public signature unchanged but wires a content-hashed `.sutra/cache/index.json`
  internally so a second scan re-parses only changed files and emits byte-identical output (1.5 AC2).
  Story 1.5's own Out of Scope explicitly defers watch to here, and its dependency line names 3.5 as
  the motivating consumer. Watch relies on that warm-scan speed; without it, per-save re-scans would
  feel broken.
- **3.1 (viewer app shell).** Watch needs a *served, re-renderable SPA* to push into. Story 3.1 builds
  `sutra viewer` → `src/viewer/server.ts` exporting `startViewerServer(cwd, opts?)` (Node `node:http`,
  bound `127.0.0.1`), a `GET /graph.json` endpoint that reads `.sutra/graph.json` fresh per request,
  and a zero-build `viewer/` SPA (`index.html` + `app.js` + `styles.css`) that fetches the graph and
  re-renders without a page reload (3.1 AC4). 3.1 deliberately stops at *manual* "Reload graph" and
  hands push-on-change to this story (3.1 Out of Scope, line 71). The static `sutra view` →
  `view.ts:renderView` → `.sutra/view.html` path is render-once and is NOT the live surface; it
  remains an additive offline fallback.

`NOTES.md` ("Missing Forge Primitives" #4, HTML view host) flags that Sutra hand-rolls its serving
layer, and `BRIEF.md` mandates "local-first … serves/opens locally" with "no auth, no login, no
`user_id`, no multi-user anything". So the push channel must stay loopback-only and opt-in. ROADMAP.md
principle 4 ("Graph.json is the contract") and principle 5 ("Renderer is a leaf") bind too: each push
must be a complete, valid `SutraGraph`, atomically emitted after a successful build — never a
partial/delta payload, and the viewer must still only consume graphs, never re-scan.

## Acceptance Criteria
1. A new `sutra watch [repoPath]` command is wired in `src/cli.ts` as a commander
   `program.command("watch [repoPath]")`, alongside the existing `scan`, `view`, and 3.1's `viewer`
   commands. `repoPath` defaults to cwd and resolves to an absolute path exactly as `cmdScan` does
   (`path.resolve(repoPath ?? cwd)`). The "watch mode: not implemented in Phase 0" string is no longer
   reached on the `sutra watch` path (the legacy `scan --watch` flag may keep printing the notice, but
   `sutra watch` is documented as the canonical entry point).
2. On start, `watch` runs an initial `scan(repoRoot)` (warm via the Story 1.5 cache), writes
   `.sutra/graph.json` the same way `cmdScan` does, starts the Story 3.1 server via
   `startViewerServer(cwd, { port })` so the SPA is reachable, prints the single `127.0.0.1` URL, and
   (on macOS) `open`s it — mirroring `cmdViewer`. The server binds loopback only, never `0.0.0.0`
   (BRIEF.md hard constraints; 3.1 AC7).
3. On any change to a watched `.ts/.tsx/.js/.jsx` file under the repo (respecting `EXCLUDED_DIRS` from
   `src/types.ts`), watch re-runs `scan(repoRoot)` — warm via the persisted `.sutra/cache/index.json`
   so only the changed file is re-parsed (Story 1.5 AC2/AC3) — then `runChecks(nodes, edges)` and
   `buildFeatures(nodes, issues)`, assembles the full `SutraGraph` exactly as `cmdScan` does, writes
   `.sutra/graph.json`, and pushes the graph to every connected viewer client.
4. The pushed payload is a **complete, valid `SutraGraph`** conforming to `src/types.ts` (`version`
   === `GRAPH_VERSION`, plus `repo`, `scanned_at`, `commit`, `nodes`, `edges`, `issues`, `features`)
   — never a partial graph or a delta. If a re-scan throws mid-flight, the previous good graph stays
   live and an error is surfaced to the client over a separate status channel; the viewer is never
   handed a partial graph (ROADMAP principle 4; Claim Bounds).
5. Filesystem events are debounced/coalesced behind a single named constant (e.g. `WATCH_DEBOUNCE_MS`,
   default ~200ms) so one editor save that emits unlink+write produces exactly **one** re-scan + one
   push, not two — guarding the partial-state hazard of atomic saves.
6. The Story 3.1 SPA re-renders in place when a new graph arrives over the push channel (no full page
   reload, no server restart): the header counts, feature grid, and detail panels reflect the new
   graph. This reuses the same render path 3.1's "Reload graph" control already invokes after a fresh
   `GET /graph.json` — push just triggers it automatically. Whatever later stories (3.2 cards, 3.3
   drill-down) render inside the shell inherits this live-update path because they consume the same
   in-memory graph the SPA holds.
7. Determinism is preserved: the graph body pushed over the wire for an unchanged tree is byte-
   identical (modulo `scanned_at`) to what `sutra scan` writes to `.sutra/graph.json` and what 3.1's
   `GET /graph.json` serves. Watch introduces **no** new non-deterministic fields into `SutraGraph`;
   any live-only metadata (connection status, last-scan ms) travels in a separate envelope, never
   inside the graph body. `GRAPH_VERSION` is **not** bumped (no body shape change).
8. `Ctrl-C` (SIGINT) shuts down cleanly: the file watcher closes, the Story 3.1 server's `close()` is
   awaited, open push connections end, and the process exits 0 with no orphaned handles.
9. `README.md` is updated — the `--watch` "reserved for Phase 1" note is replaced with real
   `sutra watch` docs (flags, the loopback-only guarantee, the incremental-rescan behavior), and the
   change is recorded in `FIXES.md` (the repo's existing fixes log; there is no `CHANGELOG.md`).

## Technical Approach
**New `src/watch.ts`** exposing `runWatch(repoRoot: string, opts?: { port?: number; out?: string })`,
wired as `program.command("watch [repoPath]")` in `src/cli.ts` (commander style, matching how `scan`/
`view`/`viewer` are registered). It reuses `cmdScan`'s pipeline composition rather than duplicating
it: `const { nodes, edges } = scan(repoRoot); const issues = runChecks(nodes, edges); const features =
buildFeatures(nodes, issues);` then assembles the `SutraGraph` with the same field order, `version:
GRAPH_VERSION`, `scanned_at: new Date().toISOString()`, and `commit` via the existing `getCommit`
helper, and writes it to `.sutra/graph.json` (reuse `graphFilePath(cwd)`). Factor the scan→graph→write
step into a small shared helper so `cmdScan` and `runWatch` cannot drift.

**Reuse the 3.1 server, do not fork it.** `runWatch` calls `startViewerServer(cwd, { port })` from
`src/viewer/server.ts` (3.1) — same `127.0.0.1` bind, same `GET /` SPA + `GET /graph.json` fresh-read
endpoint. It adds **one** push endpoint. Prefer **Server-Sent Events** over WebSocket: SSE is
server→client only (exactly the "push graph to viewer" shape), needs no dependency beyond Node
`node:http` (consistent with 3.1's "no Express, no new web framework" stack decision), and degrades to
a normal page load if the client never connects. Add `GET /events` returning `text/event-stream`; on
each successful re-scan write `event: graph\ndata: <JSON.stringify(graph)>\n\n` to every open response;
on scan failure write `event: scan-error\ndata: <message>\n\n` (status envelope, not graph body).
Implementation choice to record in NOTES.md: either extend `startViewerServer` to optionally accept a
"register SSE client" hook, or have `runWatch` attach its own `request` listener for `/events` to the
returned server. Keep `GET /graph.json` unchanged so a fresh page load still bootstraps from disk
(this is also why writing `.sutra/graph.json` on every re-scan, per AC3, matters — late joiners get
the current graph without a push).

**Reuse 1.5's incremental scan transparently.** Story 1.5 keeps `scan(repoRoot)`'s signature unchanged
and persists `.sutra/cache/index.json` itself, so `runWatch` simply calls `scan(repoRoot)` on each
change and gets a warm scan for free — it does NOT manage the cache or call a `{ cache }` variant (no
such API exists). Watch MUST NOT spin up its own cold full parse path. The first scan primes the cache;
subsequent re-scans re-parse only the changed file.

**File watching — add `chokidar`.** `chokidar` is **not currently a dependency** (current `dependencies`:
`commander`, `ts-morph`, `chalk`); add it to `dependencies` in `package.json`. Watch the repo for
`.ts/.tsx/.js/.jsx` changes, configuring `ignored` to mirror `EXCLUDED_DIRS` from `src/types.ts`
(`node_modules`, `dist`, `build`, `.next`, `.sutra`, `.git`, `coverage`, `out`). Ignoring `.sutra` is
critical: every re-scan writes `.sutra/graph.json` and the 1.5 cache under `.sutra/cache/`, and
watching those would create an infinite re-scan loop. Wrap event handling in a debounce around
`WATCH_DEBOUNCE_MS`; collect changed paths during the quiet window and trigger one `scan(repoRoot)`.

**SPA live-update — extend the 3.1 client.** In `viewer/app.js` (the zero-build SPA 3.1 ships),
subscribe to `/events` via `EventSource`. On `event: graph`, parse the payload and call the same render
function 3.1's "Reload graph" control uses (re-render header counts + feature grid + detail panels in
place — no reload). On `event: scan-error`, show a non-blocking banner while keeping the last good
graph visible. No CDN, no external assets beyond what 3.1 already uses — preserves the local-first
guarantee.

**Honesty / determinism rules respected:**
- Atomic whole-graph pushes only — a graph is emitted *after* a successful full build, never mid-parse
  (AC4; ROADMAP principle 4).
- No new non-deterministic graph fields; live metadata rides the SSE envelope, not `SutraGraph` (AC7).
  `scanned_at` remains the sole non-deterministic body field, exactly as in `cmdScan`.
- The renderer stays a leaf: watch re-runs `scan`/`runChecks`/`buildFeatures` server-side and the SPA
  only consumes the result (ROADMAP principle 5). Watch never re-labels or "promotes" findings; it
  re-runs the identical pipeline.
- `GRAPH_VERSION` (`src/types.ts`) is **not** bumped — this story changes no graph body shape.

## Tasks
- [ ] Add `chokidar` to `dependencies` in `package.json` (currently absent: only `commander`,
      `ts-morph`, `chalk`).
- [ ] Extract a shared `buildAndWriteGraph(cwd, repoRoot)` helper (scan → runChecks → buildFeatures →
      assemble `SutraGraph` → write `.sutra/graph.json`) used by both `cmdScan` and `runWatch` so they
      cannot drift.
- [ ] Add `src/watch.ts` with `runWatch(repoRoot, opts)`; parse `--port` (default = 3.1's viewer
      default) and `--out`.
- [ ] Register `program.command("watch [repoPath]")` in `src/cli.ts`; ensure the `sutra watch` path no
      longer reaches the "not implemented" string.
- [ ] Add a `GET /events` SSE endpoint (`text/event-stream`) on the 3.1 server, tracking the set of
      open responses; leave `GET /` and `GET /graph.json` unchanged. Record the integration approach
      (extend `startViewerServer` vs. attach listener) in NOTES.md.
- [ ] In `runWatch`, start `startViewerServer(cwd, { port })`, run the initial build+write, print/open
      the URL.
- [ ] Add `chokidar` watching with `ignored` mirroring `EXCLUDED_DIRS` (must include `.sutra` to avoid
      a re-scan loop on our own `graph.json`/cache writes).
- [ ] Debounce/coalesce FS events behind `WATCH_DEBOUNCE_MS`; on the quiet edge run one
      `buildAndWriteGraph` and push the result.
- [ ] Wrap each re-scan in try/catch: on success push `event: graph` with the full graph; on failure
      keep the prior graph live and push `event: scan-error` (never push a partial graph).
- [ ] Extend `viewer/app.js` to subscribe to `/events` via `EventSource` and re-render in place on
      `graph` (reusing the 3.1 reload render path); show a non-blocking banner on `scan-error`.
- [ ] Handle SIGINT: close the chokidar watcher, `await` the server's `close()`, end open SSE
      responses, exit 0.
- [ ] Update `README.md` (`--watch` → real `sutra watch` docs + loopback-only note) and add a
      `FIXES.md` entry.
- [ ] Add fixtures + `describe` blocks in `tests/sutra.test.ts`; ensure `tsc` build and `vitest run`
      stay green before commit.

## Test Plan
New fixture: `tests/fixtures/watch-repo/` — a small Next.js-style repo mirroring the existing
`tests/fixtures/clean/` shape (an `app/api/.../route.ts` endpoint + a `lib/client.ts` that fetches it).
Because watch mutates files, tests copy the fixture to a temp dir first (`node:fs` `cpSync` +
`node:os` `tmpdir`), exactly as Story 1.5's test plan does, so committed fixtures are never mutated.
Tests start watch on an ephemeral port (`port: 0`) and tear it down via the SIGINT/`close()` path in
`afterEach`/`finally` so vitest (`vitest run`) exits with no leaked handles.

New `describe` blocks in `tests/sutra.test.ts`:
- **`describe("sutra watch — startup")`**
  - Starts `runWatch` on a temp copy of `watch-repo`; asserts the server binds to `127.0.0.1` (NOT
    `0.0.0.0`) and that `GET /graph.json` returns a valid `SutraGraph` (`version === GRAPH_VERSION`).
    Proves the loopback guarantee (AC2) and reuse of the 3.1 server.
- **`describe("sutra watch — live update")`**
  - Connects an SSE client to `/events`, edits a fixture file (add an exported function or a new
    `route.ts`), and asserts a `graph` event arrives whose payload is a valid `SutraGraph` containing
    the new node id, and that `.sutra/graph.json` on disk was updated too. Proves change → warm
    re-scan → push + write (AC3, AC4).
- **`describe("sutra watch — debounce/coalesce")`**
  - Fires a rapid unlink+write sequence (simulating an atomic editor save) inside the debounce window
    and asserts exactly **one** `graph` event is emitted, not two. Proves AC5.
- **`describe("sutra watch — atomic on error")`**
  - Writes a syntactically broken file; asserts a `scan-error` envelope is emitted and that the last
    `graph` payload received is still the previous good graph (no partial graph pushed). Proves AC4 +
    Claim Bounds.
- **`describe("sutra watch — determinism parity")`** (regression guard)
  - Compares the graph body pushed over SSE against the output of a plain `scan(repoRoot)` +
    `runChecks` + `buildFeatures` for the same unchanged tree; asserts byte-identical modulo
    `scanned_at`. Guards AC7 — watch never diverges from the canonical scan output or leaks live
    metadata into the body. (Mirrors 1.5's byte-identical determinism test.)
- **`describe("sutra watch — ignores .sutra writes")`** (regression guard)
  - Confirms that writing to `.sutra/` (e.g. the 1.5 cache index or `graph.json`) does NOT trigger an
    additional re-scan, proving the `EXCLUDED_DIRS`/`ignored` config prevents a feedback loop.

## Out of Scope
- **Story 1.5 itself** — this story *consumes* the incremental cache transparently via the unchanged
  `scan(repoRoot)` signature; it does not implement `src/cache.ts`, content hashing, or
  `.sutra/cache/index.json`. If 1.5 is unmerged, watch still works correctly but each re-scan is a
  cold full parse (a known performance degradation, not the deliverable).
- **Story 3.1 itself** — `sutra viewer`, `startViewerServer`, the `viewer/` SPA, and `GET /graph.json`
  are 3.1's deliverable; this story only adds the `/events` push channel and the client-side
  `EventSource` subscriber.
- **WebSocket / bidirectional transport** — SSE (server→client only) is sufficient; no client→server
  commands (e.g. "trigger rescan from the viewer") in this story.
- **Delta / patch updates** — the roadmap mandates atomic whole-graph pushes; diffing graphs over the
  wire is deferred and may never be needed (`sutra diff`, Story 1.6, is a separate offline concern).
- **The rich feature UI (3.2 cards / 3.3 drill-down)** — watch makes the shell live; what renders
  inside it is those stories' responsibility.
- **Remote / non-loopback serving, auth, TLS, multi-user** — watch is a single-developer local tool;
  any exposure beyond `127.0.0.1` violates the BRIEF.md hard constraints and is out of scope.
- **Bumping `GRAPH_VERSION`** — no graph body shape change ships in this story.
