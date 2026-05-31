# Forge Sutra — Plan Index

Navigable index of the post-Phase-0 plan. Start with the **[ROADMAP](ROADMAP.md)** for the
north star, epics, sequencing, principles, and Definition of Done. Each story below is a
self-contained BMAD spec grounded in the real codebase.

> **North star:** a **realistic feature viewer** — see a product as features, derived from
> code, honest about uncertainty.

**Status legend:** `Draft` (specced, not started) · `Ready` (refined, pickable) ·
`In Progress` · `Done` · `Deferred` (out of scope — see Epic 5).

**Scope rule:** Sutra is single-repo, standalone, single-user, local-first. Stories that break
that (cross-repo, brain/forge coupling, hosted storage) are moved to **[Epic 5 — Deferred](epic-5-deferred/README.md)**
and must not be implemented.

---

## Epic 1 — Truthful Graph
Kill false positives; turn *candidate* findings into *confirmed*; add a confidence model.

| Story | Title | Status | Depends on |
|---|---|---|---|
| [1.1](epic-1-truthful-graph/story-1.1-external-host-allowlist.md) | External-host allowlist | Done | none |
| [1.2](epic-1-truthful-graph/story-1.2-dynamic-segment-route-matcher.md) | Dynamic-segment route matcher | Done | none |
| [1.3](epic-1-truthful-graph/story-1.3-confidence-model.md) | Confidence model & provenance | Done | none |
| [1.5](epic-1-truthful-graph/story-1.5-incremental-scan.md) | Incremental scan cache | Draft | none |
| [1.6](epic-1-truthful-graph/story-1.6-scan-diff.md) | Scan diff command | Done | none |

## Epic 2 — Real Features
A feature becomes first-class: contract-bearing, reconciled, traceable, scored.

| Story | Title | Status | Depends on |
|---|---|---|---|
| [2.1](epic-2-real-features/story-2.1-feature-contracts.md) | `feature.sutra.md` contracts | Done | none |
| [2.2](epic-2-real-features/story-2.2-client-server-reconciliation.md) | Client↔server reconciliation | Done | 1.2 |
| [2.3](epic-2-real-features/story-2.3-ai-feature-inference.md) | AI feature inference | Draft | 1.3 |
| [2.4](epic-2-real-features/story-2.4-feature-health-score.md) | Feature health score | Done | 2.1, 2.6 |
| [2.5](epic-2-real-features/story-2.5-request-flow-tracing.md) | Request flow tracing | Draft | none |
| [2.6](epic-2-real-features/story-2.6-test-coverage-mapping.md) | Test-coverage mapping | Draft | none |

## Epic 3 — Realistic Feature Viewer ⭐ (the goal)
The interactive product — replaces the static `view.html` dump.

| Story | Title | Status | Depends on |
|---|---|---|---|
| [3.1](epic-3-feature-viewer/story-3.1-viewer-app-shell.md) | Viewer app shell | Draft | none |
| [3.2](epic-3-feature-viewer/story-3.2-feature-cards-grid.md) | Feature cards grid | Draft | 3.1, 2.3, 2.4 |
| [3.3](epic-3-feature-viewer/story-3.3-feature-drilldown.md) | Feature drill-down | Draft | 3.1, 2.5 |
| [3.5](epic-3-feature-viewer/story-3.5-live-watch-mode.md) | Live / watch mode | Draft | 3.1, 1.5 |
| [3.6](epic-3-feature-viewer/story-3.6-search-filter-share.md) | Search, filter & share | Draft | 3.2, 3.3 |

## Epic 4 — Ecosystem
Make it real on the codebases we ship.

| Story | Title | Status | Depends on |
|---|---|---|---|
| [4.1](epic-4-ecosystem-sdk/story-4.1-language-agnostic-core.md) | Language-agnostic graph core | Draft | none |
| [4.2](epic-4-ecosystem-sdk/story-4.2-python-frappe-extractor.md) | Python / Frappe extractor | Draft | 4.1 |
| [4.4](epic-4-ecosystem-sdk/story-4.4-ci-integration.md) | CI integration | Draft | 1.6 |

## Epic 5 — Deferred (Out of Scope)
**Do not implement.** Moved out of Epics 1/3/4 because each breaks single-repo / standalone /
local-first. See **[epic-5-deferred/README.md](epic-5-deferred/README.md)**.

| Story | Title | Status | Reason |
|---|---|---|---|
| [1.4](epic-5-deferred/story-1.4-cross-repo-linking.md) | Cross-repo linking | Deferred | cross-repo |
| [3.4](epic-5-deferred/story-3.4-cross-repo-map.md) | Cross-repo ecosystem map | Deferred | cross-repo |
| [4.3](epic-5-deferred/story-4.3-forge-sdk-extraction.md) | Forge SDK primitive extraction | Deferred | forge coupling |
| [4.5](epic-5-deferred/story-4.5-hosted-graph-history.md) | Hosted graph history & trends | Deferred | hosted storage |

## Epic 6 — Phase 8 Hardening (Python/Frappe parity + honest viewer)
**Make Python real, harden Frappe — no new surface.** Closes the two gaps a real Frappe scan
(swifter-flows) exposed: the Python extractor produced imports-only edges → flow tracing empty →
viewer showed an import star, not a directed start→end flow; and cross-repo `link.json` was never
generated → Ecosystem tab 404. See **[epic-6-hardening/README.md](epic-6-hardening/README.md)**.

| Story | Title | Status | Depends on |
|---|---|---|---|
| [6.1](epic-6-hardening/stories/story-6.1-python-calls-edges.md) | Python `calls` edges — diagnose + fix call resolution | Draft | none |
| [6.2](epic-6-hardening/stories/story-6.2-python-local-imports-and-http-edges.md) | Local-import resolution + `http`/endpoint edges | Draft | 6.1 |
| [6.3](epic-6-hardening/stories/story-6.3-frappe-semantics.md) | Frappe semantics: hooks.py, doc_events, scheduler, DocType, whitelist | Draft | 6.1 |
| [6.4](epic-6-hardening/stories/story-6.4-flow-tracing-python-parity.md) | Flow tracing verified on Python (directed start→end) | Draft | 6.1, 6.2, 6.3 |
| [6.5](epic-6-hardening/stories/story-6.5-viewer-absent-feature-graceful.md) | Viewer: absent link.json/events ≠ console error | Draft | none |
| [6.6](epic-6-hardening/stories/story-6.6-link-json-generation.md) | `link.json` generation (cross-repo / bench-merge) | Draft | 6.5 |
| [6.7](epic-6-hardening/stories/story-6.7-self-ci-dogfood.md) | Self-CI dogfood — `scan --check` on forge-sutra PRs | Draft | none |

## Epic 8 — Phase 8 Hardening (resolution + flows + viewer truth)
**Diagnose and fix callee/id alignment on deep Frappe bench paths** — not blind emitter additions.
Epic 6 specs remain the narrative baseline; Epic 8 is the post-PR-#7 executor queue against what
is already on `main`. See **[epic-8-hardening/README.md](epic-8-hardening/README.md)**.

| Story | Title | Status | Depends on |
|---|---|---|---|
| [8.1](epic-8-hardening/stories/story-8.1-frappe-callee-resolution-deep-paths.md) | Frappe callee resolution — app-root keys vs bench-deep paths | Draft | none |
| [8.2](epic-8-hardening/stories/story-8.2-emit-callsite-coverage-gaps.md) | emitCallSiteEdges coverage — whitelist bodies, re-exports | Draft | 8.1 |
| [8.3](epic-8-hardening/stories/story-8.3-http-edges-frappe-call-requests.md) | HTTP edges — frappe.call and requests to in-repo targets | Draft | 8.1 |
| [8.4](epic-8-hardening/stories/story-8.4-flows-frappe-entry-detection.md) | flows.ts — Frappe endpoint entry detection | Draft | 8.1, 8.3 |
| [8.5](epic-8-hardening/stories/story-8.5-merge-graph-flows-link-json.md) | Merge graph — attach flows[] and real link.json | Draft | 8.4 |
| [8.6](epic-8-hardening/stories/story-8.6-viewer-empty-flows-ecosystem.md) | Viewer — empty flows and ecosystem absent-state | Draft | 8.5 |
| [8.7](epic-8-hardening/stories/story-8.7-regression-frappe-clean-withrun-slice.md) | Regression — frappe-clean + withrun bench slice | Draft | 8.1–8.4 |

---

## Remaining in-scope work (the build queue)

In order, single-repo only. **Current focus: Epic 8 (Phase 8 hardening).**

**Phase 8 hardening (Epic 8):** 8.1 deep-path resolver → 8.2 call-site coverage → 8.3 http resolve → 8.4 flow entries → 8.5 merge flows/link → 8.6 viewer honest empty → 8.7 withrun slice regression

**Epic 6 specs (planner baseline, overlaps 8.x):** 6.1 calls edges → 6.2 imports+http → 6.3 Frappe semantics → 6.4 flow parity → 6.5 viewer graceful → 6.6 link.json → 6.7 self-CI

**Earlier epics (plan baseline — much already on `main`):** 2.5 flow tracing → 2.3 AI inference → 2.6 test-coverage → 1.5 incremental scan · 3.1 shell → 3.2 cards → 3.3 drill-down → 3.5 live → 3.6 search/filter/share · 4.1 lang-agnostic core → 4.2 Python/Frappe extractor → 4.4 CI check

> **Note on status:** Epics 1–4 statuses above are the original plan baseline. The executor
> (Cursor) has since shipped much of 1–4 and the viewer directly to `main` — treat the repo's git
> history as the source of truth for what's actually built. Epic 8 is the current executor focus; Epic 6 remains the planner narrative.

## Contributing

Pick any `Draft` story with satisfied dependencies, flip its status to `In Progress` here,
and implement against its Acceptance Criteria + Test Plan. Keep `graph.json` the contract
(bump `GRAPH_VERSION` on breaking changes), keep ids deterministic, and respect the claim
bounds — *candidate* stays candidate until confirmed. Never build an Epic 5 story.
