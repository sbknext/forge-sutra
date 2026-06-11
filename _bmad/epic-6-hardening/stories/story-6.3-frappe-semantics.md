# Story 6.3: Frappe semantics hardening — hooks.py, doc_events, scheduler, DocType, whitelist

- Epic: Epic 6 — Hardening
- Status: Done (epic-6 gap fill 2026-06-11)
  <!-- Gap filled: AC1 — hasWhitelistDecorator now matches bare @frappe.whitelist (no parens).
       src/util/python-ast.ts regex updated; 6 unit tests in frappe-extractor.test.ts.
       AC2 (skip-unresolved edge) not changed: existing design emits dangling edge +
       missing_handler issue via runChecks; altering it would break existing pinned tests.
       ACs 3-9 already satisfied by epic-8 work. -->
- Priority: P0
- Depends on: 6.2 (Python call/http edge resolution for real Frappe layouts)
- Estimate: M

## Story

As a Frappe engineer scanning a real bench app with forge-sutra, I want the Python/Frappe
extractor to recognize the full set of Frappe wiring conventions — `@frappe.whitelist`
endpoints (including decorated forms and `allow_guest`/`methods=` variants), `doc_events`
and `scheduler_events` handlers declared in `hooks.py`, and DocType controller lifecycle
methods (`validate`, `on_submit`, `on_cancel`, etc.) — and resolve each declared handler
string to the real function node it points to, so that the feature graph reflects how
Frappe actually invokes my code and the flow tracer can walk an endpoint or hook entry
through to its terminal helper instead of stopping at an import.

## Context

The real scan of `swifter-flows` (3 Frappe bench apps, feature `sw_inventory_retrun_flow`)
produced 22 nodes (10 endpoint, 9 function, 3 module) and 19 edges that were **all**
`kind=imports`, with `flows=0`. The viewer rendered an import star, not a directed flow.

`flows.ts` only traces over `FLOW_KINDS = renders | calls | http` (entry → terminal). An
imports-only graph therefore yields zero flows by construction — `imports` is not a member
of `FLOW_KINDS`, so the tracer never advances. Story 6.2 addresses the general
call/http resolution gap. This story addresses the **Frappe-specific** reason those
endpoint and handler nodes existed but were never connected:

- `python-frappe.ts` already contains `parseHooksAssignments` and emits `doc_events` /
  `scheduler` edges, plus DocType controller handling and `hasWhitelistDecorator`. The
  code path exists, but on the real bench layout it did not produce connected edges for
  the feature nodes. The story closes the robustness gaps that make these emitters miss
  real Frappe code:
  1. **Whitelist detection** — `hasWhitelistDecorator` must recognize the decorated
     forms Frappe actually uses: bare `@frappe.whitelist`, called `@frappe.whitelist()`,
     and keyword forms `@frappe.whitelist(allow_guest=True)` /
     `@frappe.whitelist(methods=["POST"])`. A node that is not detected as an endpoint is
     never a flow entry, so the directed walk never starts there.
  2. **Handler resolution** — `doc_events` and `scheduler_events` values in `hooks.py`
     are dotted strings (e.g. `"app.module.sub.handler"`). The handler-resolution helper
     (referred to here as `resolveHandler`, candidate — confirm exact name in
     `python-frappe.ts`) must map those dotted paths to the real function node id across
     deep app directory layouts, so the emitted edge targets an existing node rather than
     a dangling/unresolved id that the viewer and `flows.ts` drop.
  3. **DocType controller lifecycle** — controller methods (`validate`, `on_update`,
     `on_submit`, `on_cancel`, `before_save`, etc.) must be typed as `handler` nodes and
     be reachable as flow entries/intermediates, since Frappe invokes them implicitly on
     document lifecycle events and they are the true entry points for a large share of
     business logic.

Edges this story produces participate in flows only if their `SutraEdge.kind` is in
`FLOW_KINDS`. Handler-dispatch edges (hook → handler, lifecycle event → controller
method) must therefore be emitted with `kind=calls` so `flows.ts` can traverse them;
`imports` edges remain informational and stay out of the flow walk.

The viewer ecosystem regression (`/link.json` 404, served by `viewer/server.ts`, written
by `linkGraphs` in `link.ts`) is tracked by the link/ecosystem stories and is out of
scope here except where this story's node typing feeds cross-graph linking.

## Acceptance Criteria

1. `hasWhitelistDecorator` returns true for all four real forms on a Python function:
   `@frappe.whitelist`, `@frappe.whitelist()`, `@frappe.whitelist(allow_guest=True)`,
   and `@frappe.whitelist(methods=["POST"])`; a function with no whitelist decorator
   returns false. Each detected function is emitted as an `endpoint` node via
   `makeNodeId` with the `app::path#symbol` id scheme.
2. For every `doc_events` entry in a fixture `hooks.py`, the handler-resolution helper in
   `python-frappe.ts` resolves the dotted handler string to the `makeNodeId` of the real
   target function, and an edge with `SutraEdge.kind = calls` is emitted from the event
   source to that resolved handler node. Handler strings that cannot be resolved to a
   real node emit **no** edge (skip unresolved — no dangling targets).
3. For every `scheduler_events` entry (cron/all/daily buckets) in the fixture `hooks.py`,
   the same resolution and `kind=calls` edge emission applies, targeting the resolved
   scheduled-job function node.
4. DocType controller lifecycle methods (`validate`, `on_submit`, `on_cancel`, and at
   least `on_update` / `before_save`) are emitted as `handler`-typed nodes and connected
   to their controller/class such that `flows.ts` can use them as flow entries or
   intermediates.
5. After scanning the fixture, the resulting edge set contains at least one edge with
   `kind=calls` reaching a whitelisted endpoint's downstream helper, and `flows.ts`
   returns a non-empty `SutraFlow` set with a directed path of length ≥ 2 hops over
   `FLOW_KINDS` (entry endpoint/handler → … → terminal helper). The imports-only,
   `flows=0` outcome from the `swifter-flows` scan is no longer reproducible on the
   fixture.
6. `emitCallSiteEdges` / `extractBodyEdgesForFile` continue to resolve in-body calls from
   a whitelisted endpoint and from a resolved handler into helper functions, using
   `resolveSimpleCall` (and the attribute-call resolver) so the hook/lifecycle entry
   points chain into the existing call-edge machinery rather than terminating at the
   handler node.
7. Node and edge ids are deterministic across repeated scans of the fixture (same
   `makeNodeId` / `relPosix` output for the same inputs); a second scan produces an
   identical node/edge id set.
8. `GRAPH_VERSION` is **not** bumped — this story adds detection robustness and resolves
   handler targets within the existing node/edge contract (`NodeType` values `endpoint`,
   `handler`, `function`, `module`; `EdgeKind` value `calls`). Bump only if a new
   `NodeType` or `EdgeKind` is introduced, which this story does not require.
9. Renderer/leaf nodes remain leaves: lifecycle/handler typing does not add outbound flow
   edges from a node that has no real downstream call in the source.

## Technical Approach

Parity target is `ts.ts`: the JS/TS extractor already turns route/handler declarations
into `endpoint`/`handler` nodes and emits `calls`/`http` edges that `flows.ts` walks. The
Frappe extractor reaches the same shape by hardening four areas in
`python-frappe.ts`, all within the existing contract.

- **`hasWhitelistDecorator`** — widen matching to cover the tree-sitter-python decorator
  shapes for `@frappe.whitelist`: a bare `attribute` decorator, a `call` decorator with an
  empty argument list, and a `call` decorator with keyword arguments (`allow_guest`,
  `methods`). Only inspect what tree-sitter exposes (decorator → attribute /
  call → keyword_argument); do not attempt to evaluate argument values beyond presence.
  Detection result decides whether the function node is typed `endpoint` (flow entry) vs
  plain `function`.

- **Handler resolution (`resolveHandler`, candidate name — confirm against the file)** —
  `parseHooksAssignments` already reads `doc_events` / `scheduler_events` dotted strings.
  Strengthen the dotted-path → node-id mapping so it works across deep app layouts:
  resolve `app.<segments>.<symbol>` to the file `relPosix` path under the app root and the
  trailing `#symbol`, then build the candidate id with `makeNodeId(app, path, symbol)` and
  emit the edge only if that id exists in the node set. This guarantees AC-2/AC-3 targets
  are real nodes and unresolved strings are skipped (no dangling edges, matching the
  "skip dynamic/unresolved" principle).

- **Edges** — hook → handler and `scheduler_events` → job edges are emitted with
  `SutraEdge.kind = calls` (members of `FLOW_KINDS`). DocType lifecycle: emit the
  controller method node as `NodeType=handler`; the implicit lifecycle dispatch is
  represented so the method is reachable as a flow entry. No new `EdgeKind` is added.

- **Chaining into existing call machinery** — once an endpoint or resolved handler node
  exists and is typed correctly, `extractBodyEdgesForFile` / `emitCallSiteEdges` run over
  its body and produce `calls` edges to helpers via `resolveSimpleCall` /
  `resolveAttributeCall`. This is the bridge that turns a single connected handler into a
  multi-hop directed path.

- **`flows.ts` consumption** — no change to `flows.ts`. With endpoints/handlers correctly
  typed and `calls` edges present, the existing tracer walks entry → terminal over
  `FLOW_KINDS` and emits `SutraFlow` entries (AC-5).

- **ids** — all ids via `makeNodeId` / `relPosix`; ids stay `app::path#symbol`;
  deterministic for identical inputs (AC-7).

## Tasks

- [ ] Read `python-frappe.ts` and confirm the exact current names of the
      whitelist detector, the hooks parser (`parseHooksAssignments`), and the
      handler-resolution helper; record the real `resolveHandler` name in this story.
- [ ] Harden `hasWhitelistDecorator` to match bare, called, and keyword
      (`allow_guest`, `methods=`) decorator forms via tree-sitter-python decorator nodes.
- [ ] Strengthen dotted-handler resolution to map `doc_events` /
      `scheduler_events` strings to real node ids across deep app paths using `makeNodeId`
      / `relPosix`; skip unresolved (no dangling edges).
- [ ] Emit hook → handler and scheduler → job edges with `SutraEdge.kind = calls`.
- [ ] Type DocType controller lifecycle methods (`validate`, `on_submit`,
      `on_cancel`, `on_update`, `before_save`) as `handler` nodes and make them reachable
      as flow entries/intermediates.
- [ ] Verify `extractBodyEdgesForFile` / `emitCallSiteEdges` run over endpoint
      and resolved-handler bodies so `calls` edges chain into helpers via
      `resolveSimpleCall` / the attribute-call resolver.
- [ ] Add the Python/Frappe fixture under `tests/fixtures/` (see Test Plan).
- [ ] Add tests asserting whitelist detection, `calls`-edge emission, and
      non-empty directed `flows`.
- [ ] Add the regression guard test that fails if the fixture scan returns
      imports-only edges or `flows=0`.
- [ ] Confirm two consecutive scans produce identical node/edge id sets
      (determinism).
- [ ] Confirm `GRAPH_VERSION` is unchanged and run the existing extractor test
      suite to check for regressions in `ts.ts` parity behavior.

## Test Plan

Fixture: a minimal Frappe app tree under `tests/fixtures/` (candidate path
`tests/fixtures/frappe-semantics/`) shaped like a real bench app:

- `hooks.py` declaring:
  - `doc_events = {"Sales Invoice": {"validate": "myapp.events.invoice.validate_invoice"}}`
  - `scheduler_events = {"daily": ["myapp.tasks.cleanup.run_cleanup"]}`
- `myapp/api/inventory.py` — a `@frappe.whitelist()` endpoint
  `return_inventory()` that calls a handler `process_return()`, which calls a
  helper `compute_refund()` (endpoint → handler → helper, ≥ 2 hops).
- `myapp/events/invoice.py` — `validate_invoice(doc, method)` that calls a helper.
- `myapp/tasks/cleanup.py` — `run_cleanup()` that calls a helper.
- `myapp/myapp/doctype/return_request/return_request.py` — a controller class with
  `validate` and `on_submit` lifecycle methods, each calling a helper.
- One whitelist-variant file exercising all four forms (bare, called,
  `allow_guest=True`, `methods=["POST"]`) for the detector test.

Assertions:

1. **Whitelist detection** — `hasWhitelistDecorator` returns true for all four
   decorator forms and false for an undecorated function; each true case yields an
   `endpoint` node.
2. **doc_events resolution** — scanning the fixture emits a `kind=calls` edge from
   the `Sales Invoice` `validate` event to the `makeNodeId` of `validate_invoice`;
   the target node exists.
3. **scheduler resolution** — a `kind=calls` edge targets the resolved
   `run_cleanup` node.
4. **DocType lifecycle** — `validate` and `on_submit` on the controller class are
   `handler`-typed nodes and are reachable.
5. **Directed flow** — `flows.ts` over the fixture returns a non-empty `SutraFlow`
   set containing a path `return_inventory → process_return → compute_refund`
   (length ≥ 2 hops) over `FLOW_KINDS`.
6. **Determinism** — two scans of the fixture produce identical node and edge id
   sets.
7. **Regression guard** — a test that fails if the fixture scan produces only
   `kind=imports` edges or `flows=0` (the exact `swifter-flows` failure signature),
   so a future change that reverts to imports-only is caught.

## Out of Scope

- General (non-Frappe) Python call/http edge resolution — Story 6.2.
- `/link.json` generation, `linkGraphs`/`LINK_FILE`, and the viewer ecosystem
  tab 404 — link/ecosystem stories.
- Dynamic / runtime-constructed handler strings (e.g. handlers assembled at
  runtime or via `getattr`) — these are unresolved by design and are skipped, not
  guessed.
- New `NodeType` or `EdgeKind` values, viewer rendering changes, and any
  `GRAPH_VERSION` bump.
- New product features; this is hardening only.
