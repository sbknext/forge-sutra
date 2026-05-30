/**
 * Cross-repo reconciliation — match client HTTP calls against server routes.
 * Static candidate match only; ignores auth, env URLs, runtime 404s.
 */

import type { SutraGraph, SutraNode, SutraEdge, SutraIssue } from "./types.js";

export interface ReconcileResult {
  issues: SutraIssue[];
  checked: number;
  matched: number;
}

export const RECONCILE_VERSION = 0;

export interface ReconcileOutput {
  reconcile_version: number;
  client_repo: string;
  server_repo: string;
  checked: number;
  matched: number;
  issues: SutraIssue[];
}

export function buildReconcileOutput(
  client: SutraGraph,
  server: SutraGraph,
  result: ReconcileResult,
): ReconcileOutput {
  return {
    reconcile_version: RECONCILE_VERSION,
    client_repo: client.repo,
    server_repo: server.repo,
    checked: result.checked,
    matched: result.matched,
    issues: result.issues,
  };
}

function normalisePath(p: string): string {
  return p.toLowerCase().replace(/\/+$/, "") || "/";
}

function segments(p: string): string[] {
  return p.split("/").filter(Boolean);
}

function isDynamic(seg: string): boolean {
  return seg.startsWith(":") || (seg.startsWith("[") && seg.endsWith("]"));
}

function pathMatches(definedPath: string, clientPath: string): boolean {
  const defSegs = segments(normalisePath(definedPath));
  const cliSegs = segments(normalisePath(clientPath));
  if (defSegs.length !== cliSegs.length) return false;
  for (let i = 0; i < defSegs.length; i++) {
    if (isDynamic(defSegs[i]!) || isDynamic(cliSegs[i]!)) continue;
    if (defSegs[i] !== cliSegs[i]) return false;
  }
  return true;
}

function parseEndpointDef(node: SutraNode): { method: string; path: string } | null {
  for (const src of [node.name, node.data_shape ?? ""]) {
    const m = src.match(/^([A-Z]+):?\s+(\/[^\s]*)$/i);
    if (m) return { method: m[1]!.toUpperCase(), path: m[2]! };
  }
  return null;
}

function parseHttpTargetId(
  id: string,
): { method: string; path: string; host: string | null } | null {
  const body = id.slice("http:".length).trim();
  let host: string | null = null;
  let methodPath = body;
  const pipeIdx = body.indexOf("|");
  if (pipeIdx !== -1) {
    methodPath = body.slice(0, pipeIdx).trim();
    host = body.slice(pipeIdx + 1).trim().toLowerCase() || null;
  }
  const m = methodPath.match(/^([A-Z]+)\s+(\/[^\s]*)$/i);
  if (!m) return null;
  return { method: m[1]!.toUpperCase(), path: m[2]!, host };
}

function collectExternalHosts(nodes: SutraNode[]): Set<string> {
  const hosts = new Set<string>();
  for (const n of nodes) {
    if (n.type === "route" && n.name.startsWith("EXTERNAL ")) {
      hosts.add(n.name.slice("EXTERNAL ".length).toLowerCase());
    }
  }
  return hosts;
}

function collectServerRoutes(nodes: SutraNode[]): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];
  for (const n of nodes) {
    if (n.type === "endpoint" || n.type === "route") {
      const def = parseEndpointDef(n);
      if (def) routes.push(def);
    }
  }
  return routes;
}

function featureOf(nodes: SutraNode[], id: string): string {
  return nodes.find((n) => n.id === id)?.feature ?? "unknown";
}

/** Extract deduped client HTTP calls from graph edges (external hosts skipped). */
export function extractClientCalls(client: SutraGraph): Array<{
  method: string;
  path: string;
  from: string;
}> {
  const externalHosts = collectExternalHosts(client.nodes);
  const seen = new Set<string>();
  const calls: Array<{ method: string; path: string; from: string }> = [];

  for (const edge of client.edges) {
    if (edge.kind !== "http" || !edge.to.startsWith("http:")) continue;
    const target = parseHttpTargetId(edge.to);
    if (!target) continue;
    if (target.host && externalHosts.has(target.host)) continue;

    const key = `${target.method} ${normalisePath(target.path)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ method: target.method, path: target.path, from: edge.from });
  }

  return calls;
}

/** Match client calls against server routes; emit cross_repo_orphan for gaps. */
export function reconcileGraphs(
  client: SutraGraph,
  server: SutraGraph,
): ReconcileResult {
  const serverRoutes = collectServerRoutes(server.nodes);
  const calls = extractClientCalls(client);
  const issues: SutraIssue[] = [];
  let matched = 0;

  for (const call of calls) {
    const hit = serverRoutes.some(
      (route) =>
        route.method === call.method && pathMatches(route.path, call.path),
    );
    if (hit) {
      matched++;
      continue;
    }

    issues.push({
      severity: "warn",
      kind: "cross_repo_orphan",
      node: `${call.method} ${call.path}`,
      feature: featureOf(client.nodes, call.from),
      message: `Client calls ${call.method} ${call.path} but server graph has no matching route (candidate).`,
    });
  }

  return { issues, checked: calls.length, matched };
}
