# Story 6.1: Python `calls` edges — diagnose + fix intra-repo call resolution

- **Epic:** Epic 6 — Hardening
- **Status:** Superseded by epic-8 (audit 2026-06-11)
- **Priority:** P0
- **Depends on:** none
- **Estimate:** M

## Story

As a developer scanning a Frappe/Python repo with Forge Sutra, I want a whitelisted
endpoint or function whose body calls another in-repo function to produce a `calls`
edge between those two nodes, so that `flows.ts` can trace a directed entry→terminal
path instead of rendering an undirected `imports`-only star.

## Context

The epic README records a real scan — `swifter-flows` (3 Frappe bench apps, feature
`sw_inventory_retrun_flow`): **22 nodes, 19 edges, every edge `kind: "imports"`, zero
`calls`/`http`, `flows[] = 0`.** The viewer honestly showed "No traced request paths"
because `flows.ts` only walks `FLOW_KINDS = {renders, calls, http}` (`src/flows.ts:28`)
— an `imports`-only graph has no traversable edges, so `buildFlows` returns nothing.

The puzzle: `src/extractors/python-frappe.ts` **already contains the call-edge machinery** —
`extractBodyEdgesForFile` (line 223) walks every function/method body via
`extractCallsInBody`, and `emitCallSiteEdges` (line 154) pushes `calls`/`http` edges using
`resolveSimpleCall` (line 117) and `resolveAttributeCall` (line 134). Yet on real Frappe
code it produced none. The diagnosis below is grounded in how the resolver keys are built.

**Root cause — dotted-key namespace mismatch.** In `extract` (line 299) `modPath` comes
from `modulePathFromRel(rel)`, where `rel` is **repo-root-relative**. For a Frappe bench
layout the path is `apps/<app>/<app>/api/widget.py`, so `modPath` becomes
`apps.<app>.<app>.api.widget` and `fnByDotted` is keyed
`apps.<app>.<app>.api.widget.<fn>` (line 319). But real Frappe source imports by the
**app-root module path**: `from <app>.api.widget import do_thing`. So
`parseModuleImports` yields `imports.modules.get("do_thing") = "<app>.api.widget.do_thing"`,
which `resolveSimpleCall` looks up in `fnByDotted` (line 127) and misses — the stored key
has the extra `apps.<app>.` prefix. Every cross-module call therefore fails to resolve.

**Secondary gaps confirmed by reading the code:**
1. **Bare-name fallback is dead.** `resolveSimpleCall`'s last line `fnByDotted.get(name)`
   (line 131) queries a *bare* function name against a map that is **only** keyed by
   dotted paths — it can never hit. Same-module calls happen to work because the `local`
   key `${modPath}.${name}` (line 120) matches, but a call to a function imported
   `from .sibling import helper` has no working path once the dotted lookup misses.
2. **`from . import x` / relative imports unhandled.** `parseModuleImports`
   (`util/python-ast.ts:214`) reads `module_name` literally; a relative
   `from .utils import helper` is stored as `.utils.helper`, which matches nothing.
3. **Whitelisted call targets.** `frappe.call(...)` already routes through
   `site.frappeMethod` and is keyed the same dotted way (line 163), so it inherits the
   same prefix mismatch when the target is intra-repo.

Parity reference: `src/extractors/ts.ts` resolves intra-repo calls through a flat
`symbolToNodeId` map keyed by **bare symbol name** (line 537, used at line 743), which is
why JS scans already emit `calls` edges and Python does not.

This story fixes intra-repo *function/method* call resolution only. Local-import→module
nodes and `http`/endpoint-invocation edges are Story 6.2; Frappe `hooks`/`doc_events`
depth is Story 6.3.

## Acceptance Criteria

1. A non-whitelisted function `b()` in module A whose body calls an in-repo function
   `c()` defined in module B (imported `from <app>.modB import c`) produces exactly one
   `SutraEdge` with `kind: "calls"`, `from` = A's `b` node id, `to` = B's `c` node id,
   `provenance: "ast-exact"`.
2. A `@frappe.whitelist()` endpoint whose body calls an in-repo handler produces a
   `calls` edge from the `endpoint` node to the handler node (same resolution path).
3. Same-module calls (`foo()` calling a sibling `bar()` in the same file) continue to
   resolve via `resolveSimpleCall` and still emit a `calls` edge (regression guard — this
   already works today and must not break).
4. `emitCallSiteEdges` resolves a `from .sibling import helper` relative import to the
   sibling module's function node and emits a `calls` edge.
5. Calls to symbols that are **not** resolvable in-repo (unknown receiver, `getattr`,
   third-party imports, attribute chains on call results) emit **no** edge — candidate,
   never guessed. No `calls` edge is created to a node id that does not exist in `nodes`.
6. All emitted call ids use `makeNodeId(rel, symbol)` and remain byte-identical across two
   scans of the same source (deterministic; verified by a second scan producing an
   identical sorted edge list).
7. After the fix, `buildFlows` over the fixture graph returns at least one
   `SutraFlow` whose `steps` contain an edge with `kind: "calls"` and whose
   `terminal !== "unresolved"` — i.e. `FLOW_KINDS` traversal now has real input.
8. `GRAPH_VERSION` (`src/types.ts:4`) is **unchanged** — this story adds edges that
   already conform to the existing `SutraEdge` contract; no schema change. `LINK_FILE`
   generation is untouched (out of scope, Story 6.6).
9. Existing TS extractor output is unchanged (no shared resolver regressions) and the
   full test suite plus `tsc` build are green.

## Technical Approach

**Functions that change (all in `src/extractors/python-frappe.ts`, plus possibly
`src/util/python-ast.ts`):**

1. **Normalize the dotted namespace so import keys and node keys agree.** The cleanest
   deterministic fix is to strip the bench prefix when building dotted keys so that both
   `fnByDotted` and `imports.modules` live in the **app-root** namespace.
   - Add a helper `appModulePath(rel)` that, for a Frappe layout
     `apps/<app>/<app>/...`, drops the leading `apps/<app>/` segment(s) before calling
     `modulePathFromRel`, falling back to `modulePathFromRel(rel)` for non-bench layouts.
     Derive the strip prefix once per file by detecting the `apps/<app>/<app>/` shape
     (the doubled app dir is the canonical Frappe signature) — do **not** guess when the
     shape is absent; just use the plain module path.
   - Use this app-relative `modPath` everywhere `fnByDotted` keys are written (lines 319,
     356, 373) **and** everywhere they are read (`resolveSimpleCall`,
     `resolveAttributeCall`, `emitCallSiteEdges`, `resolveHandler`). Node **ids** stay
     `makeNodeId(rel, symbol)` with the real repo-relative `rel` — only the *resolver
     map keys* are normalized, so ids remain deterministic and unchanged.

2. **Make the bare-name fallback real.** Add a second resolver map
   `fnByBareName: Map<string, string[]>` populated alongside `fnByDotted` (bare function
   name → node ids). In `resolveSimpleCall`, when the dotted lookups miss, consult
   `fnByBareName`; emit an edge **only when exactly one** node owns that name (unambiguous)
   — if 0 or >1, return `null` (candidate, never guess). This mirrors `ts.ts`'s flat
   `symbolToNodeId` while staying conservative on collisions.

3. **Resolve relative imports.** In `parseModuleImports` (or a small post-process in the
   extractor), when `module_name` begins with `.`, resolve it against the importing
   file's app-relative module path (one `.` = same package, `..` = parent) and rewrite the
   stored dotted value into the app-root namespace before it reaches `resolveSimpleCall`.
   Only static, syntactically-present imports — no filesystem probing beyond the already
   collected `pyFiles`.

**Edges produced:** `kind: "calls"`, `provenance: "ast-exact"` when the target is found
via dotted/relative-import resolution; `provenance: "heuristic"` only for the single
unambiguous bare-name fallback. No new node types. No new edge kinds.

**How `flows.ts` then consumes them:** `buildAdjacency` (`src/flows.ts:78`) already
indexes `calls` edges; `outgoingFlowEdges` (line 64) falls back to the module node, so an
endpoint→handler→helper `calls` chain becomes a walkable path and `walkFromEntry` emits a
directed `SutraFlow`. No change to `flows.ts` is required by this story.

**Parity target:** `ts.ts` (flat bare-name map + dotted resolution). **Skip** dynamic /
unresolved (`getattr`, attribute calls on unknown receivers, call-result chains) — already
filtered in `util/python-ast.ts:300-328`; keep that behavior. **Deterministic ids.**
Renderer is a leaf — no viewer change. **Do not bump `GRAPH_VERSION`** (contract
unchanged).

## Tasks

- [ ] Add a failing fixture under `tests/fixtures/` reproducing the bench-layout miss
      (endpoint → handler → helper across modules) and assert `calls` edges + non-empty
      flows; confirm it currently fails (imports-only).
- [ ] Add `appModulePath(rel)` helper that strips the `apps/<app>/<app>/` bench prefix
      deterministically and falls back to `modulePathFromRel` otherwise.
- [ ] Switch all `fnByDotted` writes (functions, controller classes, methods) and all
      reads (`resolveSimpleCall`, `resolveAttributeCall`, `emitCallSiteEdges`,
      `resolveHandler`) to the app-relative module path; keep node ids on real `rel`.
- [ ] Build `fnByBareName` alongside `fnByDotted`; wire the unambiguous-only fallback into
      `resolveSimpleCall`.
- [ ] Handle relative imports (`from .x import y`) in `parseModuleImports` / extractor
      post-process, normalizing into the app-root namespace.
- [ ] Verify no edge is emitted to a non-existent node id (guard in `emitCallSiteEdges`
      or a post-filter against the node-id set).
- [ ] Confirm `GRAPH_VERSION` is unchanged and `SutraEdge` shape is untouched.
- [ ] Run the new fixture: assert `calls` edges present AND `buildFlows` returns a
      directed flow with a `calls` step and non-`unresolved` terminal.
- [ ] Run full suite + `tsc`; confirm TS extractor output unchanged.

## Test Plan

New fixture: `tests/fixtures/frappe-calls/` shaped like a real bench app so the prefix
mismatch is exercised:

```
tests/fixtures/frappe-calls/
  hooks.py                                  # minimal, present so isFrappeRepo() passes
  apps/inv/inv/api/returns.py               # @frappe.whitelist() create_return() -> calls process_return()
  apps/inv/inv/inventory/handlers.py        # process_return() -> calls adjust_stock()  (from inv.inventory.stock import adjust_stock)
  apps/inv/inv/inventory/stock.py           # adjust_stock()  (terminal helper)
  apps/inv/inv/doctype/stock_entry/stock_entry.py  # Document controller w/ on_submit() -> calls a sibling-module helper (relative import)
```

Tests (e.g. `tests/python-frappe-calls.test.ts`):

1. **Cross-module calls edge** — assert one `kind:"calls"` edge from the `create_return`
   endpoint node to the `process_return` node, `provenance:"ast-exact"`. (AC 1, 2)
2. **Chained handler→helper** — assert a `calls` edge from `process_return` to
   `adjust_stock`, proving import-based resolution across the bench prefix. (AC 1)
3. **Same-module regression guard** — a fixture file with two functions where one calls
   the other; assert the `calls` edge still emits (proves the dotted normalization didn't
   break the same-module path). (AC 3)
4. **Relative import** — assert the controller's `on_submit` produces a `calls` edge to
   the sibling-module helper imported via `from .x import y`. (AC 4)
5. **No-guess guard** — a function calling an unknown/third-party symbol and a `getattr`
   call site; assert **zero** `calls` edges for those sites, and assert every `calls`
   edge's `to` exists in `nodes`. (AC 5)
6. **Determinism** — run the extractor twice on the fixture; assert the sorted edge lists
   are byte-identical. (AC 6)
7. **Flow regression guard (the user-visible fix)** — feed the fixture graph to
   `buildFlows`; assert `flows.length >= 1`, at least one flow has a step whose
   `edge.kind === "calls"`, and its `terminal !== "unresolved"`. This is the guard against
   regressing back to the `flows=0` ground-truth state. (AC 7)
8. **Version guard** — assert `GRAPH_VERSION === 6` (unchanged) so a contract bump is a
   conscious decision, not an accident. (AC 8)

## Out of Scope

- Local-import → `module` node edges and `http`/endpoint-invocation edges (Story 6.2).
- Frappe semantics depth: `hooks.py` override_doctype, `doc_events`, `scheduler_events`,
  full DocType controller wiring (Story 6.3) — only the existing controller-method call
  resolution is touched here.
- Cross-repo / bench-merge `link.json` generation and the Ecosystem tab 404 (Stories 6.5,
  6.6).
- Any viewer / `view.html` change — renderer stays a leaf consuming `graph.json`.
- Confidence-score tuning beyond the existing `provenance` → score mapping.
