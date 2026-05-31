# Story 8.3: HTTP edges — frappe.call and requests to in-repo targets

- **Epic:** Epic 8 — Phase 8 Hardening
- **Status:** Draft
- **Priority:** P0
- **Depends on:** 8.1
- **Estimate:** M

## Title

Resolve frappe.call and requests call sites to in-repo endpoint nodes when statically known, not only external httpTargetId leaves.

## Problem

`emitCallSiteEdges` already emits:

- `http` to `httpTargetId` when `frappeMethod` does not resolve in `fnByDotted`.
- `http` for literal `requests.*` URLs (frappe-clean proves external hosts).

On bench code, `frappe.call("app.api.method")` and relative `requests.post("/api/method/...")` should
link to **emitted endpoint nodes** so `flows.ts` can walk `http` hops into the next handler. Today
many sites stop at external ids even when the method string matches a scanned whitelist endpoint.

## Already on main (do not re-implement)

- `site.frappeMethod` extraction in `extractCallsInBody`.
- `requestsHttpMethod` / `requestsUrl` / `requestsHost` → `httpTargetId` path.
- External-host allowlist loading in extractor.

## Acceptance criteria

1. `frappe.call("myapp.api.widget.get_widget")` (literal method string) emits `http` (or `calls` per
   single-edge policy) **to the in-repo endpoint node id** when that endpoint exists in the graph.
2. Literal `requests.get/post` with a path matching a known Frappe `/api/method/...` route resolves
   to the same endpoint node when unambiguous; otherwise keeps external `httpTargetId`.
3. At most **one** flow edge per call site (no duplicate `calls` + `http` for the same invocation).
4. Unresolvable method strings (variables, f-strings, `getattr`) emit no in-repo edge.
5. frappe-clean `requests.get` external edge test unchanged (regression guard).

## Verify steps

1. Extend bench or frappe-clean-adjacent fixture with `frappe.call` to a sibling-module whitelisted method.
2. Assert edge `to` equals endpoint node id, not only `http:POST#/api/method/...` external id when resolvable.
3. Run `buildFlows`; assert flow path includes the `http` hop into the downstream handler when chained.
4. Full test suite green.

## Files likely touched

- `src/extractors/python-frappe.ts` — `emitCallSiteEdges`, route/method → endpoint lookup table
- `src/util/python-ast.ts` — frappe.call / requests pattern extraction tweaks if needed
- `src/util/frappe-match.ts` — reuse normalisation helpers for method strings
- `tests/frappe-extractor.test.ts` or new `tests/python-frappe-http-resolve.test.ts`
- `tests/fixtures/**`

## Out of scope

- Cross-repo `linkGraphs` matching (Story 8.5); dynamic frappe.call targets.
