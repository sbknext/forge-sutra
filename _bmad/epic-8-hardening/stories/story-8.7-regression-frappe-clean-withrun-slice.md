# Story 8.7: Regression — frappe-clean + withrun bench slice

- **Epic:** Epic 8 — Phase 8 Hardening
- **Status:** Draft
- **Priority:** P0
- **Depends on:** 8.1, 8.2, 8.3, 8.4
- **Estimate:** M

## Title

Lock Phase 8 hardening with frappe-clean regression plus a minimal withrun-style bench slice integration test.

## Problem

`frappe-clean` proves flat `myapp/` layout only. Production failures use `apps/withrun/withrun/...`
depth, multi-file features, and merge artifacts. Without a committed **slice** of that shape, fixes
in 8.1–8.4 can regress while unit tests stay green. This story is the Epic 6.4 / 6.7 integration
guard reframed for Phase 8 completion criteria.

## Already on main (do not re-implement)

- `tests/fixtures/frappe-clean/**` and Story 4.2 tests (endpoints, calls, http, doc_events, flows).
- Deterministic id scan test.
- TS regression guards (broken/proxied orphans).

## Acceptance criteria

1. New fixture `tests/fixtures/frappe-withrun-slice/` mirrors bench depth:
   `apps/wr/wr/api/...`, `apps/wr/wr/{feature_module}/...`, hooks + at least one DocType controller.
2. Integration test runs full `scan` → asserts:
   - at least two `calls` edges between distinct files;
   - at least one `http` edge (external or in-repo per 8.3);
   - `buildFlows` → `flows.length >= 1` with a `calls` or `http` step in the path;
   - no `calls` edge `to` id missing from `nodes`.
3. frappe-clean tests unchanged (explicit regression section in same file or describe block).
4. Optional gated test: if env `SUTRA_WITHRUN_SLICE=/path` points at a local bench checkout, run
   scan and assert `flows.length > 0` — skipped in CI when unset (document in README).
5. Epic 8 README updated with before/after edge-kind counts from the slice fixture.

## Verify steps

1. `npm test` — new describe block passes on CI with committed fixture only.
2. `npm run build` green.
3. Record in PR: frappe-clean edge kinds unchanged; slice fixture edge kinds include `calls`/`http`.
4. If optional env test enabled locally, capture feature name + flow count in PR notes (no paths with secrets).

## Files likely touched

- `tests/fixtures/frappe-withrun-slice/**` (new)
- `tests/frappe-withrun-slice.test.ts` (new) or extend `tests/frappe-extractor.test.ts`
- `_bmad/epic-8-hardening/README.md` — evidence table
- `README.md` — optional env var one-liner

## Out of scope

- Full withrun repo vendored into sutra; self-CI workflow (Epic 6.7).
