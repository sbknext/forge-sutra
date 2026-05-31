# Story 8.1: Frappe callee resolution — app-root keys vs bench-deep paths

- **Epic:** Epic 8 — Phase 8 Hardening
- **Status:** Draft
- **Priority:** P0
- **Depends on:** none
- **Estimate:** M

## Title

Align Python resolver dotted keys with Frappe app-root imports while keeping `makeNodeId` stable on repo-relative paths.

## Problem

Real bench scans (`apps/inv/inv/api/...`) still produce **imports-only** graphs: `emitCallSiteEdges` runs
but `resolveSimpleCall` misses because `fnByDotted` is keyed with a bench prefix (`apps.inv.inv...`)
while source imports use app-root paths (`inv.api.widget`). The flat `frappe-clean` fixture masks this;
deep paths are the production failure mode. Epic 6.1 specced `appModulePath`; it is **not** on main yet
(`modulePathFromRel(rel)` only).

## Already on main (do not re-implement)

- Call-site walk: `extractBodyEdgesForFile`, `extractCallsInBody`, `emitCallSiteEdges`.
- Same-file resolution via `${modPath}.${name}` local key.
- Node ids via `makeNodeId(rel, symbol)` with real `rel` — keep unchanged.

## Acceptance criteria

1. Bench-layout fixture (`apps/app/app/...`) emits `calls` edges across modules imported as
   `from app.mod import fn` (not only same-file calls).
2. Resolver map keys use app-root module paths; node ids remain repo-relative and deterministic
   across two scans.
3. `fnByBareName` (or equivalent) resolves **only** when a bare symbol is unambiguous; 0 or 2+
   matches emit no edge.
4. Relative imports (`from .sibling import helper`) normalize into the same app-root namespace
   before lookup.
5. Every `calls` edge `to` id exists in `nodes`; no invented targets.
6. `GRAPH_VERSION` unchanged unless edge schema changes.

## Verify steps

1. Add or extend `tests/fixtures/frappe-bench-calls/` with `apps/inv/inv/...` chain
   endpoint → handler → helper.
2. Run `npm test` — assert cross-module `calls` edges and `buildFlows` returns flows with a
   `calls` step (not imports-only star).
3. Run extractor twice; assert sorted `calls` edges byte-identical.
4. Re-scan a known failing bench feature (swifter-flows slice) and record edge kinds before/after
   in story PR notes (counts only, no secrets).

## Files likely touched

- `src/extractors/python-frappe.ts` — `appModulePath`, `fnByDotted` / `fnByBareName` population and reads
- `src/util/python-ast.ts` — relative import normalization in `parseModuleImports` if needed
- `tests/fixtures/frappe-bench-calls/**`
- `tests/python-frappe-bench-calls.test.ts` (new)

## Out of scope

- New edge kinds; viewer UI; `linkGraphs` multi-repo logic (Stories 8.5, 8.6).
