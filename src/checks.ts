/**
 * STATIC candidate findings only. Dynamic dispatch, aliased imports, and
 * runtime-generated routes may produce false positives or misses.
 * These are approximations to guide human review, not definitive bug reports.
 */

import type { SutraNode, SutraEdge, SutraIssue } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build O(1) lookup: nodeId → node */
function buildNodeMap(nodes: SutraNode[]): Map<string, SutraNode> {
  const m = new Map<string, SutraNode>();
  for (const n of nodes) m.set(n.id, n);
  return m;
}

/** Find a node's feature tag by its id; fallback to "unknown". */
function featureOf(nodeMap: Map<string, SutraNode>, id: string): string {
  return nodeMap.get(id)?.feature ?? "unknown";
}

/**
 * True if this id should be treated as purely external / non-local:
 * - starts with "ext:" (scanner-emitted external marker)
 * - starts with "http:" (synthetic http-target id — handled separately)
 */
function isExternal(id: string): boolean {
  return id.startsWith("ext:") || id.startsWith("http:");
}

// ---------------------------------------------------------------------------
// HTTP route-segment matching
// ---------------------------------------------------------------------------

/**
 * Normalise a URL path: trim trailing slash (except root "/"), lower-case.
 */
function normalisePath(p: string): string {
  const s = p.toLowerCase().replace(/\/+$/, "") || "/";
  return s;
}

/**
 * Split a path into segments, filtering empty strings produced by leading "/".
 */
function segments(p: string): string[] {
  return p.split("/").filter(Boolean);
}

/**
 * True if a route definition segment is dynamic (:param or [param] styles).
 */
function isDynamic(seg: string): boolean {
  return seg.startsWith(":") || (seg.startsWith("[") && seg.endsWith("]"));
}

/**
 * True if definedPath (a route pattern) matches clientPath (a concrete path).
 * Rules:
 *   - same number of segments
 *   - each segment either matches literally, or the defined segment is dynamic
 *   - trailing-slash normalised before comparison
 */
function pathMatches(definedPath: string, clientPath: string): boolean {
  const defSegs = segments(normalisePath(definedPath));
  const cliSegs = segments(normalisePath(clientPath));
  if (defSegs.length !== cliSegs.length) return false;
  for (let i = 0; i < defSegs.length; i++) {
    if (!isDynamic(defSegs[i]!) && defSegs[i] !== cliSegs[i]) return false;
  }
  return true;
}

/**
 * Parse a node's HTTP method+path from its name or data_shape.
 * Acceptable formats: "METHOD /path", "METHOD: /path".
 * Returns null if unparseable.
 */
function parseEndpointDef(node: SutraNode): { method: string; path: string } | null {
  const sources = [node.name, node.data_shape ?? ""];
  for (const src of sources) {
    const m = src.match(/^([A-Z]+):?\s+(\/[^\s]*)$/i);
    if (m) {
      return { method: m[1]!.toUpperCase(), path: m[2]! };
    }
  }
  return null;
}

/**
 * Parse "METHOD /path" out of an httpTargetId ("http:METHOD /path").
 */
function parseHttpTargetId(id: string): { method: string; path: string } | null {
  const body = id.slice("http:".length).trim(); // "METHOD /path"
  const m = body.match(/^([A-Z]+)\s+(\/[^\s]*)$/i);
  if (!m) return null;
  return { method: m[1]!.toUpperCase(), path: m[2]! };
}

// ---------------------------------------------------------------------------
// Proxy prefix helpers
// ---------------------------------------------------------------------------

/**
 * Collect proxy prefixes from nodes emitted by scanner's detectProxyNodes().
 * These are "route" nodes whose name starts with "PROXY ".
 */
function collectProxyPrefixes(nodes: SutraNode[]): string[] {
  const prefixes: string[] = [];
  for (const n of nodes) {
    if (n.type === "route" && n.name.startsWith("PROXY ")) {
      const prefix = n.name.slice("PROXY ".length); // e.g. '/api'
      prefixes.push(prefix);
    }
  }
  return prefixes;
}

/**
 * True if `urlPath` is covered by any known proxy prefix.
 * Segment-aware: '/api' covers '/api/x' but NOT '/apixyz'.
 * The special prefix '/' covers everything.
 */
function isCoveredByProxy(urlPath: string, proxyPrefixes: string[]): boolean {
  for (const prefix of proxyPrefixes) {
    if (prefix === "/") return true; // catch-all
    // Must be exact match OR urlPath starts with prefix + '/'
    if (urlPath === prefix) return true;
    if (urlPath.startsWith(prefix + "/")) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Check 1 — orphaned_endpoint
// ---------------------------------------------------------------------------
/**
 * For every edge with kind "http", confirm that some endpoint node covers
 * that METHOD+path. Flag when no endpoint node matches AND the path is not
 * covered by a proxy prefix (which intentionally routes it out of the repo).
 */
function checkOrphanedEndpoints(
  nodes: SutraNode[],
  edges: SutraEdge[],
  nodeMap: Map<string, SutraNode>,
): SutraIssue[] {
  // Build list of defined endpoints once.
  const endpointDefs: Array<{ method: string; path: string }> = [];
  for (const n of nodes) {
    if (n.type === "endpoint" || n.type === "route") {
      const def = parseEndpointDef(n);
      if (def) endpointDefs.push(def);
    }
  }

  // Collect proxy prefixes so proxied calls are not flagged.
  const proxyPrefixes = collectProxyPrefixes(nodes);

  const seen = new Set<string>();
  const issues: SutraIssue[] = [];

  for (const edge of edges) {
    if (edge.kind !== "http") continue;
    if (!edge.to.startsWith("http:")) continue; // malformed synthetic id — skip

    const target = parseHttpTargetId(edge.to);
    if (!target) continue;

    const { method, path } = target;
    const dedupeKey = `${method} ${normalisePath(path)}`;
    if (seen.has(dedupeKey)) continue;

    // Skip paths that are intentionally proxied out of the repo.
    if (isCoveredByProxy(path, proxyPrefixes)) continue;

    const matched = endpointDefs.some(
      (def) =>
        def.method === method && pathMatches(def.path, path),
    );

    if (!matched) {
      seen.add(dedupeKey);
      issues.push({
        severity: "error",
        kind: "orphaned_endpoint",
        node: `${method} ${path}`,
        feature: featureOf(nodeMap, edge.from),
        message: `Client calls ${method} ${path} but no route handler defines it.`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Check 2 — missing_handler
// ---------------------------------------------------------------------------

/**
 * Non-JS/TS asset extensions that are deliberately not scanned.
 * An "imports" edge to one of these is not a broken handler reference.
 */
const ASSET_EXTENSIONS = new Set([
  ".css", ".scss", ".sass", ".less",
  ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico",
  ".json", ".md",
  ".woff", ".woff2", ".ttf",
  ".mp4", ".webm", ".wasm",
]);

/**
 * True if the target id refers to an asset file (by extension).
 * The id may be a posix path like "src/styles/globals.css" or
 * "src/styles/globals.css#symbol" — check the extension of the path part.
 */
function isAssetTarget(toId: string): boolean {
  // Strip symbol fragment if present
  const pathPart = toId.includes("#") ? toId.slice(0, toId.indexOf("#")) : toId;
  const ext = pathPart.slice(pathPart.lastIndexOf(".")).toLowerCase();
  return ASSET_EXTENSIONS.has(ext);
}

/**
 * For edges of kind calls|renders|imports whose .to is a local (non-ext:,
 * non-http:) id absent from the node set → flag.
 * Asset imports (.css, .svg, .png, etc.) are silently skipped — they are not
 * handlers or symbols.
 */
function checkMissingHandlers(
  edges: SutraEdge[],
  nodeMap: Map<string, SutraNode>,
): SutraIssue[] {
  const seen = new Set<string>();
  const issues: SutraIssue[] = [];

  for (const edge of edges) {
    if (
      edge.kind !== "calls" &&
      edge.kind !== "renders" &&
      edge.kind !== "imports"
    ) {
      continue;
    }
    if (isExternal(edge.to)) continue;
    if (nodeMap.has(edge.to)) continue;
    // Skip asset imports — they are not scanned and are not handlers/symbols.
    if (isAssetTarget(edge.to)) continue;

    if (seen.has(edge.to)) continue;
    seen.add(edge.to);

    issues.push({
      severity: "error",
      kind: "missing_handler",
      node: edge.to,
      feature: featureOf(nodeMap, edge.from),
      message: `${edge.to} references handler/symbol that does not exist in the repo.`,
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Check 3 — dangling_test_ref
// ---------------------------------------------------------------------------
/**
 * For edges of kind "tests" from test nodes, if .to is local and absent from
 * the node set → flag (the subject under test no longer exists).
 */
function checkDanglingTestRefs(
  nodes: SutraNode[],
  edges: SutraEdge[],
  nodeMap: Map<string, SutraNode>,
): SutraIssue[] {
  // Build set of test node ids for quick membership check.
  const testNodeIds = new Set<string>();
  for (const n of nodes) {
    if (n.type === "test") testNodeIds.add(n.id);
  }

  const seen = new Set<string>();
  const issues: SutraIssue[] = [];

  for (const edge of edges) {
    if (edge.kind !== "tests") continue;
    if (!testNodeIds.has(edge.from)) continue; // only from test nodes
    if (isExternal(edge.to)) continue;
    if (nodeMap.has(edge.to)) continue;

    if (seen.has(edge.to)) continue;
    seen.add(edge.to);

    issues.push({
      severity: "error",
      kind: "dangling_test_ref",
      node: edge.to,
      feature: featureOf(nodeMap, edge.from),
      message: `Test references '${edge.to}' which no longer exists in the repo.`,
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function runChecks(nodes: SutraNode[], edges: SutraEdge[]): SutraIssue[] {
  const nodeMap = buildNodeMap(nodes);

  return [
    ...checkOrphanedEndpoints(nodes, edges, nodeMap),
    ...checkMissingHandlers(edges, nodeMap),
    ...checkDanglingTestRefs(nodes, edges, nodeMap),
  ];
}
