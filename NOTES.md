# Sutra Phase 0 — Validation Notes

## Flow-honesty fixes (2026-05-29)

Two false-positive classes eliminated. Genuine dashboard bug and fixture orphan remain detected.

### What the fixes do

**Fix 1 — PROXY-BLINDNESS (scanner.ts + checks.ts)**
`scanner.ts` reads `next.config.js` (and `.mjs/.ts/.cjs`) via regex, extracts every `source:` string from rewrites,
converts each to a path prefix (e.g. `'/api/:path*'` → `'/api'`), and emits synthetic `PROXY /api` nodes of
type `"route"`. `checks.ts:checkOrphanedEndpoints` then skips any `http:` edge whose path is covered by a
proxy prefix. Result: fetches whose target is proxied out of the repo are no longer flagged `orphaned_endpoint`.

**Fix 2 — ASSET IMPORTS (checks.ts)**
`checks.ts:checkMissingHandlers` now calls `isAssetTarget(toId)` before emitting a `missing_handler` issue.
`isAssetTarget` strips any symbol fragment and checks the file extension against a deny-list of non-JS/TS
extensions (`.css`, `.scss`, `.svg`, `.png`, `.jpg`, etc.). Asset imports are silently skipped — they are
not handlers or symbols and were never scanned.

### Before / after issue counts

| repo | issues before | issues after | notes |
|---|---|---|---|
| echo-ai | 55 | **0** | 54 proxied `/api/*`+`/auth/*` + 1 `globals.css` asset — both eliminated |
| brain-dashboard | 2 | **1** | css false-pos gone; SettingsPage→ProviderToggle bug **still detected** |
| brain-api | 1 | **1** | `/bot` template-literal false-pos remains (external Telegram URL, known limitation) |

### Regression guard — both must be true

- **Fixture orphan still flagged**: the `broken` fixture has no `next.config.js`, so its `POST /api/capture`
  fetch correctly remains an `orphaned_endpoint`. Confirmed by direct CLI scan + test suite.
- **Dashboard real bug still flagged**: `src/pages/ProviderToggle.jsx` does not exist (real file is
  `src/components/ProviderToggle.jsx`). JS/TS broken import → `missing_handler` still emitted. Confirmed
  by CLI scan + test suite.

No over-suppression detected. The `/bot` external-host false positive in brain-api is a known remaining
limitation (template-literal prefix extraction yields `/bot` from an `https://api.telegram.org/bot${TOKEN}/...`
call). Out of scope for this fix cycle.

### New tests added

Three new describe blocks in `tests/sutra.test.ts` (34 tests total, all green):
- **Section 7** — `proxied` fixture: confirms PROXY nodes emitted, zero `orphaned_endpoint` issues returned.
- **Section 8** — `assets` fixture: confirms asset imports produce zero `missing_handler` issues.
- **Section 9** — regression: `broken` fixture still yields `orphaned_endpoint` for `POST /api/capture`.

---

## Validation Gate

Gate criterion: at least one repo surfaces a real, true-and-new structural finding not already obvious from reading the code.

**Result: PASSED** — strongest confirmed bug is in **brain-dashboard** (see Ecosystem Sweep below); echo-ai surfaced a real architectural relationship (full API delegation to brain-api via rewrite).

---

## Ecosystem Sweep (12 repos, 2026-05-29)

Ran `forge sutra scan` across the brain/echo/forge ecosystem. Per-repo graphs stashed in `.sutra/all/`.

| repo | nodes | edges | issues | verdict |
|---|---|---|---|---|
| dashboard (brain-dashboard) | 313 | 629 | 2 | **1 REAL bug** + 1 css false-pos |
| claude-fuse | 223 | 663 | 1 | css false-pos |
| brain-core | 29 | 104 | 0 | clean |
| brain-mcp | 76 | 276 | 0 | clean |
| brain-debug | 10 | 23 | 0 | clean |
| brain-telegram | 47 | 183 | 0 | clean |
| bots | 102 | 356 | 0 | clean |
| mcp-site | 0 | 0 | 0 | no TS/JS source (correct) |
| corebrain | 0 | 0 | 0 | no TS/JS source (correct) |
| forge-social | 87 | 277 | 0 | clean |
| forge-linkedin | 85 | 293 | 0 | clean |
| forge-site | 15 | 14 | 1 | css false-pos |

### Confirmed REAL bug — brain-dashboard
`src/pages/SettingsPage.jsx:14` → `import ProviderToggle from './ProviderToggle.jsx'`.
That resolves to `src/pages/ProviderToggle.jsx`, which **does not exist** — the component actually
lives at `src/components/ProviderToggle.jsx`. Broken relative import path; the Settings page's
provider-toggle import cannot resolve. This is a genuine missing-link bug, spot-checked by hand.
(Sutra reported it as `missing_handler` — the kind label is imprecise for a broken import, but the
detection is correct.)

### Recurring false positive — stylesheet/asset imports
`missing_handler` fired on `src/index.css` (dashboard), `globals.css` (claude-fuse, forge-site) — same
class as echo-ai. Non-JS/TS import targets (`.css/.svg/.png`) are not scanned, so they look "absent".
Cheap fix: in the edge builder or `runChecks`, ignore edge targets whose extension is not in
`SCAN_EXTENSIONS`. Until then, treat any `missing_handler` on a `.css`/asset path as noise.

---

## Repo 1: echo-ai

| Metric | Count |
|--------|-------|
| Nodes | 638 |
| Edges | 1,206 |
| Issues | 55 |
| Features | 30 |
| Commit scanned | 982cbc5 |

### Confirmed true-and-new finding

**Client components call OTP auth endpoints that have no route handler.**

- `app/login/page.tsx` lines 112, 140 call `POST /api/auth/send-otp`
- `app/login/page.tsx` line 163 calls `POST /api/auth/verify-otp`
- `find /app/api/auth -type f` → empty. The directory does not exist.

Sutra correctly flags these as `orphaned_endpoint` (severity `error`) **within echo-ai's own tree** — no `app/api/auth/` route file defines them.

**Honest caveat (verified post-scan, NOT a runtime bug):** `echo-ai/next.config.mjs` rewrites
`{ source: '/api/:path*', destination: 'http://localhost:3457/api/:path*' }` and the same for
`/auth/:path*`. So at runtime these calls are **proxied to brain-api (port 3457)**, not broken.
Sutra is single-repo in Phase 0 and does not read the rewrite table, so it cannot see this — exactly
the "external host / proxy-config resolver" limitation listed below. All findings are therefore
**candidate**, not confirmed runtime breaks.

The genuinely true-and-new structural finding is the **relationship**, not a break:
> echo-ai defines essentially **zero local API route handlers** — its entire `/api/*` and `/auth/*`
> surface is delegated to brain-api via a single `next.config` rewrite. Every client fetch is a
> cross-process dependency on brain-api:3457. Whether each of these 54 paths actually exists on
> brain-api is a Phase-1 cross-repo reconciliation (brain-api's own scan found 320 Express endpoints).

Related candidate findings (spot-checked, same proxy caveat applies):
- `components/ChatSessionList.tsx` lines 133, 146, 158, 172, 266 call `GET/PATCH/DELETE /api/chat/sessions[/:id]`. No local route — proxied.
- `components/OnboardingModal.tsx` calls `POST /api/user/onboarding/complete`. No local route — proxied.

Total: 54 `orphaned_endpoint` issues, all `/api/` or `/auth/` paths → all covered by the rewrite.
The ~5 telegram paths are real external Bot-API calls (correctly have no local handler). Net: Sutra
did surface a true architectural fact (full API delegation to brain-api), but produced **no confirmed
runtime-broken endpoint** in echo-ai once the rewrite is accounted for.

### False positives observed

1. **`missing_handler` for `app/globals.css`** — the scanner sees an import of `globals.css` from a `.tsx` layout file and emits a `missing_handler` issue because `.css` files are not scanned (not in `SCAN_EXTENSIONS`). The referenced id has no node in the graph. This is a correct scanner limitation: CSS imports should be ignored in the edge builder when the target extension is non-JS/TS. Mitigation: filter out edges whose `to` path ends in `.css`, `.svg`, `.png`, etc. before running checks.

2. **Template literal URL truncation** — fetch calls like `fetch(\`/api/chat/sessions/${id}\`, ...)` produce `GET /api/chat/sessions?` (with truncated path) rather than the full dynamic pattern. This means the check flags the base path against defined routes and may mismatch when the defined route uses a dynamic segment (`[id]`). Not observed as causing false positives here (since the routes genuinely don't exist), but would produce false positives in a codebase where routes do exist and are referenced via template literals.

---

## Repo 2: brain-api

| Metric | Count |
|--------|-------|
| Nodes | 1,218 |
| Edges | 3,864 |
| Issues | 1 |
| Features | 18 |
| Commit scanned | dd67ff8 |

### Issue found

**1 `orphaned_endpoint`: `POST /bot`**

Sources:
- `utils/telegram-alert.js#sendTelegramAlert`
- `services/telegram-otp.js#sendTelegramOtp`
- `services/reminder-scheduler.js#alertSbkTravel`
- `routes/payments.js`

Actual code: `fetch(\`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage\`, ...)` — a template literal.

**This is a false positive.** The scanner's `extractUrlLiteral` extracts only the static prefix of a template literal. For `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, the prefix is `https://api.telegram.org/bot`, and URL path extraction yields `/bot`. This is an external URL (Telegram Bot API), not a local route.

**No true structural issues found in brain-api.** The graph is large (1,218 nodes, 3,864 edges, 320 Express endpoints) and well-wired. The single issue is a known scanner limitation.

### Notable structural relationship (not an issue)

`routes/skills-browser.js#getDB` is the call target of 183 edges — it's the most-referenced function in the codebase. This is a correct observation: `getDB()` is a module-local lazy initializer called from every route in skills-browser.js. Not a bug, but a high-fan-in structural hotspot.

---

## Missing Forge Primitives

What a real Forge SDK should provide that Sutra had to hand-roll:

1. **Repo walker / file collector** — `collectFiles(root)` in scanner.ts walks the FS, applies `EXCLUDED_DIRS` + `SCAN_EXTENSIONS` filters, skips symlinks. A Forge SDK should expose a standard `forge.repo.walk(root, options)` that handles exclusion lists, respects `.forgeignore`, and yields normalized relative paths.

2. **AST service** — the scanner creates a `ts-morph Project`, adds files, and parses them. A Forge service would provide a cached, shared AST for a given repo root so multiple subcommands don't re-parse the same files independently. Especially valuable for large repos (echo-ai: 638 nodes took ~10s on first scan).

3. **`.sutra` index store** — Sutra manually does `mkdir -p .sutra && write graph.json`. A Forge SDK would provide a named artifact store per subcommand, with versioning, diffing between scans, and a standard read/write API so other subcommands can consume Sutra's output without parsing raw JSON.

4. **HTML view host** — `renderView` generates a self-contained HTML document with an inline Mermaid script and embeds the full graph JSON. A Forge SDK would provide a `forge.view.openPanel(html)` primitive that opens a local dev-server panel in the Forge UI, eliminating the need to write to disk and shell out `open`.

5. **External host allowlist** — distinguishing local routes from external API calls (Telegram, Stripe, etc.) requires knowing which URL prefixes are external. Sutra has no such registry, so external fetch calls trigger false-positive `orphaned_endpoint` findings. A Forge SDK would maintain a known-external-host registry (or read from the project's `package.json` proxy config / Next.js `rewrites`).

6. **Dynamic-segment resolver** — matching `fetch(\`/api/todos/${id}\`, ...)` against `app/api/todos/[id]/route.ts` requires both URL pattern normalization and template-literal partial extraction. A Forge SDK would provide a URL pattern matcher aware of Next.js / Express dynamic segment conventions so route-client pairs can be matched correctly even with dynamic IDs.

---

## Phase 1 — Post-MVP + Stretch (2026-05-30)

**Baseline:** MVP shipped (SUTRA-1.1 → SUTRA-3.1), 62/62 tests, `GRAPH_VERSION=1`.
**Final:** 81/81 tests, commits `60ad919` → `621b47a`.

### Stories shipped

| Story | Feature | Tests added |
|-------|---------|-------------|
| SUTRA-3.2 | Diff summary panel in `sutra view` when `.sutra/diff.json` exists | 6 (view.test.ts) |
| SUTRA-4.1 | `sutra scaffold [--from-issues] [--force]` → `.sutra/scaffold/` CANDIDATE stubs | 6 (scaffold.test.ts) |
| SUTRA-5.1 | `sutra scan --watch` debounced re-scan, graph.prev.json + diff.json | 3 (watch.test.ts) |
| SUTRA-6.1 | `sutra reconcile --client --server` → `cross_repo_orphan` (warn) | 4 (reconcile.test.ts) |

### Regression guard — all still pass

- `broken` fixture: `POST /api/capture` still flagged `orphaned_endpoint`.
- `proxied` / `assets` / `clean` fixtures unchanged.

### Phase 1 capabilities now available

1. **External-host allowlist** (MVP) — Telegram/Stripe fetches suppressed; optional `.sutra/external-hosts.json`.
2. **Dynamic-segment resolver** (MVP) — template-literal fetches match `[id]` / `:id` routes.
3. **`feature.sutra.md` contracts** (MVP) — `contract_missing_route` / `contract_undeclared_route`.
4. **Graph diffing** (MVP) — `sutra diff`, diff panel in view, watch mode auto-diff.
5. **Test scaffold** (post-MVP) — candidate stubs only, never auto-run.
6. **Watch mode** (post-MVP) — static re-scan on file change, not runtime monitor.
7. **Cross-repo reconcile** (stretch) — client HTTP edges vs server routes; proxy paths still manual.

### Cross-repo reconcile note (echo-ai + brain-api)

`sutra reconcile --client .sutra/all/echo-ai.json --server .sutra/all/brain-api.json` extracts HTTP calls from client edges (external hosts skipped) and matches against server route nodes. Proxied paths (`/api/*` → brain-api via `next.config` rewrites) are **not** automatically mapped — reconcile treats client http edges as literal paths. For echo-ai, most `/api/*` calls are proxied and won't appear as `orphaned_endpoint` on the client scan; reconcile still checks whether matching server routes exist when http edges are present. Manual verification of rewrite tables remains required for full cross-repo confidence.

### Brain MCP execution ledger

Memory IDs: 186 (3.2), 187 (4.1), 188 (5.1), 189 (6.1). Tags: `sutra`, `phase1`, `execution-ledger`.
