# Sutra

Static structural graph tool for JavaScript / TypeScript repositories. Points at a repo, produces a structural flow graph (`graph.json`) and a local HTML view. Phase 0.

![Sutra overview — echo-ai scan](docs/overview.png)

## Vision

> **See your product as features — derived from code, not from docs, and honest about what it doesn't know.**

- **Truthful by default.** Every finding is labelled *candidate* until it's actually confirmed (cross-repo, dynamic routes, and external hosts resolved). No "finds all bugs", no overstated claims — structural/contract drift only.
- **Features, not files.** The unit is a *feature*: what it is, what it wires to, whether the wiring is intact, and where it's broken — with a health score you can click into.
- **A realistic feature viewer.** An interactive local viewer — feature cards, request-flow drill-down, a cross-repo map, and live refresh on code change — so you learn something true-and-new about your codebase in seconds.

## Roadmap

Full plan (4 epics, 23 stories, sequencing, and Definition of Done) lives here:
**[`_bmad/ROADMAP.md`](https://github.com/sbknext/forge-sutra/blob/main/_bmad/ROADMAP.md)**

- **Epic 1 — Truthful Graph:** external-host allowlist, dynamic-route matcher, confidence model, cross-repo linking, incremental scan, scan diff.
- **Epic 2 — Real Features:** feature contracts, client↔server reconciliation, AI inference, health score, flow tracing, test-coverage mapping.
- **Epic 3 — Realistic Feature Viewer ⭐:** viewer app, feature cards, drill-down, cross-repo map, live/watch, search & share.
- **Epic 4 — Ecosystem & SDK:** language-agnostic core, Python/Frappe extractor, Forge SDK extraction, CI integration, graph history.

**Try it:** `sutra scan /path/to/repo && sutra view` — then watch the roadmap as the static view grows into the full feature viewer. Issues and PRs welcome.

## Commands

### `sutra scan [repoPath]`

Scans `repoPath` (defaults to current working directory). Resolves to an absolute path.

Produces `.sutra/graph.json` in the current working directory.

```
sutra scan /path/to/my-repo
sutra scan   # uses cwd
```

Options:
- `--watch` — prints "watch mode: not implemented in Phase 0" and exits (reserved for Phase 1).

What it does:
1. Walks the repo (skips `node_modules`, `dist`, `.next`, `.git`, `coverage`, `out`).
2. Parses every `.ts`, `.tsx`, `.js`, `.jsx` file with ts-morph (AST-based, never regex).
3. Emits nodes for: modules, endpoints (Next.js App Router + pages/api + Express), components, functions, handlers, tests.
4. Emits edges for: imports, calls, renders (JSX), tests (test-file → subject), http (fetch/axios).
5. Runs structural checks (see below).
6. Groups nodes into heuristic features by directory prefix.
7. Writes `.sutra/graph.json`.
8. Prints a one-screen summary to stdout.

### `sutra view`

Reads `.sutra/graph.json` written by `scan`. Produces `.sutra/view.html` (a self-contained HTML document with Mermaid diagrams and issue lists). Opens it in the default browser on macOS; prints the file path on other platforms.

```
sutra view
```

---

## graph.json schema

```jsonc
{
  "version": 0,           // GRAPH_VERSION constant; bump = breaking change
  "repo": "my-repo",      // basename of the scanned directory
  "scanned_at": "...",    // ISO 8601 UTC timestamp
  "commit": "abc1234",    // short git hash, or "unknown"
  "nodes": [SutraNode],
  "edges": [SutraEdge],
  "issues": [SutraIssue],
  "features": [SutraFeature]
}
```

### SutraNode

```jsonc
{
  "id": "src/api/route.ts#GET /api/foo",  // stable deterministic: relPath#symbol
  "type": "route|handler|component|test|endpoint|module|function",
  "name": "GET /api/foo",
  "file": "src/api/route.ts",             // repo-relative POSIX path
  "line": 12,
  "data_shape": "{ id: string }",         // first param type text, or null
  "feature": "api"                        // heuristic grouping id
}
```

### SutraEdge

```jsonc
{
  "from": "src/components/Foo.tsx",
  "to":   "http:POST /api/bar",           // or a node id, or "ext:react"
  "kind": "calls|imports|renders|tests|http"
}
```

### SutraIssue

```jsonc
{
  "severity": "error|warn|info",
  "kind": "orphaned_endpoint|missing_handler|dangling_test_ref",
  "node": "POST /api/bar",               // the thing in question
  "feature": "components",              // heuristic feature tag
  "message": "Client calls POST /api/bar but no route handler defines it."
}
```

### SutraFeature

```jsonc
{
  "id": "components",
  "label": "Components",
  "node_ids": ["..."],
  "issue_count": 3
}
```

---

## Structural checks

| Kind | What it catches |
|------|----------------|
| `orphaned_endpoint` | A `fetch`/`axios` call targets a METHOD+path that no endpoint node covers. |
| `missing_handler` | An imports/calls/renders edge references a local symbol or file that has no node in the graph. |
| `dangling_test_ref` | A test file imports a module that no longer exists in the repo. |

---

## Claim Bounds

Sutra Phase 0 is a **static, heuristic approximation**. Read this before acting on any finding.

- **Structural / contract mistakes only.** Sutra finds missing routes, dead imports, and orphaned fetch calls. It does NOT find logic bugs, runtime errors, security issues, or performance problems.
- **Candidate results, not complete.** Dynamic imports, aliased imports, runtime-generated routes, and template-literal URLs may produce false positives or misses.
- **Static approximation.** No code is executed. No type inference beyond what ts-morph surfaces.
- **Not auto-debug / auto-test.** Sutra does not fix code, run tests, or validate runtime behavior.
- **Review before acting.** Every issue is a candidate for human review. The HTML view labels all results as "heuristic / candidate".

Known limitations in Phase 0:
- Template-literal fetch URLs: only the static prefix is extracted. Dynamic segments (`${id}`) are dropped, which can cause false positives when matching against dynamic route patterns.
- CSS/SVG/image imports: flagged as `missing_handler` because those extensions are not in the scanned set. Filter for `.ts`/`.tsx`/`.js`/`.jsx` targets before acting.
- External API calls (Telegram, Stripe, etc.) look like orphaned endpoints if their URL happens to match a local path pattern.
- Express routers mounted via variable (e.g., `app.use(prefix, router)`) may not resolve the full path correctly.
