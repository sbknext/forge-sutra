# Story 6.5: Viewer — absent link.json / events is not a console error

- Epic: Epic 6 — Hardening
- Status: Superseded by epic-8 (audit 2026-06-11)
- Priority: P1
- Depends on: none
- Estimate: S

## Story

As a developer opening the Sutra viewer on a graph that has no cross-app link
data and no live watch session, I want absent `/link.json` and `/events`
endpoints to render as a calm, empty state instead of throwing console errors,
so that an inactive feature reads as *inactive* — not *broken* — and I trust the
viewer to tell me the truth about what was scanned.

## Context

A real scan (swifter-flows, three Frappe bench apps, feature
`sw_inventory_retrun_flow`) produced a graph with 22 nodes and 19 edges, but the
Ecosystem tab requested `/link.json` and the server responded **404** — the
link file was never generated because no `link` step ran for that scan. The
browser console showed **three errors**: a failed `GET /link.json`, a failed
`GET /events` poll (no watch/SSE session was active), and a failed
`GET /favicon.ico` (the static handler has no route for it). To a viewer, three
red console errors signal a broken tool. In reality nothing is broken — those
features are simply *not present* for this graph.

This is an honesty problem, which is the core principle of the epic
(`ROADMAP.md`: "absent != error; never claim a feature is active when its data
does not exist"). The viewer must distinguish *the feature ran and produced
nothing* from *the feature never ran*, and present *never ran* as a neutral
empty state with zero console noise.

The relevant code:

- **`src/viewer/server.ts`** — the static + JSON HTTP handler. It reads the
  link artifact from disk and returns a 404 when the file is absent. It also
  has no route for `/favicon.ico`, and exposes an `/events` endpoint that the
  client polls even when no watch/SSE producer is running. The 404s are the
  literal source of the console errors.
- **`src/link.ts`** — `linkGraphs(...)` is what writes the link artifact
  (`LINK_FILE`) to disk. It only runs when a link step is invoked via the CLI
  (`src/cli.ts` command wiring). For a single-feature scan with no link step,
  `LINK_FILE` is never created — so the viewer's request for `/link.json` has
  nothing to serve. This is correct backend behaviour; the bug is that the
  *frontend* treats "file absent" as "request failed".
- **`src/flows.ts`** — `FLOW_KINDS = renders | calls | http`. Flows are
  unrelated to link data, but the viewer's flow panel and the ecosystem panel
  share the same "absent vs empty" rendering question; the fix should be
  consistent across both so an empty flow list and an absent link file both
  read as calm empty states, not failures.

Scope is purely viewer (server route behaviour + client fetch handling). No
extractor, edge, or flow-tracing logic changes. The graph contract
(`SutraNode` / `SutraEdge` / `SutraFlow` in `src/types.ts`) is untouched, so
`GRAPH_VERSION` does **not** change.

## Acceptance Criteria

1. When `LINK_FILE` does not exist on disk, `src/viewer/server.ts` responds to
   `GET /link.json` with **HTTP 200** and a well-formed empty-state JSON body
   (e.g. `{ "present": false, "links": [], "apps": [] }`) rather than 404, so a
   `fetch('/link.json')` never rejects or logs a network error.

2. When `LINK_FILE` **does** exist (a `linkGraphs` run produced it), the server
   serves its real contents unchanged with `present: true`, so existing
   multi-app ecosystem behaviour is preserved byte-for-byte aside from the added
   `present` flag.

3. The viewer client reads the `present` flag: when `present` is `false` it
   renders a neutral "No cross-app links for this scan" empty state in the
   Ecosystem tab, with **no** `console.error` and **no** uncaught promise
   rejection.

4. The client does **not** open an `EventSource`/poll against `/events` unless a
   watch/SSE session is known to be active (e.g. a server-injected
   `window.__SUTRA_WATCH__` flag, or a one-shot probe that disables polling on
   first non-OK response). On a static (non-watch) viewer launch, zero `/events`
   requests are made after the initial page load, so zero `/events` console
   errors appear.

5. `src/viewer/server.ts` handles `GET /favicon.ico` explicitly — returning
   either a tiny inline icon (HTTP 200) or a clean HTTP 204 — so the browser's
   automatic favicon request never produces a console error.

6. No change to `SutraEdge.kind`, `FLOW_KINDS`, `makeNodeId`, the node/edge id
   scheme, or any extractor output. The graph and flow JSON contracts are
   identical before and after this story.

7. `GRAPH_VERSION` is **not** bumped, because no on-disk graph/flow/link
   contract field is removed or repurposed (the `present` field is additive and
   defaulted, so older link files without it are read as `present: true`).

8. Opening the viewer on the swifter-flows / `sw_inventory_retrun_flow` graph
   (the graph that originally produced the three errors) yields a browser
   console with **zero** errors and a visible, honest empty Ecosystem state.

## Technical Approach

Parity target is the JS/TS viewer path: serve a typed empty payload rather than
a 404, and let the client branch on data presence — the same pattern the rest of
the viewer already uses for empty graph regions.

**Server (`src/viewer/server.ts`)**

- In the request router, change the `/link.json` branch: before reading
  `LINK_FILE`, check existence. If absent, write `200` with
  `Content-Type: application/json` and body
  `{ present: false, links: [], apps: [] }`. If present, parse the file and
  serve it, injecting `present: true` if the field is missing (additive
  back-compat for older link files written by `linkGraphs`). Candidate shape —
  confirm the existing link payload structure in `src/link.ts` before fixing the
  exact keys; do not invent fields beyond what `linkGraphs` already writes.
- Add a `/favicon.ico` branch that returns `204 No Content` (simplest, no
  binary asset to ship). The favicon is a leaf — it never participates in graph
  rendering.
- For `/events`: if a watch/SSE producer is wired, keep the SSE response path;
  if not, return `204` (or `200` with an empty event stream that immediately
  closes) so a stray client probe does not 404. Prefer to also stop the client
  from probing at all (below) so this becomes belt-and-suspenders.

**Client (viewer HTML/JS served by `server.ts`)**

- Wrap the `/link.json` fetch in a presence check on the JSON body's `present`
  flag instead of relying on HTTP status. Render the empty Ecosystem state when
  `present === false`. Never throw.
- Gate the `/events` `EventSource` behind an explicit watch flag the server
  injects into the page (e.g. `window.__SUTRA_WATCH__ === true`). When the flag
  is false/absent, skip creating the `EventSource` entirely. This removes the
  poll-on-static-launch console error at its source.
- Mirror the same "absent vs empty" treatment used for an empty flow list
  (flows derived over `FLOW_KINDS` may legitimately be empty for a graph that is
  all `imports` edges) so the two empty states are visually and behaviourally
  consistent.

**Why this leaves the graph alone:** `linkGraphs` / `LINK_FILE` generation,
`makeNodeId`, `SutraEdge.kind`, and `flows.ts` are not touched. The 404→200
change is a transport-layer honesty fix; the flow tracer still consumes only
`renders | calls | http` edges exactly as before. Because the link payload gains
only an additive, defaulted `present` field, the contract version is stable.

## Tasks

- [ ] Read `src/viewer/server.ts` and locate the `/link.json` route, the
      `LINK_FILE` path resolution, the (missing) `/favicon.ico` route, and the
      `/events` handler.
- [ ] Read `src/link.ts` `linkGraphs` to confirm the exact shape `LINK_FILE` is
      written in, so the empty-state payload matches its real keys.
- [ ] In `server.ts`, change `/link.json`: serve `200 { present:false, links:[],
      apps:[] }` when `LINK_FILE` is absent; serve real file (with `present:true`
      injected if missing) when present.
- [ ] Add a `/favicon.ico` route returning `204` (or inline icon `200`).
- [ ] Make `/events` return `204`/empty-close when no watch producer is active,
      and inject a `window.__SUTRA_WATCH__` flag into the served HTML reflecting
      whether watch/SSE is on.
- [ ] In the viewer client JS, branch on the `present` flag for the Ecosystem
      tab and render a neutral empty state; remove any reliance on HTTP status.
- [ ] In the viewer client JS, gate the `EventSource('/events')` creation behind
      `window.__SUTRA_WATCH__`.
- [ ] Make the empty-flow rendering and empty-link rendering visually
      consistent (shared "nothing here, and that's fine" component/string).
- [ ] Add the test fixture and viewer-server tests below.
- [ ] Manually launch the viewer on the swifter-flows graph and confirm a clean
      console (AC 8).
- [ ] Confirm `GRAPH_VERSION` is unchanged and note in the PR why no bump is
      required.

## Test Plan

Tests live alongside the existing viewer/server tests and a small fixture under
`tests/fixtures/`.

**Fixture: `tests/fixtures/no-link/`**
A graph directory representing a single-feature scan with **no** `LINK_FILE`
present (only the graph + flows artifacts). This reproduces the swifter-flows
condition: a valid graph whose ecosystem data simply does not exist.

**Server tests (`tests/viewer-server.test.ts` or sibling):**

1. *absent link.json → 200 empty state* — start the viewer server pointed at
   `tests/fixtures/no-link/`, `GET /link.json`, assert status `200` and body
   `{ present: false, links: [], apps: [] }`. Asserts the 404 is gone.

2. *present link.json → 200 real data with present:true* — point the server at a
   fixture that **does** contain a `LINK_FILE` (write one via `linkGraphs` or a
   committed sample), `GET /link.json`, assert status `200`, `present === true`,
   and that the original links/apps survive unchanged. Asserts no regression to
   the real ecosystem path.

3. *favicon → no error status* — `GET /favicon.ico`, assert status is `204` (or
   `200` with an icon `Content-Type`), never `404`.

4. *events without watch → not a 404* — with no watch producer configured,
   `GET /events`, assert status is `204`/`200` (clean), never `404`.

5. *served HTML carries watch flag* — `GET /` for a non-watch launch, assert the
   HTML contains `window.__SUTRA_WATCH__ = false` (or omits the EventSource
   bootstrap); for a watch launch, assert it is `true`.

**Regression guard:**

6. *contract unchanged* — assert the exported `GRAPH_VERSION` equals its
   pre-story value (pin the literal in the test), so any future change that
   alters the graph/flow/link contract and forgets to bump the version fails
   here. This guards AC 6 and AC 7.

(Optional, if a headless browser harness already exists in the repo: a
console-error count assertion of `0` when loading the `no-link` fixture — AC 8.
If no such harness exists, AC 8 is verified manually and that is noted in the
PR.)

## Out of Scope

- Generating link data when it is absent — this story makes *absence* honest, it
  does not make `linkGraphs` run automatically. Auto-linking is a separate
  concern.
- Any change to `linkGraphs`, `LINK_FILE` *generation*, or the link payload
  schema beyond the additive, defaulted `present` flag.
- Any extractor change (`python-frappe.ts`, `ts.ts`), edge-kind change, or
  flow-tracing change. `FLOW_KINDS`, `SutraEdge.kind`, `makeNodeId` are
  untouched.
- Building a real favicon brand asset — a `204` (or trivial inline icon) is
  sufficient to silence the console.
- Live-watch/SSE feature work itself — this story only ensures the viewer does
  not *error* when watch is off; it does not add or change watch capability.
- Bumping `GRAPH_VERSION` (explicitly not required; see AC 7).
