/**
 * Story 1.4 / 3.4 — cross-repo link result builder (consumes scan graphs).
 * Story 8.5 — attachFlowsAndLink shared helper for merge workflows.
 */

import fs from "node:fs";
import path from "node:path";
import type { LinkResult, LinkedEdge, SutraGraph } from "./types.js";
import { LINK_VERSION, SUTRA_DIR, LINK_FILE } from "./types.js";
import { makeCrossRepoId } from "./util/ids.js";
import { extractClientCalls, reconcileGraphs } from "./reconcile.js";
import { pathMatches, parseEndpointDef } from "./util/http-match.js";
import type { SutraNode } from "./types.js";
import { buildFlows } from "./flows.js";

function findServerHandler(
  server: SutraGraph,
  method: string,
  path: string,
): SutraNode | undefined {
  for (const n of server.nodes) {
    if (n.type !== "endpoint" && n.type !== "route") continue;
    const def = parseEndpointDef(n);
    if (def && def.method === method && pathMatches(def.path, path)) return n;
  }
  return undefined;
}

/** Build LinkResult from client + server graphs (reuse reconcile matching). */
export function linkGraphs(
  graphs: SutraGraph[],
  repoPaths?: string[],
): LinkResult {
  if (graphs.length < 2) {
    return {
      version: LINK_VERSION,
      linked_at: new Date().toISOString(),
      repos: graphs.map((g, i) => ({
        name: g.repo,
        path: repoPaths?.[i] ?? g.repo,
        commit: g.commit,
      })),
      edges: [],
    };
  }

  const [client, server] = graphs;
  const result = reconcileGraphs(client, server);
  const calls = extractClientCalls(client);
  const edges: LinkedEdge[] = [];

  for (const call of calls) {
    const handler = findServerHandler(server, call.method, call.path);
    const resolution = handler ? "confirmed" : "broken";
    const toId = handler
      ? makeCrossRepoId(server.repo, handler.id)
      : makeCrossRepoId(server.repo, `${call.method} ${call.path}`);

    edges.push({
      from: makeCrossRepoId(client.repo, call.from),
      to: toId,
      kind: "http",
      resolution,
      method: call.method,
      path: call.path,
    });
  }

  // Orphans from reconcile that weren't matched become broken edges already above
  void result;

  return {
    version: LINK_VERSION,
    linked_at: new Date().toISOString(),
    repos: [
      { name: client.repo, path: repoPaths?.[0] ?? client.repo, commit: client.commit },
      { name: server.repo, path: repoPaths?.[1] ?? server.repo, commit: server.commit },
    ],
    edges,
  };
}

/** Empty-but-valid link artifact for single-repo scans (no cross-repo edges). */
export function emptyLinkResult(
  repo: string,
  repoPath: string,
  commit?: string,
): LinkResult {
  return {
    version: LINK_VERSION,
    linked_at: new Date().toISOString(),
    repos: [{ name: repo, path: path.resolve(repoPath), commit }],
    edges: [],
  };
}

export function linkFilePath(cwd: string): string {
  return path.join(cwd, SUTRA_DIR, LINK_FILE);
}

/** Write `.sutra/link.json` (never overwrites a multi-repo link from `sutra link`). */
export function writeLinkFile(
  cwd: string,
  link: LinkResult,
  options?: { onlyIfAbsent?: boolean },
): string {
  const out = linkFilePath(cwd);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (options?.onlyIfAbsent && fs.existsSync(out)) {
    try {
      const existing = JSON.parse(fs.readFileSync(out, "utf8")) as LinkResult;
      if (existing.repos.length > 1 || existing.edges.length > 0) {
        return out;
      }
    } catch {
      // overwrite corrupt file
    }
  }
  fs.writeFileSync(out, JSON.stringify(link, null, 2), "utf8");
  return out;
}

/**
 * Story 8.5 — detect whether node ids span two or more distinct `app::` prefixes.
 * Multi-bench merges namespace nodes as `<app>::<rest>`; single-repo scans do not.
 */
export function isMultiAppGraph(nodes: SutraNode[]): boolean {
  const apps = new Set<string>();
  for (const n of nodes) {
    const sep = n.id.indexOf("::");
    if (sep > 0) apps.add(n.id.slice(0, sep));
    if (apps.size >= 2) return true;
  }
  return false;
}

export interface AttachFlowsAndLinkOptions {
  /** Suppress write of link.json when a richer one already exists (default false). */
  onlyIfAbsent?: boolean;
}

export interface AttachFlowsAndLinkResult {
  flowsCount: number;
  confirmed: number;
  candidate: number;
  linkPath: string;
  multiApp: boolean;
}

/**
 * Story 8.5 — shared post-merge helper:
 * 1. Runs `buildFlows` over the merged graph's nodes+edges.
 * 2. Persists `flows` back to `graphPath`.
 * 3. Writes `<artifactDir>/.sutra/link.json`:
 *    - multi-app graph (two+ `app::` prefixes) → `linkGraphs`-style result with
 *      cross-app nodes grouped into per-app synthetic SutraGraph entries and any
 *      discoverable cross-app edges; never skips write.
 *    - single-app graph → valid empty LinkResult (honesty contract).
 *
 * This is the canonical implementation; `scripts/attach-flows-link.mjs` delegates here.
 */
export function attachFlowsAndLink(
  graphPath: string,
  artifactDir: string,
  options: AttachFlowsAndLinkOptions = {},
): AttachFlowsAndLinkResult {
  const graph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as SutraGraph;

  // 1. Build and persist flows.
  const { flows, confirmed, candidate } = buildFlows(graph.nodes, graph.edges);
  graph.flows = flows;
  fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2), "utf8");

  // 2. Determine whether multi-app and build link.json accordingly.
  const multiApp = isMultiAppGraph(graph.nodes);
  let link: LinkResult;

  if (multiApp) {
    // Group nodes by app prefix to produce per-app synthetic graphs.
    const appNodes = new Map<string, SutraNode[]>();
    for (const n of graph.nodes) {
      const sep = n.id.indexOf("::");
      const app = sep > 0 ? n.id.slice(0, sep) : graph.repo ?? "merged";
      if (!appNodes.has(app)) appNodes.set(app, []);
      appNodes.get(app)!.push(n);
    }

    const appNames = [...appNodes.keys()];
    const syntheticGraphs: SutraGraph[] = appNames.map((app) => ({
      version: graph.version ?? 1,
      repo: app,
      scanned_at: graph.scanned_at ?? new Date().toISOString(),
      commit: graph.commit,
      nodes: appNodes.get(app)!,
      edges: graph.edges.filter(
        (e) => e.from.startsWith(`${app}::`) || e.to.startsWith(`${app}::`),
      ),
      issues: [],
      features: [],
      contracts: [],
      flows: [],
    }));

    // Use linkGraphs for real cross-app reconciliation when exactly two apps are
    // present; for 3+ apps produce a structural result with empty edges (schema valid).
    if (syntheticGraphs.length === 2) {
      link = linkGraphs(syntheticGraphs, [artifactDir, artifactDir]);
    } else {
      link = {
        version: LINK_VERSION,
        linked_at: new Date().toISOString(),
        repos: appNames.map((app) => ({
          name: app,
          path: artifactDir,
          commit: graph.commit,
        })),
        edges: [],
      };
    }
    // Multi-app: always write (never skip — viewer must not 404 after merge).
    writeLinkFile(artifactDir, link);
  } else {
    // Single-app: empty-but-valid link (honesty contract).
    link = emptyLinkResult(graph.repo ?? "merged", artifactDir, graph.commit);
    writeLinkFile(artifactDir, link, { onlyIfAbsent: options.onlyIfAbsent });
  }

  return {
    flowsCount: flows.length,
    confirmed,
    candidate,
    linkPath: linkFilePath(artifactDir),
    multiApp,
  };
}
