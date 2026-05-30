# Sutra — Issues Found & Fixes

_Scope: echo-ai flow showed **55 issues**. Investigation showed almost all were Sutra mis-reads, not code bugs._

## What the issues actually were

| # | What Sutra flagged | Reality | Verdict |
|---|---|---|---|
| 54 | `orphaned_endpoint` — `fetch('/api/...')` with no route in echo-ai | echo-ai's `next.config.js` **rewrites** `/api/*` + `/auth/*` → brain-api:3457. Calls are **proxied**, not broken. | false positive (tool was proxy-blind) |
| 1 | `missing_handler` — `globals.css` import | `.css` isn't scanned, so the target "looks absent". It's an asset, not a handler. | false positive |
| — | **1 genuine bug** (brain-dashboard) | `SettingsPage.jsx:14` imports `'./ProviderToggle.jsx'` → resolves to `src/pages/` (absent); real file is `src/components/`. Broken JS import. *(Lives in dead/unrouted code, so no runtime break — but a real broken link.)* | **real — must stay flagged** |
| — | echo-ai `POST /api/upgrade-request` | Genuinely has no backend, but caller is deliberate fire-and-forget (commented). | intentional no-op |

**Net:** 0 real bugs in echo-ai. The "55 red" was 54 proxy-resolved + 1 css noise.

## What was fixed (in Sutra itself)

Two precision fixes so the flow view stops lying — done by Sonnet agents:

1. **Proxy-awareness** (`scanner.ts` + `checks.ts`)
   - Scanner now parses `next.config.*` `rewrites()` (and CRA `package.json` "proxy") and records each proxied path-prefix.
   - `orphaned_endpoint` skips any `fetch` whose path falls under a proxied prefix — it's intentionally leaving the repo, not an orphan.

2. **Asset-import filter** (`checks.ts`)
   - `missing_handler` ignores import targets ending in non-JS/TS extensions (`.css/.scss/.svg/.png/.json/...`). They're assets, not handlers.

**Guard against over-suppression** (regression tests added):
- The dashboard `ProviderToggle` broken import — a real `.jsx` link — **stays flagged**.
- The test fixture's `POST /api/capture` (no `next.config`) **stays flagged** orphaned.

## Result (verified)

| repo | issues before | issues after |
|---|---|---|
| echo-ai | 55 | **0** _(54 proxied + 1 css suppressed)_ |
| brain-dashboard | 2 | **1** _(css gone; real ProviderToggle bug kept)_ |
| brain-api | 1 | **1** _(separate external-host false positive — out of scope)_ |

- Build green. **34/34 tests pass** (9 new: proxied→0 orphans, css→0 missing_handler, regression on broken fixture).
- Regression guards hold: dashboard `ProviderToggle` bug + fixture `POST /api/capture` orphan both **still flagged** (no over-suppression).
- Confirmed by independent re-scan + the full suite. Detail in `NOTES.md` → "Flow-honesty fixes".

## Still open (not fixed here)
- **brain-dashboard** `SettingsPage.jsx` + `ProviderToggle.jsx` — dead code with a broken import. Delete both, or wire + fix the path. (Code fix, not a Sutra fix.)
- **echo-ai** `/api/upgrade-request` — implement on brain-api or leave (product call).
- **brain-api** `/bot` template-literal external URL — needs an external-host allowlist (future).

## Story 3.5 — Live watch mode (2026-05-30)

- **`sutra watch [repoPath]`** — canonical live entry point. Starts viewer on `127.0.0.1`, initial scan, debounced re-scan via `chokidar`, pushes full graph over SSE `/events`.
- **`scan --watch`** — still CLI-only re-scan (no viewer push); use `sutra watch` for live browser updates.
- Dependency added: `chokidar` (FS watching with `.sutra` excluded to prevent feedback loop).
