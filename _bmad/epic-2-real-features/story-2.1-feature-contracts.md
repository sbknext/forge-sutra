# Story 2.1: feature.sutra.md contracts

- **Epic:** Epic 2 — Real features (the North Star)
- **Status:** Draft
- **Priority:** P1
- **Depends on:** none (builds on the shipped Phase-0 graph; does not require Story 2.2/2.3)
- **Estimate:** L

## Story
As a developer who knows what my product is *supposed* to do, I want to declare features in an optional `feature.sutra.md` file and have `sutra scan` reconcile each declared feature against the code-derived graph, so that the graph can finally say "this cluster of code **is** the Checkout feature" with `confirmed` status — and honestly flag features I claimed but the scanner couldn't find, and code clusters nobody declared.

## Context
Phase 0 features are produced by `buildFeatures` in `src/features.ts`, which groups nodes purely by their heuristic `SutraNode.feature` id (derived from a file's top-level directory / Next.js route segment via `featureFor` in `scanner.ts`) and carries no notion of declared intent, owner, or confidence. BRIEF.md "Out of scope (do NOT build)" explicitly defers `feature.sutra.md` contract files to "Phase 1," and ROADMAP.md Epic 2 lists **2.1** as "`feature.sutra.md` contracts (optional hand/AI-authored intent layer over heuristic groups)." This story builds exactly that deferred item.

The Phase-0 heuristic is too coarse to make an honest product claim: a `SutraFeature` today is just `{ id, label, node_ids[], issue_count }` — a directory bucket, not a capability, with no way to say "these nodes ARE the Checkout feature, and here is who owns it and what it should expose." The roadmap's Definition of Done wants the viewer to learn "something true-and-new about the product"; a declared-vs-derived reconciliation is the cheapest layer that lets a human assert intent and have Sutra confirm or refute it against code.

This story adds that layer — and nothing more. Per ROADMAP.md cross-cutting Principle 2 ("Code-derived first. Hand/AI contracts are an *optional* layer, never a prerequisite"), a repo with zero contracts must keep producing exactly the graph it produces today. The contract is purely additive: it reconciles, it never blocks. It also lets Sutra emit its first `confirmed` feature — respecting Principle 1 ("Never overstate. Candidate stays candidate until confirmed") — by reserving `confirmed` for a declared feature whose claimed code actually exists in the graph.

## Acceptance Criteria
1. `sutra scan` discovers `feature.sutra.md` files anywhere under the scanned `repoRoot` (read-only; parsed as text/front-matter, never executed; `EXCLUDED_DIRS` from `types.ts` are skipped) and reconciles each declared feature against the nodes in the graph. If zero contract files exist, `features[]` and `issues[]` are byte-identical to today's output (the only `graph.json` deltas being `version` and `scanned_at`) — verified by a regression test.
2. A new optional `SutraFeature.source` field distinguishes provenance: `'derived'` (from `buildFeatures`) vs `'declared'` (from a contract). Absent `source` is read as `'derived'` for backward compatibility. `GRAPH_VERSION` is bumped from `0` to `1` in `src/types.ts` and the README `graph.json schema` section + the `version: 0` example are updated to match.
3. A declared feature that matches at least one node in the graph is emitted with `confidence: 'confirmed'` on the feature. This is the ONLY path that produces `confirmed` in `features[]`; every `buildFeatures`-derived feature stays implicitly `candidate` (no `confidence` field, or `'candidate'`).
4. A declared feature with no matching node is emitted with `reconciliation.status: 'declared-not-found'` AND a `SutraIssue` of a new `IssueKind` `'declared-feature-unmatched'` (severity `warn`), so the claim is surfaced honestly rather than silently dropped. The three reconciliation states are `confirmed`, `declared-not-found`, and `undeclared` (the last for derived clusters no contract claims).
5. Each declared feature carries its declared fields (intent, owner, expected endpoints) and a `provenance` recording the source `feature.sutra.md` file + line. AI-authored contracts are permitted as input, but the *matching* logic is deterministic — same repo + same contract files in → identical `features[]`/`issues[]` out across two scans (modulo `scanned_at`).
6. Feature ids stay deterministic and stable. Declared-feature ids are derived from the declared `name` via a documented slug rule (reuse the existing `toPosix`/slug style; add a small `featureSlug(name)` helper rather than inventing a hashing scheme). A derived feature whose nodes are fully claimed by a declared one is not silently renamed — overlaps resolve by a documented, stable rule (**declared wins**; the unclaimed remainder of a derived cluster stays as an `undeclared` derived feature), never by iteration order.
7. Expected-endpoint reconciliation matches a declared endpoint (e.g. `POST /checkout`) to `endpoint`/`route`-type `SutraNode`s by their METHOD+path **name** (the same `"GET /api/foo"` form Sutra already stores in `SutraNode.name`), not by raw node id. Matched and unmatched expected endpoints are both recorded on the feature's reconciliation detail.
8. `tests/sutra.test.ts` gains a `describe("contracts — feature.sutra.md", …)` block proving: contract discovery, the three reconciliation states, the bumped `GRAPH_VERSION`, and the zero-contract regression guard. Re-running scan on the contract fixture yields identical `features[]`/`issues[]` (modulo `scanned_at`).

## Technical Approach
- **New file `src/contracts.ts`** — owns contract discovery + parsing + reconciliation. It imports only from `./types.js` and `./util/ids.js` (no Brain runtime — BRIEF.md hard constraint), and performs read-only fs access only (no code execution):
  - `findContractFiles(repoRoot: string): string[]` — walk the tree (mirror the `collectFiles(root)` walker already in `scanner.ts`, reusing `EXCLUDED_DIRS` from `types.ts`), collect files named `feature.sutra.md`, return them **sorted** for determinism.
  - `parseContract(absPath: string, repoRoot: string): DeclaredFeature[]` — parse a documented front-matter shape (`name`, `intent`, `owner`, `expectedEndpoints: string[]`) from the markdown. Pure text parse; on a malformed file, skip it and (optionally) emit an `info`/`warn` issue rather than throwing — a bad contract must never crash a scan (Principle 2: never gate the core).
  - `reconcileFeatures(derived: SutraFeature[], declared: DeclaredFeature[], nodes: SutraNode[]): { features: SutraFeature[]; issues: SutraIssue[] }` — produce the merged, **id-sorted** `features[]` (matching the sort in `features.ts:buildFeatures`) plus any `declared-feature-unmatched` issues. New types added in `contracts.ts`: `interface DeclaredFeature { name; intent?; owner?; expectedEndpoints?: string[]; provenance: Provenance }`.
- **`src/types.ts` contract changes (bump `GRAPH_VERSION` 0 → 1):**
  - Add an optional `Confidence = "candidate" | "confirmed"` union and an optional `Provenance = { file: string; line: number }` interface.
  - Extend `SutraFeature` with optional fields (all optional → backward-safe): `source?: "derived" | "declared"`, `confidence?: Confidence`, and `reconciliation?: { status: "confirmed" | "declared-not-found" | "undeclared"; intent?: string; owner?: string; expectedEndpoints?: string[]; matchedEndpoints?: string[]; unmatchedEndpoints?: string[]; provenance?: Provenance }`.
  - Extend the `IssueKind` union with `"declared-feature-unmatched"`.
  - Keep `Confidence` two-valued. A numeric 0–1 score is ROADMAP Epic 1.3 / Epic 2.4, explicitly out of scope here.
- **`src/util/ids.ts`** — add `featureSlug(name: string): string` (lowercase, collapse non-alphanumerics to `-`, trim) so declared-feature ids are deterministic and human-stable. No hashing; consistent with the existing plain-text id style (`makeNodeId`, `httpTargetId`).
- **`src/cli.ts` wiring** — in `cmdScan`, after `const features = buildFeatures(nodes, issues);`, call `contracts.findContractFiles(repoRoot)`. If empty, leave `features`/`issues` untouched (AC #1). Otherwise parse + `reconcileFeatures(...)`, then assign the merged `features` and append the returned contract `issues` to `issues` **before** the `graph` object is assembled. `runChecks` and `buildFeatures` are not modified — reconciliation is a post-pass, keeping the renderer/leaf contract intact (Principle 5).
- **Endpoint matching** — compare each declared `expectedEndpoints[]` entry (normalized METHOD+path, e.g. `POST /checkout`) against `SutraNode.name` for nodes of type `endpoint`/`route`. This reuses the exact METHOD+path string form Sutra already emits, so no new id scheme is needed.
- **Honesty rules respected:** declared features that match earn `confidence: "confirmed"`; declared-but-missing produce a `warn` issue and a `declared-not-found` status, never silently dropped; AI-authored contracts are permitted as input but the reconciliation that grants `confirmed` is deterministic structural matching, so an AI guess can never be laundered into a `confirmed` claim. No "finds bugs" / "dead code" / "auto-fix" verdicts introduced (BRIEF.md claim bounds).

## Tasks
- [ ] Define the `feature.sutra.md` on-disk format (front-matter: `name`, `intent`, `owner`, `expectedEndpoints[]`) and document it in README.md under a new "Contracts (optional)" section.
- [ ] Bump `GRAPH_VERSION` 0 → 1 in `src/types.ts`; add `Confidence`, `Provenance`, the `SutraFeature.source`/`confidence`/`reconciliation` optional fields, and the `"declared-feature-unmatched"` `IssueKind`.
- [ ] Add `featureSlug(name)` to `src/util/ids.ts`.
- [ ] Create `src/contracts.ts` with `findContractFiles`, `parseContract`, `reconcileFeatures` (all read-only, deterministic, sorted; bad contract never throws).
- [ ] Wire `contracts.ts` into `src/cli.ts:cmdScan` after `buildFeatures`, guarded by "skip when no contract files" so zero-contract output is unchanged.
- [ ] Implement endpoint reconciliation: match declared `expectedEndpoints` to `endpoint`/`route` nodes by METHOD+path name, recording matched/unmatched on the feature.
- [ ] Implement the declared-vs-derived merge rule (declared wins; unclaimed remainder of a derived cluster stays an `undeclared` derived feature) deterministically.
- [ ] Emit `declared-feature-unmatched` `warn` issues for declared features with no node match.
- [ ] Update README.md schema section: `version: 1`, new `SutraFeature` fields, new `IssueKind`, new "Contracts (optional)" docs (respecting claim bounds — no overstated language).
- [ ] Add fixtures + `describe("contracts — feature.sutra.md", …)` tests (see Test Plan).
- [ ] Run `npm test` + a manual self-scan on a contract-free repo to confirm `features[]`/`issues[]` are unchanged except the `version` bump and `scanned_at`.

## Test Plan
New fixtures under `tests/fixtures/` (alongside the existing `broken`, `clean`, `proxied`, `assets`):
- `tests/fixtures/contract-confirmed/` — a small repo with a real `POST /checkout` endpoint/route node **and** a `feature.sutra.md` declaring a `Checkout` feature with `expectedEndpoints: ["POST /checkout"]`. Proves: feature emitted with `source: "declared"`, `confidence: "confirmed"`, `reconciliation.status: "confirmed"`, and `POST /checkout` appears in `reconciliation.matchedEndpoints`.
- `tests/fixtures/contract-declared-not-found/` — a `feature.sutra.md` declaring a `Billing` feature whose `expectedEndpoints` point at an endpoint that does not exist in the code. Proves: feature emitted with `reconciliation.status: "declared-not-found"` **and** a `declared-feature-unmatched` `SutraIssue` of severity `warn`; the missing endpoint appears in `unmatchedEndpoints`.
- `tests/fixtures/contract-none/` — reuse the spirit of the existing `clean` fixture but assert the additive guarantee: a repo with **no** `feature.sutra.md`. Regression guard: `features[]` and `issues[]` equal those produced when contract reconciliation is skipped, and two scans are identical modulo `scanned_at`. This is the executable proof of ROADMAP Principle 2 (contracts never gate the core).

New `describe("contracts — feature.sutra.md", …)` block in `tests/sutra.test.ts` (following the existing fixture-constant + `scan`→`runChecks`→`buildFeatures` pattern) with `it()` cases:
- discovers `feature.sutra.md` files under root and ignores `EXCLUDED_DIRS` (e.g. a copy inside `node_modules/` is not picked up).
- confirmed reconciliation sets `confidence: "confirmed"` + `source: "declared"` + matched endpoint listed.
- declared-not-found sets `reconciliation.status: "declared-not-found"` and produces the new `warn` issue kind.
- `GRAPH_VERSION === 1` asserted (update any existing version assertion).
- a malformed `feature.sutra.md` does not throw — scan still completes.
- **regression:** scanning `contract-none` yields `features[]` identical to the contract-free path and an identical second run (modulo `scanned_at`).

## Out of Scope
- Numeric 0–1 confidence scoring of features/edges — ROADMAP Epic 1.3 (confidence model) / Epic 2.4 (feature health score).
- Client↔server reconciliation matching every client call to a real handler across repos — ROADMAP Epic 2.2 (depends on 1.4 cross-repo linking).
- AI inference that *names/summarizes* features from a node cluster — ROADMAP Epic 2.3 (this story only reconciles human/AI-*declared* contracts, it does not generate them).
- Rendering declared features as a distinct lens in `view.html` (`src/view.ts`) — Epic 3 viewer work; this story changes only the `graph.json` data contract and may leave the renderer rendering features generically.
- Sutra *writing* `feature.sutra.md` files — Sutra only reads and reconciles contracts here.
- Any non-structural / semantic matching (dataflow, taint, runtime behavior) — permanently a non-goal per BRIEF.md claim bounds.
