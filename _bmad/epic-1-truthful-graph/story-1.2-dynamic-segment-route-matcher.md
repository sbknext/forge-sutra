# Story 1.2: Dynamic-segment route matcher

- **Epic:** Epic 1 — Truthful Graph
- **Status:** Draft
- **Priority:** P0
- **Depends on:** 1.1 (External-host allowlist) — not a hard code dependency, but 1.1 should land first so the `orphaned_endpoint` check is already free of external-host noise before we change its matching logic.
- **Estimate:** M

## Story
As a developer scanning a Next.js or Express repo, I want Sutra to match a dynamic client call such as `fetch(`/api/todos/${id}`)` against the route that actually serves it (`app/api/todos/[id]/route.ts` in Next.js, or `app.get('/todos/:id', ...)` in Express), so that parameterized routes are correctly recognized as wired and do not produce false `orphaned_endpoint` issues.

## Context
NOTES.md ("Repo 1: echo-ai" → "False positives observed" #2, and "Repo 2: brain-api") documents two related defects in template-literal URL handling. First, `scanner.ts:extractUrlLiteral` extracts only the *static prefix* of a template literal: `fetch(`/api/chat/sessions/${id}`)` becomes a truncated `/api/chat/sessions` (NOTES records it surfacing as `GET /api/chat/sessions?`), dropping the dynamic segment entirely. Second, even if the segment were preserved, `checks.ts:checkOrphanedEndpoints` does plain string matching of `METHOD /path` and has no awareness that `app/api/todos/[id]/route.ts` (Next.js) or `:id` (Express) is a *pattern* that matches a concrete value. README "Claim Bounds" → "Known limitations in Phase 0" states this plainly: "Template-literal fetch URLs: only the static prefix is extracted. Dynamic segments (`${id}`) are dropped, which can cause false positives when matching against dynamic route patterns."

This is item #6 in NOTES.md "Missing Forge Primitives" — a **Dynamic-segment resolver**: "matching `fetch(`/api/todos/${id}`, ...)` against `app/api/todos/[id]/route.ts` requires both URL pattern normalization and template-literal partial extraction. A Forge SDK would provide a URL pattern matcher aware of Next.js / Express dynamic segment conventions." ROADMAP Epic 1 lists this as story 1.2 and it sits on the minimum path to the named goal (1.1 → **1.2** → 1.3 → 1.4 → 2.2 → ...). The viewer cannot be "truthful" (ROADMAP principle 1) while it flags wired parameterized routes as broken.

## Acceptance Criteria
1. `scanner.ts:extractUrlLiteral` no longer truncates template literals at the first interpolation. Each interpolation expression (`${id}`, `${sessionId}`, etc.) is replaced by a canonical placeholder token rather than dropped, so `fetch(`/api/todos/${id}`)` yields a normalized path of `/api/todos/{param}` (placeholder spelling defined in Technical Approach), not `/api/todos`.
2. Route/endpoint nodes that contain a dynamic segment are normalized to the same canonical placeholder form. A Next.js node derived from `app/api/todos/[id]/route.ts` and an Express node derived from `app.get('/todos/:id', ...)` both normalize their path to `/api/todos/{param}` / `/todos/{param}` respectively, using a single shared normalizer.
3. `checks.ts:checkOrphanedEndpoints` matches an `http:` edge against route/endpoint nodes by comparing **normalized** `METHOD /path` forms, not raw strings. A dynamic client call matched to a dynamic route of the same method + same segment arity + matching static segments produces **no** `orphaned_endpoint` issue.
4. Segment **arity and static segments still matter**: `/api/todos/{param}` must NOT match `/api/todos` (arity mismatch) and must NOT match `/api/users/{param}` (static-segment mismatch). A genuinely orphaned dynamic call against a non-existent route is still flagged `orphaned_endpoint` with `severity: "error"`.
5. Next.js catch-all (`[...slug]`) and optional-catch-all (`[[...slug]]`) directory conventions are recognized and normalized to a distinct catch-all placeholder that matches one-or-more (and zero-or-more, respectively) trailing segments. If full catch-all matching is judged out of scope for this story it must be explicitly degraded to a documented, conservative behavior (see Out of Scope) — never silently mis-matched.
6. The matcher remains a **structural / candidate** check. Where a template literal interpolates into the *middle of a single path segment* (e.g. `/api/item-${id}` → one segment, partially dynamic), the normalizer marks that segment as a wildcard rather than guessing, and the result is treated as a candidate match, consistent with README "Claim Bounds". No "confirmed"/"complete" language is introduced anywhere.
7. Node ids stay deterministic and stable (ROADMAP principle 3): the **node id** continues to use the real on-disk `relPath#symbol` (e.g. `app/api/todos/[id]/route.ts#GET /api/todos/[id]`). Normalization is a matching-time transform; it does NOT rewrite stored `SutraNode.id` or `SutraNode.name`, so `sutra diff` and history are unaffected.
8. `GRAPH_VERSION` (currently `0` in `src/types.ts`) is bumped **only if** a new field is persisted to `graph.json` (see Technical Approach). If matching is implemented purely as a check-time transform with no schema change, `GRAPH_VERSION` stays `0` and this is stated in the PR description.
9. The brain-api `POST /bot` Telegram false positive (NOTES.md "Repo 2") is NOT reintroduced or worsened by the new extraction logic — external-host calls remain out of `orphaned_endpoint` once 1.1's allowlist is in place; this story's template-literal change must compose with that, not bypass it.

## Technical Approach
Important — what already exists (do NOT rebuild): `checks.ts` already contains `pathMatches(definedPath, clientPath)` + `isDynamic(seg)`, and `isDynamic` already recognizes BOTH `:param` (Express) and `[param]` (Next.js) on the **route-definition** side. The scanner also already converts route files to `:param` form (`nextAppRouterPath`/`nextPagesApiPath` map `[id]` → `:id`; Express literals keep `:id`). So the route side of matching is largely working. The genuine unsolved defect is the **client side**: `scanner.ts:extractUrlLiteral` truncates a template literal at its head, dropping the `${id}` segment entirely, so `fetch(`/api/todos/${id}`)` never even reaches `pathMatches` as a comparable 3-segment path. The bulk of this story is fixing client-side extraction; the route side needs hardening (catch-all + arity rigor), not a rewrite.

Files changed:
- `src/scanner.ts` — `extractUrlLiteral` (named in NOTES.md). Replace the "head/static-prefix only" branch for `TemplateExpression` with full traversal: walk `getHead()` + `getTemplateSpans()`, emit each span's literal text verbatim, and substitute every interpolation with a canonical placeholder segment so `/api/todos/${id}` yields a complete `/api/todos/{param}` (or `/api/todos/:param` to match the existing `:`-convention — pick ONE and make `isDynamic` accept it). Keep ts-morph AST nodes (per BRIEF "Parse TS/JS with a real parser (ts-morph)") — no regex on source text. Also handle the `http://host/path/${x}` template case by extracting the pathname after substitution.
- `src/checks.ts` — extend the EXISTING `pathMatches`/`isDynamic` rather than replacing them: (a) treat a dynamic **client** segment (the new placeholder) as matching a dynamic **or** literal route segment of the same position; (b) add catch-all awareness for Next.js `[...slug]`/`[[...slug]]` (AC5); (c) keep the strict arity + static-segment checks already present (AC4). The existing proxy-prefix skip (`isCoveredByProxy`) and the post-1.1 external-host skip run BEFORE matching, preserving precedence (AC9).
- `src/util/ids.ts` (or a new sibling `src/util/routes.ts` — **NEW**, preferred, to keep `ids.ts` id-only) — optionally extract the shared normalization (`normalizeRoutePath`) here so the scanner's client-side normalization and the checks' route-side normalization use one implementation. Only do this if it removes duplication; otherwise keep the logic in `checks.ts` next to `pathMatches`.

Normalization rules (the canonical form — align on the existing `:`-convention so `isDynamic` keeps working):
- Next.js route files: already mapped `[id]` → `:id` by `nextAppRouterPath`/`nextPagesApiPath`. Add `[...slug]` → a catch-all marker and `[[...slug]]` → an optional-catch-all marker (new, AC5).
- Express: `:id` already preserved verbatim from the route string literal in `app.METHOD(...)` / `router.METHOD(...)`. No change.
- Client template literals (the fix): each `${...}` interpolation occupying a whole segment → a dynamic placeholder segment that `pathMatches` accepts against a route's `:id`/`[id]`; an interpolation embedded inside a larger segment (e.g. `item-${id}`) → that whole segment becomes a dynamic placeholder and the match is flagged candidate (AC6).
- Method comparison stays exact (`GET`/`POST`/`PATCH`/`DELETE`), reusing the existing method extraction the scanner already does for `http:` edges and `parseHttpTargetId`/`parseEndpointDef` in `checks.ts`.

Contract / schema decision:
- Preferred: implement as a **check-time transform only** — no new field on `SutraNode`/`SutraEdge`/`SutraIssue`, no `GRAPH_VERSION` bump. The stored graph keeps real ids/names; matching normalizes on the fly. This honors ROADMAP principle 4 (only bump on breaking change) and principle 3 (stable ids).
- If profiling shows recomputing normalized forms per check is wasteful and a memoized `normalized_path` is persisted, then it is **additive/optional** on `SutraNode`, `GRAPH_VERSION` bumps to `1`, and the view (Story 3.x / current `view.ts`) must tolerate its absence. Default to the no-bump path.

Honesty rules respected: results stay "candidate"; no AI fields introduced (this is a deterministic matcher); ids deterministic; partial-segment interpolation is conservatively widened, never guessed.

## Tasks
- [ ] Rewrite `scanner.ts:extractUrlLiteral`'s `TemplateExpression` branch to traverse `getHead()` + `getTemplateSpans()` and substitute each interpolation with the dynamic placeholder segment instead of truncating at the head; handle the `http://host/...${x}` case by extracting pathname after substitution.
- [ ] Detect and flag mid-segment interpolation (`/api/item-${id}`) → widen the whole segment to a dynamic placeholder and mark the resulting match as candidate.
- [ ] Extend `checks.ts:isDynamic`/`pathMatches` to (a) treat the client placeholder as dynamic, (b) add Next.js `[...slug]`/`[[...slug]]` catch-all matching, while keeping the existing arity + static-segment strictness.
- [ ] Add catch-all derivation to `scanner.ts:nextAppRouterPath`/`nextPagesApiPath` (currently only `[id]` → `:id`).
- [ ] Confirm route/endpoint node `id`/`name` (real `relPath#symbol`) stay unchanged — normalization is matching-time only (AC7, no id drift).
- [ ] (Optional) extract shared normalization into `src/util/routes.ts` (NEW) only if it removes duplication between scanner and checks.
- [ ] Confirm interaction order with 1.1's external-host allowlist so `POST /bot` (Telegram) and other external hosts are never re-flagged.
- [ ] Decide and document the schema choice (no `GRAPH_VERSION` bump vs additive `normalized_path` + bump to `1`); update `src/types.ts` only if the additive path is taken.
- [ ] Re-run `sutra scan` on echo-ai and brain-api; record the before/after `orphaned_endpoint` counts in NOTES.md (extend the existing tables) and note any newly-suppressed-or-still-flagged dynamic calls.
- [ ] Run `npm run build` + full test suite green before commit (ROADMAP principle 7; playbook "tests + build green").

## Test Plan
New fixtures under `tests/fixtures/`:
- `dynamic-next/` — a minimal Next.js App Router tree: `app/api/todos/[id]/route.ts` exporting `GET`/`DELETE`, and a client `components/TodoItem.tsx` calling `fetch(`/api/todos/${id}`)`. **Proves** the dynamic client call matches the dynamic route → zero `orphaned_endpoint`.
- `dynamic-express/` — `server.ts` with `app.get('/todos/:id', ...)` and a client module calling `fetch(`/todos/${id}`)`. **Proves** Express `:seg` convention normalizes and matches.
- `dynamic-mismatch/` — client calls `fetch(`/api/todos/${id}/comments`)` but only `app/api/todos/[id]/route.ts` exists (arity/static-segment mismatch). **Proves** a genuinely orphaned dynamic call is STILL flagged `orphaned_endpoint` (error). This is the core regression guard against over-suppression.
- `dynamic-catchall/` — `app/api/files/[...path]/route.ts` + a client `fetch(`/api/files/${a}/${b}`)`. **Proves** catch-all matching (or the documented conservative degrade from AC5).

New `describe` blocks in `tests/sutra.test.ts`:
- "Section 10 — extractUrlLiteral preserves dynamic segments": unit-asserts `extractUrlLiteral` on a template literal returns `/api/todos/{param}`, not the truncated prefix.
- "Section 11 — dynamic route matching (Next.js + Express)": runs scan on `dynamic-next` and `dynamic-express`, asserts zero `orphaned_endpoint`.
- "Section 12 — dynamic mismatch still flagged": runs scan on `dynamic-mismatch`, asserts the `orphaned_endpoint` issue is present with `severity: "error"` (regression guard).
- Regression: re-run the existing Section 9 `broken` fixture assertion to confirm `POST /api/capture` is still flagged (the static-path orphan path must not regress), and the `proxied` fixture (Section 7) still yields zero issues.

## Out of Scope
- Cross-repo resolution of a dynamic call to a handler in *another* repo (echo-ai → brain-api). That is Story 1.4 (Cross-repo linking) + 2.2 (Client↔server reconciliation). This story matches client↔route **within a single repo** only.
- A confidence score on matched-vs-candidate dynamic routes. That is Story 1.3 (Confidence model); here, partial/mid-segment matches are simply labelled candidate via existing claim-bounds language.
- Query-string and matrix-param semantics, route groups `(group)`, and parallel/intercepting routes (`@slot`, `(.)`); if these appear they are normalized away or ignored conservatively, not matched precisely. Full Next.js advanced-routing fidelity is deferred.
- Express routers mounted via a variable prefix (`app.use(prefix, router)`) — already a documented Phase-0 limitation in README "Claim Bounds"; not solved here.
- Any non-TS/JS language route conventions (Frappe/Python) — Epic 4.2.
