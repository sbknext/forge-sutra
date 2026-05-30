# Sutra — Phase 0 (Executor Brief)

> Saved verbatim from the planner. This is the spec. Build Phase 0 ONLY.

## Mission
Point Sutra at a single repo and learn something true and new about it. Scan the
codebase, build a structured flow graph (`graph.json`), surface it as a simple
project view, and flag a small set of structural mistakes the code reveals on its
own. No hand-authored contracts, no auto-mode, no test generation in this phase.
Success = it tells me something about echo-ai / brain-api that I didn't already know.

## Hard constraints
- Standalone, single-user. No auth, no login, no `user_id`, no multi-user anything.
- NOT in Brain's runtime. Zero dependency on `brain-api`, its SQLite tables, communities,
  or any multi-user infra. (Lives in a folder under the brain repo, but imports none of it.)
- Local-first. Reads a target repo, writes a local `.sutra/` index, serves/opens locally.
- Forge subcommand, dogfooded. Implemented as the `sutra` command. Missing Forge SDK
  primitives are recorded in `NOTES.md` — never silently worked around.
- TypeScript only this phase. Scan only `.ts/.tsx/.js/.jsx`.
- Manual trigger only. Auto-mode OFF. `--watch` flag exists but exits "not implemented in Phase 0".

## Two commands only
1. `forge sutra scan [repo-path]` — default cwd. Parse TS/JS with a real parser (ts-morph).
   Exclude node_modules, dist, build, .next, *.min.js. Extract nodes+edges. Run 3 drift
   checks → `issues[]`. Write `.sutra/graph.json`. Print one-screen summary.
2. `forge sutra view` — read `.sutra/graph.json`, generate self-contained `.sutra/view.html`
   and open it. Feature grid + node/edge counts + issue badge (green/amber/red). Click a
   feature → sub-graph (Mermaid) + its issues.

## graph.json schema (the contract)
- version, repo, scanned_at, commit
- nodes[]: id (`relative/path#symbol`, stable+deterministic), type, name, file, line, data_shape, feature
- edges[]: from, to, kind
- issues[]: severity, kind, node, feature, message
- features[]: id, label, node_ids[], issue_count
- node.type ∈ route | handler | component | test | endpoint | module | function
- edge.kind ∈ calls | imports | renders | tests | http
- features = best-effort heuristic grouping (top-level route segment or directory). Mark heuristic.

## The three drift checks (code-derivable, no contract files)
1. `orphaned_endpoint` (error) — an HTTP call (fetch/axios) targets a path/method but no route handler defines it.
2. `missing_handler` (error) — a route file references a handler whose export/function doesn't exist.
3. `dangling_test_ref` (error) — a test imports/references a symbol/module/file that no longer exists.

## Claim bounds (don't overstate, anywhere)
- Surfaces structural/contract mistakes only — missing/broken/dangling links.
- Does NOT detect logic bugs. Intact wiring + wrong value = Sutra silent. Say so.
- Static approximation. Dynamic dispatch / runtime routes / external calls may be missed.
  Call results "candidate" where coverage uncertain, never "complete".
- No "auto-debug", "finds all bugs", "auto-generates tests" language anywhere.

## Validation gate
Run scan+view on echo-ai AND brain-api. Success only if on ≥1 it surfaces a real structural
issue/relationship not already obvious. Record findings in NOTES.md. If it only renders prettily
but reveals nothing true-and-new, stop and report honestly.

## Out of scope (do NOT build)
- `feature.sutra.md` contract files (Phase 1). Test scaffold generation. Auto-mode/watcher.
- Multi-repo/cross-repo linking. Freshness beyond storing `commit`. Any non-TS/JS language.

## Definition of done
- `scan` produces valid graph.json (deterministic ids) on both repos.
- 3 checks populate issues[] correctly (verify with a deliberately broken fixture).
- `view` opens a usable local HTML index with grouping + badges.
- Renderer is an optional leaf — graph.json generated independently.
- Build + tests pass locally before commit (per playbook).
- Zero Brain/auth/multi-user code.
- NOTES.md records validation findings + missing Forge primitives.
