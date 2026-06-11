# Story 6.2: Resolve local imports to module/function nodes + http endpoint edges

- Epic: Epic 6 — Hardening
- Status: Superseded by epic-8 (audit 2026-06-11)
- Priority: P0
- Depends on: 6.1 (Python `calls` edges — intra-repo call resolution)
- Estimate: M

## Story

As a Forge Sutra user scanning a Frappe bench, I want a Python call to a symbol that was
brought in by a local `from ... import ...` to resolve to the real in-repo node id (not get
silently dropped), and I want a call that invokes a whitelisted endpoint or hits a route to
emit a `kind:"http"` edge, so that `flows.ts` can walk a directed path across module and
endpoint boundaries and produce a real start→end flow instead of an imports-only star.

## Context

A real scan of `swifter-flows` (3 Frappe bench apps, feature `sw_inventory_retrun_flow`)
produced 22 nodes but **19 edges, all `kind:"imports"`** — zero `calls`, zero `http` — so
`flows.ts` (which only traverses `FLOW_KINDS = {renders, calls, http}`) returned `flows[] = 0`
and the viewer honestly showed a star-shaped import blob, not a directed flow.

The call-edge machinery already exists in `src/extractors/python-frappe.ts`:
`extractBodyEdgesForFile` walks every function body, `extractCallsInBody` (from
`src/util/python-ast.ts`) yields `PyCallSite` records, and `emitCallSiteEdges` dispatches them
through `resolveSimpleCall` / `resolveAttributeCall` against the `fnByDotted` map built in the
first pass. So intra-module call resolution can work. The reason a *real* Frappe layout still
emitted imports-only is two concrete gaps in how imports feed that resolver:

1. **Local `from`-imports resolve to a dotted key that does not match how `fnByDotted` is
   keyed in a real bench.** `resolveSimpleCall` (python-frappe.ts) tries `${modPath}.${name}`,
   then `imports.modules.get(name)`, then a bare `fnByDotted.get(name)`. `parseModuleImports`
   (python-ast.ts, lines 214-234) *does* key the local name to the full dotted symbol — but it
   uses the import statement's **written** module path (e.g. `from myapp.stock.api import
   process_return` → `myapp.stock.api.process_return`, and `from .handler import x` →
   `.handler.x`). `fnByDotted`, however, is keyed by the **scan-relative** dotted path that
   `modulePathFromRel(rel)` produces from the file's position under the bench
   (`apps/myapp/myapp/stock/api.py` → `apps.myapp.myapp.stock.api.process_return`). In a 3-app
   bench these two strings rarely match: relative imports (`from . / from ..`) are not resolved
   to the scan-relative module at all, and absolute imports omit the `apps/<app>/` prefix that
   `modulePathFromRel` includes. So `fnByDotted.get(imp)` misses, the bare-name fallback usually
   misses across multiple apps, and the call is dropped — no `calls` edge. Cross-module
   `from ... import ...` is the dominant call style in a bench, so this mismatch alone yields the
   imports-only graph we observed.

   The `imports`-only edges that *did* appear in the real scan come from a separate pass that
   emits `imports` → `ext:<module>` for what a file imports, not from the call resolver — which is
   why nodes exist but no `calls` edges connect them.

2. **Calls to whitelisted endpoints / routes never become `http` edges that cross to the
   endpoint node.** `emitCallSiteEdges` only emits `http` for a `frappeMethod` call site when the
   method is **not** found in `fnByDotted` (the fallback `httpTargetId("POST", "/api/method/...")`
   branch). When the whitelisted target *is* in-repo it emits a `calls` edge — good — but a
   `frappe.call({ method })` / `requests.*` to a route that maps to a known endpoint node is not
   resolved to that endpoint's real id, so cross-boundary request flow (caller → `/api/method/...`
   → endpoint handler) is not expressible for `flows.ts` to terminate on.

The JS/TS extractor (`src/extractors/ts.ts`) already emits `calls`/`http`/`renders`, which is why
JS scans produce real flows. This story brings Python import-resolution + http-edge emission to
that parity. It does **not** add Frappe semantics depth (hooks/doc_events — that is 6.3) and does
**not** change `flows.ts` itself (6.4 verifies tracing). It changes only how `python-frappe.ts`
turns call sites into edges, plus the import-map contract it consumes.

## Acceptance Criteria

1. The from-import dotted symbol that `parseModuleImports` records (python-ast.ts, lines 214-234)
   is reconciled against the scan-relative keying of `fnByDotted` so resolution succeeds for both
   absolute imports (`from myapp.stock.api import x`) and relative imports (`from . / from ..
   import x`). The existing `PyImportMap.modules` shape used by `resolveAttributeCall` is preserved
   (no behavioral regression for `import x` / `x.y()`). Relative-import resolution beyond what the
   importing file's own position can determine is left unresolved (skipped, not guessed).
2. `resolveSimpleCall` (python-frappe.ts) resolves a call whose `site.simpleName` is a
   locally-`from`-imported symbol to the real node id via `fnByDotted.get(<reconciled dotted
   symbol>)`, and returns the in-repo `makeNodeId`-derived id — never `ext:` — when the symbol
   exists in the repo. It returns `null` when unresolved (caller skips; no edge).
3. For a `frappeMethod` call site whose target is an in-repo whitelisted endpoint present in
   `fnByDotted`, `emitCallSiteEdges` emits **both** the `calls` edge to the endpoint node id (as
   today) **and** a `kind:"http"` edge to `httpTargetId("POST", "/api/method/<frappeMethod>")` is
   NOT double-counted — exactly one edge is emitted, `kind:"http"` only when the method is genuinely
   unresolved in-repo, `kind:"calls"` to the real endpoint node id when it is in-repo. (i.e. the
   existing single-edge dispatch is preserved; this AC pins it as the contract, not a regression.)
4. A `requests.*` / route call site (`site.requestsHttpMethod` + `site.requestsUrl`) whose URL
   matches a known in-repo endpoint route resolves to a `kind:"http"` edge whose `to` is the
   endpoint's real node id (via the resolver), and falls back to `httpTargetId(method, url, host)`
   only when no in-repo endpoint matches the route. `SutraEdge.kind` is `"http"` in both cases.
5. Genuinely external modules (e.g. `requests`, `frappe` core, third-party packages **not** in the
   scanned repo) still produce an `imports` edge to an `ext:<module>` node — `ext:` is reserved for
   modules absent from the repo and is never emitted for a symbol that resolved to a real node id.
6. Every emitted edge carries a truthful `provenance`: `"ast-exact"` when the dotted symbol was
   found in `fnByDotted`, `"heuristic"` when a route/name match was used to reach the endpoint, and
   imports-to-`ext:` keep their current provenance. No call site is invented when the receiver/name
   is dynamic or unresolved — it is skipped, not guessed.
7. After this story, a single scanned fixture produces at least one `kind:"calls"` edge AND at
   least one `kind:"http"` edge between feature nodes, and `traceFlows` over `FLOW_KINDS` returns a
   non-empty flow whose path crosses a module boundary and terminates at an endpoint/external node.
8. `makeNodeId(rel, symbol)` remains the only id constructor for in-repo targets; ids stay
   deterministic (`path#symbol`) so `sutra diff` and the viewer remain stable. `GRAPH_VERSION`
   (currently `6` in types.ts) is **not** bumped — no field is added or removed from
   `SutraNode`/`SutraEdge`/`EdgeKind`; only edge population changes within the existing contract.

## Technical Approach

**Parity target:** `src/extractors/ts.ts` — match its behavior of resolving imported symbols to
real nodes and emitting `calls`/`http`, not its implementation.

Functions that change:

- **`parseModuleImports` (src/util/python-ast.ts).** Today (lines 214-234) it already maps a
  from-imported local name → `${moduleName}.${imported}` into the single `.modules` map, but
  `moduleName` is the *written* module path, which does not match `fnByDotted`'s scan-relative
  keying (see Context). Distinguish from-import symbol bindings from plain `import x` aliases
  (either a separate `fromSymbols` map on `PyImportMap`, or by recording the raw written-module
  string + imported name so the caller can reconcile). For relative imports (`from .` / `from ..`),
  capture the leading-dot depth so the resolver can rebase against the importing file's own
  scan-relative module. Use the tree-sitter `import_from_statement` node already available; do not
  add a new parser. Star imports (`from m import *`) and dot-depths the importing file cannot
  satisfy are left unresolved (skipped, not guessed).

- **`resolveSimpleCall` (src/extractors/python-frappe.ts).** Before the bare-name fallback, if
  `name` is a bound from-import, reconcile its written dotted symbol to the scan-relative key that
  `fnByDotted` uses: for an absolute import, match by suffix against `fnByDotted` keys (the
  scan-relative key ends with `...<app-module-tail>.<name>`); for a relative import, rebase the
  dot-depth against the importing file's `modPath` to build the scan-relative dotted symbol, then
  `fnByDotted.get(reconciled)`. Only fall through to the existing bare-name fallback when that
  misses. Returns the in-repo node id or `null` (null → caller skips, no edge, no `ext:` — `ext:`
  is an *imports*-pass concern, handled separately, never a substitute for a dropped call). Suffix
  matching must be unambiguous: if more than one `fnByDotted` key matches the same suffix, treat it
  as unresolved (`null`) rather than guess.

- **`emitCallSiteEdges` (src/extractors/python-frappe.ts).** Keep the single-edge dispatch.
  For `requestsHttpMethod`/`requestsUrl` sites, before falling back to
  `httpTargetId(method, url, host)`, attempt to resolve the URL to an in-repo endpoint node id
  (a small route→endpoint lookup built from endpoint nodes whose `name` is the dotted method or
  whose route is derivable). If matched, emit `kind:"http"` with `to` = endpoint node id,
  `provenance:"heuristic"`; otherwise emit the existing external `httpTargetId` http edge. The
  `frappeMethod` branch is unchanged in shape (calls-if-in-repo, http-to-`/api/method/...`-if-not)
  and is pinned by AC 3.

- **External imports → `ext:` edges.** Add (or confirm) the imports pass that, for each module a
  file imports which is *not* a module present in the scanned repo, emits an `imports` edge to an
  `ext:<module>` node. This must run *after* call resolution so a symbol that resolved to a real
  node is never also rendered as `ext:`. Modules that ARE in the repo do not get `ext:` nodes.

Edges/nodes with exact kind + id scheme:
- `calls` edge: `{ from: <caller node id>, to: makeNodeId(rel, symbol), kind:"calls", provenance }`.
- `http` edge (resolved route): `{ from, to: <endpoint node id>, kind:"http", provenance:"heuristic" }`.
- `http` edge (external/unresolved): `{ from, to: httpTargetId(method, url, host?), kind:"http", provenance:"ast-exact" }`.
- `imports` edge (external module only): `{ from: moduleId, to: "ext:<module>", kind:"imports", ... }`.

**How `flows.ts` then consumes them:** `traceFlows` walks edges whose `kind ∈ FLOW_KINDS`
(`renders|calls|http`). With `calls` edges now connecting caller→in-repo-symbol and `http` edges
connecting caller→endpoint/external, an entry node (whitelisted endpoint, the natural Python entry)
can now reach a terminal (an `ext:`/`httpTarget` node, or a leaf handler) over a directed path that
crosses module boundaries — so `flows[]` becomes non-empty. The renderer remains a leaf; no viewer
change in this story.

Non-goals that keep scope tight: do not resolve dynamic dispatch, `getattr`, runtime route
registration, or string-built method names — skip them. Do not add confidence scoring. Do not
touch `flows.ts` logic.

## Tasks

- [ ] In `src/util/python-ast.ts`, extend `parseModuleImports` to distinguish from-import symbol bindings from plain `import x` aliases and to capture relative-import dot-depth, keeping `.modules` (plain imports) behavior unchanged. Add the field(s) to the `PyImportMap` type.
- [ ] In `src/extractors/python-frappe.ts`, update `resolveSimpleCall` to reconcile a from-imported symbol to the scan-relative `fnByDotted` key (suffix match for absolute, dot-depth rebase for relative) before the bare-name fallback; return the in-repo node id or `null`; treat ambiguous suffix matches as unresolved.
- [ ] Build a route→endpoint lookup (dotted method / derivable route → endpoint node id) from the endpoint nodes collected in the first pass; pass it into `emitCallSiteEdges`.
- [ ] In `emitCallSiteEdges`, resolve `requestsUrl` to an in-repo endpoint node id when matched, emitting `kind:"http"` to that id (`provenance:"heuristic"`); else keep the `httpTargetId(...)` external http edge. Confirm the `frappeMethod` branch stays single-edge per AC 3.
- [ ] Add/confirm the external-imports pass: emit `imports` → `ext:<module>` only for modules absent from the repo, running after call resolution so resolved symbols never also appear as `ext:`.
- [ ] Verify `provenance` is set truthfully on every new edge (`ast-exact` for fnByDotted hits, `heuristic` for route/name matches).
- [ ] Add the Python/Frappe fixture under `tests/fixtures/` (see Test Plan) and wire it into the extractor test suite.
- [ ] Add the flow-tracing assertion test consuming the fixture graph through `traceFlows`.
- [ ] Run the full build + test suite; confirm no `GRAPH_VERSION` bump is needed (schema unchanged).
- [ ] Confirm the existing JS/TS extractor tests and any 6.1 `calls` tests still pass (no regression).

## Test Plan

Add a minimal Frappe-shaped fixture under `tests/fixtures/` (e.g.
`tests/fixtures/frappe-local-imports/`) with this exact shape so the resolution chain is exercised
end to end:

```
apps/inv/inv/hooks.py                          # marks repo as Frappe (isFrappeRepo)
apps/inv/inv/doctype/return_order/return_order.py   # endpoint: @frappe.whitelist() def process_return(...)
apps/inv/inv/stock/handler.py                  # def handle_return(...): from ..doctype... import process_return; process_return(...)
apps/inv/inv/stock/helper.py                   # def compute_qty(...): ...  (leaf)
apps/inv/inv/api.py                            # @frappe.whitelist() def submit(): from .stock.handler import handle_return; handle_return(...)
```

Wire so: endpoint `submit` (whitelisted) → calls `handle_return` (imported via `from .stock.handler import`)
→ calls `compute_qty` (leaf helper) AND `handle_return` → calls `process_return` (another whitelisted
endpoint, imported cross-module). Include one genuinely external call (`requests.post("https://erp.example.com/api/x")`)
inside `handle_return` to exercise the external `http` branch, and one `import frappe` to exercise the
`ext:` imports edge.

Tests assert:

1. **Local from-import resolves to real node (AC 1, 2, 5):** scanning the fixture emits a `kind:"calls"`
   edge from `submit`'s node id to `handle_return`'s real `makeNodeId`-derived node id (not `ext:`), and
   from `handle_return` to `compute_qty`. No `ext:handle_return` / `ext:compute_qty` node exists.
2. **Cross-module endpoint call (AC 2):** `handle_return` → `process_return` emits a `kind:"calls"`
   edge to `process_return`'s endpoint node id, `provenance:"ast-exact"`.
3. **External http edge (AC 4):** the `requests.post(...)` site emits a `kind:"http"` edge whose `to`
   equals `httpTargetId("POST", "https://erp.example.com/api/x", "erp.example.com")`.
4. **External import stays ext: (AC 5):** an `imports` edge to `ext:frappe` exists; no in-repo node was
   mislabeled `ext:`.
5. **Flow is non-empty and directed (AC 7):** running `traceFlows` over the fixture graph
   (`FLOW_KINDS = {renders, calls, http}`) returns at least one flow whose ordered path starts at the
   `submit` endpoint, crosses module boundaries (`api.py` → `stock/handler.py` → `stock/helper.py`),
   and terminates at a leaf/handler — assert the path contains both `handle_return` and `compute_qty`
   node ids in order.
6. **Regression guard:** a second tiny case (`tests/fixtures/frappe-local-imports/regression/`) with a
   plain `import frappe; frappe.get_doc(...)` and a bare local call (`x()` where `x` is module-local,
   no from-import) — assert the module-local call still resolves via the existing `${modPath}.${name}`
   path (proves we did not break pre-6.2 simple-call resolution) and `frappe` stays `ext:`. Also assert
   total edge count and per-kind counts to lock the contract and catch double-emission.

## Out of Scope

- Frappe semantics depth — `hooks.py`, `doc_events`, `scheduler_events`, DocType controller events
  (Story 6.3); this story leaves the existing hooks handling as-is.
- Any change to `flows.ts` traversal logic or `FLOW_KINDS` (Story 6.4 verifies tracing).
- Cross-repo / bench-merge `link.json` generation and the Ecosystem tab (Stories 6.5, 6.6).
- Dynamic dispatch, `getattr`, runtime/string-built method names, star imports — skipped, never guessed.
- Confidence scoring, AI inference, viewer rendering changes.
- `GRAPH_VERSION` bump — the schema contract is unchanged.
