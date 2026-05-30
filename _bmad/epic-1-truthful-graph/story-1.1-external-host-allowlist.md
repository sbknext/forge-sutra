# Story 1.1: External-host allowlist

- **Epic:** Epic 1 — Truthful Graph
- **Status:** Draft
- **Priority:** P0
- **Depends on:** none
- **Estimate:** S

## Story
As an engineer scanning a repo that calls third-party APIs (Telegram Bot API, Stripe, etc.), I want Sutra to recognize external hosts as out-of-repo destinations rather than local routes, so that `fetch`/`axios` calls to external services stop being reported as `orphaned_endpoint` false positives and every remaining orphan is a genuine candidate worth reviewing.

## Context
Phase 0 validation (NOTES.md, "Repo 2: brain-api") found exactly one issue on brain-api's 1,218-node graph: a single `POST /bot` `orphaned_endpoint`. It is a **false positive**. The real code is `fetch(\`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage\`, ...)` in `utils/telegram-alert.js`, `services/telegram-otp.js`, `services/reminder-scheduler.js`, and `routes/payments.js`. The scanner's `extractUrlLiteral` keeps only the static prefix of a template literal, so URL-path extraction yields `/bot`, which then matches no endpoint node and gets flagged. The same class applies to any external host (Stripe, etc.) whose path happens to look like a local route. NOTES.md "Missing Forge Primitives" item #5 ("External host allowlist") names this directly: "distinguishing local routes from external API calls ... requires knowing which URL prefixes are external. Sutra has no such registry."

This is the first story in Epic 1 ("Truthful Graph") and the very first hop on the roadmap's minimum path to the named goal (ROADMAP.md: `1.1 → 1.2 → ...`). The viewer is "worthless if it lies"; killing the `/bot` false positive is the cheapest, highest-signal truth fix available — Phase 0's proxy-blindness fix already eliminated 54 echo-ai false positives, leaving the external-host class as the last known orphan false positive in the validated set.

## Acceptance Criteria
1. The brain-api scan no longer reports `POST /bot` (or any other external-host-derived path) as an `orphaned_endpoint`. brain-api's issue count drops from 1 to 0.
2. `checks.ts:checkOrphanedEndpoints` skips any `http:` edge (`SutraEdge.kind === "http"`) whose destination host is recognized as external, mirroring the existing proxy-prefix skip path already in that function — no new `IssueKind` is introduced.
3. External-host recognition keys on the **host of the original URL literal**, not on the truncated `/bot`-style path. The scanner must preserve enough of the original URL (scheme + host) for the check to make this decision; a bare relative path like `/api/foo` is never treated as external.
4. A built-in registry of common external hosts exists (at minimum `api.telegram.org`, `api.stripe.com`, plus a small curated set), and is the default source of truth when no project config is present.
5. The registry is extended from the scanned project's `package.json` (e.g. a `proxy` string host, and any explicit Sutra config block) and from `next.config.*` rewrite **destinations** whose host is non-local (absolute URLs pointing off-box), reusing the existing `next.config` reader added in the Phase-0 proxy fix in `scanner.ts`.
6. A `localhost`/`127.0.0.1`/loopback destination is **never** classified as external (those are the proxy case already handled, e.g. echo-ai's `destination: 'http://localhost:3457/...'`), so this story does not regress or double-handle the Phase-0 proxy behavior.
7. Determinism is preserved: the same repo at the same commit yields a byte-identical `graph.json` (NodeType/edge ids unchanged, deterministic `relPath#symbol` ids per ROADMAP principle #3). No `GRAPH_VERSION` bump is required because the change suppresses a false-positive issue without altering the schema; if any new field is added to capture external-host provenance, `GRAPH_VERSION` MUST be bumped from `0` and the change recorded.
8. The existing Phase-0 regression guards still pass: the `broken` fixture still emits `orphaned_endpoint` for `POST /api/capture` (genuine local orphan), and brain-dashboard's `missing_handler` for the real broken `ProviderToggle` import is untouched.
9. The HTML view and stdout summary continue to label all surviving results as "heuristic / candidate" — this story removes a known false positive and makes no "finds all bugs" claim.

## Technical Approach
Files changed:
- **`src/util/hosts.ts` (NEW)** — a small, dependency-free module owning the external-host registry and classification. Exports:
  - `DEFAULT_EXTERNAL_HOSTS: ReadonlySet<string>` — curated defaults (`api.telegram.org`, `api.stripe.com`, etc.).
  - `isLoopbackHost(host: string): boolean` — true for `localhost`, `127.0.0.1`, `::1`, `0.0.0.0`.
  - `isExternalHost(host: string, registry: Set<string>): boolean` — false for empty/relative (no host) and loopback; true if `host` (or a parent domain match) is in `registry`.
  - `buildExternalHostRegistry(opts): Set<string>` — merges `DEFAULT_EXTERNAL_HOSTS` with hosts derived from `package.json` (`proxy`, optional `sutra.externalHosts` array) and from non-loopback absolute `next.config.*` rewrite destinations.
- **`src/scanner.ts`** — extend the URL handling so the host is preserved for `http` edges. The Phase-0 `extractUrlLiteral` truncates to `/bot`; capture the original literal's scheme+host alongside the path so the check can classify by host. Reuse the existing `next.config` rewrite reader (the one that emits synthetic `PROXY /api` route nodes) to feed `buildExternalHostRegistry` with off-box rewrite destinations. Read `package.json` once per scan (the scan root already known to the walker). Do not change edge `kind` values or node ids.
- **`src/checks.ts`** — in `checkOrphanedEndpoints`, before emitting an `orphaned_endpoint` for an `http:` edge, add an external-host short-circuit alongside the existing proxy-prefix skip: if the edge's destination host `isExternalHost(host, registry)`, skip silently (same shape as the proxy skip — no issue produced). The registry is computed once per scan and threaded into `runChecks`/`checkOrphanedEndpoints` (constructor arg or options object), not recomputed per edge.

Honesty rules (ROADMAP cross-cutting principles): no overstatement — an external host is *known external*, not *confirmed reachable*; we only suppress the false positive, we do not claim the external call succeeds. Deterministic ids unchanged. Renderer stays a leaf — `view.html` is unaffected because the suppressed issue simply never enters `issues[]`. No AI fields are introduced (this is purely deterministic).

## Tasks
- [ ] Create `src/util/hosts.ts` with `DEFAULT_EXTERNAL_HOSTS`, `isLoopbackHost`, `isExternalHost`, `buildExternalHostRegistry`.
- [ ] In `scanner.ts`, preserve the scheme+host of each `http` edge's original URL literal (extend the current `extractUrlLiteral` path-only output) without changing edge `kind` or node ids.
- [ ] In `scanner.ts`, read the scan root's `package.json` once and extract `proxy` host + optional `sutra.externalHosts`.
- [ ] In `scanner.ts`, reuse the existing `next.config.*` rewrite reader to collect non-loopback absolute rewrite destination hosts and feed them to `buildExternalHostRegistry`.
- [ ] Thread the computed registry into `runChecks` → `checkOrphanedEndpoints` (options/arg, computed once per scan).
- [ ] In `checks.ts:checkOrphanedEndpoints`, add the external-host skip next to the existing proxy-prefix skip; skip silently, emit no issue.
- [ ] Confirm loopback destinations remain handled by the existing proxy path and are never classified external.
- [ ] Add fixtures + describe blocks in `tests/sutra.test.ts` (see Test Plan).
- [ ] Run the full suite (Phase-0 baseline was 34 green) and rescan brain-api to confirm issue count 1 → 0.
- [ ] Update README "Structural checks" / "Claim Bounds" and NOTES.md to mark the `/bot` external-host limitation as resolved; cross-off Missing Primitive #5.

## Test Plan
New fixtures under `tests/fixtures/`:
- **`external-host/`** — a client file with `fetch(\`https://api.telegram.org/bot${TOKEN}/sendMessage\`, ...)` and an `fetch('https://api.stripe.com/v1/charges', ...)`, plus one genuine local orphan `fetch('/api/local-missing', ...)` and no `next.config`. **Proves:** the two external calls produce zero `orphaned_endpoint`, while the genuine local orphan is still flagged — i.e. the allowlist suppresses external hosts only, not real local orphans.
- **`external-host-pkgjson/`** — same external call pattern but the host is supplied only via `package.json` (`proxy` or `sutra.externalHosts`), not in `DEFAULT_EXTERNAL_HOSTS`. **Proves:** `buildExternalHostRegistry` actually reads project config and the registry is the merge of defaults + project.
- **`external-host-loopback/`** (or extend the existing `proxied` fixture) — a `fetch('/api/x')` proxied via `next.config` to a `localhost` destination. **Proves:** loopback is treated as proxy (not external) and the Phase-0 behavior is unchanged.

Describe blocks in `tests/sutra.test.ts`:
- **Section 10 — external-host allowlist:** asserts `external-host` fixture yields zero `orphaned_endpoint` for the telegram + stripe calls and exactly one for the genuine local orphan.
- **Section 11 — registry from package.json:** asserts `external-host-pkgjson` suppresses the configured host and that an *unconfigured* external host in the same fixture (if present) behaves per defaults.
- **Regression guard (extend existing Section 9):** the `broken` fixture still emits `orphaned_endpoint` for `POST /api/capture`; assert the brain-dashboard `missing_handler` path and the Phase-0 `proxied` fixture (zero orphans) remain green. Add an explicit determinism check: scanning the `external-host` fixture twice produces identical `graph.json` node/edge id sets.

## Out of Scope
- **Dynamic-segment URL matching** (`fetch(\`/api/todos/${id}\`)` ↔ `app/api/todos/[id]/route.ts`) — that is the template-literal/dynamic-route limitation, owned by Story 1.2 (dynamic-segment route matcher).
- **Cross-repo confirmation** — resolving echo-ai's proxied `/api/*` calls to real brain-api handlers is Story 1.4 (cross-repo linking). This story only stops *external* hosts from being flagged; it does not confirm that any external or proxied call actually exists at its destination.
- **Confidence scoring** — attaching a numeric confidence/provenance to the suppression decision is Story 1.3 (confidence model). Here the decision is binary skip/keep.
- **Verifying external endpoints are live** — Sutra never executes code or hits the network (Claim Bounds); "external host" means "out of this repo", not "reachable".
- **A general extractor/registry as a Forge SDK primitive** — extracting this as `forge.repo` / a shared host registry primitive is Epic 4 (4.3 Forge SDK extraction).
