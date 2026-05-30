# Story 2.4: Feature health score

- **Epic:** Epic 2 — Real Features
- **Status:** Draft
- **Priority:** P1
- **Depends on:** 1.3 (confidence model — optional input, degrades gracefully if absent), 2.1 (contract drift — optional input), 2.6 (test-coverage mapping — optional input). Hard dependency: none. Story computes a meaningful score from Phase-0 data alone and absorbs the richer inputs as they land.
- **Estimate:** M

## Story
As a developer pointing Sutra at my repo, I want each feature to carry a single composite **health score (0–100) and a band (green/amber/red)** derived from the structural signals Sutra already collects, so that the feature-cards grid (Story 3.2) can show an at-a-glance, honestly-derived badge telling me which parts of my product are wired cleanly and which are decaying — without me reading every issue line by line.

## Context
Phase 0 gives each feature only `issue_count` (see `SutraFeature` in `src/types.ts` and `buildFeatures` in `src/features.ts`). The roadmap's "minimum path to the named goal" lists **2.4** explicitly between reconciliation (2.2) and the viewer cards (3.2): "Each feature shows a **health score** with provenance you can click into" is a Definition-of-Done bullet in `_bmad/ROADMAP.md`. The viewer card in Story 3.2 is specified to render a "health badge" — that badge needs a field to read. Right now there is none; `view.ts:renderView` only has a raw issue count to colour against.

This story adds a `health` object to the `SutraFeature` contract and computes it deterministically from signals Sutra already has (issue count + severity, orphan ratio from `checks.ts` output) plus three *optional* signals that arrive in sibling stories (confidence from 1.3, contract drift from 2.1, test coverage from 2.6). Per the roadmap's cross-cutting principle #2 ("Code-derived first… optional layer, never a prerequisite") and #1 ("Never overstate"), the score must be fully computable from Phase-0 data and must record *which* signals were actually available, so the viewer can show provenance and never imply a coverage/contract input it did not have. This is a structural health heuristic only — it does not claim to measure runtime correctness, and must not use "finds all bugs" / "auto-debug" framing anywhere (per `README.md` Claim Bounds and `BRIEF.md`).

## Acceptance Criteria
1. `SutraFeature` in `src/types.ts` gains a required field `health: FeatureHealth`, where `FeatureHealth` is a new exported interface with at minimum: `score: number` (integer 0–100), `band: "green" | "amber" | "red"`, `inputs: FeatureHealthInput[]`, and `available_signals: string[]`. A new exported type `HealthBand = "green" | "amber" | "red"` is added.
2. `FeatureHealthInput` records per-signal provenance: `{ signal: string; available: boolean; weight: number; penalty: number; detail: string }` — so the viewer (3.2/3.3) can let a user click into *why* a feature scored what it did. `penalty` is the points this signal removed from 100; `available: false` signals contribute `penalty: 0` and are excluded from weight normalization.
3. `buildFeatures(nodes, issues)` in `src/features.ts` computes and attaches `health` for every feature it returns. The function signature is extended to accept the data it needs to score (see Technical Approach); the call site in `src/cli.ts:cmdScan` is updated accordingly. No feature may be emitted without a `health` field.
4. The score is **deterministic**: identical `graph.json` inputs produce an identical `health.score` and `health.band` across runs (no `Date.now()`, no random, stable iteration order). A regression test asserts byte-stable health output for a fixed fixture.
5. Scoring uses, at minimum, two always-available structural signals: **issue load** (count weighted by `SutraIssue.severity` — `error` > `warn` > `info`, normalized against feature size via `node_ids.length`) and **orphan ratio** (share of the feature's nodes/edges implicated in `orphaned_endpoint` / `missing_handler` / `dangling_test_ref` issues, derived from the existing `runChecks` output in `src/checks.ts`). A feature with zero issues and zero orphans scores 100 / green.
6. Three **optional** signals are wired but gated on availability: **confidence** (mean per-issue confidence from Story 1.3 if that field exists on `SutraIssue`), **contract drift** (from Story 2.1's `feature.sutra.md` reconciliation if present), and **test coverage** (from Story 2.6's coverage mapping if present). When an optional signal's source data is absent, it appears in `inputs` with `available: false`, `penalty: 0`, and is omitted from `available_signals`; the score is renormalized over only the available weights so missing inputs neither inflate nor deflate the result.
7. Band thresholds are explicit, documented constants in `src/features.ts` (proposed: `score >= 80` → green, `50–79` → amber, `< 50` → red) and are unit-tested at each boundary (49/50, 79/80).
8. `GRAPH_VERSION` in `src/types.ts` is bumped from `0` to `1` because `health` is a new required field on an existing contract object (breaking per ROADMAP principle #4). `README.md`'s `graph.json` schema section and `SutraFeature` example are updated to document `health` and the new version.
9. `view.ts:renderView` reads `feature.health.band` to colour the existing feature badge instead of (or in addition to) raw `issue_count`, and labels the badge as a "heuristic structural health score" so no consumer reads it as a correctness guarantee. The CLI summary in `cli.ts:cmdScan` may optionally print a one-line health distribution (e.g. "features: 12 green · 4 amber · 2 red") but must not regress existing output.

## Technical Approach
- **`src/types.ts`**: add `export type HealthBand = "green" | "amber" | "red";`, `export interface FeatureHealthInput { signal: string; available: boolean; weight: number; penalty: number; detail: string; }`, and `export interface FeatureHealth { score: number; band: HealthBand; inputs: FeatureHealthInput[]; available_signals: string[]; }`. Add `health: FeatureHealth;` to `SutraFeature`. Bump `export const GRAPH_VERSION = 0;` → `1`.
- **`src/features.ts`**: introduce `computeFeatureHealth(...)` and band constants (`GREEN_MIN = 80`, `AMBER_MIN = 50`). Extend `buildFeatures` to accept the inputs it scores against. Minimum new params: the `edges` array (for orphan-ratio denominators) alongside the existing `nodes` and `issues`; optional params for the 1.3/2.1/2.6 signals passed as nullable/optional so the function compiles and scores correctly when those stories have not shipped. Each feature: collect its `node_ids`, the `SutraIssue`s whose `feature` matches its `id`, weight by severity, divide by feature size to get an issue-load penalty; compute orphan-ratio penalty from the structural-issue kinds; then for each *available* optional signal compute its penalty. Normalize weights over available signals, sum penalties, `score = clamp(round(100 - totalPenalty), 0, 100)`, derive `band` from the constants. Populate `inputs` (all signals, available or not) and `available_signals` (available only). Use a stable sort / fixed signal ordering so output is deterministic (AC4).
- **`src/cli.ts`**: update the `buildFeatures(nodes, issues)` call in `cmdScan` to pass the additional arguments (`edges`, and any optional signals already present on the graph). Optionally extend the summary block to print the green/amber/red distribution.
- **`src/checks.ts`**: no behavioural change required — the orphan signal is derived from the `SutraIssue[]` that `runChecks` (including `checkOrphanedEndpoints`, `checkMissingHandlers`, `checkDanglingTestRefs`) already returns. If a shared helper to map an issue to its implicated node id(s) is useful, export it from `checks.ts` rather than duplicating matching logic.
- **`src/view.ts`**: in `renderView`, switch the feature badge colour source to `feature.health.band`; add the "heuristic structural health score" wording. Keep the renderer a pure leaf consumer of `graph.json` (ROADMAP principle #5).
- **Honesty rules**: `health` is fully code-derived from structural data; optional contract/AI/coverage signals are gated on availability and surfaced in `inputs`/`available_signals` so the viewer never implies a signal it lacked. No "complete" / "all bugs" language. If Story 2.3's AI summaries ever feed health, that contribution must be a clearly AI-labelled input with its own `signal` name. Deterministic ids and stable ordering preserved so `sutra diff` (1.6) can track health drift over time.

## Tasks
- [ ] Add `HealthBand`, `FeatureHealthInput`, `FeatureHealth` and the `health` field on `SutraFeature` in `src/types.ts`; bump `GRAPH_VERSION` to `1`.
- [ ] Implement `computeFeatureHealth(...)` and band threshold constants in `src/features.ts` (issue-load + orphan-ratio always-on signals).
- [ ] Wire the three optional signals (confidence/1.3, contract drift/2.1, coverage/2.6) with availability gating + weight renormalization.
- [ ] Extend `buildFeatures` signature and attach `health` to every returned `SutraFeature`.
- [ ] Update the `buildFeatures(...)` call site in `src/cli.ts:cmdScan` (pass `edges` + any present optional signals).
- [ ] Update `view.ts:renderView` to colour the feature badge from `feature.health.band` with the "heuristic structural health score" label.
- [ ] (Optional) Add a green/amber/red distribution line to the `cmdScan` summary without regressing existing output.
- [ ] Update `README.md`: `graph.json` `version` → `1`, `SutraFeature` example with `health`, and a short "Feature health (heuristic)" subsection.
- [ ] Add fixtures + `describe` blocks in `tests/sutra.test.ts` (see Test Plan).
- [ ] Run build + full test suite; confirm green before commit (ROADMAP principle #7).

## Test Plan
New fixtures under `tests/fixtures/` plus new `describe` blocks in `tests/sutra.test.ts`:
- **`health-clean/`** — a tiny feature with valid imports and a matched endpoint, zero issues. Proves a clean feature scores `100` / `green` and that `inputs` lists each signal with the always-on ones `available: true`.
- **`health-broken/`** — reuse the structural shape of the existing `broken` fixture (an unmatched `POST /api/capture` fetch). Proves an `orphaned_endpoint` drives `score` down and `band` to `amber` or `red`, and that the orphan signal's `FeatureHealthInput.penalty > 0`.
- **`describe("feature health — band thresholds")`** — unit-test `computeFeatureHealth` (or band derivation) at boundaries 49/50 (red↔amber) and 79/80 (amber↔green).
- **`describe("feature health — optional signal gating")`** — feed a graph with no confidence/contract/coverage data; assert those three appear in `inputs` with `available: false` / `penalty: 0`, are absent from `available_signals`, and that the score equals the score computed from the always-on signals alone (renormalization correctness).
- **Determinism regression guard** — run `buildFeatures` twice on the same fixture graph and assert deep-equal `health` objects (identical `score`, `band`, `inputs` ordering); guards AC4 and the `sutra diff` contract.
- **Schema/version guard** — assert `GRAPH_VERSION === 1` and that every feature emitted by a scan has a `health.band` in `{green, amber, red}` and an integer `0 <= score <= 100`.

## Out of Scope
- The actual viewer card UI and click-into-provenance panel — that is **Story 3.2** (cards grid) and **Story 3.3** (drill-down). This story only guarantees `feature.health` exists, is honest, and is read by the current `view.ts` badge.
- Defining or computing the confidence model (**1.3**), contract drift (**2.1**), or test-coverage mapping (**2.6**) themselves — this story only *consumes* them when present and degrades gracefully when not.
- Tuning weights against real repos / calibration studies — ship explicit, documented default weights; calibration is a later hardening task.
- Health trend / history across scans — that rides on `sutra diff` (**1.6**) and hosted history (**4.5**); this story only keeps output deterministic so those can diff it later.
- Any non-TS/JS language scoring — Python/Frappe features come via Epic 4 (**4.1/4.2**).
