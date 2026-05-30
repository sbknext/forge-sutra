> ⛔ **DEFERRED — DO NOT IMPLEMENT.** Out of scope (breaks single-repo / standalone / local-first). See [Epic 5 README](README.md). Build this only on an explicit owner decision.

# Story 4.5: Graph History & Trends

- **Epic:** Epic 4 — Ecosystem & SDK
- **Status:** Draft
- **Priority:** P2
- **Depends on:** 1.6 (scan diff), 2.4 (feature health score), 3.x (viewer app — specifically 3.1 viewer shell + 3.2 feature cards grid)
- **Estimate:** L

## Story
As an engineer dogfooding Sutra on a repo I ship over time, I want each scan archived under its commit and a derived trend of feature health across that archive, so that I can see whether a feature got healthier or more broken across a span of commits — and click into the exact scan where a regression first appeared — without manually keeping old `graph.json` files around.

## Context
Phase 0 already records a `commit` field on every graph (`SutraGraph.commit`, populated by `getCommit()` in `src/cli.ts` via `git rev-parse --short HEAD`, or `"unknown"`), and a `scanned_at` ISO timestamp. Today that `commit` field is written and then never read — `sutra view` consumes only the single most recent `.sutra/graph.json`. The ROADMAP names this story explicitly: *"4.5 Hosted graph history (store scans over time; trend health; the `commit` field finally pays off)."* This is the story where that latent field earns its place.

Two earlier capabilities make this possible and must land first. Story **1.6 (`sutra diff`)** already answers "what changed between two graphs" (new/removed/broken links) for a *pair* of scans; 4.5 generalizes that from a pair to an ordered series and adds a per-feature health dimension. Story **2.4 (feature health score)** adds the composite `health` number per `SutraFeature` that 4.5 trends over time — without 2.4 there is nothing meaningful to chart. Epic 3's viewer (3.1 shell + 3.2 cards) is the surface where the trend is shown. Per the ROADMAP cross-cutting principle *"Deterministic ids — keep `relPath#symbol` stable so `sutra diff` and history work,"* history is only trustworthy because node/feature ids are stable across scans; this story leans on `src/util/ids.ts` continuing to produce stable ids and must not perturb them. Honesty bounds from the ROADMAP and README still apply: this is a *static* trend of *candidate* findings — never phrase a trend line as "the feature is now bug-free," only as "issue count / health score moved from X to Y between commit A and commit B."

## Acceptance Criteria

1. A new command `sutra history` exists, wired in `src/cli.ts` alongside `scan` and `view` using the same `commander` registration pattern. Running it with no prior history prints a clear, non-error message (e.g. `No history yet — run \`sutra scan\` at least twice across commits.`) and exits 0.

2. `sutra scan` archives each completed scan into a per-commit history store under `.sutra/history/` (NEW directory). The archived artifact for a scan whose `commit` is `abc1234` is written deterministically (e.g. `.sutra/history/abc1234.json`), is a byte-faithful copy of the same `SutraGraph` written to `.sutra/graph.json`, and re-scanning the same commit overwrites that commit's entry rather than creating duplicates. Scans whose `commit === "unknown"` are NOT archived (no stable key) and a one-line note is printed; the live `.sutra/graph.json` write is unaffected.

3. A history index file `.sutra/history/index.json` (NEW) records, per archived scan, at minimum: `commit`, `scanned_at`, `version` (the `GRAPH_VERSION` the scan was written under), and rolled-up counts (`nodes`, `edges`, `issues`, `features`). The index is the only file `sutra history` and the trend builder need to read for summary views; full graphs are loaded lazily by commit only when a per-feature trend or a diff drill-down is requested.

4. A NEW pure module `src/history.ts` exports `buildHistory(entries: HistoryEntry[]): SutraHistory` and `buildFeatureTrends(graphs: SutraGraph[]): FeatureTrend[]`, both deterministic and renderer-free (no FS, no `git`, no `console`) so they are unit-testable and obey the ROADMAP "renderer is a leaf / generatable headless" principle. New types (`HistoryEntry`, `SutraHistory`, `FeatureTrend`, `TrendPoint`, `TrendDirection`) are added to `src/types.ts`.

5. Per-feature trends key on the stable `SutraFeature.id`. For each feature present in ≥1 archived scan, `buildFeatureTrends` emits a `FeatureTrend` containing an ordered `points: TrendPoint[]` (one per scan that contained the feature, ordered by `scanned_at` ascending), where each `TrendPoint` carries `{ commit, scanned_at, issue_count, health }`. `health` is sourced from the 2.4 field when present and is `null` (not `0`) when a scan predates 2.4 — a missing score must never be silently rendered as a real value.

6. Each `FeatureTrend` carries a `direction: TrendDirection` (`"improved" | "regressed" | "unchanged" | "appeared" | "disappeared" | "insufficient_data"`) computed only from the first vs. last comparable points. "Improved/regressed" is defined explicitly (issue_count down/up, or health up/down when both endpoints have non-null health) and documented in code; when fewer than two comparable points exist the direction is `"insufficient_data"` — the tool must not assert a trend it cannot support.

7. History scan-to-scan deltas reuse the Story 1.6 diff engine rather than reimplementing it: `sutra history` (and the trend builder's drill-down) computes the new/removed/broken-link delta between consecutive archived commits by calling the 1.6 diff function on the two loaded graphs. If 1.6's diff module is not yet present at implementation time, this criterion is parked behind a clearly-labelled `// depends on 1.6` seam and the rest of 4.5 still ships.

8. The viewer (Epic 3) gains a read-only history affordance: when `.sutra/history/index.json` exists, the feature cards grid (3.2) shows a small per-card trend indicator (e.g. an up/down/flat arrow reflecting `FeatureTrend.direction`) and a sparkline or N-point mini series derived from `TrendPoint.issue_count` / `TrendPoint.health`. Every history surface is labelled as a *static, candidate-derived* trend (consistent with the existing `view.ts` disclaimer banner) and never claims a bug was fixed — only that a count/score changed between two commits.

9. `GRAPH_VERSION` (in `src/types.ts`) is NOT bumped by this story: 4.5 adds sibling files (`.sutra/history/*`) and new optional types, and does not change the shape of `graph.json` itself. If, and only if, 4.5 must add a field to `SutraGraph`, `GRAPH_VERSION` is bumped and the history reader tolerates mixed-version archived graphs (reads `version` per entry, degrades gracefully on older scans).

## Technical Approach

**Files changed**
- `src/cli.ts` — add `getHistoryDir(cwd)` / `historyIndexPath(cwd)` helpers next to the existing `sutraDir`/`graphFilePath`/`viewFilePath` helpers; in `cmdScan`, after the existing `fs.writeFileSync(outFile, ...)` for `graph.json`, append an `archiveScan(graph, cwd)` step (skipping when `graph.commit === "unknown"`); register a new `program.command("history")` → `cmdHistory()`.
- `src/types.ts` — add `HistoryEntry`, `SutraHistory`, `FeatureTrend`, `TrendPoint`, `TrendDirection` interfaces/types. Do **not** change `SutraNode`/`SutraEdge`/`SutraIssue`/`SutraFeature`/`SutraGraph` shapes (so `GRAPH_VERSION` stays `0`). Add an exported `HISTORY_DIR = "history"` and `HISTORY_INDEX = "index.json"` constant pair, mirroring the existing `SUTRA_DIR`/`GRAPH_FILE`/`VIEW_FILE` constants.
- `src/history.ts` (NEW) — pure builders: `buildHistory(entries)` and `buildFeatureTrends(graphs)` plus `directionFor(first, last)`. No `fs`, no `child_process`, no `chalk`/`console`.
- `src/view.ts` — extend `renderView` (and `buildDetailPanel` / the card builder) to optionally consume a `SutraHistory` argument; render the per-card trend indicator + mini series only when history is present, reusing the existing `badge`/`disclaimer` styling. Keep `renderView` working unchanged when no history is passed (back-compat with current `cmdView`).

**Contract additions (`src/types.ts`)**
```ts
export type TrendDirection =
  | "improved" | "regressed" | "unchanged"
  | "appeared" | "disappeared" | "insufficient_data";

export interface HistoryEntry {
  commit: string;          // short hash; never "unknown" (those aren't archived)
  scanned_at: string;      // ISO 8601 UTC, copied from the graph
  version: number;         // GRAPH_VERSION the scan was written under
  nodes: number; edges: number; issues: number; features: number;
}

export interface TrendPoint {
  commit: string;
  scanned_at: string;
  issue_count: number;
  health: number | null;   // 2.4 score; null when scan predates 2.4 — never coerced to 0
}

export interface FeatureTrend {
  feature_id: string;      // stable SutraFeature.id
  label: string;
  points: TrendPoint[];    // ordered by scanned_at ascending
  direction: TrendDirection;
}

export interface SutraHistory {
  repo: string;
  entries: HistoryEntry[]; // ordered by scanned_at ascending
  trends: FeatureTrend[];
}
```

**Honesty rules respected**
- No new graph shape ⇒ no `GRAPH_VERSION` bump (deterministic-ids + graph-is-the-contract principles intact).
- `health: null` is propagated, never defaulted, so a pre-2.4 scan cannot masquerade as a real score (AI/derived fields labelled / uncertainty preserved).
- `direction` is `"insufficient_data"` rather than a guessed trend when there are <2 comparable points (never overstate).
- Diff deltas delegate to the 1.6 engine (single source of truth for "what changed"); 4.5 does not fork that logic.
- All viewer history surfaces inherit the existing "heuristic / candidate" disclaimer and are phrased as count/score movement between commits, never as "fixed."

## Tasks
- [ ] Add `HISTORY_DIR`, `HISTORY_INDEX` constants and the new history/trend types to `src/types.ts` (no `SutraGraph` shape change; `GRAPH_VERSION` unchanged).
- [ ] Add `getHistoryDir` / `historyIndexPath` path helpers in `src/cli.ts`.
- [ ] Implement `archiveScan(graph, cwd)` in `src/cli.ts`: write `.sutra/history/<commit>.json` (overwrite on same commit), update `.sutra/history/index.json`; skip + note when `commit === "unknown"`.
- [ ] Wire `archiveScan` into `cmdScan` after the existing `graph.json` write; ensure the live `graph.json` path is untouched on the skip branch.
- [ ] Create `src/history.ts` with pure `buildHistory`, `buildFeatureTrends`, and `directionFor` (no FS / git / console).
- [ ] Implement `directionFor(first, last)` covering all `TrendDirection` cases incl. `appeared`/`disappeared`/`insufficient_data`, with the improved/regressed rule documented inline.
- [ ] Register `sutra history` in `src/cli.ts` (`cmdHistory`): load index, build `SutraHistory`, print an ordered per-commit + per-feature trend summary; friendly empty-state when no/one entry.
- [ ] Add the 1.6 diff drill-down seam in `cmdHistory` (consecutive-commit deltas), guarded `// depends on 1.6` if the diff module is not yet merged.
- [ ] Extend `src/view.ts` to optionally accept `SutraHistory` and render per-card trend arrows + mini series, gated on history presence, reusing existing styles + disclaimer.
- [ ] Update `cmdView` in `src/cli.ts` to load `.sutra/history/index.json` (when present) and pass the built `SutraHistory` into `renderView`.
- [ ] Update `README.md` (Commands section + graph.json schema notes) to document `sutra history`, the `.sutra/history/` store, and the honesty framing of trends.
- [ ] Run full test suite + build; confirm the existing 34 tests stay green and no node/feature id drift.

## Test Plan

New fixtures under `tests/fixtures/`:
- `tests/fixtures/history/` (NEW) — a directory of two-or-more hand-authored archived graphs (e.g. `history-graphs/v1.json`, `v2.json`, `v3.json`) representing the *same* repo at three commits, with stable feature ids across all three. v1→v2 shows a feature whose `issue_count` drops (a `regressed`→`improved` line) and v2→v3 shows a feature whose `issue_count` rises (`improved`→`regressed`), plus one feature that only appears in v3 (`appeared`) and one present only in v1 (`disappeared`). One graph deliberately omits the 2.4 `health` field to prove `health: null` propagation.

New `describe` blocks in `tests/sutra.test.ts`:
- **`history — buildHistory`** — feeding the fixture graphs' index entries yields a `SutraHistory` whose `entries` are ordered by `scanned_at` ascending and whose rolled-up counts match each graph; proves index correctness without touching FS.
- **`history — buildFeatureTrends ordering & direction`** — proves each feature's `points` are time-ordered and that `direction` is `improved` / `regressed` / `appeared` / `disappeared` exactly as the fixture is constructed; asserts a single-point feature yields `insufficient_data`.
- **`history — health null propagation`** — the fixture graph missing 2.4 scores produces `TrendPoint.health === null` (never `0`), and a `FeatureTrend` mixing null+non-null endpoints does not claim a health-based `improved`/`regressed`.
- **`history — archive keying`** (integration, drives `cmdScan`'s archive helper or a directly-exported `archiveScan`) — scanning the same commit twice produces exactly one `.sutra/history/<commit>.json` entry (overwrite, no dup); a `commit === "unknown"` scan produces no archive file while `.sutra/graph.json` is still written.
- **Regression guard** — re-run the existing Section 1–9 suites unchanged and assert node/feature ids are byte-identical to a baseline scan of the `broken` fixture (history must not perturb `src/util/ids.ts` output); assert `GRAPH_VERSION` is still `0` and `renderView(graph)` (no history arg) still produces valid HTML.

## Out of Scope
- **Networked/multi-user hosting.** Despite the ROADMAP shorthand "hosted graph history," this story is **local-first only** — `.sutra/history/` on disk. No server, no upload, no auth, no `user_id` (the BRIEF Phase-0 standalone/single-user constraint and ROADMAP principle 6 still hold). A genuinely hosted backend is a later, separately-scoped story.
- **Defining the feature health formula.** The composite `health` score is owned by Story 2.4; 4.5 only trends whatever 2.4 produces. If 2.4 has not landed, trends fall back to `issue_count` only and all `health` points are `null`.
- **The pairwise diff algorithm itself.** "What changed between two graphs" is Story 1.6; 4.5 consumes it for consecutive-commit deltas and does not reimplement it.
- **Cross-repo history.** Trending the echo-ai↔brain-api ecosystem map over time depends on Epic 1.4 / 2.2 / 3.4 and is out of scope here; 4.5 trends a single repo's archive.
- **Retention / pruning policy** (auto-deleting old archived scans, size caps) and **CI publishing of history** (that belongs with Story 4.4). 4.5 only writes and reads the local store.
- **Non-TS/JS history.** Trending Python/Frappe scans depends on Epic 4.1/4.2; the mechanism here is language-agnostic by construction but is validated only on TS/JS fixtures in this story.
