# Story 8.5: Merge graph — attach flows[] and real link.json

- **Epic:** Epic 8 — Phase 8 Hardening
- **Status:** Draft
- **Priority:** P1
- **Depends on:** 8.4
- **Estimate:** M

## Title

Wire smart-merge and multi-app bench output so merged graph.json always carries traced flows and a non-placeholder link.json when multiple apps are present.

## Problem

Single-repo `runScanPipeline` already sets `graph.flows` and writes placeholder `link.json` via
`emptyLinkResult` (`onlyIfAbsent: true`). Bench workflows that **merge** per-app graphs (e.g.
swifter-api-doc `merge_forge_smart_graph.py`) produce a combined `graph.json` **without** re-running
`buildFlows` or `linkGraphs` — viewer shows empty flows and Ecosystem 404. `scripts/attach-flows-link.mjs`
exists but is manual and writes empty link when not multi-repo.

## Already on main (do not re-implement)

- `watch.ts`: scan pipeline attaches `flows` on every `sutra scan`.
- `cli.ts` `sutra link` command and `linkGraphs` implementation in `src/link.ts`.
- `scripts/attach-flows-link.mjs` post-merge helper (flows + placeholder link).

## Acceptance criteria

1. Documented merge path (script or CLI flag) runs `buildFlows(merged.nodes, merged.edges)` and
   persists `flows` on the merged graph artifact.
2. When merged graph node ids span **two or more** distinct `app::` prefixes, write `link.json` via
   `linkGraphs` with at least one cross-app edge or an explicit empty-edge schema — **never** skip
   write (viewer must not 404 after merge).
3. Single-app merge still writes valid empty `link.json` (same as scan pipeline honesty contract).
4. `attach-flows-link.mjs` delegates to shared library code (no duplicated flow/link logic).
5. Integration test: two minimal fixture graphs merged → `flows.length > 0` and `link.json` parseable.

## Verify steps

1. Run merge helper on two fixture subgraph exports; assert `graph.flows` populated.
2. Assert `.sutra/link.json` exists and `GET /link.json` returns 200 in viewer server test or smoke script.
3. `npm test` includes merge attach test.
4. Manual: post-merge swifter-flows graph shows non-zero flows in scan summary line.

## Files likely touched

- `scripts/attach-flows-link.mjs`
- `src/cli.ts` — optional `scan --merge` or export shared `attachFlowsAndLink(graph, artifactDir)`
- `src/link.ts` — helper to detect multi-app from node ids
- `tests/link-artifact.test.ts` or `tests/merge-flows-link.test.ts`

## Out of scope

- Viewer fetch UX (Story 8.6); extractor changes.
