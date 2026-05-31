# Epic 8 — Phase 8 Hardening (resolution + flows + viewer truth)

> **Theme:** Diagnose and fix **callee resolution and node-id alignment** on real Frappe bench
> layouts — not blind emitter additions. PR #7 merged Epic 6 story specs; **main already ships**
> partial fixes (`emitCallSiteEdges`, scan-time `flows[]`, placeholder `link.json`, frappe-clean
> tests). This epic is the **executor queue** for what still fails on deep bench paths (e.g.
> swifter-flows) and for merge/viewer integration gaps.

## Relationship to Epic 6

| Epic 6 story | Phase 8 focus |
|---|---|
| 6.1 calls edges | **8.1** — same root cause, reframed: resolver keys vs `makeNodeId` ids on `apps/app/app/` paths |
| 6.2 imports + http | **8.3** — frappe.call / requests resolution to in-repo endpoints, not only external `httpTargetId` |
| 6.3 Frappe semantics | Covered by **8.2** whitelist-body / re-export coverage where semantics meet call sites |
| 6.4 flow parity | **8.4** entry detection + **8.7** withrun slice regression |
| 6.5 viewer graceful | **8.6** empty flows copy + ecosystem absent-state (build on partial server work) |
| 6.6 link.json | **8.5** merge-graph attach + real multi-app `linkGraphs`, not placeholder-only |
| 6.7 self-CI | Out of Phase 8 scope — pick up separately |

## Already on main (do not re-implement)

- `python-frappe.ts`: `extractBodyEdgesForFile`, `emitCallSiteEdges`, `resolveSimpleCall`,
  `resolveAttributeCall`, hooks `doc_events` / `scheduler_events`, whitelist endpoint nodes.
- `watch.ts` `runScanPipeline`: `buildFlows` → `graph.flows`, `writeLinkFile` with
  `emptyLinkResult` (`onlyIfAbsent: true`).
- `scripts/attach-flows-link.mjs` for post-merge graphs.
- `tests/fixtures/frappe-clean` + `tests/frappe-extractor.test.ts` (flat `myapp/` layout).

## Stories

| Story | Title |
|---|---|
| [8.1](stories/story-8.1-frappe-callee-resolution-deep-paths.md) | Frappe callee resolution — app-root keys vs bench-deep paths |
| [8.2](stories/story-8.2-emit-callsite-coverage-gaps.md) | emitCallSiteEdges coverage — whitelist bodies, re-exports |
| [8.3](stories/story-8.3-http-edges-frappe-call-requests.md) | HTTP edges — frappe.call and requests to in-repo targets |
| [8.4](stories/story-8.4-flows-frappe-entry-detection.md) | flows.ts — Frappe endpoint entry detection |
| [8.5](stories/story-8.5-merge-graph-flows-link-json.md) | Merge graph — attach flows[] and real link.json |
| [8.6](stories/story-8.6-viewer-empty-flows-ecosystem.md) | Viewer — empty flows and ecosystem absent-state |
| [8.7](stories/story-8.7-regression-frappe-clean-withrun-slice.md) | Regression — frappe-clean + withrun bench slice |

## Principles

Candidate-not-confirmed; deterministic `makeNodeId(rel, symbol)` for node ids; normalize only
**resolver map keys** (dotted namespace), not ids; one story = one commit; bump `GRAPH_VERSION`
only on contract change.
