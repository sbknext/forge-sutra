# Story 4.2: Python / Frappe extractor

- **Epic:** Epic 4 — Ecosystem & SDK
- **Status:** Draft
- **Priority:** P1
- **Depends on:** 4.1 (language-agnostic graph core — the `Extractor` interface and the decoupling of `scan()` from ts-morph)
- **Estimate:** L

## Story
As an engineer who ships Frappe/Python apps (Liberoid, Relay, frappe-latte, tasksyncer, fpatch, etc.), I want Sutra to scan a Frappe app and emit the same `graph.json` it emits for TS/JS — turning `frappe.whitelist()` methods into endpoints, `doc_events`/`scheduler_events` hooks into edges, and DocType controllers into nodes — so that the realistic feature viewer works on the stack we actually run in production, not just the JS half of the ecosystem.

## Context
Phase 0 is TypeScript/JavaScript only. `BRIEF.md` lists "TypeScript only this phase" as a hard constraint, `README.md` Claim Bounds repeats "TS/JS only," and `NOTES.md` ("Phase 0 honest limits") closes with "no live view, **TS/JS only**." Every Frappe app we own is therefore invisible to Sutra today, which means the tool cannot describe the products that pay the bills. `ROADMAP.md` Epic 4 calls this out directly: line 43 ("Real on real codebases — works on the Frappe/Python world we actually ship") and the Definition of Done line 140 ("It runs on at least one **Frappe/Python** repo we own (Epic 4.2)"). The roadmap table maps 4.2 to "Python / Frappe extractor (whitelisted methods, DocType events, hooks → nodes/edges)."

This story is sequenced after 4.1 in `ROADMAP.md` ("4.1 lang-core gates 4.2"). 4.1 decouples the graph model from ts-morph and introduces a pluggable `Extractor` interface; the TS scanner in `src/scanner.ts` becomes one extractor among several. 4.2 is the second extractor, proving the abstraction is real by emitting the identical `SutraGraph` contract (`src/types.ts`) from a completely different language and runtime. Per the cross-cutting principle "Graph.json is the contract" (`ROADMAP.md` line 124), this extractor must not change the schema in a way the viewer can't consume; per "Never overstate" (line 122), Python findings that we cannot statically confirm stay labelled as candidates exactly like the TS side.

## Acceptance Criteria

1. A new `PythonFrappeExtractor` implements the `Extractor` interface defined in story 4.1 and is registered so that `sutra scan <repo>` auto-selects it when the target repo is a Frappe app (detected by an `apps/*/<app>/hooks.py` layout or a top-level `hooks.py` + `*/doctype/*/` tree). Selection is deterministic and logged in the scan summary (e.g. `extractor: python-frappe`).

2. Every Python function decorated with `@frappe.whitelist()` (and the `frappe.whitelist(allow_guest=True)` / `methods=[...]` forms) becomes a `SutraNode` of `type: "endpoint"`, with `name` set to the dotted Frappe API path (`"<module.path>.<function>"`, e.g. `"liberoid.api.order.get_status"`) and `data_shape` carrying the first non-`self` parameter type or signature text, or `null` when untyped. The endpoint `name` format is documented so `checks.ts` route-matching can be extended later without guessing.

3. Each DocType controller class (a class in a `*/doctype/<name>/<name>.py` file extending `Document`) becomes a `SutraNode` of `type: "handler"` (reusing the existing `NodeType` union in `src/types.ts` — no new node type added in this story), and its controller hook methods (`validate`, `before_save`, `on_submit`, `on_update`, `after_insert`, etc.) become `handler` or `function` nodes attributed to the same `file`.

4. `hooks.py` `doc_events` entries produce `SutraEdge`s of `kind: "calls"` from a synthetic node representing the DocType+event to the resolved handler function node — e.g. `doc_events = {"Sales Invoice": {"on_submit": "liberoid.events.on_invoice_submit"}}` yields an edge whose `to` is the deterministic id of `on_invoice_submit`. When the handler dotted path cannot be resolved to a real function node in the repo, the edge target is left as the unresolved id so that `checks.ts:checkMissingHandlers` flags it as `missing_handler` (same candidate treatment as a broken TS import).

5. `hooks.py` `scheduler_events` entries (`all`, `hourly`, `daily`, `cron`, etc.) produce `SutraEdge`s of `kind: "calls"` from a synthetic scheduler node to each referenced job function, with the same unresolved-target → `missing_handler` behavior as AC 4.

6. Node ids remain deterministic and stable per the existing `src/util/ids.ts` scheme (`makeNodeId(relPath, symbol)` → `relative/posix/path#symbol`). For Python, `relPath` is the repo-relative POSIX `.py` path and `symbol` is the qualified Python name (e.g. `apps/liberoid/liberoid/api/order.py#get_status`). Two consecutive scans of the same Frappe fixture produce byte-identical sorted id lists (mirrors the existing "deterministic ids" tests, section 2 of `tests/sutra.test.ts`).

7. The emitted graph passes through the **unchanged** `runChecks(nodes, edges)` and `buildFeatures(nodes, issues)` pipeline in `src/checks.ts` / `src/features.ts` and `src/cli.ts` — i.e. `cmdScan` writes a valid `.sutra/graph.json` for a Frappe repo with `version: GRAPH_VERSION`, populated `nodes/edges/issues/features`, and the one-screen summary renders. No `GRAPH_VERSION` bump is required by this story (the contract shape is unchanged; only a new producer is added). If 4.1 already bumped the version, this story consumes that version and does not bump again.

8. Frappe-specific extraction limits are recorded honestly: dynamically-built dotted paths, `frappe.get_attr()` / `frappe.call()` string-resolved targets, and runtime-overridden hooks are NOT confirmed and either skipped or left as unresolved (candidate) targets — never silently "matched." A new "Python / Frappe extractor — known limits" subsection is appended to `NOTES.md`, consistent with the existing "Missing Forge Primitives" honesty convention.

9. The roadmap DoD gate is met: `sutra scan` runs end-to-end on **at least one real Frappe repo we own** and the result is recorded in `NOTES.md` (node/edge/issue counts + at least one true-and-new structural observation, e.g. a `doc_events` handler whose dotted path no longer resolves), matching the Phase-0 validation-gate discipline (`BRIEF.md` "Validation gate").

## Technical Approach

**New files**
- `src/extractors/python-frappe.ts` (NEW) — the `PythonFrappeExtractor`. Implements the `Extractor` interface from 4.1 (expected shape: `{ id: string; detect(repoRoot): boolean; extract(repoRoot): { nodes: SutraNode[]; edges: SutraEdge[] } }` — confirm exact signature against the 4.1 deliverable before coding; if 4.1's interface differs, conform to it, do not redefine it here).
- `src/util/python-ast.ts` (NEW) — a thin Python parsing helper. Phase-4 choice: parse `.py` with a dependency-free Python parser usable from Node. Prefer `tree-sitter` + `tree-sitter-python` (WASM build, no Python runtime required) so Sutra stays a self-contained Node CLI and does not shell out to a `python` interpreter. Record the chosen parser and the "why not shell out to CPython" decision in `NOTES.md`. Parsing is AST-based, never regex over function bodies (regex is acceptable only for the `hooks.py` dict literals if AST extraction proves brittle, and that fallback must be noted).

**Files changed**
- `src/types.ts` — NO new `NodeType`, `EdgeKind`, or `IssueKind` values, and NO `GRAPH_VERSION` change in this story (the whole point is contract reuse). Add `.py` handling only where the language-agnostic core (4.1) expects per-extractor file globs; the `SCAN_EXTENSIONS`/`EXCLUDED_DIRS` constants stay TS-focused for the TS extractor, while the Python extractor owns its own include set (`.py`) and exclusions (`node_modules`, `.git`, `__pycache__`, `dist`, `build`, `*.egg-info`, `node_modules`, `.frappe`, `sites/`).
- `src/cli.ts` — `cmdScan` already calls the pipeline generically (`scan` → `runChecks` → `buildFeatures`). After 4.1, extractor selection happens inside the core; this story ensures the summary line names the chosen extractor and that the Frappe path produces sane counts. No issue-rendering changes.
- `NOTES.md` — append the validation result (AC 9) and the known-limits subsection (AC 8).
- `README.md` — extend the intro and Claim Bounds: Sutra is no longer "JavaScript / TypeScript only"; add a short "Frappe / Python (Epic 4.2)" note describing what is extracted and explicitly stating it is the same heuristic/candidate standard.

**Extraction mapping (the contract reuse)**

| Frappe construct | Source | → graph.json |
|---|---|---|
| `@frappe.whitelist()` def | `*.py` | `SutraNode { type: "endpoint", name: "<dotted.path>", data_shape: <first-param type or null>, feature }` |
| DocType controller class | `*/doctype/<n>/<n>.py` | `SutraNode { type: "handler", name: "<ClassName>", ... }` |
| Controller hook method (`validate`, `on_submit`, …) | controller class body | `SutraNode { type: "handler" \| "function" }` |
| `doc_events["DocType"]["event"] = "a.b.fn"` | `hooks.py` | synthetic event node + `SutraEdge { kind: "calls", to: <resolved fn id \| unresolved id> }` |
| `scheduler_events["daily"] = [...]` | `hooks.py` | synthetic scheduler node + `SutraEdge { kind: "calls", ... }` |
| `import` / `frappe.get_doc("X")` controller refs | `*.py` | `SutraEdge { kind: "imports" \| "calls" }` (best-effort; unresolved → candidate) |

**Honesty rules honored**
- Candidate vs confirmed: any edge whose dotted-path target cannot be resolved to a real function node is left unresolved so the *existing* `missing_handler` check surfaces it as a candidate — Sutra never invents a node to make a link "resolve" (`ROADMAP.md` principle 1).
- No AI in this story — extraction is purely static AST. (AI feature inference is Epic 2.3, out of scope.)
- Deterministic ids preserved via `src/util/ids.ts` (`ROADMAP.md` principle 3) so future `sutra diff` (1.6) works across Python scans too.
- Renderer untouched: `src/view.ts` consumes whatever `graph.json` it is given; a Frappe graph renders through the same leaf (`ROADMAP.md` principle 5).

## Tasks
- [ ] Read the shipped story 4.1 `Extractor` interface and conform exactly to its signature, registration mechanism, and selection logic.
- [ ] Add a Python parser dependency (prefer `tree-sitter` + `tree-sitter-python` WASM; no CPython shell-out) and wrap it in `src/util/python-ast.ts`.
- [ ] Implement `detect(repoRoot)` for Frappe layout (`hooks.py` + `*/doctype/*/` tree) so the core auto-selects the extractor.
- [ ] Implement `@frappe.whitelist()` discovery → `endpoint` nodes with dotted-path names and first-param `data_shape`.
- [ ] Implement DocType controller class + hook-method discovery → `handler`/`function` nodes.
- [ ] Implement `hooks.py` `doc_events` parsing → synthetic event nodes + `calls` edges, resolving dotted paths to function node ids where possible.
- [ ] Implement `hooks.py` `scheduler_events` parsing → synthetic scheduler nodes + `calls` edges.
- [ ] Wire deterministic Python node ids through `src/util/ids.ts` (relPath = `.py` posix path, symbol = qualified Python name).
- [ ] Confirm the Frappe graph flows unchanged through `runChecks` + `buildFeatures` + `cmdScan` and writes valid `.sutra/graph.json`.
- [ ] Add Frappe fixtures + describe blocks in `tests/sutra.test.ts` (see Test Plan).
- [ ] Run on ≥1 real owned Frappe repo; record counts + one true-and-new finding in `NOTES.md` (DoD gate).
- [ ] Update `README.md` (no longer TS/JS-only; Frappe extraction + claim bounds) and append the known-limits subsection to `NOTES.md`. Verify `npm run build` + `vitest` are green before commit (max 5 files / 300 lines per change-set per playbook; split if larger).

## Test Plan

New fixtures under `tests/fixtures/` (mirroring the existing `broken/`, `clean/`, `proxied/`, `assets/` convention) — minimal hand-authored Frappe app trees, NOT a copy of a real repo:

- `tests/fixtures/frappe-clean/` — a tiny app with `hooks.py`, one DocType controller (`.../doctype/widget/widget.py` with a `Widget(Document)` class + `validate`), one `@frappe.whitelist()` API function, and `doc_events`/`scheduler_events` whose dotted paths all resolve. **Proves:** endpoint/handler nodes emitted, `doc_events`/`scheduler_events` edges resolve to real function nodes, and `runChecks` returns **zero** issues (parallels section 5 "clean fixture").
- `tests/fixtures/frappe-broken/` — same shape but with (a) a `doc_events` handler pointing at a dotted path whose function does not exist, and (b) a `scheduler_events` job referencing a removed function. **Proves:** the unresolved targets surface as `missing_handler` issues through the *unchanged* `checks.ts` (parallels section 3 "all three issue kinds" — here at least `missing_handler` must fire for the Python case).

New describe blocks in `tests/sutra.test.ts`:
- **Section 10 — python/frappe extractor (clean):** `endpoint` node exists for the whitelisted function with the correct dotted-path `name`; `handler` node exists for the `Widget` controller; `doc_events` produces a `calls` edge to the real handler; zero issues from `runChecks`.
- **Section 11 — python/frappe extractor (broken):** the unresolved `doc_events` handler yields a `missing_handler` issue; the issue `node`/`message` references the missing dotted path.
- **Section 12 — deterministic ids (frappe):** two scans of `frappe-clean` produce identical sorted id lists (regression guard; mirrors section 2).

**Regression guard:** Re-run the entire existing suite (sections 1–9) against the TS fixtures and confirm all stay green — adding the Python extractor and `.py` handling MUST NOT alter TS extraction output. Specifically assert that `scan(BROKEN)` still flags `POST /api/capture` (section 9) and that the proxied/assets fixtures still return zero issues (sections 7–8), proving the new extractor is additive and the contract is unchanged.

## Out of Scope
- Cross-repo resolution of Frappe dotted paths into *other* repos' handlers (that is Epic 1.4 cross-repo linking applied to Python, a later story).
- AI naming/summarizing of Frappe features (Epic 2.3).
- A Frappe-specific issue kind or a `GRAPH_VERSION` bump — this story deliberately reuses the existing `NodeType`/`EdgeKind`/`IssueKind` unions and contract. If a richer Frappe model is needed later (e.g. a distinct `doctype` node type or a `frappe_hook` edge kind), that is a separate, version-bumping story with a viewer migration.
- Full Frappe runtime semantics: permission queries (`frappe.has_permission`), `frappe.enqueue` background-job graphs, Powerflow/Latte workflow edges, fixtures/patches, and JS-side `.js` DocType client scripts (those `.js` files are already handled by the TS extractor, not re-claimed here).
- Languages other than TS/JS and Python (Epic 4.1 keeps the door open; additional extractors are their own stories).
- Any change to `src/view.ts` rendering specific to Frappe (the leaf renderer consumes the shared contract as-is; Frappe-aware viewer affordances belong to Epic 3 stories).
