# Story 8.2: emitCallSiteEdges coverage — whitelist bodies and re-exports

- **Epic:** Epic 8 — Phase 8 Hardening
- **Status:** Draft
- **Priority:** P0
- **Depends on:** 8.1
- **Estimate:** M

## Title

Close emitCallSiteEdges gaps so whitelisted endpoints and re-exported symbols get the same body walk as plain functions.

## Problem

Machinery exists but real scans still miss edges when:

- Whitelist decorators wrap handlers whose bodies only call through imported aliases or thin wrappers.
- `__init__.py` re-exports (`from .handlers import process_return`) leave `imports.modules` pointing
  at symbols `fnByDotted` never registered under that alias key.
- Endpoint nodes are emitted in pass one while body edges run with a `nodeIdBySymbol` map that does
  not include every endpoint symbol key `emitCallSiteEdges` uses as `fromId`.

This is a **coverage** story, not "add emitCallSiteEdges" — the function already exists.

## Already on main (do not re-implement)

- `walkFunctions` visits `decorated_definition` and class methods.
- `@frappe.whitelist()` → `endpoint` nodes via `hasWhitelistDecorator`.
- Hooks `doc_events` / `scheduler_events` edges from `parseHooksAssignments`.

## Acceptance criteria

1. Whitelisted endpoint whose body only calls a re-exported handler (`from pkg import handler` where
   `pkg/__init__.py` re-exports) emits a `calls` edge to the handler node.
2. Endpoint `fromId` in body edges always matches the emitted endpoint node's id (no orphan `from`
   pointing at a symbol-only id missing from `nodes`).
3. Module-level call sites inside files that only re-export symbols still walk re-export targets when
   the callee is defined in-repo (static import graph only).
4. Unresolvable dynamic targets (`getattr`, string-built paths) still emit **no** edge.
5. frappe-clean tests remain green; new fixture failures drive the fix only.

## Verify steps

1. Add `tests/fixtures/frappe-reexport/` with `__init__.py` re-export + whitelisted caller.
2. Assert `calls` from endpoint → ultimate handler definition (not `imports` substitute).
3. Assert all `calls`/`http` edges have `from`/`to` present in `nodes`.
4. `npm run build` and `npm test` green.

## Files likely touched

- `src/extractors/python-frappe.ts` — pass ordering, `nodeIdBySymbol` / `fnByDotted` registration for endpoints
- `src/util/python-ast.ts` — re-export / import alias capture if needed
- `tests/fixtures/frappe-reexport/**`
- `tests/python-frappe-reexport.test.ts` (new)

## Out of scope

- Bench prefix normalization (Story 8.1); http target matching (Story 8.3).
