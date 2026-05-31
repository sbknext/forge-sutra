# Story 6.4: Flow tracing verified on Python (directed start->end)

- Epic: Epic 6 — Hardening
- Status: Draft
- Priority: P0
- Depends on: 6.1, 6.2, 6.3
- Estimate: M

## Story

As a Forge user scanning a Frappe codebase, I want the viewer's feature page to render
directed flows that start at a whitelisted endpoint and end at a real terminal (a handler,
a DB write, or an external call) — exactly the way it already does for JS/TS — so that I
can trust the picture as the actual call path rather than the imports star the real scan
produced.

This is the integration-and-verification story for the Python branch. Stories 6.1, 6.2,
and 6.3 make `python-frappe.ts` emit `calls`/`http` edges (local-import resolution,
cross-module call resolution, whitelist/hooks coverage). Story 6.4 closes the loop: it
proves `flows.ts` consumes those edges to produce directed entry->terminal flows at parity
with the TS extractor, and it locks that behaviour with a Frappe fixture and a regression
guard.

## Context

The real scan (`swifter-flows`, three Frappe bench apps, feature `sw_inventory_retrun_flow`)
produced **22 nodes (10 endpoint, 9 function, 3 module), 19 edges all `kind=imports`,
flows=0**, and the viewer rendered an import star instead of a directed flow. The Ecosystem
tab failed because `/link.json` 404'd — `linkGraphs` had never been run.

The relevant facts in the code today:

- `src/flows.ts` only traverses edges whose kind is in `FLOW_KINDS = renders | calls | http`.
  `imports` is deliberately excluded. So an imports-only graph yields **flows=0** by design —
  this is the direct cause of the ground-truth result, not a bug in `flows.ts`. A flow walks
  from an **entry** node along `FLOW_KINDS` edges to a **terminal** node; with no `calls`/`http`
  edges between feature nodes there is nothing to walk.

- `src/extractors/python-frappe.ts` already contains the machinery to emit those edges —
  `extractBodyEdgesForFile`, `emitCallSiteEdges`, `resolveSimpleCall`, `resolveAttributeCall`,
  `parseHooksAssignments`, `hasWhitelistDecorator`, DocType-controller handling, and
  `doc_events`/`scheduler_events` edges. The fact that a real scan still came out imports-only
  means resolution **did not connect** the call sites to the right target node ids under a real
  Frappe bench layout (multi-app, app-name-prefixed module paths, relative imports). 6.1/6.2/6.3
  own those fixes; 6.4 must confirm the result is a directed flow and detect any remaining gap
  in **entry detection** and **terminal resolution** that only surfaces once edges exist.

- `src/extractors/ts.ts` is the parity reference: the TS extractor already emits `calls`/`http`
  edges that `flows.ts` walks into directed flows, which is why JS/TS features render correctly
  while Python features render the star.

- `src/viewer/server.ts` serves the feature graph plus `/link.json` and `/events`; it returns
  **404 for `/link.json` when the file is absent**, which is the honest behaviour the Ecosystem
  tab showed. Producing `/link.json` is `linkGraphs` + `LINK_FILE`, wired in `src/cli.ts`.

Net: the call-edge code exists, but no test proves a Python feature reaches the viewer as a
directed flow. 6.4 is that proof, plus the entry/terminal correctness needed for it to hold.

## Acceptance Criteria

1. For a Frappe fixture where a whitelisted endpoint calls a handler that calls a helper,
   `extractBodyEdgesForFile` (via `emitCallSiteEdges` / `resolveSimpleCall`) emits `SutraEdge`
   records with `kind` in `{ calls, http }` connecting the endpoint -> handler -> helper node ids,
   with **zero** `imports` edges substituting for a resolvable call.

2. Every emitted call/http edge's `from`/`to` is a deterministic id produced by `makeNodeId`
   (and `httpTargetId` for external calls), and both endpoints exist as nodes in the same graph —
   no edge points to a node id that was never emitted.

3. A function carrying `@frappe.whitelist()` (as detected by `hasWhitelistDecorator`) is emitted
   as an **endpoint** node and is treated as a flow **entry** by `flows.ts` — confirmed by the
   fixture's traced flow starting at that endpoint.

4. After scanning the fixture, `traceFlows` (the `flows.ts` entry point) returns at least one
   `SutraFlow` whose path is **directed and length >= 2 edges**, starting at the whitelisted
   endpoint and ending at a terminal (the leaf helper, a DB write, or an external `http` target);
   `flows.length > 0`.

5. The traced flow only traverses edges whose kind is in `FLOW_KINDS`; the assertion proves no
   `imports` edge participates in the path.

6. Parity check: the same scenario authored in TS (or the existing TS fixture) and the Python
   fixture both yield a non-empty directed flow of comparable shape — the test asserts the Python
   flow count and minimum path length are not weaker than the TS reference for the equivalent shape.

7. `linkGraphs` produces `LINK_FILE` (`/link.json`) for a two-graph fixture, and a test asserts
   the file exists and is non-empty so the viewer's Ecosystem tab no longer 404s for that case.

8. Regression guard: a test asserts that a graph containing **only** `imports` edges yields
   `flows=0` (preserving the intended `FLOW_KINDS` exclusion) AND that the Frappe fixture does
   **not** regress to imports-only — i.e. it always emits at least one `calls` edge between
   feature nodes.

9. No change to `GRAPH_VERSION` unless a `SutraFlow`/`SutraEdge` field is added; if 6.4 needs a
   new field on `SutraFlow`, bump `GRAPH_VERSION` and document the migration. Default expectation:
   **no contract change, no version bump.**

## Technical Approach

This story is primarily integration + verification. Code changes are expected to be small and
land only where the fixture exposes a gap left by 6.1/6.2/6.3.

**Edges and ids (parity target = `ts.ts`).** The Python branch must, for a resolvable
in-repo call, emit a `SutraEdge` with `kind: "calls"` whose `from` is the caller's node id and
`to` is the callee's node id, both via `makeNodeId(app, relPosix(path), symbol)` so ids follow
the `app::path#symbol` scheme. External/network calls (e.g. `frappe.make_post_request`,
`requests.*`) emit `kind: "http"` with `to` from `httpTargetId`. This mirrors how `ts.ts`
already feeds `flows.ts`. **Candidate-not-confirmed discipline:** if a call target cannot be
resolved to an emitted node, skip it (do not fall back to an `imports` edge and do not invent a
node). Renderer/leaf nodes remain leaves — a terminal helper has no outgoing `FLOW_KINDS` edge,
which is what lets `flows.ts` stop there.

**Functions in scope (verify; patch only if the fixture fails):**

- `extractBodyEdgesForFile` / `emitCallSiteEdges` / `resolveSimpleCall` / `resolveAttributeCall`
  in `python-frappe.ts` — confirm they resolve across the fixture's module layout and emit
  `calls`/`http` (not `imports`). Any fix here is owned by 6.1/6.2/6.3; 6.4 records the failing
  case if one remains.
- `hasWhitelistDecorator` + endpoint-node emission — confirm whitelisted functions become
  endpoint nodes so they are flow entries.
- `flows.ts` (`traceFlows`, `FLOW_KINDS`, entry/terminal selection) — confirm entry detection
  treats endpoint nodes (incl. whitelisted Python endpoints) as entries and terminal detection
  stops at leaves / DB writes / `http` targets. Only adjust entry/terminal predicates if the
  fixture shows Python endpoints are not picked as entries; keep TS behaviour unchanged.

**How `flows.ts` then consumes them.** Once `calls`/`http` edges connect endpoint -> handler ->
helper, `traceFlows` walks from the endpoint entry along `FLOW_KINDS` to the leaf and emits a
`SutraFlow` with the directed path. No new traversal logic is required if the edges are correct —
that is the whole point of this verification story.

**Linking.** Run `linkGraphs` over the fixture's two graphs to produce `LINK_FILE` so the
viewer Ecosystem tab is exercised, matching the `src/cli.ts` wiring.

## Tasks

- [ ] Add a minimal Frappe fixture under `tests/fixtures/` (multi-file, app-prefixed module
      layout) with a `@frappe.whitelist()` endpoint -> handler -> helper chain and one external
      call.
- [ ] Run the Python extractor over the fixture; capture emitted nodes/edges and assert at least
      one `kind=calls` edge exists between feature nodes (AC1, AC8).
- [ ] Assert every call/http edge's `from`/`to` ids are `makeNodeId`/`httpTargetId` outputs and
      resolve to emitted nodes (AC2).
- [ ] Assert the whitelisted function is an endpoint node and is selected as a flow entry (AC3).
- [ ] Run `traceFlows`; assert `flows.length > 0` with a directed path length >= 2 ending at a
      terminal (AC4) and that no `imports` edge is in the path (AC5).
- [ ] Add/point to a TS reference fixture of the same shape; assert Python is not weaker than TS
      (AC6).
- [ ] Run `linkGraphs`, assert `LINK_FILE` is written and non-empty (AC7).
- [ ] Add the imports-only regression test asserting `flows=0` for an imports-only graph (AC8).
- [ ] If — and only if — the fixture exposes a gap, patch the narrow entry/terminal predicate in
      `flows.ts` or the resolution path in `python-frappe.ts`; keep the diff small and TS parity
      intact.
- [ ] Re-scan `swifter-flows` `sw_inventory_retrun_flow` and capture the viewer feature page
      showing a directed flow (not the imports star) as acceptance evidence.
- [ ] Confirm `GRAPH_VERSION` is unchanged; bump + document migration only if a `SutraFlow`
      field was added.
- [ ] Update the epic README evidence section with before (19 imports / flows=0) vs after
      (calls edges / flows>0) numbers.

## Test Plan

All tests live alongside the existing sutra test suite and use a real Python/Frappe fixture
under `tests/fixtures/` (e.g. `tests/fixtures/frappe-flow/`).

- **Fixture shape:** `app_a/app_a/api.py` defines `@frappe.whitelist() def get_return()` which
  calls `process_return()` (handler in same or sibling module) which calls a leaf helper
  `compute_qty()` and makes one external call. This reproduces endpoint -> handler -> helper
  plus an `http` terminal under an app-prefixed layout like the real bench.

- **Test: emits call edges (AC1, AC2).** Scan the fixture; assert the edge set contains a
  `kind=calls` edge `api.get_return -> process_return` and `process_return -> compute_qty`,
  each id built by `makeNodeId`, each endpoint resolving to an emitted node; assert no `imports`
  edge stands in for a resolvable call.

- **Test: whitelist is an entry (AC3).** Assert `get_return` is an endpoint node and appears as
  a `flows.ts` entry.

- **Test: directed flow exists (AC4, AC5).** Call `traceFlows`; assert `flows.length > 0`, the
  first flow starts at `get_return`, has path length >= 2, ends at `compute_qty` or the `http`
  target, and that every edge kind in the path is within `FLOW_KINDS` (no `imports`).

- **Test: TS parity (AC6).** Run the equivalent TS fixture; assert Python `flows.length` and min
  path length are >= the TS reference for the same shape.

- **Test: link file (AC7).** Run `linkGraphs` over two fixture graphs; assert `LINK_FILE` exists
  and is non-empty (viewer Ecosystem tab no longer 404s).

- **Regression guard (AC8).** Construct a graph with only `imports` edges; assert `traceFlows`
  returns `flows=0`. Separately assert the Frappe fixture never produces zero `calls` edges
  between feature nodes — failing this catches a relapse to the imports-only star.

## Out of Scope

- New extractor features or new edge kinds beyond `calls`/`http`/`renders`/`imports`.
- Resolving dynamic/unresolved call targets (string-built attribute chains, runtime dispatch) —
  those are skipped, not guessed.
- The 6.1/6.2/6.3 resolution work itself (local-import, cross-module, whitelist/hooks coverage);
  6.4 depends on them and only verifies the end-to-end result, patching narrow entry/terminal
  predicates if the fixture forces it.
- Viewer UI/visual redesign beyond confirming the feature page renders the directed flow.
- Changing `FLOW_KINDS` to include `imports` — the imports-only=flows=0 behaviour is intended
  and is protected by the regression guard.
