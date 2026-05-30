/**
 * STATIC candidate findings only. Dynamic dispatch, aliased imports, and
 * runtime-generated routes may produce false positives or misses.
 * These are approximations to guide human review, not definitive bug reports.
 */

import type { SutraNode, SutraEdge, SutraIssue, SutraContract, Provenance } from "./types.js";
import { confidenceForProvenance } from "./types.js";
import {
  pathMatches,
  parseEndpointDef,
  parseHttpTargetId,
  collectProxyPrefixes,
  isCoveredByProxy,
  collectExternalHosts,
  normalisePath,
} from "./util/http-match.js";

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
  const externalHosts = new Set(collectExternalHosts(nodes));

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

    // Skip fetches to known external API hosts (Telegram, Stripe, etc.).
    if (target.host && externalHosts.has(target.host)) continue;

    const matched = endpointDefs.some(
      (def) =>
        def.method === method && pathMatches(def.path, path),
    );

    if (!matched) {
      seen.add(dedupeKey);
      const provenance: Provenance = edge.provenance ?? "heuristic";
      issues.push({
        severity: "error",
        kind: "orphaned_endpoint",
        node: `${method} ${path}`,
        feature: featureOf(nodeMap, edge.from),
        message: `Client calls ${method} ${path} but no route handler defines it.`,
        provenance,
        confidence: confidenceForProvenance(provenance),
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
      provenance: "ast-exact",
      confidence: confidenceForProvenance("ast-exact"),
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
      provenance: "ast-exact",
      confidence: confidenceForProvenance("ast-exact"),
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Check 4 — contract drift (declared vs observed routes)
// ---------------------------------------------------------------------------

/**
 * Compare author-declared endpoints in feature.sutra.md against route nodes
 * in the graph. Candidate static comparison only — not runtime verification.
 */
export function checkContractDrift(
  contracts: SutraContract[],
  nodes: SutraNode[],
): SutraIssue[] {
  if (contracts.length === 0) return [];

  const routeDefs: Array<{ method: string; path: string; feature: string }> = [];
  for (const n of nodes) {
    if (n.type !== "endpoint" && n.type !== "route") continue;
    const def = parseEndpointDef(n);
    if (def) routeDefs.push({ ...def, feature: n.feature });
  }

  const declared: Array<{ method: string; path: string; feature: string; file: string }> = [];
  for (const c of contracts) {
    for (const ep of c.endpoints) {
      declared.push({ method: ep.method, path: ep.path, feature: c.feature, file: c.file });
    }
  }

  const seen = new Set<string>();
  const issues: SutraIssue[] = [];

  for (const ep of declared) {
    const key = `${ep.method} ${normalisePath(ep.path)}`;
    if (seen.has(`missing:${key}`)) continue;

    const matched = routeDefs.some(
      (def) => def.method === ep.method && pathMatches(ep.path, def.path),
    );

    if (!matched) {
      seen.add(`missing:${key}`);
      issues.push({
        severity: "error",
        kind: "contract_missing_route",
        node: `${ep.method} ${ep.path}`,
        feature: ep.feature,
        message: `Contract in ${ep.file} declares ${ep.method} ${ep.path} but no route handler defines it.`,
      });
    }
  }

  for (const def of routeDefs) {
    const key = `${def.method} ${normalisePath(def.path)}`;
    if (seen.has(`undeclared:${key}`)) continue;

    const matched = declared.some(
      (ep) => ep.method === def.method && pathMatches(ep.path, def.path),
    );

    if (!matched) {
      seen.add(`undeclared:${key}`);
      issues.push({
        severity: "warn",
        kind: "contract_undeclared_route",
        node: `${def.method} ${def.path}`,
        feature: def.feature,
        message: `Route ${def.method} ${def.path} exists but is not declared in any contract file.`,
      });
    }
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
