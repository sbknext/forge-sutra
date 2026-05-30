# Story 2.3: AI Feature Inference

- **Epic:** Epic 2 — Real Features
- **Status:** Draft
- **Priority:** P2
- **Depends on:** 1.3 (Confidence model + provenance — supplies the `provenance` field convention this story stamps as `ai-inferred`)
- **Estimate:** M

## Story
As a developer looking at a scanned repo, I want each feature to carry a human-meaningful name
and a one-line summary inferred by an LLM from the feature's own node cluster, so that the
feature grid reads like a product map ("Authentication", "Chat sessions") instead of raw
directory-prefix labels ("auth", "components") — while staying honest that those names are
machine-guessed, not confirmed.

## Context
Today `features.ts:buildFeatures` derives every feature's `label` purely mechanically:
`toTitleCase(id)` turns the heuristic directory-prefix id (`featureFor` in scanner.ts — e.g.
`components`, `api`, `chat`) into `Components`, `Api`, `Chat`. The roadmap's North Star is a
*realistic feature viewer* that lets a human "see your product as features". A directory prefix
is not a feature name; "components" tells a reader nothing about what the product does. ROADMAP.md
Epic 2 line **2.3** asks the LLM to "name + summarize features from their node cluster — labelled
AI". This story delivers that naming/summary layer.

Two cross-cutting principles from ROADMAP.md govern this work and must not be bent. Principle 1
("Never overstate … Every AI-derived field labelled AI") means any name or summary the model
produces must be explicitly marked as AI-inferred in graph.json and in the view; the heuristic
`id` stays as the stable key. Principle 2 ("Code-derived first … Hand/AI contracts are an
*optional* layer, never a prerequisite") means the scan must produce a complete, correct
graph.json with **no** LLM call by default: offline, no-API-key, or LLM-error all fall back to the
existing heuristic `toTitleCase` label. This also keeps Phase-0 hard constraints intact — `scan`
remains usable headless and deterministic when AI is off (BRIEF.md "Manual trigger only";
README.md Claim Bounds "No code is executed").

## Acceptance Criteria
1. A new opt-in flag `sutra scan --ai` (wired in `cli.ts` via commander, alongside the existing
   `--watch` option) enables LLM feature inference. Without the flag, behaviour is byte-for-byte
   identical to today (heuristic labels only, no network call).
2. The graph.json contract (`src/types.ts` `SutraFeature`) gains three additive, optional fields:
   `ai_name?: string`, `ai_summary?: string`, and `label_source: "heuristic" | "ai-inferred"`.
   `label` (the existing field) is never overwritten — it always keeps the deterministic
   `toTitleCase(id)` value so the stable heuristic name survives even when AI is on.
3. When `--ai` is OFF (default), every feature has `label_source: "heuristic"` and
   `ai_name`/`ai_summary` absent (or `undefined`). When `--ai` is ON and inference succeeds for a
   feature, that feature has `label_source: "ai-inferred"`, a non-empty `ai_name`, and a non-empty
   one-line `ai_summary`.
4. **Offline / no-key fallback is mandatory:** if `--ai` is set but no API key is present in the
   environment, or the LLM call throws / times out / returns unparseable output, the affected
   feature keeps `label_source: "heuristic"` with its `toTitleCase` label and no `ai_name`. The
   scan still completes successfully (non-zero exit only on genuine scan failure, never on a missing
   key). A clear stderr note explains AI was skipped and why.
5. The LLM is given only **structural context already in the graph** — the feature `id`, its member
   node names/types/files, and representative edges — never raw source file contents. This keeps the
   tool a structural analyzer (BRIEF.md: "No code is executed") and bounds token cost.
6. Inference is per-feature and resilient: one feature's failed/empty response does not abort the
   others; each feature is resolved independently to `ai-inferred` or `heuristic`.
7. `ai_name` and `ai_summary` are length-bounded and single-line (summary trimmed to one sentence /
   a hard char cap) so the viewer's feature card layout is not broken by a runaway response.
8. `view.ts:renderView` displays the `ai_name` as the feature heading **only when**
   `label_source === "ai-inferred"`, with a visible "AI" / "ai-inferred" badge next to it and the
   `ai_summary` beneath; when `label_source === "heuristic"` it renders the existing `label`
   unchanged with no AI badge. The existing "heuristic / candidate" framing of the view is preserved.
9. Deterministic ids are untouched: `SutraFeature.id`, every `node_ids` entry, and all
   `makeNodeId`-derived ids remain exactly as today, so `sutra diff` / history (roadmap 1.6 / 4.5)
   keep working regardless of AI naming.

## Technical Approach
- **New file `src/ai/infer-features.ts`** (NEW). Exports
  `inferFeatureLabels(graph: SutraGraph, opts: { enabled: boolean }): Promise<SutraFeature[]>`.
  When `opts.enabled` is false it returns `graph.features` unchanged (each stamped
  `label_source: "heuristic"`). When enabled, for each `SutraFeature` it builds a compact
  structural prompt from the feature's `node_ids` resolved against `graph.nodes` (collect each
  node's `name`, `type`, `file`; sample a handful of `graph.edges` touching those nodes), asks the
  LLM for a JSON `{ name, summary }`, validates + trims the response, and sets `ai_name`,
  `ai_summary`, `label_source: "ai-inferred"`. Any error path leaves the feature at
  `label_source: "heuristic"`.
- **New file `src/ai/llm.ts`** (NEW). A tiny provider shim: reads the API key from env
  (e.g. `SUTRA_AI_API_KEY` / a documented provider key), exposes
  `isLlmAvailable(): boolean` and `complete(prompt): Promise<string>`. `isLlmAvailable()` returning
  false is the offline/no-key gate that drives the fallback in AC-4. No key literals ever logged
  (mask per repo security rule). Network/timeout errors are caught here and surfaced as thrown
  errors the caller treats as "fall back to heuristic".
- **`src/types.ts`** — extend `SutraFeature` with the three optional fields in AC-2. Because all
  three are additive and optional (`label` semantics unchanged, old readers ignore unknown keys),
  this is a **non-breaking** schema change: `GRAPH_VERSION` stays `0`. Add a code comment noting
  that any future change to `label` semantics WOULD require a `GRAPH_VERSION` bump per ROADMAP.md
  Principle 4.
- **`src/features.ts:buildFeatures`** — set `label_source: "heuristic"` on every feature at
  construction time (default). `label` continues to be `toTitleCase(id)`. No AI logic lives here;
  `buildFeatures` stays pure and synchronous.
- **`src/cli.ts:cmdScan`** — add the `--ai` option to the `scan` command. After
  `buildFeatures(...)`, if `--ai` is set, `await inferFeatureLabels(graph, { enabled: true })` and
  replace `graph.features` with the result before writing graph.json. `cmdScan` becomes `async`
  (or wraps the await) only on the AI path; the default path stays synchronous and unchanged.
  Print a one-line summary of how many features were AI-named vs left heuristic, and the
  skip-reason if AI was requested but unavailable.
- **`src/view.ts:renderView`** — in the feature grid, branch on `label_source`: render `ai_name`
  + an "ai-inferred" badge + `ai_summary` when AI, else the current `label`. Keep the page's
  existing "heuristic / candidate" disclaimer.
- **Honesty rules respected:** the heuristic `id`/`label` are never destroyed (candidate stays
  candidate); AI output is always badged and confined to clearly-named `ai_*` fields; ids stay
  deterministic; AI is strictly optional and off by default.

## Tasks
- [ ] Extend `SutraFeature` in `src/types.ts` with `ai_name?`, `ai_summary?`, `label_source`
      (optional/additive; document why `GRAPH_VERSION` stays `0`).
- [ ] Set `label_source: "heuristic"` default in `src/features.ts:buildFeatures`; confirm `label`
      stays `toTitleCase(id)`.
- [ ] Add `src/ai/llm.ts`: `isLlmAvailable()` + `complete(prompt)` with env-key read, timeout, and
      caught network errors; never log key material.
- [ ] Add `src/ai/infer-features.ts`: per-feature structural prompt builder (names/types/files +
      sampled edges, no source bodies), JSON response parse + trim, per-feature try/catch fallback.
- [ ] Add `--ai` option to the `scan` command in `src/cli.ts`; await inference on the AI path only;
      replace `graph.features` before write.
- [ ] Add stderr/skip messaging: report AI-named vs heuristic counts and the reason AI was skipped
      (offline / no key / error).
- [ ] Update `src/view.ts:renderView` to show `ai_name` + AI badge + `ai_summary` when
      `label_source === "ai-inferred"`, else the existing `label`.
- [ ] Enforce single-line, length-capped `ai_name`/`ai_summary` (trim + hard cap) so cards don't break.
- [ ] Update README.md (`graph.json schema` → `SutraFeature`, plus a `--ai` note under `sutra scan`
      Options) and add an entry to NOTES.md "Missing Forge Primitives" for a shared LLM client.
- [ ] Add tests + fixtures (see Test Plan); ensure `vitest` + build stay green before commit.

## Test Plan
Add a new describe block (Section 10) in `tests/sutra.test.ts`. AI inference must be tested
**without a live network call** — inject a fake LLM (a stub `complete` / dependency-injected
provider) so tests are deterministic and offline, in keeping with the existing offline test suite.

- **New fixture `tests/fixtures/ai-features/`** — a tiny repo with two clearly-distinct heuristic
  feature clusters (e.g. an `auth/` group with a login component + an OTP fetch, and a `chat/`
  group with a session list component). Proves the cluster passed to the prompt builder contains
  the right node names/types/files per feature.
- **Default-off determinism:** `scan` + `buildFeatures` on `ai-features` (no `--ai`, no AI call)
  yields every feature with `label_source === "heuristic"`, `ai_name` absent, and `label` equal to
  `toTitleCase(id)`. Two runs produce identical feature arrays (extends the existing
  "deterministic ids" guarantee to the new fields).
- **AI-on success path (stubbed LLM):** with a fake `complete` returning valid
  `{ name, summary }` JSON, `inferFeatureLabels(graph, { enabled: true })` returns features with
  `label_source === "ai-inferred"`, non-empty `ai_name`/`ai_summary`, and **unchanged** `id`,
  `label`, and `node_ids` (regression guard on AC-9 / determinism).
- **No-key / offline fallback:** with `isLlmAvailable()` forced false (or `complete` throwing),
  `inferFeatureLabels(graph, { enabled: true })` returns every feature at
  `label_source === "heuristic"` with no `ai_name`, and does not throw — proves AC-4.
- **Per-feature resilience:** stub `complete` to succeed for the first feature and throw/return
  garbage for the second; assert the first is `ai-inferred` and the second falls back to
  `heuristic`, with all other features unaffected.
- **Length bound:** stub `complete` to return an overlong multi-line summary; assert the stored
  `ai_summary` is single-line and within the char cap.
- **Regression guard:** existing Sections 1–9 stay green; specifically the `clean` and `broken`
  fixtures, run without `--ai`, produce the same node/edge/issue/feature results as before
  (no behavioural drift when AI is off).

## Out of Scope
- **No LLM-authored feature contracts.** Generating or persisting a `feature.sutra.md` intent file
  is Story 2.1; this story only names/summarizes existing heuristic feature groups in graph.json.
- **No AI-derived issues, edges, or node types.** The model touches feature naming only; it never
  creates or labels structural findings (those stay code-derived per BRIEF.md claim bounds).
- **No regrouping of nodes into features.** The clustering stays the heuristic `featureFor`
  directory-prefix grouping; smarter (AI) feature *boundaries* are a later concern, not this story.
- **No flow tracing, health score, or reconciliation** — those are Stories 2.2 / 2.4 / 2.5.
- **No provider/model registry UI or multi-provider config** — a single documented env-keyed
  provider is enough; a richer client belongs to the Forge SDK extraction (Epic 4.3 / NOTES.md
  "Missing Forge Primitives").
- **No `GRAPH_VERSION` bump** — the schema change is purely additive; bump only if a future story
  changes existing field semantics.
