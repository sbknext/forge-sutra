# Story 6.7: Self-CI dogfood — forge-sutra runs `scan --check` on its own PRs

- **Epic:** Epic 6 — Hardening
- **Status:** Draft
- **Priority:** P1
- **Depends on:** 6.1, 6.2, 6.4 (Python `calls`/`http` edges + flow parity must land first so the self-scan is meaningful), Story 4.4 (`scan --check` + baseline contract, already shipped)
- **Estimate:** M

## Story

As a forge-sutra maintainer, I want forge-sutra to run its own `scan --check` against a committed baseline on every pull request, so that regressions in our own structural health (new error-severity issues, broken flows) are caught by the same gate we ask users to trust — and the gate stops being an untested feature we ship but never run.

## Context

Story 4.4 shipped two cooperating commands in `src/cli.ts`: a `baseline` subcommand (`cmdBaseline`) that scans a repo and writes `.sutra/baseline.json` (the `BASELINE_FILE` constant), and `scan --check` (`runCheckGate`) that re-scans, runs `diffGraphs(baseline, current)` → `gateFromDiff(...)` and calls `process.exit(gate.exitCode)` — failing the build on new error-severity issues (`--fail-on` defaults to `error`), with optional `--format json` and `--pr-comment`. It also calls `assertGraphVersionsMatch` so a baseline recorded under a different `GRAPH_VERSION` is rejected. The capability is fully wired, but **forge-sutra has never run it on forge-sutra.** It is a feature we tell users to put in their CI while we have no CI that exercises it ourselves.

This is the classic untested-feature failure mode the epic warns against. Two concrete risks follow from not dogfooding:

1. **The gate may not actually work on a real TypeScript repo.** Our test suite covers `scan --check` against fixtures, but fixtures are small and hand-built. forge-sutra's own `src/` (extractors, `flows.ts`, `viewer/server.ts`, `cli.ts`, `link.ts`) is a real, evolving codebase — the kind of input that exposes baseline-drift, id-instability, and exit-code bugs that fixtures miss. If `makeNodeId` (`src/util/ids.ts`) ever produces non-deterministic ids, a committed baseline would thrash on unrelated PRs; only a real self-scan surfaces that.
2. **The README's CI example is aspirational, not proven.** The epic principle "build + tests green before commit" plus the ROADMAP's Epic 4.4 ("`sutra scan --check` fails build on new error-severity issues; PR comment") imply the example in the README should be copy-pasteable and known-good. Today it is neither, because nothing runs it.

This story does **not** change the extractor or the graph contract. It is pure dogfooding + documentation: a GitHub Actions workflow that builds, runs the existing test suite, then runs `sutra scan --check` on forge-sutra itself against a baseline committed to the repo. The ground-truth Frappe scan that motivates Epic 6 (22 nodes, 19 imports-only edges, `flows=0`) is *Python*; this story's self-scan is over forge-sutra's own *TypeScript* source, so it leans on the JS/TS extractor (`src/extractors/ts.ts`) which already emits `calls`/`http`/`renders`. That makes forge-sutra a valid non-trivial self-target even before the Python stories complete — but the gate is most valuable once 6.1/6.2/6.4 land, hence the dependency ordering.

## Acceptance Criteria

1. A committed baseline graph for forge-sutra exists at `.sutra/baseline.json` (the `BASELINE_FILE` constant in `src/types.ts`), produced by the real `baseline` subcommand (`cmdBaseline` in `src/cli.ts` → `runScanPipeline`), so its node/edge ids come from `makeNodeId` (`src/util/ids.ts`, `app::path#symbol`) and re-running `scan --check` on an unchanged tree yields zero new error-severity issues.
2. A GitHub Actions workflow file (candidate path: `.github/workflows/sutra-self-check.yml`) triggers on `pull_request` and runs ordered steps: (a) `npm ci`, (b) `npm run build`, (c) `npm test` (the existing suite), (d) `node dist/cli.js scan --check` against the committed `.sutra/baseline.json` — using the verbatim subcommand/flags already wired in `src/cli.ts` (`scan --check`, default baseline path, `--fail-on error`). Do not invent flags; reuse what the CLI exposes.
3. The `scan --check` step **fails the PR** via the non-zero `gate.exitCode` returned by `gateFromDiff` (`runCheckGate` calls `process.exit(gate.exitCode)`) when the self-scan introduces a new **error-severity** issue relative to the baseline, and **passes** (exit 0) when only warn/info-severity issues or no new issues appear — matching Story 4.4's `--fail-on error` default.
4. The workflow does not depend on `link.json` (`LINK_FILE`), the viewer server (`src/viewer/server.ts`), or `linkGraphs` (`src/link.ts`); a single-repo self-scan must run headlessly with no `/link.json`, `/events`, or viewer process involved (renderer is a leaf — `graph.json` is generatable without it).
5. `GRAPH_VERSION` (currently 6 in `src/types.ts`) is **not** bumped: this story adds CI + a baseline artifact and changes no graph schema, `SutraEdge.kind`, node type, or `FLOW_KINDS` contract. The committed baseline's `version` field must equal the current `GRAPH_VERSION`, or `assertGraphVersionsMatch` will (correctly) reject it — exit code 2, surfacing the need to re-record.
6. A documented refresh path exists for the baseline: when an intentional structural change lands, a maintainer regenerates it via `node dist/cli.js baseline` (the real subcommand) and commits the updated `.sutra/baseline.json` in the same PR, so the gate stays honest rather than being permanently silenced. The README states this explicitly.
7. The README's CI section is rewritten to point at this real, passing workflow as the canonical `scan --check` example, replacing any hand-written/aspirational snippet, including the `baseline` record + commit + refresh instructions.
8. A regression test proves the gate actually fails: an intentionally-introduced new error-severity issue (relative to a fixture baseline) makes `scan --check` exit non-zero via `gate.exitCode`, and removing it restores a clean (exit 0) run.

## Technical Approach

This story touches **CI config, a committed baseline artifact, and docs** — not the graph-producing code.

**Files added / changed:**
- `.github/workflows/sutra-self-check.yml` (new) — the dogfood workflow.
- `.sutra/baseline.json` (new, committed) — the baseline graph for forge-sutra, produced by `cmdBaseline` so its ids come from `makeNodeId` and are stable across runs. Note `.sutra` is in the default `EXCLUDED_DIRS` for scanning but is **not** git-ignored for this single committed file; confirm `.gitignore` does not exclude `.sutra/baseline.json` (candidate: add a negated ignore rule) so the baseline is actually checked in.
- `README.md` (changed) — CI section rewritten to reference the real workflow + `baseline` refresh command.
- Possibly `package.json` (changed) — add `scripts` wrappers (candidate: `"sutra:baseline": "node dist/cli.js baseline"`, `"sutra:check": "node dist/cli.js scan --check"`) so the workflow and humans invoke one canonical command. The verbatim CLI surface (confirmed in `src/cli.ts`) is: `baseline [repoPath] [--output-dir]` writes `.sutra/baseline.json`; `scan [repoPath] --check [--baseline <path>] [--fail-on <sev>] [--format <fmt>] [--pr-comment [path]]`. Default baseline path is `.sutra/baseline.json`; default `--fail-on` is `error`. Reuse these exactly — invent nothing.

**Command contract (confirmed against `src/cli.ts`):**
- The workflow's check step invokes `scan --check` with no `--baseline` override, relying on the default `.sutra/baseline.json` resolution in `cmdScan` (`opts.baseline ?? baselineFilePath(cwd)`). The gate's outcome is `process.exit(gate.exitCode)` from `runCheckGate`; the workflow needs no extra exit-code plumbing — a non-zero CLI exit fails the GitHub Actions step natively.
- Baseline is recorded with the `baseline` subcommand (not by redirecting `scan` stdout); `cmdBaseline` writes the file directly via `runScanPipeline` + `fs.writeFileSync`.

**Edges / nodes / ids:** none are introduced or modified by this story. The self-scan consumes whatever the existing extractors emit (`src/extractors/ts.ts` for forge-sutra's own TS source) and whatever `scan` already writes. Determinism of `makeNodeId` (`app::path#symbol`) is what makes a committed baseline viable; if the self-scan reveals id churn on unchanged code, that is a *separate* bug to file — this story's gate would surface it, which is part of its value.

**How flows.ts is involved:** only indirectly. forge-sutra's self-scan exercises the same `scan` pipeline that runs `flows.ts` over `FLOW_KINDS = {renders, calls, http}`; the baseline therefore captures forge-sutra's own traced flows, and a regression that breaks flow tracing would shift the baseline. This story does not modify `flows.ts`.

**Parity target:** the workflow should mirror what we would tell a user to do — `npm ci`, build, test, then `scan --check`. The README example and the workflow must be the same commands, so "the docs" and "what CI runs" can never drift.

## Tasks

- [ ] Build (`npm run build`), then record the baseline against forge-sutra itself: `node dist/cli.js baseline`. Commit the resulting `.sutra/baseline.json`; ensure `.gitignore` does not drop it.
- [ ] Verify re-running `node dist/cli.js scan --check` immediately on the unchanged tree yields exit 0 (zero new error-severity issues). If ids churn (`makeNodeId` non-determinism), STOP and file that as a separate bug — it would invalidate the committed baseline.
- [ ] Add `package.json` scripts (candidate `sutra:baseline`, `sutra:check`) wrapping the verbatim CLI commands so workflow + humans share one entrypoint.
- [ ] Write `.github/workflows/sutra-self-check.yml`: `pull_request` trigger; steps = checkout, setup Node (pin to the repo's `engines` version), `npm ci`, `npm run build`, `npm test`, then `npm run sutra:check` (the `scan --check` step). Confirm `assertGraphVersionsMatch` passes (baseline `version` == `GRAPH_VERSION`).
- [ ] Confirm the check step runs fully headless — no viewer server (`src/viewer/server.ts`), no `link.json`, no `linkGraphs` — and that a non-zero CLI exit fails the job.
- [ ] Rewrite the README CI section to point at this workflow as the canonical example, including the `baseline` record + commit + refresh instructions.
- [ ] Add the regression-guard test (see Test Plan) under `tests/fixtures/`: assert a synthetic new error-severity issue makes `scan --check` exit non-zero against a fixture baseline, and a clean tree exits 0.
- [ ] Run the npm scripts locally to confirm green on the unchanged tree.
- [ ] Verify `GRAPH_VERSION` is unchanged and no graph-schema / edge-kind / `flows.ts` files were touched.
- [ ] Single commit; build + full test suite green.

## Test Plan

A new test under `tests/fixtures/` proves the gate's behaviour deterministically, independent of forge-sutra's live source (so the test does not break every time we edit `src/`):

- **Fixture:** `tests/fixtures/self-check-gate/` containing (a) a small clean TS feature (e.g. a route handler that `calls` a helper — enough for the existing TS extractor to emit `calls` edges and for `flows.ts` to trace a path), and (b) a committed `baseline.json` produced by `scan` over that clean tree.
- **Test 1 — clean tree passes:** run `scan --check` over the fixture against its committed baseline; assert exit code 0 and zero new error-severity issues. This proves the happy path the CI relies on.
- **Test 2 — regression fails:** mutate the fixture to introduce a new error-severity issue (e.g. an `orphaned_endpoint` / `missing_handler` — one of the existing drift checks from Phase 0), re-run `scan --check` against the same baseline; assert non-zero exit and that the new issue appears in the diff. This proves the gate actually bites.
- **Test 3 — warn/info does not fail:** introduce only a warn/info-severity change; assert `scan --check` exits 0. This proves the gate is scoped to error-severity per Story 4.4 semantics and won't false-fail PRs.
- **Test 4 — baseline determinism / regression guard:** run `scan` twice over the unchanged fixture and assert byte-stable (or id-stable) output, so a committed baseline cannot thrash on unrelated PRs. This is the regression guard against `makeNodeId` non-determinism.

Each test asserts on exit code + the issue diff, not on log text, so the contract is the gate behaviour, not formatting.

## Out of Scope

- Any change to the Python/Frappe extractor (`src/extractors/python-frappe.ts`), `flows.ts`, `FLOW_KINDS`, edge kinds, node types, or `GRAPH_VERSION` — those are Stories 6.1–6.4.
- `link.json` generation or cross-repo / Ecosystem CI (Stories 6.5/6.6); this is a single-repo self-scan only.
- PR-comment formatting/enhancements beyond what Story 4.4 already provides — reuse it as-is, do not extend it.
- Publishing, release automation, or hosted graph history (ROADMAP Epic 4.5).
- Running the gate on any repo other than forge-sutra itself.
