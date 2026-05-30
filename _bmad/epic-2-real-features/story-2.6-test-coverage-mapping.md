# Story 2.6: Test-coverage mapping

- **Epic:** Epic 2 — Real Features
- **Status:** Draft
- **Priority:** P1
- **Depends on:** 2.4 (Feature health score) consumes this output; this story is independently shippable without 2.5. No hard upstream dependency — it builds on the Phase-0 `tests` edge kind that already exists.
- **Estimate:** M

## Story

As a developer looking at my product as features, I want Forge Sutra to map which features and flows have tests pointing at them (and which do not), so that I can see — honestly and statically — where my product is exercised by tests and where it is a blind spot, without being told this is a runtime coverage number.

## Context

Phase 0 already extracts a `tests` edge (`EdgeKind = "tests"` in `src/types.ts`) from a test file to its subject, and ships the `dangling_test_ref` check (`checks.ts`) that flags test references with no resolvable target. What Phase 0 does **not** do is invert that relationship to answer the product-level question: *which features have any test pointing at them, and which have none?* The `SutraFeature` interface in `src/types.ts` carries `id`, `label`, `node_ids`, and `issue_count` — there is no notion of test linkage on a feature. The roadmap names this gap directly: Epic 2 line **2.6 "Test-coverage mapping (which features have tests, which flows are untested)"**, and the sequencing note states 2.6 feeds health (2.4) and the viewer (3.2/3.3).

This is **static mapping, not runtime coverage**. We can see that a `tests` edge exists from a test file to a node inside a feature; we cannot and must not claim a line/branch coverage percentage, that an assertion is meaningful, or that the test passes. The roadmap's first cross-cutting principle ("Never overstate") and Sutra's claim bounds (README's claim-bounds section: structural, not "finds all bugs") govern every field this story adds. The output must read as "this feature has N test edges pointing into it" / "this feature has zero test edges" — a presence signal derived from imports/references, explicitly labelled as static.

## Acceptance Criteria

1. The graph emits, per feature, a static test-linkage summary: at minimum the count of `tests` edges whose target node belongs to that feature, and the set of distinct test node ids ("test files") that contribute. This is computed only from existing `SutraEdge` records where `kind === "tests"` — no new extraction of test internals.
2. A feature with zero resolvable `tests` edges into any of its `node_ids` is marked **untested** (a boolean or equivalent enum field), distinct from a feature whose test linkage is merely low.
3. A new check in `src/checks.ts` (e.g. `checkUntestedFeatures`) emits a `SutraIssue` of a new `IssueKind` value `"untested_feature"` at `severity: "info"` for each untested feature, with `node` set to the feature id, `feature` set to the same id, and a `message` that uses static language ("no test references resolve into this feature" — never "0% coverage").
4. The new field(s) are added to the `SutraFeature` interface in `src/types.ts` and are **additive** (existing consumers — `view.ts`, future viewer — keep working if they ignore them). Field naming makes the static nature unambiguous (e.g. `test_edge_count`, `tested: boolean`, `test_node_ids`), and any uncertainty is surfaced rather than hidden.
5. Because `SutraFeature` and `IssueKind` change, `GRAPH_VERSION` is bumped from `0` to `1` in `src/types.ts`, and `view.ts` is updated to not break on the new version.
6. Coverage linkage uses **only** confirmed `tests` edges already in the graph; a `tests` edge that is itself dangling (no resolvable target — the `dangling_test_ref` case) does **not** count toward a feature being "tested". The mapping must not let a broken test reference inflate coverage.
7. The mapping is deterministic: feature order, `test_node_ids` order, and emitted issue order are stable across runs given the same input graph (sorted by id), preserving the roadmap's deterministic-ids / diffable-scan guarantee.
8. README's structural-checks / claim-bounds section is updated to list test-coverage mapping as a **static presence signal**, explicitly stating it is NOT runtime/line coverage and does NOT assert tests pass.
9. The static-only framing is stated in the emitted data itself (e.g. a label/`note` on the summary or in the issue message) so a downstream viewer (3.2/3.3) cannot accidentally render it as a runtime percentage.

## Technical Approach

**Files changed:**

- `src/types.ts`
  - Add `"untested_feature"` to the `IssueKind` union.
  - Extend `SutraFeature` with additive fields, e.g.:
    ```ts
    /** Count of confirmed `tests` edges whose target node is in this feature. Static linkage, NOT runtime coverage. */
    test_edge_count: number;
    /** Distinct test node ids that reference into this feature. */
    test_node_ids: string[];
    /** True iff at least one confirmed `tests` edge resolves into this feature. Static presence only. */
    tested: boolean;
    ```
  - Bump `export const GRAPH_VERSION = 0;` → `1`.

- `src/features.ts`
  - In the function that builds `SutraFeature[]`, after node grouping, take the graph's `edges` (or accept them as a parameter) and, for each feature, count `tests` edges whose `to` resolves to a node id in that feature's `node_ids`. Populate `test_edge_count`, `test_node_ids` (sorted, deduped), and `tested`. Only count edges whose target is a real node id present in the node set — a dangling test ref (target not in nodes) is excluded, keeping AC6.

- `src/checks.ts`
  - Add `checkUntestedFeatures(graph)` (mirroring the existing `checkOrphanedEndpoints` / dangling-test-ref style) that iterates features and emits an `info` `SutraIssue` with `kind: "untested_feature"` for every feature where `tested === false`. Wire it into the same aggregation point where the existing three checks are collected so its issues land in `SutraGraph.issues` and bump `SutraFeature.issue_count` consistently with the other checks.

- `src/view.ts`
  - Render the new per-feature test linkage in the feature grid as a small static badge/label (e.g. "tests: 3" or "untested"), worded so it cannot be misread as a coverage percent. Tolerate `version >= 1`.

- `README.md`
  - Document `untested_feature`, the new `SutraFeature` fields, the `GRAPH_VERSION` bump to 1, and the explicit claim bound: static presence, not runtime coverage.

**Honesty rules respected:** no AI fields (this is purely deterministic edge counting, so nothing is labelled AI); candidate-vs-confirmed honored by excluding dangling test refs; deterministic ids/order preserved; `GRAPH_VERSION` bumped because the contract changed; the static-not-runtime claim is carried in both the data and the docs.

## Tasks

- [ ] Add `"untested_feature"` to `IssueKind` and the additive fields (`test_edge_count`, `test_node_ids`, `tested`) to `SutraFeature` in `src/types.ts`.
- [ ] Bump `GRAPH_VERSION` from `0` to `1` in `src/types.ts`.
- [ ] In `src/features.ts`, compute per-feature test linkage from `tests` edges, counting only edges whose target is a real node id within the feature (exclude dangling refs); sort + dedupe `test_node_ids`.
- [ ] Add `checkUntestedFeatures` to `src/checks.ts` emitting `info` / `untested_feature` issues with static-language messages.
- [ ] Wire the new check into the existing check-aggregation path so its issues feed `SutraGraph.issues` and `SutraFeature.issue_count`.
- [ ] Update `src/view.ts` to render a static test-linkage badge and accept `version >= 1`.
- [ ] Update `README.md` structural-checks + claim-bounds sections with the new check, fields, version bump, and the static-not-runtime disclaimer.
- [ ] Add test fixtures + `describe` blocks in `tests/sutra.test.ts` (see Test Plan).
- [ ] Add a regression guard asserting a dangling test ref does NOT mark its target feature `tested`.
- [ ] Run the full test + build; confirm all existing tests stay green and the `GRAPH_VERSION` bump is reflected wherever the suite asserts the version.

## Test Plan

New fixtures under `tests/fixtures/` (each a minimal repo tree scanned end-to-end via the existing scan path used by `tests/sutra.test.ts`):

- `fixtures/test-coverage-tested/` — a feature with a component/handler **and** a co-located test file that imports/references it. Proves: a real `tests` edge produces `tested: true`, `test_edge_count >= 1`, the test file id appears in `test_node_ids`, and NO `untested_feature` issue is emitted for it.
- `fixtures/test-coverage-untested/` — a feature with source nodes but **no** test file referencing any of them. Proves: `tested: false`, `test_edge_count === 0`, `test_node_ids === []`, and exactly one `info` `untested_feature` issue with `node` = feature id.
- `fixtures/test-coverage-dangling/` — a test file that references a symbol that does not resolve to a real node (the `dangling_test_ref` case). Proves the regression guard: the targeted feature is NOT counted as `tested`, the existing `dangling_test_ref` issue still fires, and an `untested_feature` issue is also emitted for the feature if it has no other valid test edge.

`describe` blocks in `tests/sutra.test.ts`:

- `describe("test-coverage mapping")` — asserts `test_edge_count`, `tested`, and `test_node_ids` are populated correctly across the tested/untested fixtures; asserts deterministic ordering of `test_node_ids` and of emitted `untested_feature` issues across two runs of the same fixture.
- `describe("untested_feature check")` — asserts the issue `kind`, `severity: "info"`, `node`/`feature` = feature id, and that the `message` contains static-presence wording and never a `%`/"coverage" runtime claim.
- Regression guard inside the dangling fixture test: explicitly assert that a dangling `tests` edge does not flip `tested` to `true`.
- Version guard: update / add an assertion that the emitted graph reports `version === 1` (or `GRAPH_VERSION`), so the bump is enforced and accidental reverts fail the suite.

## Out of Scope

- **Runtime / line / branch coverage.** No reading of coverage reports (lcov, istanbul, `coverage/`), no execution of tests, no pass/fail status. This story is static edge presence only.
- **Flow-level coverage of traced request paths.** Marking individual request flows (entry → endpoint → handler → DB) as covered/uncovered depends on the flow-trace path objects from Story **2.5** and is deferred to a follow-up once 2.5 lands. This story maps coverage at the *feature* granularity (and surfaces "untested flow" only insofar as a flow's nodes sit in an untested feature).
- **Test quality / assertion analysis.** No judgement on whether a test is meaningful, only that a `tests` edge exists.
- **AI-derived coverage inference.** No LLM guessing about what a test covers (that would belong with 2.3 AI inference and would have to be labelled AI).
- **Viewer rendering of coverage cards/badges** beyond the minimal static label kept working in `view.ts`. The real interactive surfacing belongs to Epic 3 (3.2 feature cards / 3.3 drill-down), which consume the fields this story adds.
