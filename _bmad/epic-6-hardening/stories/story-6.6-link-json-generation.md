# Story 6.6: link.json generation (cross-repo / bench-merge)

- Epic: Epic 6 — Hardening
- Status: Draft
- Priority: P1
- Depends on: 6.5 (honest empty-state for the viewer Ecosystem tab)
- Estimate: M

## Story

As a Forge user inspecting a multi-app Frappe bench (e.g. swifter-flows, a smart-merge of three bench apps), I want `sutra scan` to write a `.sutra/link.json` describing the cross-app edges between the merged graphs, so that the viewer's Ecosystem tab renders a real cross-repo picture (confirmed / broken / unresolved) instead of returning 404.

## Context

`src/link.ts` already exports `linkGraphs(...)`, which computes cross-graph edges between two or more per-app graphs by matching call/import/http targets across `app::` boundaries. But **nothing in the pipeline ever calls it and nothing ever writes its output to disk.** Concretely:

- `src/cli.ts` wires the `scan` command. On scan it writes the per-feature graph and flows into `.sutra/` (the graph + flows artifacts), but there is no step that invokes `linkGraphs` and no write of a `link.json` artifact. There is also no `link` subcommand.
- `src/viewer/server.ts` exposes a route for `/link.json` (the Ecosystem tab fetches it). When the file is absent the server returns **404**, which is exactly what the real swifter-flows scan produced — the Ecosystem tab was empty because the artifact was never generated.

Evidence from the real scan (swifter-flows, three Frappe bench apps, feature `sw_inventory_retrun_flow`): 22 nodes (10 endpoint, 9 function, 3 module), 19 edges all `kind=imports`, `flows=0`, and `/link.json` → 404 ("never generated"). The flows-and-edges gap is the subject of sibling stories; **this story is scoped strictly to the missing artifact**: there is link-computation code (`linkGraphs`) and a viewer endpoint, but no producer in between.

The honesty contract (per ROADMAP principles and the Epic 6 theme) means the artifact must classify each cross-app edge as `confirmed` / `broken` / `unresolved` and must never claim a link it cannot ground. For a single-repo scan there are no cross-app boundaries, so the correct output is a **valid empty `link.json`** (not a missing file) so the viewer can render the honest empty-state from 6.5 instead of a 404.

## Acceptance Criteria

1. A new module-level constant `LINK_FILE` (the on-disk artifact name, e.g. `link.json` under the existing `.sutra/` output directory) is defined and used by both the writer in `src/cli.ts` and the reader in `src/viewer/server.ts` — no string literal duplicated across the two.
2. `sutra scan` invokes `linkGraphs` over the set of per-app sub-graphs whenever the merged graph spans **more than one** distinct `app::` namespace (detected from `SutraNode` ids via the `app::path#symbol` scheme produced by `makeNodeId`), and writes the result to `LINK_FILE`.
3. When the merged graph spans exactly **one** `app::` namespace (single-repo), `sutra scan` writes a **valid, schema-conformant but empty** `link.json` (empty edge list, populated metadata) rather than skipping the write — so the viewer never 404s post-scan.
4. A `sutra link` subcommand exists in `src/cli.ts` that (re)generates `LINK_FILE` from already-scanned per-app graphs without re-running extraction, producing byte-identical output to what `scan` would write for the same inputs (deterministic).
5. Every cross-app edge in `link.json` carries an honest status of exactly one of `confirmed` / `broken` / `unresolved`, derived from whether `linkGraphs` resolved the target node id on the far side of the boundary; unresolved/dynamic targets are emitted as `unresolved` (or omitted), never silently upgraded to `confirmed`.
6. Cross-app edge endpoints reference node ids built with `makeNodeId` (i.e. the `app::path#symbol` scheme) so the viewer can join them against the loaded graph nodes; ids are stable across runs given identical inputs.
7. Cross-app edges use a `SutraEdge.kind` value consistent with their origin (`calls` / `http` / `imports`); the writer does not invent a new edge kind outside the existing `EdgeKind` union, and does not fabricate `calls`/`http` edges that `linkGraphs` did not actually resolve.
8. `src/viewer/server.ts` serves the generated `LINK_FILE` over `/link.json` with HTTP 200 and the correct content type when present; the empty-but-valid case (AC3) also returns 200 with an empty edge set so the Ecosystem tab shows the 6.5 empty-state, not a 404.
9. `GRAPH_VERSION` is bumped **only if** the on-disk graph/flows contract changes; since this story only adds a sibling `link.json` artifact and does not alter the existing graph or flows schema, `GRAPH_VERSION` stays unchanged and the addition is documented as additive.

## Technical Approach

Parity target is `src/extractors/ts.ts` only in spirit (honest, candidate-not-confirmed, deterministic ids); this story touches the pipeline and viewer, not the extractors.

**Where edges come from.** `linkGraphs` in `src/link.ts` already does the matching. The job is to feed it and persist its result:

- In `src/cli.ts`, after the per-app graphs are built and merged for the scanned feature, group nodes by their `app::` prefix (parsed from the `makeNodeId` id scheme; `relPosix`/`httpTargetId` in `src/util/ids.ts` define how those ids are formed). If the distinct-app count is `> 1`, call `linkGraphs(subGraphs)`; otherwise construct the empty result object directly.
- Write the result with `LINK_FILE` to the same `.sutra/` output directory the existing graph/flows artifacts go to. Reuse the existing `mkdir`/`writeFile` path so the directory is guaranteed to exist.

**Edge shape.** Each cross-app edge keeps `SutraEdge.kind` ∈ existing `EdgeKind` union (`calls` | `http` | `imports`), with `from`/`to` as `makeNodeId`-formed ids. The honesty status (`confirmed` / `broken` / `unresolved`) is taken from `linkGraphs`' own resolution result: a far-side id that resolves to a real node ⇒ `confirmed`; a far-side id that names a target which should exist but doesn't ⇒ `broken`; a dynamic/unresolvable target ⇒ `unresolved` (or dropped). No upgrading of unresolved → confirmed; no synthesis of edges `linkGraphs` did not return.

**Determinism.** Sort the emitted edge list by a stable composite key (`from`, then `to`, then `kind`) before writing so `scan` and `link` produce byte-identical files for identical inputs (AC4). Sort node/app metadata likewise.

**`link` subcommand.** Mirror the existing command-registration style in `src/cli.ts`. It loads the already-written per-app graph artifacts from `.sutra/`, runs the same group-by-app + `linkGraphs` + write logic, and emits to `LINK_FILE`. Factor the "compute + serialize link result" step into a single helper so `scan` and `link` share it (single source of truth, guarantees byte-identical output).

**Viewer.** In `src/viewer/server.ts`, the `/link.json` handler reads `LINK_FILE` from the artifact directory and returns 200 + JSON when present (including the empty case). The existing 404 branch remains only for the genuinely-never-scanned case, which 6.5 covers for the empty-state UX.

**Flows interaction.** `src/flows.ts` traces over `FLOW_KINDS` (`renders` | `calls` | `http`) within a single graph; `link.json` is a separate cross-graph artifact and does **not** feed `flows.ts`. This story does not change flow tracing. The renderer remains a leaf.

**Version.** No change to the graph/flows on-disk schema ⇒ `GRAPH_VERSION` unchanged (AC9). The `link.json` artifact is additive.

## Tasks

- [ ] Add `LINK_FILE` constant in a shared location and import it in both `src/cli.ts` and `src/viewer/server.ts`.
- [ ] In `src/cli.ts`, add a helper that groups merged nodes by `app::` prefix (parsed via the `makeNodeId` scheme) and returns the distinct-app set.
- [ ] Add a shared `computeAndSerializeLink(subGraphs)` helper that calls `linkGraphs` (multi-app) or builds the empty result (single-app), sorts edges/metadata for determinism, and returns the serializable object.
- [ ] Wire `scan` to call the helper after merge and write `LINK_FILE` to the existing `.sutra/` output dir (reusing the current `mkdir`/`writeFile` path).
- [ ] Add the `sutra link` subcommand in `src/cli.ts` that loads existing per-app graph artifacts and writes `LINK_FILE` via the same shared helper.
- [ ] Ensure each emitted cross-app edge carries `from`/`to` as `makeNodeId` ids, a valid `SutraEdge.kind`, and a `confirmed`/`broken`/`unresolved` status sourced from `linkGraphs`' resolution (no upgrades, no fabrication).
- [ ] Update `src/viewer/server.ts` `/link.json` handler to serve `LINK_FILE` with 200 + JSON when present (empty case included); keep 404 only for never-scanned.
- [ ] Confirm `GRAPH_VERSION` is unchanged and add a short comment/doc note that `link.json` is an additive artifact.
- [ ] Add the Test Plan fixture and tests below; run the suite.
- [ ] Manually verify against a two-app fixture scan that `/link.json` returns 200 with classified edges and a single-app scan returns 200 with an empty edge set.

## Test Plan

Add a Python/Frappe fixture under `tests/fixtures/` representing two bench apps so a real cross-app boundary exists, plus a single-app fixture for the empty case.

**Fixture A — `tests/fixtures/link-twoapp/` (multi-app):**
- `app_a/` with a `@frappe.whitelist()` endpoint that calls a handler in the same app, and that handler imports + calls a helper located in `app_b/`.
- `app_b/` with the helper function that is the cross-app call target.
- This yields at least one cross-app edge whose far side resolves ⇒ status `confirmed`, and (deliberately) one call to a name in `app_b` that does not exist ⇒ status `broken`.

**Fixture B — `tests/fixtures/link-singleapp/` (single-app):**
- One Frappe app with an endpoint → handler → helper chain, all within one `app::` namespace.

**Tests and what each asserts:**

1. `scan` over Fixture A writes `LINK_FILE`; assert the file exists and parses as JSON.
2. Assert the link result contains ≥1 edge with status `confirmed` whose `to` is a `makeNodeId`-formed id resolving to the `app_b` helper node, and that its `from` resolves to the `app_a` handler.
3. Assert the deliberately-missing cross-app call is emitted with status `broken` (or dropped), and that **no** edge is emitted with status `confirmed` for an unresolved target (honesty guard).
4. Assert every emitted edge's `kind` is within the existing `EdgeKind` union (`calls` | `http` | `imports`).
5. `scan` over Fixture B writes a **valid empty** `LINK_FILE`: assert the file exists, parses, and has an empty edge list with populated metadata (no missing file, no null).
6. Determinism: run `scan` twice on Fixture A and assert byte-identical `LINK_FILE`; run `sutra link` on the already-scanned Fixture A and assert it produces byte-identical output to `scan`.
7. Viewer: with Fixture A's `LINK_FILE` present, assert `/link.json` returns 200 + JSON; with the file absent (pre-scan), assert it returns 404; with Fixture B's empty `LINK_FILE`, assert 200 + empty edge set.
8. **Regression guard:** assert that adding the `link.json` artifact does not change the graph or flows artifacts for either fixture (compare graph/flows output to a stored baseline) and that `GRAPH_VERSION` is unchanged.

## Out of Scope

- Fixing why a real Frappe scan produced imports-only edges with `flows=0` (local-import resolution, cross-module call resolution, whitelist-detection robustness, hooks coverage) — those belong to the sibling Epic 6 extractor/flow stories.
- Any change to `src/flows.ts`, `FLOW_KINDS`, or flow tracing.
- Any new `EdgeKind` value or change to the graph/flows on-disk schema (would require a `GRAPH_VERSION` bump).
- New Ecosystem-tab UI features beyond serving the artifact and the 6.5 honest empty-state.
- Three-or-more-app aggregation beyond what `linkGraphs` already supports; this story consumes `linkGraphs` as-is and does not extend its matching logic.
