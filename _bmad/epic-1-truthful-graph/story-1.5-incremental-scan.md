# Story 1.5: Incremental scan cache

- **Epic:** Epic 1 — Truthful Graph
- **Status:** Draft
- **Priority:** P1
- **Depends on:** none (foundational for Story 3.5 — Live / watch mode)
- **Estimate:** M

## Story
As a developer re-scanning a real-world repo, I want only the files whose content changed to be re-parsed, so that re-running `sutra scan` is near-instant instead of paying the full ts-morph parse every time — without changing the graph output in any way.

## Context
Today `scan(repoRoot)` in `src/scanner.ts` does a full parse on every run: `collectFiles(absRoot)` walks the tree, then `for (const f of allFiles) project.addSourceFileAtPath(f)` re-adds and re-parses every source file, after which Pass 1 builds nodes and Pass 2 builds edges over `project.getSourceFiles()`. `NOTES.md` "Missing Forge Primitives" #2 (AST service) records the cost directly: "Especially valuable for large repos (echo-ai: 638 nodes took ~10s on first scan)." Every re-scan pays that ~10s again because nothing is cached.

This story implements a persistent, content-hashed per-file cache so unchanged files are served from disk instead of re-parsed. It is the prerequisite the `_bmad/ROADMAP.md` sequencing diagram names for Epic 3 Story 3.5 ("3.5 live (needs 1.5)"). The roadmap bar is strict: cross-cutting principle #3 requires deterministic ids, and the Phase-0 contract requires deterministic output. This is a performance + foundation story — it must not change graph *output*, only how fast that output is produced. Byte-identical output (modulo the timestamp) is the acceptance bar.

## Acceptance Criteria
1. A `sutra scan` writes a cache under `.sutra/cache/` in the **current working directory** (sibling to the `.sutra/graph.json` that `cmdScan` in `src/cli.ts` already writes). `.gitignore` already ignores `.sutra/`, so the cache is git-ignored with no change needed — confirm and note it.
2. On a second scan with **no file changes**, every source file is served from cache: zero files are re-parsed by ts-morph (`project.addSourceFileAtPath` is not called for cached files). The resulting `.sutra/graph.json` is **byte-identical** to the first run except for the `scanned_at` field (and `commit` if the repo moved) — i.e. `nodes`, `edges`, `issues`, `features` are deep-equal.
3. The cache is keyed on a **content hash** of each file's bytes (sha1 via `node:crypto` `createHash`). Changing one file's content invalidates only that file's cache entry; unchanged files stay cached.
4. The cached unit per file is that file's contribution to the graph: the `SutraNode[]` and `SutraEdge[]` (typed exactly per `src/types.ts`) that the scanner produced for that file. A cache hit reconstructs identical nodes and edges for that file without re-parsing it.
5. A cache entry is invalidated (file re-parsed) when **any** of these differ from the cached value: the file's content hash, the cache's own `cacheVersion`, or `GRAPH_VERSION` from `src/types.ts`. A missing, stale, or corrupt cache file is treated as a full cache miss (re-parse everything) and never throws.
6. Deleted files (present in the cache, absent from `collectFiles`) do **not** contribute stale nodes/edges to the new graph, and their entries are dropped from the rewritten cache.
7. `runChecks(nodes, edges)` and `buildFeatures(nodes, issues)` (the exact signatures in `src/checks.ts` and `src/features.ts`) run unchanged over the **full merged** node/edge set, whether a file was parsed fresh or restored from cache. `runChecks` is a pure function over the graph (no file IO, no AST) — restoring nodes/edges from cache must therefore produce identical `issues`.
8. Cache hit/miss counts are surfaced on stdout in `cmdScan` (e.g. `398 cached · 2 parsed`), consistent with the existing one-screen summary style, so the speedup is observable.
9. `npm run build` (tsc) is clean and `npm test` (vitest) is green, including a new regression test asserting the warm (cached) scan's graph is deep-equal to the cold scan's graph minus `scanned_at`.

## Technical Approach
**New file: `src/cache.ts` (NEW).** Self-contained per-file cache. No new runtime dependencies — use `node:crypto` `createHash` and `node:fs`. Keep `src/util/ids.ts` untouched (the cache stores the already-deterministic ids `makeNodeId` produced; it does not recompute them).

- `export const CACHE_VERSION = 1;` — bumped independently when the cached payload shape changes.
- `hashContent(content: string | Buffer): string` — sha1 hex digest of file bytes. Content-based, no timestamps (honesty/determinism).
- Cache layout: a single JSON file `.sutra/cache/index.json` mapping repo-relative POSIX path (as produced by `relPosix`) → `{ contentHash, graphVersion, cacheVersion, nodes: SutraNode[], edges: SutraEdge[] }`. One index file keeps the write atomic and avoids per-file fan-out.
- `loadCache(cacheRoot): CacheIndex` — read `.sutra/cache/index.json`; on missing / JSON parse error / `cacheVersion` mismatch return an empty index. Never throws.
- `saveCache(cacheRoot, index): void` — `fs.mkdirSync(.sutra/cache, { recursive: true })` then `fs.writeFileSync` of the index, key-sorted and pretty-printed so the cache file itself is byte-stable.

**Change: `src/scanner.ts` — `scan(repoRoot)`.** Make the per-file work cacheable without changing the public signature (`scan(repoRoot) → { nodes, edges }`):

- The scanner currently parses ALL files into one shared ts-morph `Project`, then builds nodes (Pass 1) and edges (Pass 2) globally. Note that Pass 2 edge resolution uses cross-file maps (`fileToModuleId`, `symbolToNodeId`) and resolves relative imports via `imp.getModuleSpecifierSourceFile()`, which needs other source files present in the `Project`. The cache must preserve this behavior exactly. Two acceptable implementations — pick the one that keeps output byte-identical:
  - **(a) Per-file emit + cache (preferred):** refactor Pass 1 + Pass 2 so each file's node/edge production is callable in isolation given the shared `Project`, returning `{ nodes, edges }` for that file. For a cache miss, add the file to the `Project`, run the per-file emit, and store the result. For a cache hit, restore the stored `nodes`/`edges` and **skip** `addSourceFileAtPath`. Because import-edge resolution depends on the target file being in the `Project`, the stored edges (already-resolved ids) are reused verbatim on a hit — that is exactly why caching the *output* nodes/edges, not re-resolving, is correct.
  - **(b) Conservative fallback:** if isolating per-file emit risks changing cross-file resolution, gate the cache at the whole-`Project` level for this story is NOT acceptable (defeats the purpose). Instead, only files whose content hash is unchanged are skipped from `addSourceFileAtPath`, and their cached nodes/edges are merged in; changed/new files are added to the `Project` and emitted. Relative-import edges from a changed file to an unchanged (not-in-`Project`) file must still resolve to the same id — verify the `makeNodeId(approx)` fallback path in the scanner already yields the same id as the resolved-source-file path, and if not, force-add referenced unchanged files to the `Project` for resolution only (still skipping their node/edge emit). Document whichever path is taken.
- After merging cached + freshly-emitted contributions, apply a deterministic final sort of `nodes` and `edges` by a stable key (e.g. node `id`; edge `from|to|kind`) so the final ordering is independent of which files were cached vs parsed. **This sort is the linchpin of byte-identical output** and is the single most important correctness step. Pass 3 (`detectProxyNodes`) runs after the merge exactly as today.
- Wire `loadCache` / per-file `hashContent` compare / `saveCache` into `scan`. Build the new index from exactly the files present this run (criterion 6 — deleted files drop out). Return hit/miss counts (extend the return shape internally or expose via an out-param) so `cmdScan` can print them.

**Change: `src/cli.ts` — `cmdScan`.** Surface the hit/miss counts in the existing summary block. No change to the `graph.json` written or its field order.

**Contract / honesty.** No change to `src/types.ts` shapes and **no `GRAPH_VERSION` bump** — the graph contract is untouched; only scan speed changes. The cache stores already-deterministic ids verbatim and introduces no new nodes, edges, confidence values, or AI fields, so the candidate-vs-confirmed rule and "AI is additive/labelled" rule are unaffected. The cache is local-only, never networked (the `BRIEF.md` local-first / standalone constraints hold).

**README.** Add a short "Incremental cache" note: `.sutra/cache/` holds a content-hashed per-file cache; deleting it just forces a full re-scan; it is git-ignored.

## Tasks
- [ ] Create `src/cache.ts` with `CACHE_VERSION`, `hashContent` (sha1 via `node:crypto`), `CacheIndex` + entry types (storing `SutraNode[]`/`SutraEdge[]` from `src/types.ts`), `loadCache`, `saveCache` (key-sorted, never-throw on read).
- [ ] Refactor `src/scanner.ts` so each file's node + edge emit is isolatable from the shared ts-morph `Project`, preserving the existing Pass 1 / Pass 2 cross-file resolution behavior.
- [ ] In `scan`: load cache, hash each file from `collectFiles`, restore on hit (skip `addSourceFileAtPath`) / parse + store on miss.
- [ ] Verify relative-import edge resolution for changed→unchanged files still yields identical edge ids; force-add referenced unchanged files to the `Project` for resolution-only if needed.
- [ ] Add a deterministic final sort of merged `nodes` and `edges` so output is independent of cache mix; keep Pass 3 (`detectProxyNodes`) after the merge.
- [ ] Rebuild the cache index from only this run's files so deleted files drop out (criterion 6); `saveCache`.
- [ ] Thread hit/miss counts out of `scan` and print them in `cmdScan` (`src/cli.ts`).
- [ ] Confirm `.sutra/cache/` is covered by the existing `.sutra/` line in `.gitignore`.
- [ ] Update `README.md` with the incremental-cache note; record cache-as-AST-service progress against `NOTES.md` "Missing Forge Primitives" #2.
- [ ] Run `npm run build` and `npm test`; add the new fixtures + describe block below.

## Test Plan
The suite uses real on-disk fixture directories under `tests/fixtures/` and the `scan` / `runChecks` / `buildFeatures` imports already in `tests/sutra.test.ts`. There is **no** in-memory repo harness today, so warm/cold tests that mutate files must write into a fresh **temp copy** of a fixture (use `node:fs` `cpSync` + `node:os` `tmpdir`) to avoid mutating the committed fixtures. Add a new `describe("incremental cache", ...)` block:

- **Cold→warm byte-identity (regression guard):** copy `fixtures/clean` to a temp dir, run `scan` twice. Assert the two results are deep-equal (`expect(warm).toEqual(cold)` on `{ nodes, edges }`), and that `runChecks`/`buildFeatures` over both produce equal `issues`/`features`. Proves criterion 2 / 7. This is the core regression guard for the whole story.
- **Cache files written:** after a scan into a temp dir, assert `.sutra/cache/index.json` exists, its parsed `cacheVersion === CACHE_VERSION`, and it has one entry per scanned source file.
- **Single-file change invalidation:** scan a temp copy, rewrite exactly one source file's content, re-scan. Assert that file's stored `contentHash` changed while the others' are unchanged, and that the edited file's nodes/edges reflect the new content while the rest are byte-identical to the first scan.
- **Deleted file:** scan a temp copy of a multi-file fixture, delete one source file, re-scan. Assert no node or edge references the deleted file and the cache index no longer contains it (criterion 6).
- **Corrupt cache tolerated:** scan a temp copy, overwrite `.sutra/cache/index.json` with `"{ not json"`, re-scan. Assert no throw and the result equals a clean cold scan (full-miss fallback, criterion 5).
- **Version skew:** scan a temp copy, mutate the stored entries' `graphVersion` (and separately `cacheVersion`) to wrong values, re-scan. Assert those files are re-parsed and the result is identical to a cold scan.
- **Issue parity on broken fixture:** run the cold→warm comparison on a temp copy of `fixtures/broken` (which triggers all three `IssueKind`s) and assert `runChecks` returns an identical `issues` array for warm and cold. Guards against `runChecks` diverging when nodes/edges are restored from cache rather than freshly emitted.

## Out of Scope
- **Watch mode / FS watching / push-to-viewer** — re-scan-on-change is Story 3.5 (Epic 3); this story only builds the cache 3.5 depends on. The `--watch` flag in `cli.ts` still prints "not implemented in Phase 0".
- **Parallel parsing** — speeding up the cold/first scan via concurrency is not in scope (and must not break determinism if attempted later).
- **External-host allowlist (1.1), dynamic-segment matcher (1.2), confidence model (1.3), cross-repo linking (1.4), scan diff (1.6)** — separate Epic 1 stories. The cache stores whatever the scanner emits today, unchanged.
- **Any change to the graph contract** (`src/types.ts`, `GRAPH_VERSION`), edge semantics, feature derivation, or the addition of confidence/AI fields.
- **Cross-repo or global/home-dir cache** — the cache is strictly per-repo under `.sutra/cache/`.
