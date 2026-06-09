/**
 * Cross-repo reconciliation — match client HTTP calls against server routes.
 * Static candidate match only; ignores auth, env URLs, runtime 404s.
 *
 * Story 1.5.2: each cross_repo_orphan is now classified into one of four classes:
 *   confirmed_broken  — no static suppression explains it (human review needed;
 *                       does NOT mean "definitely a bug")
 *   proxy_suppressed  — matches a PROXY node prefix from next.config rewrite detection
 *   dynamic_suppressed — structurally matches a server route template (not validated)
 *   external_suppressed — target host matches the external-host allowlist
 */

import type { SutraGraph, SutraNode, SutraEdge, SutraIssue, OrphanClassification } from "./types.js";

export interface ReconcileResult {
  issues: SutraIssue[];
  checked: number;
  matched: number;
}

export const RECONCILE_VERSION = 1;

export interface ReconcileSummary {
  confirmed_broken: number;
  proxy_suppressed: number;
  dynamic_suppressed: number;
  external_suppressed: number;
}

export interface ReconcileOutput {
  reconcile_version: number;
  client_repo: string;
  server_repo: string;
  checked: number;
  matched: number;
  /** Classification summary counts (Story 1.5.2). */
  summary: ReconcileSummary;
  issues: SutraIssue[];
}

export function buildReconcileOutput(
  client: SutraGraph,
  server: SutraGraph,
  result: ReconcileResult,
): ReconcileOutput {
  const summary = computeSummary(result.issues);
  return {
    reconcile_version: RECONCILE_VERSION,
    client_repo: client.repo,
    server_repo: server.repo,
    checked: result.checked,
    matched: result.matched,
    summary,
    issues: result.issues,
  };
}

function computeSummary(issues: SutraIssue[]): ReconcileSummary {
  const s: ReconcileSummary = {
    confirmed_broken: 0,
    proxy_suppressed: 0,
    dynamic_suppressed: 0,
    external_suppressed: 0,
  };
  for (const iss of issues) {
    if (iss.kind !== "cross_repo_orphan") continue;
    const c = iss.classification ?? "confirmed_broken";
    s[c]++;
  }
  return s;
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

// ── Suppressor helpers (Story 1.5.2) ─────────────────────────────────────────

/**
 * Collect proxy prefixes from PROXY nodes in the client graph.
 * A PROXY node is emitted when next.config rewrite detection finds a prefix rewrite.
 * Its name format: "PROXY /prefix" or "PROXY /prefix -> https://target".
 */
function collectProxyPrefixes(nodes: SutraNode[]): string[] {
  const prefixes: string[] = [];
  for (const n of nodes) {
    if (n.type === "route" && n.name.startsWith("PROXY ")) {
      const raw = n.name.slice("PROXY ".length).trim();
      // Take the source side (before " -> " if present)
      const arrow = raw.indexOf(" -> ");
      const prefix = arrow !== -1 ? raw.slice(0, arrow).trim() : raw;
      if (prefix) prefixes.push(normalisePath(prefix));
    }
  }
  return prefixes;
}

/**
 * Check if `callPath` starts with any proxy prefix.
 * Candidate only — dynamic expressions in next.config may be missed.
 */
function matchesProxyPrefix(callPath: string, proxyPrefixes: string[]): string | null {
  const normalised = normalisePath(callPath);
  for (const prefix of proxyPrefixes) {
    if (normalised === prefix || normalised.startsWith(prefix + "/")) {
      return prefix;
    }
  }
  return null;
}

/**
 * Check if `callPath` structurally matches any server route template with the same method.
 * Returns the matched template string, or null.
 * Note: structural path + method match only — auth and params are NOT validated.
 * Known limitation: may over-suppress if the template is very broad (e.g. /api/[id]).
 */
function matchesDynamicRoute(
  callMethod: string,
  callPath: string,
  serverRoutes: Array<{ method: string; path: string }>,
): string | null {
  for (const route of serverRoutes) {
    // Method must match — different verbs on the same path template are distinct routes.
    if (route.method !== callMethod) continue;
    // Look for template matches where at least one segment is dynamic.
    const defSegs = segments(normalisePath(route.path));
    const cliSegs = segments(normalisePath(callPath));
    if (defSegs.length !== cliSegs.length) continue;
    let hasDynamic = false;
    let mismatch = false;
    for (let i = 0; i < defSegs.length; i++) {
      if (isDynamic(defSegs[i]!)) {
        hasDynamic = true;
      } else if (defSegs[i] !== cliSegs[i]) {
        mismatch = true;
        break;
      }
    }
    if (!mismatch && hasDynamic) return route.path;
  }
  return null;
}

/**
 * Classify a single unmatched client call using the four-class suppressor chain.
 * Order: external → proxy → dynamic → confirmed_broken.
 */
function classifyOrphan(
  callMethod: string,
  callPath: string,
  callHost: string | null,
  externalHostSet: Set<string>,
  externalHostList: string[],
  proxyPrefixes: string[],
  serverRoutes: Array<{ method: string; path: string }>,
): { classification: OrphanClassification; reason: string } {
  // 1. External-host check
  if (callHost) {
    if (externalHostSet.has(callHost)) {
      return {
        classification: "external_suppressed",
        reason: `host "${callHost}" is in the external-host allowlist`,
      };
    }
  }
  // Also check against the loaded allowlist (may differ from graph-embedded hosts)
  if (callHost) {
    for (const h of externalHostList) {
      if (callHost === h || callHost.endsWith("." + h)) {
        return {
          classification: "external_suppressed",
          reason: `host "${callHost}" matches external allowlist entry "${h}"`,
        };
      }
    }
  }

  // 2. Proxy check
  const proxyMatch = matchesProxyPrefix(callPath, proxyPrefixes);
  if (proxyMatch !== null) {
    return {
      classification: "proxy_suppressed",
      reason: `path "${callPath}" matches proxy prefix "${proxyMatch}" (next.config rewrite candidate; dynamic expressions may be missed)`,
    };
  }

  // 3. Dynamic-route check (method + path — must match both to avoid over-suppression)
  const dynMatch = matchesDynamicRoute(callMethod, callPath, serverRoutes);
  if (dynMatch !== null) {
    return {
      classification: "dynamic_suppressed",
      reason: `path "${callPath}" structurally matches server route template "${dynMatch}" (structurally matched only — auth, method params not validated)`,
    };
  }

  // 4. Confirmed broken — no static suppression found
  return {
    classification: "confirmed_broken",
    reason: "no suppression rule matched (static analysis only — not necessarily a runtime bug)",
  };
}

/** Match client calls against server routes; emit cross_repo_orphan for gaps. */
export function reconcileGraphs(
  client: SutraGraph,
  server: SutraGraph,
  opts: { externalHostList?: string[] } = {},
): ReconcileResult {
  const serverRoutes = collectServerRoutes(server.nodes);
  const calls = extractClientCalls(client);
  const externalHostSet = collectExternalHosts(client.nodes);
  const proxyPrefixes = collectProxyPrefixes(client.nodes);
  const externalHostList = opts.externalHostList ?? [];
  const issues: SutraIssue[] = [];
  let matched = 0;

  for (const call of calls) {
    // Exact-match check (method + path, ignoring dynamic placeholders)
    const hit = serverRoutes.some(
      (route) =>
        route.method === call.method && pathMatches(route.path, call.path),
    );
    if (hit) {
      matched++;
      continue;
    }

    // Classify the orphan
    // Parse host from edge to get it for external check (re-parse needed)
    let callHost: string | null = null;
    for (const edge of client.edges) {
      if (edge.kind !== "http" || !edge.to.startsWith("http:")) continue;
      const t = parseHttpTargetId(edge.to);
      if (t && t.method === call.method && normalisePath(t.path) === normalisePath(call.path)) {
        callHost = t.host;
        break;
      }
    }

    const { classification, reason } = classifyOrphan(
      call.method,
      call.path,
      callHost,
      externalHostSet,
      externalHostList,
      proxyPrefixes,
      serverRoutes,
    );

    issues.push({
      severity: "warn",
      kind: "cross_repo_orphan",
      node: `${call.method} ${call.path}`,
      feature: featureOf(client.nodes, call.from),
      message: `Client calls ${call.method} ${call.path} but server graph has no matching route (candidate).`,
      classification,
      reason,
    });
  }

  // Deterministic output: sort issues by node id
  issues.sort((a, b) => a.node.localeCompare(b.node));

  return { issues, checked: calls.length, matched };
}
