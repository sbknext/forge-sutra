# Story 4.3: Forge SDK primitive extraction

- **Epic:** Epic 4 — Ecosystem & SDK
- **Status:** Draft
- **Priority:** P1
- **Depends on:** 4.1 (Language-agnostic graph core — establishes the package/module boundary the SDK lives behind)
- **Estimate:** L

## Story

As a Forge tool author, I want the repo walker, AST service, `.sutra` index store, and HTML view host that Sutra currently hand-rolls to live behind a clean, reusable SDK surface, so that other Forge tools can build on the same foundation instead of re-implementing them, and Sutra becomes the first consumer of its own SDK with no change in behaviour.

## Context

`NOTES.md` → "Missing Forge Primitives" catalogs reusable pieces Sutra had to hand-roll. This story extracts the first four into an SDK surface, in the order that note lists them: (1) **repo walker / file collector** — today `scanner.ts:collectFiles`, which walks the FS applying `EXCLUDED_DIRS` + `SCAN_EXTENSIONS` and skipping symlinks; (2) **AST service** — today the inline `new Project({...})` + `addSourceFileAtPath` loop in `scanner.ts:scan`; (3) **`.sutra` index store** — today the hand-done `fs.mkdirSync` / `JSON.stringify` write in `cli.ts:cmdScan` and the `fs.readFileSync` / `JSON.parse` read in `cli.ts:cmdView`; (4) **HTML view host** — today the self-contained document built in `view.ts:renderView` with its embedded data and the `esc` HTML escaper. `BRIEF.md` Hard Constraints already commits Sutra to this: "Missing Forge SDK primitives are recorded in `NOTES.md` — never silently worked around"; this story pays that debt down.

This is the largest story in Epic 4. `_bmad/ROADMAP.md` Epic 4 lists 4.3 as "Forge SDK extraction (repo walker, AST service, index store, view host — per NOTES.md §'Missing Primitives')" and notes "4.3 SDK can start anytime". The work is a **pure refactor**: per the `ROADMAP.md` cross-cutting principles (#3 "Deterministic ids", #5 "Renderer is a leaf", #7 "Tests + build green before commit"), `sutra scan` / `sutra view` behaviour must stay byte-identical (same `graph.json` for the same repo+commit, `scanned_at` excepted). No new graph semantics, no new claims, no `GRAPH_VERSION` bump. The risk to manage is determinism surviving the move and the view host's escaping staying XSS-safe for embedded JSON.

## Acceptance Criteria

1. A **repo walker** SDK module exposes the behaviour currently in `scanner.ts:collectFiles`: recursive `walk` from a root, skipping symlinked entries (`e.isSymbolicLink()` → continue), skipping directories in an ignore set (today the `EXCLUDED_DIRS` set from `types.ts`), and keeping files whose extension is in an allow set (today `SCAN_EXTENSIONS`) and not excluded by `isExcludedFile` (`.min.js` / `.d.ts`). The ignore set, extension set, and exclude predicate are parameters whose defaults equal Sutra's current `EXCLUDED_DIRS` / `SCAN_EXTENSIONS` / `isExcludedFile`, so calling with defaults returns the **same list in the same order** as today. Note: `collectFiles` today does NOT sort — it returns files in `fs.readdirSync` traversal order; the walker must preserve that exact ordering so the byte-identical guarantee in AC 8 holds.
2. An **AST service** SDK module wraps ts-morph `Project` creation with the **exact** options used today in `scanner.ts:scan` (`new Project({ skipFileDependencyResolution: true, compilerOptions: { allowJs: true, jsx: 2 } })`), adds the given files (each via `project.addSourceFileAtPath` inside the existing try/catch that silently skips unreadable files), and exposes the parsed `SourceFile`s in the same order `project.getSourceFiles()` returns today. No ts-morph configuration literal remains inlined in `scanner.ts`.
3. An **index store** SDK module owns read/write of artifacts under a dot-dir: it writes JSON via `fs.mkdirSync(dir, { recursive: true })` then `fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8")` — byte-for-byte matching `cli.ts:cmdScan` today (today's write has **no trailing newline**; the store must NOT add one), reads + `JSON.parse` (matching `cmdView`), and exposes a version check against `GRAPH_VERSION`. The `SUTRA_DIR` (`.sutra`), `GRAPH_FILE` (`graph.json`), and `VIEW_FILE` (`view.html`) constants stay in `types.ts` and are passed in by `cli.ts`; the store does not hard-code them.
4. A **view host** SDK module owns the generic HTML shell: doc skeleton, inline CSS/JS slots, and embedded-JSON slot, plus the generic HTML escaper currently named `esc` in `view.ts` (the `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&#39;` chain — the `<` / `>` replacements are what neutralize a `</script>` breakout in embedded text). Sutra's feature-specific renderer (`renderView`) and its Sutra-only helpers (`mermaidLabel`, `mermaidShape`, `buildMermaid`, `buildDetailPanel`) stay in `view.ts` and consume the host; the host carries no Sutra/Mermaid layout knowledge.
5. None of the four SDK modules import any Sutra-domain module (`scanner.ts`, `checks.ts`, `features.ts`, `view.ts`). The walker, index store, and view host depend only on Node stdlib; the AST service additionally depends on ts-morph. None import the graph-shape interfaces from `src/types.ts` — the index store takes `GRAPH_VERSION` as a passed argument rather than importing the type. This satisfies `ROADMAP.md` principle #5 ("Renderer is a leaf") and the Epic 4 intent that primitives are reusable beyond Sutra.
6. `scanner.ts:scan` and `cli.ts` (`cmdScan` / `cmdView`) are rewired to call the SDK primitives; the in-file `collectFiles`, the inline ts-morph setup, and the inline fs/JSON artifact logic are replaced by SDK calls. Sutra must not leave both a live in-file copy and the SDK copy executing — Sutra calls the SDK (the final removal of any dead duplicate is verified here, not deferred).
7. `SutraEdge.kind`, `SutraNode.type`, `SutraIssue.kind`, the `checks.ts:runChecks` family (including the proxy-aware orphaned-endpoint logic and the `isAssetTarget` asset-import skip), `features.ts:buildFeatures`, and the scanner's proxy detection (`detectProxyNodes`) are untouched. The extraction is structural only.
8. **Determinism preserved:** running `sutra scan` twice on the same repo at the same commit produces `graph.json` files that diff to empty except the `scanned_at` field, and the output is byte-identical to a pre-extraction scan of the same commit (`scanned_at` excepted). `commit` is held constant by scanning the same checkout.
9. **No `GRAPH_VERSION` bump.** The graph.json contract in `src/types.ts` is not changed here. The index store's version check reads whatever `GRAPH_VERSION` currently is (`0`).

## Technical Approach

New SDK modules placed behind the package boundary that 4.1 establishes (paths below assume `src/sdk/`; adjust to 4.1's chosen layout — these are the **NEW** symbols this story introduces):

- **NEW `src/sdk/walker.ts`** — `collectFiles(root: string, opts?: { excludedDirs?: Set<string>; scanExtensions?: Set<string>; isExcludedFile?: (name: string) => boolean }): string[]`. Lift the body of `scanner.ts:collectFiles` verbatim: the inner recursive `walk`, the `e.isSymbolicLink()` skip, the `EXCLUDED_DIRS.has(e.name)` dir skip, and the `SCAN_EXTENSIONS.has(ext) && !isExcludedFile(e.name)` file filter. Defaults pull from `types.ts` so a no-opts call reproduces today's traversal-order list. Pure; no ts-morph import. (`.forgeignore` honoring from NOTES.md stays out — see Out of Scope.)
- **NEW `src/sdk/ast.ts`** — `createAstService(files: string[]): { project: Project; sources(): SourceFile[] }` (or equivalent). Encapsulate `new Project({ skipFileDependencyResolution: true, compilerOptions: { allowJs: true, jsx: 2 } })` and the `for (const f of allFiles) { try { project.addSourceFileAtPath(f); } catch {} }` loop currently inline in `scan`. `sources()` returns `project.getSourceFiles()` so iteration order is unchanged. ts-morph is the only third-party dependency.
- **NEW `src/sdk/index-store.ts`** — `writeArtifact(dir: string, filename: string, value: unknown): string` (mkdir recursive, `JSON.stringify(value, null, 2)`, utf8, no trailing newline — exactly `cmdScan` today; returns the written path), `readArtifact<T>(dir: string, filename: string): T` (read + `JSON.parse`, mirroring `cmdView`'s try/catch error path), and `assertVersion(actual: number, expected: number): void` that throws on mismatch. Dir/filename-agnostic; `cli.ts` keeps passing `SUTRA_DIR` / `GRAPH_FILE` / `VIEW_FILE`.
- **NEW `src/sdk/view-host.ts`** — `renderDocument({ title, styles, scripts, body, embedded }): string` producing the `<!doctype html>` skeleton currently inline in `view.ts:renderView`, with the inline `<style>` slot, the `<script>` slots, the `<main>` body slot, and the embedded-data slot. Move the generic `esc` escaper into this module and export it (keeping all five replacements; the `<` / `>` ones are the `</script>` breakout guard for embedded content). `view.ts:renderView` stays and becomes a consumer: it builds Sutra's CSS/JS/body (Mermaid panels via the existing `buildMermaid` / `buildDetailPanel`) and calls `renderDocument`.

Rewiring:

- `scanner.ts:scan` imports `collectFiles` from `src/sdk/walker.ts` and `createAstService` from `src/sdk/ast.ts`; the two passes (node build, edge build), the `detectProxyNodes` pass, and all id usage (`makeNodeId`, `relPosix`, `httpTargetId`) are unchanged. `scan` still returns `{ nodes, edges }`.
- `cli.ts:cmdScan` uses `writeArtifact` for the `graph.json` write; `cmdView` uses `readArtifact` + `assertVersion`, then calls `renderView` and `writeArtifact` for `view.html`. The `scanned_at: new Date().toISOString()` assignment stays in `cmdScan` and remains the only non-deterministic field.

Honesty rules (per `ROADMAP.md` principles + README "Claim Bounds"): pure structural extraction — no new candidate/confirmed semantics, no AI fields, no new claims. Deterministic ids stay in `src/util/ids.ts` and are not re-implemented. No banned-language strings (`finds all bugs`, `auto-debug`, `auto-test`, `auto-generates tests`) appear in any new module, doc, or comment.

## Tasks

- [ ] Confirm the 4.1 package/module boundary and place the four new modules accordingly (`src/sdk/` assumed below).
- [ ] Extract `src/sdk/walker.ts` from `scanner.ts:collectFiles`; parameterize `excludedDirs` / `scanExtensions` / `isExcludedFile` with current defaults; preserve `readdirSync` traversal order (no sort).
- [ ] Extract `src/sdk/ast.ts` wrapping the `new Project({...})` setup and the `addSourceFileAtPath` try/catch loop from `scan`.
- [ ] Extract `src/sdk/index-store.ts` from `cmdScan` write + `cmdView` read; add `assertVersion(actual, expected)`; preserve no-trailing-newline output exactly.
- [ ] Extract `src/sdk/view-host.ts` from `view.ts` (`<!doctype html>` skeleton + the `esc` escaper); keep all five escape replacements.
- [ ] Rewire `scanner.ts:scan` to consume the walker + AST service.
- [ ] Rewire `cli.ts:cmdScan` / `cmdView` to consume the index store; rewire `view.ts:renderView` to consume `renderDocument`.
- [ ] Grep to confirm no SDK module imports `scanner.ts` / `checks.ts` / `features.ts` / `view.ts` or the graph-shape types.
- [ ] Run `npm run build` (tsc) and `npm test` (vitest) clean.
- [ ] Capture a pre-extraction `graph.json` baseline (prior commit), then diff against a post-extraction scan of the same checkout to prove byte-identical output (excluding `scanned_at`).
- [ ] Grep new files for banned claim-bound words; update this story with shipped-vs-deferred.

## Test Plan

The existing harness (`tests/sutra.test.ts`, vitest) drives `scan` / `runChecks` / `buildFeatures` against on-disk fixtures under `tests/fixtures/` (`broken`, `clean`, `proxied`, `assets`). New SDK tests follow the same pattern; add new fixtures under `tests/fixtures/` where a stored tree is clearer than constructing one in-test.

- **`describe("sdk/walker")`** — NEW fixture `tests/fixtures/walker/` containing a `node_modules/` dir, a `.git/` dir, a `.ts`, a `.txt`, a `foo.min.js`, and a nested `.tsx`. Proves: ignored dirs are skipped, only `SCAN_EXTENSIONS` files are returned, `.min.js` is excluded via `isExcludedFile`, and the result order matches a direct `readdirSync` walk (determinism). A second `it` passes custom `excludedDirs`/`scanExtensions` and proves the parameters override the defaults.
- **`describe("sdk/ast")`** — NEW fixture with one `.ts` and one `.js` file. Proves `createAstService` parses both (`allowJs` honored), `sources()` returns them, and two calls on the same file list yield the same source order.
- **`describe("sdk/index-store")`** — proves `writeArtifact` emits exactly `JSON.stringify(value, null, 2)` (2-space indent, **no** trailing newline) into a temp dir, `readArtifact` round-trips it, and `assertVersion(0, 1)` throws while `assertVersion(0, 0)` does not.
- **`describe("sdk/view-host")`** — proves `renderDocument` embeds the data in its slot, `esc` escapes `<`/`>`/`&`/`"`/`'`, and an embedded payload containing the literal `</script>` is neutralized by the `<`/`>` replacements (XSS-safe embedding — the NOTES.md risk).
- **Regression guard — `describe("extraction is behaviour-preserving")`** — run the existing `broken` and `clean` fixtures through the rewired `scan` → `runChecks` → `buildFeatures` pipeline and assert the issue set and sorted node-id list are unchanged from the pre-extraction expectations already encoded in the suite (the deterministic-ids and zero-issue-clean tests must keep passing untouched). This locks the byte-identical guarantee (AC 8) into CI so a future SDK change can't silently alter Sutra's output.

## Out of Scope

- **New checks, features, node/edge kinds, or AI enrichment** — Epics 1 / 2 / 3.
- **`.forgeignore` honoring + normalized-relative-path yielding in the walker** — NOTES.md marks these as the future Forge ideal; this story preserves current behaviour (absolute paths, `EXCLUDED_DIRS` only).
- **AST caching / shared cross-subcommand AST** — NOTES.md item 2 names this as the eventual goal; this story extracts the service as-is (parse per scan), without a cache layer.
- **Artifact versioning / scan diffing in the index store** — NOTES.md item 3 and `sutra diff` belong to Epic 1.6; the store here only does read/write + version check.
- **`forge.view.openPanel` / Forge-UI dev-server panel** — NOTES.md item 4's eventual host; this story keeps the write-to-disk + `open` flow in `cli.ts:cmdView`. The interactive viewer is Epic 3.
- **External-host allowlist + dynamic-segment resolver** — NOTES.md items 5 and 6 are Epic 1.1 / 1.2, not primitive extraction.
- **Any graph.json schema change or `GRAPH_VERSION` bump.**
