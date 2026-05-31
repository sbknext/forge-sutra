/**
 * Story 1.4 / 3.4 — cross-repo link result builder (consumes scan graphs).
 */

import fs from "node:fs";
import path from "node:path";
import type { LinkResult, LinkedEdge, SutraGraph } from "./types.js";
import { LINK_VERSION, SUTRA_DIR, LINK_FILE } from "./types.js";
import { makeCrossRepoId } from "./util/ids.js";
import { extractClientCalls, reconcileGraphs } from "./reconcile.js";
import { pathMatches, parseEndpointDef } from "./util/http-match.js";
import type { SutraNode } from "./types.js";

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
