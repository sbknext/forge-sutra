# Story 4.1: Language-agnostic graph core

- **Epic:** Epic 4 — Ecosystem & SDK
- **Status:** Draft
- **Priority:** P1
- **Depends on:** none
- **Estimate:** M

## Story
As a Forge Sutra maintainer, I want the graph model and pipeline decoupled from ts-morph behind a language-neutral `Extractor` interface, so that a second-language extractor (Python, 4.2) can populate the same `graph.json` contract without reimplementing checks, feature inference, the view, or the CLI.

## Context
Phase 0 shipped a single-language tool: `src/scanner.ts` instantiates a ts-morph `Project`, walks `SourceFile`s, and emits the `SutraGraph` defined in `src/types.ts`. The graph contract is already mostly language-neutral on paper — `NodeType`, `EdgeKind`, `IssueKind`, and `SutraGraph` describe modules, exports, endpoints, edges, issues, and features in terms that are not intrinsically TypeScript — but in practice the only producer of that contract is ts-morph, and ts-morph types leak into the scanner's internals. The README documents the `graph.json` schema as the stable interface between scan and render; nothing downstream of the scanner (`checks.ts`, `features.ts`, `view.ts`, `cli.ts`) should care which language produced a node.

NOTES.md "Missing Forge Primitives" calls out that the tool is structurally TS/JS-only and that broadening language coverage is the gating prerequisite for the ecosystem epic. This story is the refactor that makes that possible: it introduces a thin `Extractor` abstraction, makes the existing TS/JS scanner the first implementation of it, and asserts that the emitted `graph.json` is byte-for-byte identical to today's output. It deliberately adds no new analysis capability — it is a pure decoupling so 4.2 (Python extractor) can plug in. Per the ROADMAP epic-4 sequencing, 4.1 must land and soak before 4.2 begins.

## Acceptance Criteria
1. A new `src/extractor.ts` defines an `Extractor` interface with at minimum: `language` (a stable string id, e.g. `"ts"`), `matches(filePath: string): boolean` (which file extensions this extractor claims), and `extract(input): ExtractorResult` where `ExtractorResult` carries the language-local `nodes` and `edges` that this extractor produces (mirroring today's scanner output, which is `{ nodes, edges }` — checks and features remain downstream stages run after extraction). No ts-morph type appears in `src/extractor.ts`.
2. `src/scanner.ts` is split: a new `src/extractors/ts.ts` (NEW) holds the ts-morph–specific implementation (`TsExtractor`) and is the *only* file in `src/` that imports `ts-morph`. `src/scanner.ts`'s exported `scan(repoRoot)` keeps its current signature (`{ nodes, edges }`) and becomes a thin orchestrator that selects extractors, runs them, and merges their results — issue running (`runChecks`) and feature building (`buildFeatures`) stay where they are today (called from `src/cli.ts`, not the scanner).
3. The `SutraGraph` contract in `src/types.ts` remains language-neutral. Each `SutraNode` gains an explicit `language` field (string) so consumers can tell what produced it; the field is required and set by every extractor. This is an additive change to the contract.
4. `GRAPH_VERSION` (currently `0` in `src/types.ts`) is bumped by exactly one step to reflect the new required `language` field on nodes, and the bumped constant remains the single source of truth written into `graph.json`'s `version` field by the `cmdScan` emitter in `src/cli.ts`.
5. Running `forge-sutra scan` (via `src/cli.ts`) on the Forge Sutra repo itself produces a `graph.json` whose `nodes`, `edges`, `issues`, and `features` arrays are identical to the pre-refactor output **except** for (a) the bumped version field and (b) the new `language: "ts"` field on every node. A diff fixture proves this.
6. `src/checks.ts` (including `checkOrphanedEndpoints` and every other check) and `src/features.ts` operate purely on the assembled `SutraGraph` / its `SutraNode`/`SutraEdge` arrays — verified by the fact that neither file imports `ts-morph` nor `src/extractors/ts.ts` after the refactor.
7. Node and edge ids remain deterministic and stable across runs: `src/util/ids.ts` helpers stay the canonical id source, and extractors MUST route every id through them. A regression test asserts ids are unchanged from the Phase-0 baseline for the existing fixtures.
8. Honesty invariants are preserved: candidate-vs-confirmed status, AI-labelled fields, and `IssueKind` values are unchanged by this story. No extractor may upgrade a candidate to confirmed; the `Extractor` interface only emits structural facts.
9. The extractor registry is explicit and ordered: `src/scanner.ts` holds a typed array of registered extractors (just `TsExtractor` for now), and a file claimed by no extractor is skipped (not errored), matching today's behavior for non-TS/JS files.

## Technical Approach
Files changed / added:
- **`src/extractor.ts` (NEW)** — defines `Extractor` interface and `ExtractorResult` type. `ExtractorResult` = `{ nodes: SutraNode[]; edges: SutraEdge[] }` using existing types from `src/types.ts` (matches the current `scan()` return shape; checks/features stay downstream). No third-party imports beyond `./types`.
- **`src/extractors/ts.ts` (NEW)** — move the ts-morph–dependent body of today's `src/scanner.ts` here as `TsExtractor implements Extractor`: the `Project` setup, Pass 1 (node building), Pass 2 (edge building), `extractUrlLiteral`, and the Express/Next.js path helpers (`nextAppRouterPath`, `nextPagesApiPath`, `isApiLookingFile`, etc.). `language = "ts"`. `matches()` claims the `SCAN_EXTENSIONS` set (`.ts`/`.tsx`/`.js`/`.jsx`) from `src/types.ts`. `extract()` returns `{ nodes, edges }`. This is the ONLY file allowed to import `ts-morph`. Move `detectProxyNodes()` + its helpers (`extractNextRewrites`, `rewriteSourceToPrefix`) here too, since they are Next.js-specific.
- **`src/scanner.ts` (CHANGED)** — `scan(repoRoot)` becomes orchestrator: keep `collectFiles()` (the FS walk) here or factor it into a shared util, build the extractor registry `[new TsExtractor()]`, for each discovered file pick the first extractor whose `matches()` returns true (skip unclaimed files), call `extract()`, merge all `ExtractorResult`s into one `{ nodes, edges }`, and return it. Note: `detectProxyNodes()` currently runs at the end of `scan()` and mutates the node list — decide whether it stays in the orchestrator (language-neutral, post-merge) or moves into `TsExtractor`; the story's intent is that proxy detection is a Next.js/TS concern and should live in `TsExtractor`. No ts-morph import remains in `src/scanner.ts`.
- **`src/types.ts` (CHANGED)** — add required `language: string` to the `SutraNode` interface (after `feature`). Bump `GRAPH_VERSION` from `0` by one step. Keep `ExtractorResult` in `src/extractor.ts` (do not duplicate it in `types.ts`).
- **`src/checks.ts`, `src/features.ts`, `src/view.ts`, `src/cli.ts`** — no logic changes expected. `view.ts` may optionally render the new `language` field, but rendering it is out of scope here; at minimum it must not break on the added field.

Honesty rules respected: extractors emit only structural facts and never set `confirmed`/AI-labelled fields; all ids flow through `src/util/ids.ts` so they stay deterministic; the candidate-vs-confirmed and `IssueKind` semantics are untouched. The `language` field is a plain structural fact (which extractor produced the node), not an inferred claim.

## Tasks
- [ ] Add `language: string` to `SutraNode` in `src/types.ts` and bump `GRAPH_VERSION` by one minor step.
- [ ] Create `src/extractor.ts` with the `Extractor` interface and `ExtractorResult = { nodes; edges }` type referencing `src/types.ts`.
- [ ] Create `src/extractors/ts.ts`; move the ts-morph `Project` walk (Pass 1 + Pass 2), `extractUrlLiteral`, path helpers, and `detectProxyNodes`+helpers out of `src/scanner.ts` into `TsExtractor`, setting `language: "ts"` on every emitted node and routing all ids through `src/util/ids.ts`.
- [ ] Reduce `src/scanner.ts`'s `scan(repoRoot)` to an orchestrator: keep/share `collectFiles`, build the extractor registry, file-to-extractor selection (skip unclaimed), merge results into `{ nodes, edges }`. Leave `runChecks`/`buildFeatures` wiring in `src/cli.ts` unchanged.
- [ ] Confirm `src/checks.ts` (incl. `checkOrphanedEndpoints`) and `src/features.ts` import neither `ts-morph` nor `src/extractors/ts.ts`.
- [ ] Verify `src/cli.ts` `cmdScan` still calls `scan(repoRoot)` → `runChecks` → `buildFeatures` with no signature change, and stamps the bumped `GRAPH_VERSION` into `graph.version`.
- [ ] Run `forge-sutra scan` on this repo; capture the new `graph.json` and diff against a saved Phase-0 baseline.
- [ ] Add a baseline `graph.json` fixture (pre-refactor output) and a diff assertion in tests.
- [ ] Add a guard test asserting no file under `src/` except `src/extractors/ts.ts` imports `ts-morph`.
- [ ] Add a guard test asserting node/edge ids match the Phase-0 baseline for existing fixtures.
- [ ] Run the full `tests/sutra.test.ts` suite; fix any breakage caused by the added `language` field.

## Test Plan
New fixtures under `tests/fixtures/`:
- `tests/fixtures/baseline-graph.json` — the Phase-0 `graph.json` for the existing test fixture repo, captured before the refactor. Proves output equivalence.
- Reuse the existing fixture sources already exercised by `tests/sutra.test.ts` as the input corpus for the equivalence run.

New `describe` blocks in `tests/sutra.test.ts`:
- **`describe("language-agnostic core")`**
  - test: scanning the fixture corpus produces nodes/edges/issues/features identical to `baseline-graph.json` except `version` (bumped) and per-node `language: "ts"`. Proves the refactor is behavior-preserving.
  - test: every emitted `SutraNode` has `language === "ts"`. Proves the new contract field is populated by the extractor.
  - test (regression guard): node and edge ids exactly match the baseline ids for the fixture corpus. Proves `src/util/ids.ts` determinism survived the split.
  - test (architecture guard): read `src/checks.ts` and `src/features.ts` source and assert neither contains an import of `ts-morph` or `extractors/ts`. Proves downstream stages are language-neutral.
  - test (architecture guard): assert `src/extractors/ts.ts` is the only file under `src/` importing `ts-morph`. Proves the extractor boundary holds.
  - test: a file with an unclaimed extension (add a `.py` stub to the fixture corpus) is skipped, not errored, and contributes no nodes. Proves the registry's skip behavior and pre-stages the 4.2 Python extractor slot.

## Out of Scope
- The Python extractor itself (`src/extractors/python.ts`) — that is Story 4.2 and is gated on this story landing.
- Rendering the new `language` field in `src/view.ts` (the realistic feature viewer) — view changes for multi-language display are deferred to a later epic-4 story.
- Any new `NodeType`, `EdgeKind`, or `IssueKind` values, or any new structural checks in `src/checks.ts`.
- Cross-language edges (e.g. a TS frontend calling a Python endpoint) — explicitly deferred; this story keeps each extractor's output self-contained.
- Performance work, parallel extraction, or caching of extractor results.
