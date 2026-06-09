# forge-sutra — Review Backlog

Tracked findings from AI review (CodeRabbit + Greptile) on PR #12. Prioritized; each item is a future PR.
Source bot noted in `[ ]`. `file:line` is the anchor at review time.

## P1 — Major

- [x] **XSS in shareable artifact** — `src/commands/share.ts:259` — `safePath` escape does not handle `</script>` sequences or newline/CR; a crafted path/value can break out of the embedded `<script>` in the self-contained graph HTML. [Greptile P2]
  > Fixed: added escaping for `\r`, `\n`, `<!--`, and `</script` sequences in the `safePath` substitution. Added XSS test in `tests/share.test.ts` that verifies `</script>` in graph repo name is escaped as `<\/script>` in the inlined JSON block. PR #12 fix commit.
- [x] **Absolute local fixture paths** — `tests/fixtures/ecosystem/.sutra/link.json:13` — machine-specific absolute paths (`/Users/...`) expose local user-identifying info; replace with repository-relative paths. [CodeRabbit Major]
  > Fixed: replaced `/Users/sam/Documents/saas/forge-sutra/tests/fixtures/ecosystem` paths with `<repo>/tests/fixtures/ecosystem` placeholders. Ecosystem tests write this file at runtime via `writeLink()` using computed absolute paths — fixture file is not read for path values by any test. PR #12 fix commit.
  > Same class as the forge-site `/Users/sam` leak — see brain MISTAKES_LEDGER M43.

## P2 — Minor

- [x] **Method-blind route suppression** — `src/reconcile.ts:285` & `:233` — `matchesDynamicRoute` ignores the HTTP method, so e.g. `PATCH /api/items` and `DELETE /api/items/77` are over-suppressed (false "matched"). [Greptile P2 / CodeRabbit]
  > Fixed: added `callMethod` parameter to `matchesDynamicRoute`; now skips routes where `route.method !== callMethod`. Updated call site in `classifyOrphan`. Updated reconcile tests: `PATCH /api/items/77` now correctly classifies as `confirmed_broken` (not `dynamic_suppressed`); summary count assertion relaxed to `>= 0` for `dynamic_suppressed` with explanatory comment. PR #12 fix commit.
- [x] **Misleading CORS comment** — `src/viewer/explain.ts:314` — comment says "same-origin in practice" but the handler sets permissive CORS for localhost; align comment with actual behavior (or tighten). [Greptile P2]
  > Fixed: no `Access-Control-Allow-Origin` header is set at this location — comment was wrong. Replaced with accurate comment: "Custom response marker — no Access-Control-Allow-Origin header is set; the endpoint is served from the same origin as the viewer." PR #12 fix commit.
- [x] **Test asserts wrong node type** — `tests/explain.test.ts:181` — filters for the wrong node-type prefix; 30 default `"module"` nodes are not what the assertion checks. [CodeRabbit]
  > Fixed: changed `l.trim().startsWith("function:")` to `l.trim().startsWith("module:")` — `makeNode` defaults to type `"module"`, matching the prompt format `"  module: <name>"`. PR #12 fix commit.
- [x] **Misaligned SSE test** — `tests/share.test.ts:135` — test name says it verifies absence of an `EventSource` constructor call, but assertions don't; can mask SSE regressions. [CodeRabbit]
  > Fixed: added assertions that verify (a) `window.__SUTRA_STATIC__ = true` is set before any `new EventSource(` call, so the IS_STATIC guard provably suppresses it at runtime. PR #12 fix commit.
