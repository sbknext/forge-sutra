# Story 1.6: Scan diff command

- **Epic:** Epic 1 — Truthful Graph
- **Status:** Draft
- **Priority:** P1
- **Depends on:** Phase 0 (graph emission with deterministic ids); none within Epic 1
- **Estimate:** M

## Story
As a developer maintaining a JS/TS repo with Forge Sutra, I want a `sutra diff <graphA> <graphB>` command that reports exactly what changed between two graph snapshots — new and removed nodes, new/removed/now-broken edges, and new/resolved issues — so that I can see the structural impact of a change set honestly, gate CI on it (Epic 4.4), and feed a structural history timeline (Epic 4.5).

## Context
Phase 0 ships a single-shot picture: scan a repo, emit `.sutra/graph.json`, render `.sutra/view.html`. There is no way today to ask "what did this change actually do to the structure?" — every scan is a fresh, standalone snapshot. The BRIEF.md insistence on **stable, deterministic node/edge ids** (`src/util/ids.ts`) exists precisely so two snapshots can be compared by identity rather than by position or by fuzzy matching. This story is the first consumer that cashes in that guarantee.

A diff command is also a structural prerequisite for two later epics: CI gating (Epic 4.4, which needs a machine-readable "did anything regress?" signal — e.g. new broken edges or new high-confidence issues) and history (Epic 4.5, which needs a per-commit changelog of the graph). Per the roadmap's honesty principles, the diff MUST preserve the candidate-vs-confirmed distinction and never imply that a disappeared issue was "fixed" when it may simply be a scanner blind spot — it reports *resolved-in-snapshot*, not *fixed*.

## Acceptance Criteria
1. A new CLI subcommand `sutra diff <graphA> <graphB>` is wired in `src/cli.ts` alongside the existing scan command. Both arguments are paths to `graph.json` files; `<graphB>` defaults to the freshly-scanned current `.sutra/graph.json` when only one argument is given, and to comparing the last two available snapshots when invoked as `sutra diff` with no arguments (resolution rule documented in `--help`).
2. The command refuses to compare graphs whose `version` field (`SutraGraph.version`, i.e. `GRAPH_VERSION`) differs, printing a clear message that diff across schema versions is unsupported, rather than producing a misleading result.
3. Node diff: the output lists `added` nodes (id present in B, absent in A), `removed` nodes (id present in A, absent in B), and `changed` nodes (same id, differing `NodeType`, `file`, `name`, or other tracked fields). Comparison is by `SutraNode.id` only — never by name or file path — exercising the deterministic-id contract from `src/util/ids.ts`.
4. Edge diff: the output lists `added` edges, `removed` edges, and a distinct **`nowBroken`** category — edges whose endpoints existed and resolved in A but where at least one endpoint is now absent/unresolved in B (e.g. a `SutraEdge` whose `to` node id no longer exists). `nowBroken` is reported separately from plain `removed` because it represents a regression signal, not an intentional deletion.
5. Issue diff: the output lists `new` issues (present in B, absent in A), `resolved` issues (present in A, absent in B), and carries through each issue's `IssueKind` and confidence/label fields. Resolved issues are labelled "resolved in snapshot B" — NOT "fixed" — honoring the roadmap honesty rule that absence in a static scan is not proof of a fix.
6. Issue identity for diffing is computed deterministically from stable fields (e.g. `IssueKind` + the offending node/edge id + location), not from array index or message text, so that re-ordering or re-wording an issue does not register as resolve+new churn. Where an issue carries AI-derived fields, those fields are excluded from the identity key and clearly labelled in output as AI-sourced.
7. The diff has two output modes: a human-readable summary (default, grouped counts + detail lines) and `--json`, which emits a deterministic, stably-sorted `SutraDiff` object suitable for CI consumption (Epic 4.4) and history storage (Epic 4.5). The `--json` output is byte-stable for identical inputs (sorted keys, arrays sorted by id / composite key).
8. Exit code: in CI-friendly mode the command exits non-zero when a `--fail-on` threshold is crossed (default off; e.g. `--fail-on=now-broken,new-issues`), and exits zero on a clean diff. With no `--fail-on` flag the command always exits zero (reporting only), so adding diff to a pipeline is opt-in.
9. An empty diff (A and B identical) reports "no structural changes" and produces an all-empty `SutraDiff` in `--json` mode.

## Technical Approach
**Files changed / added:**
- `src/cli.ts` — register the `diff` subcommand, parse `<graphA> <graphB>`, the `--json` and `--fail-on` flags, and the no-arg / one-arg snapshot-resolution rules. Reuse the existing graph-loading helper used by the scan path; do not re-implement JSON reads ad hoc.
- `src/diff.ts` (**NEW**) — pure diffing module exporting `diffGraphs(a: SutraGraph, b: SutraGraph): SutraDiff`. No I/O, no console — testable in isolation. Internal helpers: `diffNodes`, `diffEdges` (incl. `nowBroken` detection), `diffIssues`.
- `src/types.ts` — add the **NEW** `SutraDiff` type and its member shapes. No change to `GRAPH_VERSION` is required because the on-disk `graph.json` contract is unchanged — diff only *reads* existing graphs. (If, while implementing, a tracked node/edge field turns out to be missing for change-detection, that is a separate graph-schema change requiring its own `GRAPH_VERSION` bump in its own story — do not fold it in here.)
- `tests/sutra.test.ts` — new `describe('diff', ...)` block (see Test Plan).

**New `SutraDiff` contract (in `src/types.ts`):**
```
export interface SutraDiff {
  fromVersion: number;       // GRAPH_VERSION of graphA (numeric, per SutraGraph.version)
  toVersion: number;         // GRAPH_VERSION of graphB (equal, enforced)
  nodes: { added: SutraNode[]; removed: SutraNode[]; changed: NodeChange[] };
  edges: { added: SutraEdge[]; removed: SutraEdge[]; nowBroken: SutraEdge[] };
  issues: { new: SutraIssue[]; resolved: SutraIssue[] };
  summary: { nodesAdded: number; nodesRemoved: number; nodesChanged: number;
             edgesAdded: number; edgesRemoved: number; edgesNowBroken: number;
             issuesNew: number; issuesResolved: number };
}
export interface NodeChange { id: string; before: SutraNode; after: SutraNode; changedFields: string[]; }
```
(Member type names `SutraNode`, `SutraEdge`, `SutraIssue` referenced above are the existing exports in `src/types.ts`; align the `SutraDiff` field names to their actual casing during implementation.)

**Honesty rules enforced (per roadmap):**
- Identity-by-deterministic-id only (nodes/edges via `src/util/ids.ts`-produced ids; issues via a stable composite key). No fuzzy matching, no positional comparison.
- `nowBroken` is a derived *candidate* regression signal, kept distinct from confirmed deletions.
- Issue absence is reported as "resolved in snapshot," never "fixed."
- AI-derived issue fields are excluded from identity keys and labelled as AI-sourced in output, so AI churn does not masquerade as structural change.
- `--json` output deterministically sorted so diffs consumed by history/CI are themselves stable.

## Tasks
- [ ] Add `SutraDiff` + `NodeChange` types to `src/types.ts`, aligned to existing `SutraNode`/`SutraEdge`/`SutraIssue` field names.
- [ ] Create `src/diff.ts` with pure `diffGraphs(a, b)`; index A and B nodes/edges by id into maps.
- [ ] Implement `diffNodes`: set arithmetic on node-id sets; for shared ids, compute `changedFields` and emit `NodeChange`.
- [ ] Implement `diffEdges`: added/removed by edge id; then compute `nowBroken` by checking each surviving/added edge's endpoint ids against B's resolved node-id set.
- [ ] Implement `diffIssues`: build stable composite issue keys (kind + node/edge id + location), excluding AI fields; set arithmetic for `new`/`resolved`.
- [ ] Implement deterministic sorting of all `SutraDiff` arrays (by id / composite key) and populate `summary` counts.
- [ ] Wire `diff` subcommand in `src/cli.ts`: arg parsing, snapshot-resolution (0/1/2 args), graph loading via the existing helper.
- [ ] Add `version` equality guard; clear error + non-zero exit on mismatch.
- [ ] Add `--json` output mode (stable serialization) and human-readable summary renderer.
- [ ] Add `--fail-on` flag mapping to exit codes; default reporting-only (exit 0).
- [ ] Write fixtures + `describe('diff', ...)` tests in `tests/sutra.test.ts`.
- [ ] Update README.md command list + add a `SutraDiff` schema note alongside the existing `graph.json` schema section.

## Test Plan
New fixtures under `tests/fixtures/diff/` — each a pair of pre-built `graph.json` snapshots so tests run `diffGraphs` directly without re-scanning:

- `node-add-remove/` — A→B adds one node and removes another; proves `nodes.added`/`nodes.removed` keyed by id, and that an unrelated node living at a *different* id does not leak into `changed`.
- `node-changed/` — same node id, different `NodeType`/`file`; proves `NodeChange.changedFields` lists exactly the differing fields and nothing more.
- `edge-now-broken/` — A has a resolved edge A→C; B removes node C; proves the edge lands in `edges.nowBroken`, NOT `edges.removed`, and is absent from `edges.added`.
- `edge-removed-clean/` — an edge intentionally deleted with both endpoints still present; proves it lands in `removed`, not `nowBroken` (regression guard distinguishing the two categories).
- `issue-new-resolved/` — A has issue X, B has issue Y; proves `issues.new` / `issues.resolved`, that output labels resolved as "resolved in snapshot" (asserts wording, not "fixed"), and carries `IssueKind`.
- `issue-reorder-noop/` — identical issues in a different array order and with a reworded message; **regression guard**: `diffGraphs` must report zero new/resolved issues (stable composite key, message text excluded).
- `identical/` — A === B; asserts empty `SutraDiff` and "no structural changes".
- `version-mismatch/` — graphs with differing `version`; asserts `diffGraphs`/CLI rejects with the version-mismatch error.

`describe('diff', ...)` blocks assert: (a) `diffGraphs` purity (no console / no FS access), (b) `--json` byte-stability — running twice on the same fixtures yields identical strings, (c) `--fail-on=now-broken` yields non-zero exit on `edge-now-broken/` and zero on `identical/`.

## Out of Scope
- Scanning/regenerating graphs as part of diff beyond the documented one-arg "diff against fresh scan" convenience (the heavy scan path stays in the existing scan command).
- Persisting or storing snapshot history, retention, or a timeline UI — that is **Epic 4.5 (history)**.
- The CI wrapper, GitHub Action, or PR-comment formatting — that is **Epic 4.4 (CI)**; this story only provides the `--json` contract and `--fail-on` exit codes those will consume.
- Rendering the diff into `view.html` / any visual diff — no change to `src/view.ts` here.
- Any change to `GRAPH_VERSION` or the `graph.json` node/edge/issue schema; diff is read-only over the existing contract.
- AI-assisted "explain the change" narratives — out of scope; diff stays deterministic and structural.
