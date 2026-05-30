# Sutra Phase 2 — BMAD Plan

**Date:** 2026-05-30  
**Owner:** Sambhaji (executor-directed BMAD authoring)  
**Repo:** `~/Documents/saas/brain/sutra` (`github.com/sbknext/forge-sutra`, MIT)  
**Baseline:** Phase 1 complete — 81/81 tests green, `GRAPH_VERSION = 1`, commits `60ad919` → `621b47a`

**Scope:** Sutra repo only. No cross-repo dogfood stories, no Brain/echo-ai/brain-api integration work.

---

## Phase 2 Mission

Harden Sutra as a **publishable, Forge-ready CLI**: polish the command surface, make graph schema evolution safe, improve scan performance observability, extend contract authoring (`features/*.sutra.md`), enrich the HTML view for contract drift and reconcile output, and prepare `forge-sutra` for npm publish — all while staying standalone, local-first, TS/JS-only, and honest about static approximation limits.

Success = a maintainer can install `forge-sutra` from npm, scan a large fixture repo under a documented time budget, migrate an older `graph.json`, declare multi-feature contracts, and review drift/reconcile in the HTML view without reading raw JSON.

---

## Internal Gaps (from Phase 1 completion)

| Gap | Source | Phase 2 epic |
|-----|--------|--------------|
| Bin is `forge-sutra` but docs/README say `sutra`; no `forge sutra` alias story | `package.json`, BRIEF.md | A |
| No migration path when `GRAPH_VERSION` bumps | README schema section | B |
| Large-repo scan time unmeasured (~10s echo-ai noted in NOTES) | NOTES "Missing Forge Primitives" #2 | C |
| Contracts: root `feature.sutra.md` only; `features/*.sutra.md` deferred in Phase 1 | `contracts.ts` | D |
| View shows diff panel but no contract-drift or reconcile summary panels | `view.ts` | E |
| npm publish not ready (`0.0.0`, no `files`, no prepublish) | `package.json` | F |
| Forge SDK primitives still hand-rolled (walker, AST cache, index store, view host) | NOTES "Missing Forge Primitives" | Document only — blocked on Forge SDK, not Sutra scope |

**Out of scope (unchanged):** non-TS/JS languages, Brain auth/multi-user, runtime execution, auto-debug language, cross-repo proxy auto-mapping, Forge UI panel host (until SDK exists).

---

## Epics (rationale + order)

| # | Epic | Rationale | Ships in MVP? |
|---|------|-----------|---------------|
| **A** | **CLI polish** — naming, help text, optional `sutra` bin alias | Reduces friction before npm publish; aligns README/BRIEF with shipped commands. | **Yes** |
| **B** | **`graph.json` schema migration helper** | `GRAPH_VERSION = 1` today; next bump needs a documented upgrade path for saved graphs and CI caches. | **Yes** |
| **C** | **Large-repo scan performance** — fixture benchmarks + optional `--profile` | Echo-ai-scale repos ~10s; need regression guard without dogfooding external repos in CI. | **Yes (minimal)** |
| **D** | **Richer contract syntax** — `features/*.sutra.md` | Phase 1 deferred multi-file contracts; enables per-feature declarations in monorepos. | Post-MVP |
| **E** | **HTML view UX** — contract drift panel, reconcile summary | Operational visibility; builds on Phase 1 diff panel pattern. | Post-MVP |
| **F** | **npm package publish prep** — `files`, version, README install, dry-run publish | Makes Sutra consumable outside the brain monorepo folder. | **Yes (minimal)** |

---

## Dependency Order

```
A1 (CLI naming + help)
  └─► F1 (npm publish prep)          ← bin name settled first
B1 (migrate command)
  └─► (future GRAPH_VERSION bumps)
C1 (benchmark fixtures + --profile)
D1 (features/*.sutra.md loader)
  └─► D2 (multi-contract drift checks)
        └─► E1 (contract drift panel in view)
              └─► E2 (reconcile summary panel)
```

Epics A, B, C can parallelize after plan approval. D → E is sequential. F1 depends on A1 bin naming decision.

---

## MVP Cut Line

**Ships in Phase 2 MVP (executor stops after F1-min unless owner says continue):**

- Epic A — **SUTRA-7.1**
- Epic B — **SUTRA-8.1**
- Epic C — **SUTRA-9.1** (benchmark fixtures + threshold test; `--profile` optional)
- Epic F — **SUTRA-12.1** (publish prep only; no actual npm publish without owner)

**Post-MVP (same phase doc, later sprint):** SUTRA-10.1, SUTRA-10.2, SUTRA-11.1, SUTRA-11.2

**Explicitly deferred:** Forge SDK primitive extraction (walker, AST cache, index store, view host) — record gaps in NOTES, do not hand-roll Forge-shaped APIs inside Sutra.

---

## Global Regression Guard (every story)

After every story gate, confirm:

1. **`tests/fixtures/broken`** — `POST /api/capture` still flagged `orphaned_endpoint`.
2. **`tests/fixtures/proxied`** — zero `orphaned_endpoint`.
3. **`tests/fixtures/assets`** — zero asset `missing_handler`.
4. **`tests/fixtures/clean`** — zero issues.
5. **`tests/fixtures/contract-declared`** — contract drift checks unchanged unless story touches contracts.
6. **`npm run build` + `npm test`** — count ≥ 81 (may increase with new tests).

---

## Stories (INVEST, ordered)

### Epic A — CLI Polish

#### SUTRA-7.1 — Command naming and help consistency

**As a** Forge user, **I want** a consistent CLI entry (`forge-sutra` and/or `sutra`) with accurate help text, **so that** install docs match what I type.

**Acceptance criteria:**
- [ ] Decision documented in README: primary bin (`forge-sutra`), optional secondary bin (`sutra`) if added.
- [ ] All subcommands (`scan`, `view`, `diff`, `scaffold`, `reconcile`) show `--help` with claim-bounds one-liner.
- [ ] README command examples match actual bin name(s).
- [ ] BRIEF.md header updated to "Phase 2" pointer (not rewrite of historical Phase 0 spec).
- [ ] `npm run build` + `npm test` green; test count ≥ 81.

**Fixtures:** CLI smoke test via `execSync('node dist/cli.js --help')` in test or existing sutra.test.ts section.  
**Schema impact:** None.  
**Honesty / claim bounds:** Alias is convenience only — no new semantic checks.

---

### Epic B — Graph Schema Migration

#### SUTRA-8.1 — `sutra migrate <graph.json>` helper

**As a** developer with cached `.sutra/graph.json` from an older Sutra version, **I want** a migrate command, **so that** `GRAPH_VERSION` bumps do not break my saved graphs.

**Acceptance criteria:**
- [ ] New CLI subcommand: `sutra migrate <path>` (default: `.sutra/graph.json`).
- [ ] Reads `version` field; if already current (`GRAPH_VERSION`), no-op with message.
- [ ] Implements at least **v0 → v1** migration (add empty `contracts: []` if missing; preserve nodes/edges/issues/features).
- [ ] Unknown version → clear error with supported range.
- [ ] Unit tests with frozen v0 fixture graph JSON.
- [ ] README "graph.json schema" section documents migration command and version history.
- [ ] Phase 0 regression guards hold.

**Fixtures:**
- **New `tests/fixtures/migrate/graph-v0.json`** — minimal Phase 0 shape without `contracts`.
- **New `tests/migrate.test.ts`** — v0 → v1 adds `contracts: []`, bumps `version`.

**Schema impact:** Migration module only; `GRAPH_VERSION` stays 1 until a future story bumps it.  
**Honesty / claim bounds:** Migrates **structure only** — does not re-scan or fix semantic issues.

---

### Epic C — Large-Repo Scan Performance

#### SUTRA-9.1 — Benchmark fixtures and optional `--profile`

**As a** maintainer, **I want** scan timing benchmarks on synthetic large fixtures, **so that** performance regressions are caught in CI without scanning echo-ai.

**Acceptance criteria:**
- [ ] New fixture `tests/fixtures/large-repo/` — generated or committed TS/JS files (≥200 modules) under sutra only; no external repo dependency.
- [ ] Test asserts scan completes under configurable threshold (e.g. 15s on CI, documented as heuristic).
- [ ] Optional `sutra scan --profile` prints phase timings (walk, parse, checks, write) to stderr.
- [ ] No change to graph semantics vs small fixtures.
- [ ] Regression guards hold; test count increases.

**Fixtures:** `tests/fixtures/large-repo/` + `tests/benchmark.test.ts` (or section in sutra.test.ts).  
**Schema impact:** None.  
**Honesty / claim bounds:** Benchmark is **environment-dependent**; threshold is a regression guard, not a SLA. Label timings **candidate**.

**Note:** Shared AST cache (Forge primitive #2) is out of scope — profile output informs future Forge SDK work only.

---

### Epic D — Richer Contract Syntax (post-MVP)

#### SUTRA-10.1 — Discover and parse `features/*.sutra.md`

**As a** monorepo maintainer, **I want** per-feature contract files under `features/`, **so that** I do not maintain one giant root contract.

**Acceptance criteria:**
- [ ] Scanner discovers `features/**/*.sutra.md` (in addition to root `feature.sutra.md`).
- [ ] Each file parsed with same syntax as SUTRA-2.1; `contracts[]` includes `source_file` field.
- [ ] Parse errors per file → `contract_parse_error` with file path in message.
- [ ] Fixture with two feature files → two entries in `contracts[]`.
- [ ] Root-only repos unchanged.

**Fixtures:**
- **New `tests/fixtures/contract-multi/`** — `features/todos.sutra.md` + `features/auth.sutra.md`.

**Schema impact:** Extend `SutraContract` with optional `source_file: string`. Bump `GRAPH_VERSION` → 2 only if breaking; prefer backward-compatible optional field.  
**Honesty / claim bounds:** Multi-file contracts are still **author-declared intent**.

---

#### SUTRA-10.2 — Multi-contract drift aggregation

**Acceptance criteria:**
- [ ] `contract_missing_route` / `contract_undeclared_route` work per contract file.
- [ ] Issue `feature` tag uses contract feature name, not generic `"contract"`.
- [ ] `contract-multi` fixture with one missing route → drift fires with correct source file.

**Fixtures:** Extend `contract-multi`.  
**Schema impact:** Issue messages only.  
**Honesty:** Same as Phase 1 contract checks.

---

### Epic E — HTML View UX (post-MVP)

#### SUTRA-11.1 — Contract drift panel in `sutra view`

**As a** reviewer, **I want** contract issues grouped in the HTML view, **so that** I see declared-vs-observed drift without parsing JSON.

**Acceptance criteria:**
- [ ] When `graph.contracts.length > 0`, view shows "Contract drift" section listing `contract_*` issues by feature/source file.
- [ ] Section labeled "heuristic / candidate".
- [ ] Snapshot or DOM fragment test in `view.test.ts`.

**Fixtures:** Reuse `contract-declared` graph in view test.  
**Schema impact:** None (display only).  
**Honesty:** Display-only; no new checks.

---

#### SUTRA-11.2 — Reconcile summary panel in `sutra view`

**As a** reviewer, **I want** reconcile results visible in the view when `.sutra/reconcile.json` exists, **so that** cross-repo orphans are reviewable in the browser.

**Acceptance criteria:**
- [ ] `sutra reconcile --out .sutra/reconcile.json` (new optional flag) writes reconcile result JSON.
- [ ] View reads `.sutra/reconcile.json` if present; shows client/server repo names + orphan list.
- [ ] Without file, panel hidden (no error).
- [ ] Unit tests for reconcile output + view fragment.

**Fixtures:** Extend `tests/fixtures/reconcile/` + view test.  
**Schema impact:** New ephemeral `reconcile.json` schema (`reconcile_version: 0`).  
**Honesty:** Same claim bounds as CLI reconcile — static match, candidate results.

---

### Epic F — npm Package Publish Prep

#### SUTRA-12.1 — Package metadata and publish dry-run

**As a** maintainer, **I want** `forge-sutra` ready for `npm publish`, **so that** others can install without cloning the brain repo.

**Acceptance criteria:**
- [ ] `package.json`: `"files": ["dist", "README.md", "LICENSE"]`, version `0.1.0` (or owner-chosen).
- [ ] `prepublishOnly`: `npm run build && npm test`.
- [ ] README "Install" section: `npm install -g forge-sutra` (or `npx forge-sutra`).
- [ ] `npm pack --dry-run` lists only intended files (no tests/fixtures in tarball).
- [ ] **No actual `npm publish`** without explicit owner approval.
- [ ] Regression guards hold.

**Fixtures:** None (metadata only).  
**Schema impact:** None.  
**Honesty:** README states Phase 2 capabilities and claim bounds; no "auto-debug" language.

---

## Missing Forge Primitives — Phase 2 Stance

| Primitive | Phase 1 status | Phase 2 action |
|-----------|----------------|----------------|
| Repo walker | Hand-rolled `collectFiles` | Document; do not extract to pseudo-SDK |
| AST service (shared cache) | Re-parse per scan | `--profile` timings only; defer to Forge |
| `.sutra` index store | Manual write | Optional: standardize paths in README; no Forge API mimic |
| HTML view host | Disk + `open` | View UX improvements stay file-based until Forge panel exists |
| External-host allowlist | **Shipped** (MVP) | Maintain; extend via `.sutra/external-hosts.json` docs |
| Dynamic-segment resolver | **Shipped** (MVP) | Maintain; document Express variable-mount limitation |

---

## Executor Workflow (immutable)

1. **This plan** → owner approval → then one story at a time.
2. Per story: state AC → failing test/fixture first (TDD) → minimal impl → gate (`npm run build` + `npm test`) → regression guard → **one commit** (≤5 files / ≤300 lines) → **STOP**, wait for owner `"next"`.
3. Phase end: update `NOTES.md` (Phase 2 findings), `README.md` (commands + claim bounds), bump `GRAPH_VERSION` only when schema changes.

---

## Risk Register

| Risk | Mitigation |
|------|------------|
| Large-repo fixture bloats repo | Generate fixture in test setup or cap at ~200 files; gitignore generated tree if needed |
| Migration complexity | Only v0→v1 in MVP; explicit version table in README |
| npm name collision | Verify `forge-sutra` availability before publish; scoped `@sbknext/forge-sutra` fallback documented |
| Multi-contract syntax bikeshedding | Reuse Phase 1 markdown list syntax; no YAML until proven |
| Benchmark flakiness on CI | Generous threshold + skip tag option for slow runners |

---

## Approval Gate

**STOP HERE.** No implementation until owner approves this plan (or requests edits to epic order / MVP cut).

After approval, first executable story: **SUTRA-7.1 — Command naming and help consistency**.
