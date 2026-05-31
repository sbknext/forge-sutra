# Epic 6 — Phase 8 Hardening (Python / Frappe parity + honest viewer)

> **Theme: make Python real, harden Frappe — no new surface.** Forge Sutra grew wide (export,
> hooks, migrate, viewer, npm publish) but is **shallow on Python/Frappe**: the extractor emits
> only `imports` edges, so flow tracing, health, and reconciliation are half-broken on the stack
> we actually ship. This epic closes that gap and polishes the rough edges a real Frappe scan
> exposed. **No new features — parity + hardening only.**

## Why this epic exists (evidence)

Verified on a real scan — `swifter-flows` (3 Frappe bench apps), feature `sw_inventory_retrun_flow`:
- 22 nodes (10 endpoint, 9 function, 3 module), **19 edges — all `imports`**. Zero `calls`/`http`.
- `flows.ts` (Story 2.5) traces over `FLOW_KINDS = {renders, calls, http}` → **`flows[] = 0`** →
  viewer honestly shows "No traced request paths" + a star-shaped import blob instead of a
  directed start→end flow diagram.
- **Root cause:** `src/extractors/python-frappe.ts` emits module/function/endpoint nodes and
  `imports` edges to `ext:<module>` only. It does **not** resolve intra-repo calls (`calls`),
  does not emit `http`/endpoint-invocation edges, does not resolve local imports to module nodes,
  and ignores Frappe semantics (`hooks.py`, `doc_events`, `scheduler_events`, DocType controllers).
- Cross-repo / Ecosystem tab requests `/link.json` → **404** (never generated). `events`/`favicon`
  404s also surface in console — feature-absent shown as error.

The JS/TS extractor (`src/extractors/ts.ts`) already emits `calls`/`http`/`renders`, so JS scans
produce proper flows. This epic brings Python to parity, then hardens.

## Stories

| Story | Title | Fixes |
|---|---|---|
| [6.1](stories/story-6.1-python-calls-edges.md) | Python `calls` edges (intra-repo call resolution) | flow-trace input |
| [6.2](stories/story-6.2-python-local-imports-and-http-edges.md) | Resolve local imports to module nodes + `http`/endpoint edges | flow crosses boundaries |
| [6.3](stories/story-6.3-frappe-semantics.md) | Frappe semantics: hooks.py, doc_events, scheduler_events, DocType controllers | Frappe depth |
| [6.4](stories/story-6.4-flow-tracing-python-parity.md) | Flow tracing verified on Python (directed start→end) | the user-visible "one flow diagram" |
| [6.5](stories/story-6.5-viewer-absent-feature-graceful.md) | Viewer: absent link.json/events ≠ console error | honest polish |
| [6.6](stories/story-6.6-link-json-generation.md) | `link.json` generation (cross-repo / bench-merge) | Ecosystem tab works |
| [6.7](stories/story-6.7-self-ci-dogfood.md) | Self-CI dogfood — forge-sutra runs `scan --check` on its own PRs | prove the gate |

## Mapping to the reported bugs
- **"Ek flow diagram start→end nahi banta"** → 6.1 + 6.2 + 6.4.
- **"Cross-repo broken / link.json 404"** → 6.5 + 6.6.
- **"Frappe ke liye harden"** → 6.3 (+ 6.1/6.2 are Frappe-first).

## Principles (unchanged)
Orchestrate the AST, don't guess; candidate not confirmed; deterministic ids (`app::path#symbol`);
renderer is a leaf; bump `GRAPH_VERSION` only if the contract changes; one story = one commit,
build + tests green; add a Python/Frappe fixture per story.
