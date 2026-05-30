# Story 4.4: CI integration

- **Epic:** Epic 4 — Ecosystem & SDK
- **Status:** Draft
- **Priority:** P1
- **Depends on:** 1.6 (graph diff)
- **Estimate:** M

> **Authoring note (planner):** Grounded in the verified contract —
> `src/types.ts` (`GRAPH_VERSION = 0`, `Severity = "error" | "warn" | "info"`,
> `SutraIssue { severity, kind, node, feature, message }`, `IssueKind`,
> `SutraGraph { version, repo, scanned_at, commit, nodes, edges, issues, features }`,
> `SUTRA_DIR = ".sutra"`, `GRAPH_FILE = "graph.json"`), `src/cli.ts` (commander
> wiring of `scan` / `view`, the `cmdScan` emitter, `graphFilePath()` helper,
> `process.exit` usage), `src/checks.ts` (the three checks — all emit
> `severity: "error"` today), `src/util/ids.ts` (exports `makeNodeId`,
> `relPosix`, `toPosix`, `httpTargetId`), and Story 1.6's diff module spec
> (`_bmad/epic-1-truthful-graph/story-1.6-scan-diff.md`) — all read during
> authoring. **This story is a thin gate layered on Story 1.6: it MUST consume
> 1.6's `diffGraphs(a, b): SutraDiff` and the `SutraDiff.issues.new` /
> `SutraDiff.issues.resolved` arrays rather than re-implementing graph diffing or
> issue-identity matching** (1.6 already computes stable issue identity excluding
> message text, and already enforces the `version`-equality guard). If 1.6 has
> not yet landed when this is picked up, it is a hard blocker — STOP and surface,
> do not re-derive diffing here. Symbols introduced by this story are tagged
> **NEW**; confirm 1.6's exact exported names against the merged code before
> binding.

## Story

As a developer who has adopted Forge Sutra on a JS/TS repo, I want `sutra scan`
to fail my CI build when my change introduces a **new** error-severity
structural issue (compared to a committed baseline), so that the team can gate
merges on structural drift and stop regressions from landing silently — without
being blocked by the pre-existing issues we haven't fixed yet.

## Context

Phase 0 ships a one-shot scanner: `sutra scan` writes `.sutra/graph.json` and
`.sutra/view.html`, and the `issues` array surfaces structural findings (each
with a `kind` and a `severity`). On its own that is a *report* — a human has to
open it and notice regressions. There is no machine signal a CI system can act
on, and the North Star ("honest about uncertainty") means we cannot just fail on
*every* issue: a repo with a long tail of pre-existing `warn`/`info` findings (or
even legacy `error` findings the team has chosen to defer) would have a red build
forever, which trains everyone to ignore it. The NOTES.md validation work also
flagged that some checks produce false positives, so a blunt "any error = fail"
gate would be dishonest about confidence and would punish noise.

Story 1.6 introduced the **graph diff** capability — comparing two
`.sutra/graph.json` snapshots to compute added/removed/changed nodes, edges, and
issues. This story builds the *gate* on top of that diff: `sutra scan --check`
compares the freshly scanned graph against a committed **baseline graph** and
exits non-zero **only when the diff contains a NEW issue at `error` severity**.
Pre-existing errors do not break the build; only drift does. Optionally, in a PR
context, it emits a concise comment describing the delta. This is the
"ecosystem" payoff: Sutra becomes an enforceable signal, not just a viewer.

## Acceptance Criteria

1. `sutra scan --check` runs a normal scan (producing `.sutra/graph.json` as
   today via the existing `cmdScan` pipeline), loads the baseline graph, and
   calls Story 1.6's `diffGraphs(baseline, current): SutraDiff`. It exits with
   code **`1`** if and only if `SutraDiff.issues.new` contains at least one
   `SutraIssue` whose `severity === "error"`. Otherwise it exits **`0`**. The
   set of "new" issues is taken verbatim from `SutraDiff.issues.new` — this story
   does not recompute which issues are new.
2. The baseline source is explicit and deterministic: `--check` reads the
   baseline from `--baseline <path>` if given, else from a default committed path
   `.sutra/baseline.json` (**NEW** convention; sibling of the existing
   `SUTRA_DIR`/`GRAPH_FILE` paths). If no baseline is found, `--check` must
   **not** silently pass; it prints `no baseline found; run \`sutra baseline\` to
   record one` to stderr and exits with code **`2`** (distinct from the `1` used
   for a real regression and the `0` used for a clean diff). No silent fallback
   that hides drift.
3. Issue identity for new/resolved classification is **delegated to Story 1.6**,
   not re-implemented here: 4.4 consumes `SutraDiff.issues.new` /
   `SutraDiff.issues.resolved`, which 1.6 already computes from a stable
   composite key (`IssueKind` + offending node/edge id + location, message text
   excluded). Consequently, re-running `scan --check` twice on an unchanged tree
   reports zero new issues (regression guard) — this property is inherited from
   1.6's deterministic ids (`makeNodeId` / `httpTargetId` in `src/util/ids.ts`)
   and must be re-asserted at this layer.
4. Only `severity === "error"` issues in `SutraDiff.issues.new` gate the build by
   default. New `warn` / `info` issues are **reported in the summary** (so they
   are visible) but do **not** change the exit code. A `--fail-on <severity>`
   flag MAY widen the threshold (e.g. `warn` gates on new `warn` and `error`),
   but the default stays `error`. (Note: 1.6 already defines a `--fail-on`
   concept for the `diff` command; 4.4's `--fail-on` is the *severity* threshold
   for the gate — reuse the flag name and semantics if they align, otherwise
   document the distinction explicitly in `--help`.)
5. `--check` prints a human-readable summary to stdout regardless of pass/fail:
   counts of new `error`, new `warn`, new `info` issues, plus a count of
   resolved-in-snapshot issues (from `SutraDiff.issues.resolved`), each line
   naming the issue `kind` and the `SutraIssue.node` it points at. Phrasing
   respects Sutra's claim bounds — "new structural issue" / "candidate" /
   "resolved in snapshot", never "bug", "fixed", or "this will break".
6. `--format json` makes `--check` emit a machine-readable delta object on stdout
   so other CI steps can consume it. The object reuses / wraps the 1.6
   `SutraDiff` (whose `--json` output is already byte-stable) plus the gate's
   computed `exitCode` and per-severity new-issue counts. It carries the current
   `GRAPH_VERSION` so consumers can detect contract changes.
7. Cross-version safety is **inherited from 1.6**: `diffGraphs` already refuses
   to compare graphs whose `version` (`GRAPH_VERSION`) differs. When the baseline
   and current versions differ, `--check` surfaces 1.6's version-mismatch error
   with the actionable hint `baseline is from a different graph version; re-record
   it with \`sutra baseline\`` and exits code **`2`** (NOT `1`) — a schema change
   must never be reported as a structural regression. This is tested.
8. An optional `--pr-comment [<path>]` mode formats the delta as Markdown suitable
   for a PR comment (new errors first, then a collapsible list of new warnings,
   then a one-line resolved count). It **writes the Markdown to stdout or the
   given file**; actually posting to GitHub/GitLab is the responsibility of a
   thin shell wrapper / GitHub Action documented in the README, not the CLI
   binary (no network I/O in this story).
9. A documented GitHub Actions snippet in `README.md` shows the canonical usage:
   commit a baseline (`sutra baseline`), then `sutra scan --check` on PRs, with
   the job failing on exit `1` and treating exit `2` as a configuration error
   (missing/incompatible baseline) rather than a regression.

## Technical Approach

**Design stance:** 4.4 is a *gate*, not a differ. All graph comparison and
issue-identity logic lives in Story 1.6's `src/diff.ts` (`diffGraphs`). 4.4 adds
(a) CLI flags + a `baseline` subcommand, (b) a small pure classifier over
`SutraDiff.issues`, and (c) a Markdown formatter. No new graph traversal, no new
id scheme.

**Files changed**

- `src/cli.ts` — extend the existing `scan` command (registered around the
  `.command("scan [repoPath]")` block) with the new flags: `--check`,
  `--baseline <path>`, `--fail-on <severity>`, `--format <text|json>`, and
  `--pr-comment [path]`. In `cmdScan`, after the existing pipeline builds the
  in-memory `SutraGraph` and writes `graph.json`, if `opts.check` is set:
  resolve the baseline path (`--baseline` or `.sutra/baseline.json`), load it
  with the same JSON-read approach used by `cmdView`, call
  `diffGraphs(baseline, current)` from `src/diff.ts`, pass the resulting
  `SutraDiff` to `gateFromDiff(...)`, print the summary (or JSON / PR-comment per
  flags), and `process.exit(result.exitCode)`. Handle the missing-baseline
  (exit `2`) and 1.6 version-mismatch (exit `2`) branches explicitly. Also add a
  **NEW** `baseline` subcommand — `sutra baseline [repoPath]` — that reuses the
  scan pipeline and writes the resulting graph to `.sutra/baseline.json` (factor
  the scan→graph assembly out of `cmdScan` into a shared helper so both commands
  call it; do not duplicate the pipeline).
- **NEW** `src/gate.ts` — pure functions, no I/O, no `console`:
  - `gateFromDiff(diff: SutraDiff, opts: { failOn: Severity }): GateResult` —
    partitions `diff.issues.new` by `severity` into `newErrors` / `newWarns` /
    `newInfos`, counts `diff.issues.resolved`, computes `exitCode` (`1` if any
    new issue at-or-above `opts.failOn` exists, else `0`), and returns a
    `GateResult`. It does **not** read `diff.nodes` / `diff.edges` for the gate
    decision (issues only).
  - `GateResult` (**NEW** type, in `src/gate.ts` or `src/types.ts`):
    `{ exitCode: number; newErrors: SutraIssue[]; newWarns: SutraIssue[];
    newInfos: SutraIssue[]; resolvedCount: number; graphVersion: number }`.
  - Reuse the existing `Severity` union from `src/types.ts` (`"error" | "warn"
    | "info"`) — do not redefine it. Define a severity-rank helper so `--fail-on`
    can express "this severity or worse".
- **NEW** `src/pr-comment.ts` — `formatPrComment(result: GateResult): string`
  produces Markdown (new errors first, `<details>` block for new warns, resolved
  count line). No network calls.
- `src/checks.ts` — unchanged. (Today all three checks emit `severity: "error"`;
  the gate is written to handle `warn`/`info` too so it stays correct once Story
  1.3's confidence/severity work lands.)

**Contract / versioning**

- No `GRAPH_VERSION` bump: the `.sutra/graph.json` node/edge/issue schema is
  unchanged — 4.4 only *reads* graphs and the 1.6 `SutraDiff`. The `--format
  json` output embeds the current `GRAPH_VERSION` (AC6) for consumer safety, and
  cross-version refusal is inherited from `diffGraphs` (AC7), not re-implemented.

**Honesty rules (from roadmap) respected**

- Gate language uses "candidate" / "new structural issue" / "resolved in
  snapshot", never "bug" / "fixed" / "auto-fix" / "will break".
- Identity + new/resolved classification are deterministic because they come from
  1.6 (which routes through `src/util/ids.ts`); 4.4 adds no fuzzy or index-based
  matching, so output is reproducible across runs and machines.
- No silent fallback (AC2/AC7): a missing baseline or a version mismatch exits
  `2` with an explicit message — it never quietly passes a real regression nor
  quietly fails a build on a schema change.
- Only `error`-severity issues gate by default, acknowledging that lower-severity
  and noted false-positive-prone checks (NOTES.md — e.g. the `/bot`
  template-literal external-host case) are not yet trustworthy enough to block a
  merge.

## Tasks

- [ ] Confirm Story 1.6 has landed and bind to its real exports: `diffGraphs`,
      the `SutraDiff` shape, and `SutraDiff.issues.new` / `.resolved`. If 1.6 is
      not merged, STOP and surface (hard blocker — do not re-implement diffing).
- [ ] Factor the scan→`SutraGraph` assembly out of `cmdScan` in `src/cli.ts` into
      a shared helper so both `scan` and the new `baseline` command reuse it.
- [ ] Add `--check`, `--baseline`, `--fail-on`, `--format`, and `--pr-comment`
      flags to the `scan` command in `src/cli.ts`.
- [ ] Add the **NEW** `baseline [repoPath]` subcommand writing the graph to
      `.sutra/baseline.json`.
- [ ] Create **NEW** `src/gate.ts` with pure `gateFromDiff(diff, { failOn })`
      partitioning `diff.issues.new` by `severity`, counting
      `diff.issues.resolved`, and computing `exitCode`. Reuse `Severity` from
      `src/types.ts`; add a severity-rank helper for `--fail-on`.
- [ ] In `cmdScan` `--check` path: resolve baseline → load → `diffGraphs` →
      `gateFromDiff` → render → `process.exit(result.exitCode)`.
- [ ] Implement the baseline-missing branch (exit `2`) and surface 1.6's
      version-mismatch as exit `2` with an actionable message (no silent pass).
- [ ] Implement the human-readable summary printer and the `--format json`
      emitter (wraps `SutraDiff` + gate counts; carries `GRAPH_VERSION`).
- [ ] Create **NEW** `src/pr-comment.ts` `formatPrComment(result)` (errors first,
      `<details>` for warns, resolved count) writing to stdout/file only.
- [ ] Add the GitHub Actions usage snippet + flag/exit-code docs to `README.md`.
- [ ] Add fixtures and `describe` blocks (see Test Plan) and run the suite green.

## Test Plan

New fixtures under `tests/fixtures/ci-gate/` (each is a pair of pre-built
`graph.json` snapshots, or a tiny source tree the scanner runs on, plus the
expected baseline — the executor picks whichever matches how existing tests in
`tests/sutra.test.ts` are structured):

- `baseline-clean` + `current-clean` — identical graphs. Proves `--check` exits
  `0` and reports zero new issues. **Regression guard:** running the gate twice
  on the same tree reports no phantom new issues (covers AC3).
- `baseline-clean` + `current-new-error` — current adds one `error`-severity
  issue not present in baseline. Proves exit `1` and that the summary names the
  issue `kind` + target (AC1, AC5).
- `baseline-with-errors` + `current-same-errors` — baseline already has `error`
  issues; current has the *same* pre-existing errors and nothing new. Proves
  exit `0` (pre-existing errors do NOT gate — the core "drift not state"
  behavior, AC1/AC4).
- `baseline-clean` + `current-new-warn` — current adds only a `warn` issue.
  Proves exit `0` by default but the new warn appears in the summary; with
  `--fail-on warn` the same fixture exits `1` (AC4).
- `baseline-missing` — no baseline file present. Proves the explicit
  "no baseline found" stderr message and **exit `2`** (not `0`, not `1`) (AC2).
- `version-skew` — baseline `version` differs from current `GRAPH_VERSION`.
  Proves the gate surfaces 1.6's version-mismatch as **exit `2`** and reports
  NO spurious drift (AC7).
- `pr-comment-format` — feed a known gate result to `formatPrComment` and snapshot
  the Markdown (errors first, warnings collapsible) (AC8).
- `json-output` — assert `--format json` emits a delta object containing
  `graphVersion` and the new-issue lists, parseable as JSON (AC6).

`describe('scan --check (CI gate)')` block in `tests/sutra.test.ts` covering the
above, asserting exit codes `0` (clean / new warn under default), `1` (new
error, or new warn under `--fail-on warn`), and `2` (missing / version-skewed
baseline). Add a focused `describe('gateFromDiff')` unit block that feeds
hand-built `SutraDiff` objects (no scanning) and asserts: a `diff.issues.new`
with one `error` yields `exitCode 1`; a `diff.issues.new` with only `warn`
yields `exitCode 0` by default and `1` under `failOn: "warn"`; an empty
`diff.issues.new` yields `exitCode 0` regardless of how many `resolved` issues
are present. The "no phantom new issues on unchanged tree" regression guard
(AC3) is covered by the `baseline-clean` + `current-clean` end-to-end case above
plus 1.6's own determinism tests.

## Out of Scope

- Graph diffing and issue-identity matching — owned by **Story 1.6**
  (`diffGraphs` / `SutraDiff`). 4.4 consumes them and must not re-implement them.
- Actually posting comments to GitHub/GitLab from the CLI (network I/O, auth
  tokens). This story only *formats* the comment; posting is a documented Action
  / shell wrapper.
- Auto-fixing or suppressing issues, inline-ignore comments, or a per-issue
  baseline "accept" workflow (push to a later Epic 4 story).
- Trend reporting / historical dashboards across many commits — that is
  **Story 4.5 (hosted graph history)**; `--check` is a two-point (baseline vs
  current) comparison only.
- Severity re-classification or new structural checks — this story consumes the
  existing `severity` on issues; it does not introduce or re-tune checks (those
  belong to the checks epic / NOTES.md false-positive cleanup).
- Any change to the AI-derived feature fields; the gate is purely structural and
  deterministic.
