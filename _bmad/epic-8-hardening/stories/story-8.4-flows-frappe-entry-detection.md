# Story 8.4: flows.ts — Frappe endpoint entry detection

- **Epic:** Epic 8 — Phase 8 Hardening
- **Status:** Draft
- **Priority:** P0
- **Depends on:** 8.1, 8.3
- **Estimate:** S

## Title

Ensure flows.ts treats Frappe whitelist endpoints as flow entries even when entry heuristics differ from TS routes.

## Problem

`findEntryPoints` (`src/flows.ts`) adds `endpoint` nodes only when they have **outgoing**
`FLOW_KINDS` edges (`renders`, `calls`, `http`). If resolution fails upstream, endpoints never
become entries → `flows[]` empty despite emitted endpoint nodes. TS `route`/`component` entries use
a separate branch. Frappe scans need explicit, tested entry rules: whitelisted `endpoint` with
Python-frappe `language` is always an entry when it is a declared API surface, or when it has any
outgoing flow edge after Stories 8.1–8.3.

## Already on main (do not re-implement)

- `FLOW_KINDS` traversal, `walkFromEntry`, `buildFlows` integration in `runScanPipeline`.
- `findFrappeHandlerByHttpPath` for http hop resolution inside flows.
- frappe-clean test: `buildFlows` non-empty for `get_widget` (flat layout).

## Acceptance criteria

1. After 8.1/8.3 fixtures pass edge emission, `buildFlows` lists the whitelisted endpoint as
   `flow.entry` for at least one directed flow.
2. Bench-layout fixture: if endpoint has outgoing `calls`/`http`, it is an entry; flow length ≥ 2.
3. Imports-only graph still yields `flows.length === 0` (regression guard — do not add `imports` to `FLOW_KINDS`).
4. TS route/component entry behaviour unchanged (existing CLI tests pass).
5. No `GRAPH_VERSION` bump unless `SutraFlow` shape changes.

## Verify steps

1. Unit test `findEntryPoints` or `buildFlows` with synthetic nodes: Frappe endpoint + `calls` chain.
2. Bench fixture end-to-end: scan → `graph.flows` non-empty in written graph.json shape.
3. Compare TS fixture flow count ≥ Python equivalent path length (parity guard from Epic 6.4).
4. `npm test` green.

## Files likely touched

- `src/flows.ts` — `findEntryPoints`, optional Frappe-specific entry predicate
- `tests/flows-frappe-entry.test.ts` (new) or extend `tests/frappe-extractor.test.ts`

## Out of scope

- Extractor resolution (Stories 8.1–8.3); viewer copy (Story 8.6).
