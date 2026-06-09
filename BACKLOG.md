# forge-sutra — Review Backlog

Tracked findings from AI review (CodeRabbit + Greptile) on PR #12. Prioritized; each item is a future PR.
Source bot noted in `[ ]`. `file:line` is the anchor at review time.

## P1 — Major

- [ ] **XSS in shareable artifact** — `src/commands/share.ts:259` — `safePath` escape does not handle `</script>` sequences or newline/CR; a crafted path/value can break out of the embedded `<script>` in the self-contained graph HTML. [Greptile P2]
- [ ] **Absolute local fixture paths** — `tests/fixtures/ecosystem/.sutra/link.json:13` — machine-specific absolute paths (`/Users/...`) expose local user-identifying info; replace with repository-relative paths. [CodeRabbit Major]
  > Same class as the forge-site `/Users/sam` leak — see brain MISTAKES_LEDGER M43.

## P2 — Minor

- [ ] **Method-blind route suppression** — `src/reconcile.ts:285` & `:233` — `matchesDynamicRoute` ignores the HTTP method, so e.g. `PATCH /api/items` and `DELETE /api/items/77` are over-suppressed (false "matched"). [Greptile P2 / CodeRabbit]
- [ ] **Misleading CORS comment** — `src/viewer/explain.ts:314` — comment says "same-origin in practice" but the handler sets permissive CORS for localhost; align comment with actual behavior (or tighten). [Greptile P2]
- [ ] **Test asserts wrong node type** — `tests/explain.test.ts:181` — filters for the wrong node-type prefix; 30 default `"module"` nodes are not what the assertion checks. [CodeRabbit]
- [ ] **Misaligned SSE test** — `tests/share.test.ts:135` — test name says it verifies absence of an `EventSource` constructor call, but assertions don't; can mask SSE regressions. [CodeRabbit]
