# Forge Sutra — Roadmap (Planner Document)

> **Author:** Planner session. **Status:** active. **Last updated:** 2026-05-30.
> **North Star:** A **realistic feature viewer** — point Sutra at one repo (or a set of
> linked repos) and *see your product as features*: what each feature is, what it wires to,
> whether the wiring is intact, and where it is broken — derived from code, not from
> hand-written docs, and honest about its own uncertainty.

This document is the single source of truth for what gets built after Phase 0. The executor
session reads the per-story files under `_bmad/epic-*/stories/`. The planner authors stories
BEFORE the executor begins (role split). Do not skip the planner cross-check pass.

---

## Where we are (Phase 0 — DONE)

Shipped (`364e5c5`):
- `sutra scan [repo]` → `.sutra/graph.json` (deterministic ids, nodes/edges/issues/features).
- `sutra view` → self-contained `.sutra/view.html` (Mermaid + feature grid + issue badges).
- 3 drift checks: `orphaned_endpoint`, `missing_handler`, `dangling_test_ref`.
- Proxy-awareness (`next.config` rewrites) + asset-import filter (precision fixes, 34 tests green).
- Validated on echo-ai (638 nodes), brain-api (1,218 nodes), + 12-repo ecosystem sweep.

Phase 0 honest limits (from NOTES.md — these define the backlog):
- Single-repo. Cannot confirm cross-repo (echo-ai → brain-api) links → findings are *candidate*.
- External-host false positives (Telegram `/bot` template literal).
- Dynamic-segment URLs (`/api/todos/${id}`) truncated → mismatch risk.
- No confidence score — error/warn/info is coarse; can't say "80% sure".
- No feature contracts, no flow tracing, no live view, TS/JS only.

---

## The gap to "realistic feature viewer"

A *realistic* feature viewer must be:
1. **Truthful** — no lies. Every candidate is labelled; confirmed links are actually confirmed
   (cross-repo + dynamic-route + external-host resolved). → **Epic 1**.
2. **Feature-centric** — the unit is a *feature*, not a file. Features are first-class, can carry
   a code-derived contract, reconcile client↔server, and trace a real request flow. → **Epic 2**.
3. **Viewable** — an actual interactive viewer (not a static dump): feature cards, drill-down,
   cross-repo map, live refresh on change. This is the deliverable the goal names. → **Epic 3**.
4. **Real on real codebases** — works on the Frappe/Python world we actually ship, extractable as
   a Forge SDK primitive, runs in CI, diffs scans over time. → **Epic 4**.

Each epic is independently shippable and leaves the tool more honest + more useful than before.

---

## Epics

| Epic | Title | Goal contribution | Stories |
|---|---|---|---|
| **1** | Truthful Graph | Kill false positives; turn *candidate* into *confirmed*; add confidence | 1.1–1.6 |
| **2** | Real Features | Features become first-class: contracts, reconciliation, AI inference, flow trace | 2.1–2.6 |
| **3** | Realistic Feature Viewer ⭐ | The viewer app — cards, drill-down, cross-repo map, live | 3.1–3.6 |
| **4** | Ecosystem & SDK | Python/Frappe, lang-agnostic core, Forge SDK, CI, scan diff | 4.1–4.5 |

⭐ = the named goal. Epics 1–2 make the viewer *truthful*; Epic 3 builds the viewer; Epic 4 makes
it real across our stack.

### Epic 1 — Truthful Graph
The viewer is worthless if it lies. Before we build UI, the graph must stop producing false
positives and must be able to *confirm* a link, not just flag a candidate.
- **1.1** External-host allowlist (kill `/bot` & 3rd-party API false positives)
- **1.2** Dynamic-segment route matcher (Next.js `[id]` / Express `:id` aware)
- **1.3** Confidence model (per node/edge/issue score + provenance, replaces coarse severity-only)
- **1.4** Cross-repo linking (resolve echo-ai → brain-api proxied calls to real handlers)
- **1.5** Incremental scan (per-file cache keyed on content hash; only re-parse changed files)
- **1.6** Scan diff (`sutra diff` — what changed between two graphs: new/removed/broken links)

### Epic 2 — Real Features
A feature is more than a directory prefix. Make it a real, contract-bearing, traceable unit.
- **2.1** `feature.sutra.md` contracts (optional hand/AI-authored intent layer over heuristic groups)
- **2.2** Client↔server reconciliation (match every client call to a real handler across repos)
- **2.3** AI feature inference (LLM names + summarizes features from their node cluster — labelled AI)
- **2.4** Feature health score (composite: issues + coverage + orphan ratio + contract drift)
- **2.5** Request flow tracing (entry → component → call → endpoint → handler → DB, as a path)
- **2.6** Test-coverage mapping (which features have tests, which flows are untested)

### Epic 3 — Realistic Feature Viewer ⭐ (the goal)
The interactive product. Replaces the static `view.html` dump with a real viewer.
- **3.1** Viewer app shell (local dev server + SPA; reads `graph.json`, no rebuild to refresh)
- **3.2** Feature cards grid (name, health badge, node/edge counts, contract status, AI summary)
- **3.3** Feature drill-down (interactive flow graph + issue list + traced request paths)
- **3.4** Cross-repo map (ecosystem view: repos as clusters, confirmed cross-repo edges between them)
- **3.5** Live / watch mode (implements the Phase-0 `--watch` stub; re-scan on FS change, push to viewer)
- **3.6** Search, filter & share (find a feature/endpoint; filter by health/confidence; export a view)

### Epic 4 — Ecosystem & SDK
Make it real on the codebases we actually ship and extract reusable primitives.
- **4.1** Language-agnostic graph core (decouple model from ts-morph; pluggable extractors)
- **4.2** Python / Frappe extractor (whitelisted methods, DocType events, hooks → nodes/edges)
- **4.3** Forge SDK extraction (repo walker, AST service, index store, view host — per NOTES.md §"Missing Primitives")
- **4.4** CI integration (`sutra scan --check` fails build on new error-severity issues; PR comment)
- **4.5** Hosted graph history (store scans over time; trend health; the `commit` field finally pays off)

---

## Sequencing & dependencies

```
Epic 1 (truthful)  ──┬─> Epic 2 (features) ──┬─> Epic 3 (viewer) ⭐
                     │                        │
1.1 host allowlist   │   2.1 contracts        │   3.1 shell ── 3.2 cards ── 3.3 drilldown
1.2 dyn routes  ─────┤   2.2 reconcile (needs 1.4)  3.4 cross-repo (needs 1.4/2.2)
1.3 confidence  ─────┤   2.3 AI infer          │   3.5 live (needs 1.5)
1.4 cross-repo  ─────┘   2.4 health            │   3.6 search/filter
1.5 incremental ─────────2.5 flow trace ───────┘
1.6 diff                 2.6 test-cov
                                          Epic 4 runs partly parallel:
                                          4.1 lang-core gates 4.2; 4.3 SDK can start anytime; 4.4/4.5 last
```

Minimum path to the **named goal** (a realistic feature viewer that doesn't lie):
**1.1 → 1.2 → 1.3 → 1.4 → 2.2 → 2.4 → 3.1 → 3.2 → 3.3 → 3.4.**
Everything else hardens or widens it.

---

## Cross-cutting principles (apply to every story)

1. **Never overstate.** Candidate stays candidate until confirmed. Every AI-derived field labelled AI.
2. **Code-derived first.** Hand/AI contracts are an *optional* layer, never a prerequisite.
3. **Deterministic ids.** Keep `relPath#symbol` stable so `sutra diff` and history work.
4. **Graph.json is the contract.** Bump `GRAPH_VERSION` on any breaking schema change; migrate the viewer.
5. **Renderer is a leaf.** `graph.json` must be generatable headless; the viewer only consumes it.
6. **Standalone, single-user, local-first.** No Brain runtime, no auth, no multi-user (Phase-0 constraint holds).
7. **Tests + build green before commit.** Add a fixture for every new check / resolver.

---

## Definition of Done — "Realistic Feature Viewer"

The roadmap is *done* when, on the real echo-ai + brain-api pair:
- Sutra **confirms** (not just flags) which echo-ai client calls resolve to real brain-api handlers,
  and which are genuinely broken — zero proxy/host/dynamic false positives.
- Each feature shows a **health score** with provenance you can click into.
- The **viewer** opens locally, lists features as cards, drills into a real traced request flow,
  shows the **cross-repo** echo-ai↔brain-api map, and refreshes live on code change.
- It runs on at least one **Frappe/Python** repo we own (Epic 4.2).
- A human looking at it learns something true-and-new about the product — the Phase-0 gate, raised.
