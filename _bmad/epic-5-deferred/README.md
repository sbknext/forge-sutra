# Epic 5 — Deferred (Out of Scope)

These stories are **deliberately deferred** and must **not** be implemented by the autonomous
executor. They were moved here out of Epics 1/3/4 because each one either couples Sutra to the
brain/forge ecosystem or breaks the single-repo, standalone, local-first constraint that has
held since Phase 0.

> **Hard rule for executors:** do not build anything in this epic. If a task references a story
> by number, and the story file lives under `epic-5-deferred/`, skip it.

| Story | Was in | Why deferred |
|---|---|---|
| [1.4 Cross-repo linking](story-1.4-cross-repo-linking.md) | Epic 1 | Requires scanning across multiple repos — breaks single-repo scope. |
| [3.4 Cross-repo ecosystem map](story-3.4-cross-repo-map.md) | Epic 3 | Depends on 1.4; ecosystem-wide, not single-repo. |
| [4.3 Forge SDK primitive extraction](story-4.3-forge-sdk-extraction.md) | Epic 4 | Couples Sutra to the Forge SDK — Sutra must stay standalone. |
| [4.5 Hosted graph history & trends](story-4.5-hosted-graph-history.md) | Epic 4 | Hosted/brain-backed storage breaks local-first. (A purely-local `.sutra/history/` variant could be re-scoped later, but the hosted story as written is deferred.) |

## Note on existing code

`src/reconcile.ts` (Phase-1 cross-repo plumbing) already exists and may remain as-is. It is not
to be extended, and scans must never be pointed at real brain / echo / forge repositories — local
fixtures only.

Revisit this epic only on an explicit owner decision to take Sutra beyond single-repo / standalone.
