# Story 8.6: Viewer — empty flows and ecosystem absent-state

- **Epic:** Epic 8 — Phase 8 Hardening
- **Status:** Draft
- **Priority:** P1
- **Depends on:** 8.5 (for real link data); can start server routes in parallel
- **Estimate:** S

## Title

Harden viewer so empty flows and missing cross-repo link read as inactive features, not console errors.

## Problem

When `flows[]` is empty (imports-only or pre-8.1 bench), the feature drill-down should say
**no traced paths** calmly — same honesty as Epic 6.5 for link/events. Ecosystem tab still logs
failed `fetch('/link.json')` on 404; `server.ts` returns 404 for absent file. After Story 8.5,
placeholder link should return 200 — viewer must handle **empty edges** vs **404** distinctly.
`/events` and `/favicon.ico` noise remain on real scans.

## Already on main (do not re-implement)

- `viewer/ecosystem.js` disables tab when `!res.ok` (404 → inactive tab).
- `src/viewer/server.ts` structured JSON errors for bad link parse.
- Scan pipeline writes placeholder link when absent.

## Acceptance criteria

1. Absent `link.json`: server returns **204 or 200 with `{ repos: [], edges: [] }`** OR client treats
   404 as expected without `console.error` — pick one approach and document in README.
2. Present but empty `link.json`: Ecosystem tab shows neutral copy ("single-repo scan — run sutra link for cross-app map"), not an error badge.
3. Feature drill-down with `flows.length === 0`: visible empty state referencing `FLOW_KINDS` limitation, not a broken graph impression.
4. `/events` poll when watch inactive: no red console error (skip poll or 204).
5. `/favicon.ico` served or ignored without console error.
6. No extractor or `GRAPH_VERSION` change.

## Verify steps

1. Manual viewer load on frappe-clean graph (has flows) — drill-down shows path.
2. Manual load on imports-only synthetic graph — empty flow copy, no stack traces.
3. Load without link file after chosen server behaviour — zero console errors in browser devtools.
4. Optional: minimal playwright or static HTML test for fetch handlers if project already has pattern.

## Files likely touched

- `src/viewer/server.ts` — link/events/favicon routes
- `viewer/app.js`, `viewer/drilldown.js`, `viewer/ecosystem.js`
- `viewer/index.html` — empty-state markup
- `README.md` — absent vs empty semantics (one paragraph)

## Out of scope

- Generating real cross-app links (Story 8.5); resolver fixes (8.1–8.3).
