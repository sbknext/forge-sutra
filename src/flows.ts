/**
 * Request flow tracing — ordered entry → terminal paths from graph structure.
 * Code-derived only; candidate when http hops are unresolved or dynamic.
 */

import type {
  SutraNode,
  SutraEdge,
  SutraFlow,
  SutraFlowStep,
  FlowTerminal,
} from "./types.js";
import {
  pathMatches,
  parseEndpointDef,
  parseHttpTargetId,
  collectProxyPrefixes,
  isCoveredByProxy,
  collectExternalHosts,
  matchUsedDynamicSegment,
} from "./util/http-match.js";
import {
  extractFrappeCandidatesFromPath,
  isFrappeDottedEndpoint,
  normaliseFrappeDotted,
} from "./util/frappe-match.js";

const FLOW_KINDS = new Set<SutraEdge["kind"]>(["renders", "calls", "http"]);
const MAX_DEPTH = 32;

const DB_NAME_RE = /^(query|execute|raw|transaction)$/i;
const DB_MODULE_RE = /(?:^|\/)(db|database|prisma|knex|drizzle|sql)/i;

export interface CrossRepoEndpoint {
  method: string;
  path: string;
  handlerId: string;
  repo?: string;
}

export interface CrossRepoIndex {
  endpoints: CrossRepoEndpoint[];
}

export interface BuildFlowsResult {
  flows: SutraFlow[];
  confirmed: number;
  candidate: number;
}

function buildNodeMap(nodes: SutraNode[]): Map<string, SutraNode> {
  const m = new Map<string, SutraNode>();
  for (const n of nodes) m.set(n.id, n);
  return m;
}

function moduleIdFor(nodeId: string, nodeMap: Map<string, SutraNode>): string | null {
  const node = nodeMap.get(nodeId);
  if (!node) return null;
  if (nodeId === node.file) return nodeId;
  return node.file;
}

function outgoingFlowEdges(
  current: string,
  adj: Map<string, SutraEdge[]>,
  nodeMap: Map<string, SutraNode>,
): SutraEdge[] {
  const direct = (adj.get(current) ?? []).filter((e) => FLOW_KINDS.has(e.kind));
  if (direct.length > 0) return direct;
  const mod = moduleIdFor(current, nodeMap);
  if (mod && mod !== current) {
    return (adj.get(mod) ?? []).filter((e) => FLOW_KINDS.has(e.kind));
  }
  return [];
}

function buildAdjacency(edges: SutraEdge[]): Map<string, SutraEdge[]> {
  const adj = new Map<string, SutraEdge[]>();
  for (const e of edges) {
    if (!FLOW_KINDS.has(e.kind)) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e);
  }
  for (const list of adj.values()) {
    list.sort((a, b) => a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind));
  }
  return adj;
}

/**
 * Frappe whitelist endpoints are declared API surfaces — they are entries
 * unconditionally (even when edge resolution produced no outgoing flow edges).
 * This prevents empty flows when upstream resolution is partial or missing.
 */
function isFrappeEndpointEntry(node: SutraNode): boolean {
  return node.type === "endpoint" && node.language === "python-frappe";
}

function findEntryPoints(
  nodes: SutraNode[],
  edges: SutraEdge[],
  adj: Map<string, SutraEdge[]>,
): SutraNode[] {
  const rendered = new Set<string>();
  for (const e of edges) {
    if (e.kind === "renders") rendered.add(e.to);
  }
  const entries: SutraNode[] = [];
  const seen = new Set<string>();

  for (const n of nodes) {
    if ((n.type === "route" || n.type === "component") && !rendered.has(n.id)) {
      entries.push(n);
      seen.add(n.id);
    }
  }

  for (const n of nodes) {
    if (n.type !== "endpoint" || seen.has(n.id)) continue;
    const out = (adj.get(n.id) ?? []).filter((e) => FLOW_KINDS.has(e.kind));
    // Frappe whitelisted endpoints are always entries (declared API surface).
    // Non-Frappe endpoints are entries only when they have outgoing flow edges.
    if (isFrappeEndpointEntry(n) || out.length > 0) {
      entries.push(n);
      seen.add(n.id);
    }
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

function findFrappeHandlerByHttpPath(
  nodes: SutraNode[],
  urlPath: string,
): { handlerId: string; dynamic: boolean } | null {
  const candidates = extractFrappeCandidatesFromPath(urlPath).map(normaliseFrappeDotted);
  if (candidates.length === 0) return null;
  for (const n of nodes) {
    if (n.type !== "endpoint" || !isFrappeDottedEndpoint(n.name)) continue;
    const norm = normaliseFrappeDotted(n.name);
    if (candidates.some((c) => c === norm || norm.endsWith(c) || c.endsWith(norm))) {
      return { handlerId: n.id, dynamic: false };
    }
  }
  return null;
}

function findEndpointHandler(
  nodes: SutraNode[],
  method: string,
  urlPath: string,
): { handlerId: string; dynamic: boolean } | null {
  const frappe = findFrappeHandlerByHttpPath(nodes, urlPath);
  if (frappe) return frappe;

  let best: { handlerId: string; dynamic: boolean } | null = null;
  for (const n of nodes) {
    if (n.type !== "endpoint" && n.type !== "route") continue;
    const def = parseEndpointDef(n);
    if (!def || def.method !== method) continue;
    if (!pathMatches(def.path, urlPath)) continue;
    const dynamic = matchUsedDynamicSegment(def.path, urlPath);
    const handlerId =
      nodes.find(
        (h) =>
          h.file === n.file &&
          (h.type === "handler" || h.name === method),
      )?.id ?? n.id;
    if (!best || (!best.dynamic && dynamic)) {
      best = { handlerId, dynamic };
    }
  }
  return best;
}

function resolveCrossRepo(
  index: CrossRepoIndex | undefined,
  method: string,
  urlPath: string,
): { handlerId: string; dynamic: boolean } | null {
  if (!index) return null;
  for (const ep of index.endpoints) {
    if (ep.method !== method) continue;
    if (!pathMatches(ep.path, urlPath)) continue;
    return {
      handlerId: ep.handlerId,
      dynamic: matchUsedDynamicSegment(ep.path, urlPath),
    };
  }
  return null;
}

function detectTerminal(
  handlerId: string,
  nodeMap: Map<string, SutraNode>,
  adj: Map<string, SutraEdge[]>,
  externalHosts: Set<string>,
): { terminal: FlowTerminal; candidate: boolean; extraStep?: SutraFlowStep } {
  const node = nodeMap.get(handlerId);
  if (!node) return { terminal: "handler", candidate: false };

  const outbound = [
    ...(adj.get(handlerId) ?? []),
    ...(adj.get(node.file) ?? []),
    ...[...adj.entries()]
      .filter(([from]) => from.startsWith(node.file))
      .flatMap(([, es]) => es),
  ];

  for (const e of outbound) {
    if (e.kind === "http" && e.to.startsWith("http:")) {
      const target = parseHttpTargetId(e.to);
      if (target?.host && externalHosts.has(target.host)) {
        return {
          terminal: "external",
          candidate: true,
          extraStep: { node: e.to, edge: e },
        };
      }
    }
    if (e.kind === "calls") {
      const target = nodeMap.get(e.to);
      if (target) {
        const isDb =
          DB_NAME_RE.test(target.name) ||
          DB_MODULE_RE.test(target.file) ||
          DB_MODULE_RE.test(target.id);
        if (isDb) {
          return {
            terminal: "db",
            candidate: false,
            extraStep: { node: e.to, edge: e },
          };
        }
      }
    }
  }

  return { terminal: "handler", candidate: false };
}

interface WalkState {
  steps: SutraFlowStep[];
  candidate: boolean;
  terminal: FlowTerminal;
}

function walkFromEntry(
  entry: SutraNode,
  nodeMap: Map<string, SutraNode>,
  adj: Map<string, SutraEdge[]>,
  nodes: SutraNode[],
  proxyPrefixes: string[],
  externalHosts: Set<string>,
  crossRepoIndex: CrossRepoIndex | undefined,
): WalkState {
  const steps: SutraFlowStep[] = [{ node: entry.id, edge: null }];
  const visited = new Set<string>([entry.id]);
  let candidate = false;
  let terminal: FlowTerminal = "handler";
  let current = entry.id;
  let depth = 0;

  while (depth < MAX_DEPTH) {
    const outEdges = outgoingFlowEdges(current, adj, nodeMap);
    if (outEdges.length === 0) break;

    const edge = outEdges[0]!;
    const nextId = edge.to;

    if (edge.kind === "http" && nextId.startsWith("http:")) {
      const target = parseHttpTargetId(nextId);
      if (!target) {
        terminal = "unresolved";
        candidate = true;
        steps.push({ node: nextId, edge });
        break;
      }

      if (isCoveredByProxy(target.path, proxyPrefixes)) {
        // Next.js App Router: local route handlers always take precedence over
        // rewrites.  Check for a local handler FIRST before treating this as a
        // proxy hop.  Only fall through to cross-repo / unresolved when no
        // local handler exists for the same method + path.
        const localFirst = findEndpointHandler(nodes, target.method, target.path);
        if (localFirst) {
          if (localFirst.dynamic) candidate = true;
          if (edge.provenance === "template-prefix") candidate = true;
          if (visited.has(localFirst.handlerId)) {
            terminal = "truncated";
            candidate = true;
            break;
          }
          visited.add(localFirst.handlerId);
          steps.push({ node: localFirst.handlerId, edge });
          current = localFirst.handlerId;
          const det = detectTerminal(localFirst.handlerId, nodeMap, adj, externalHosts);
          terminal = det.terminal;
          if (det.candidate) candidate = true;
          if (det.extraStep) steps.push(det.extraStep);
          break;
        }

        const cross = resolveCrossRepo(crossRepoIndex, target.method, target.path);
        if (cross) {
          if (cross.dynamic) candidate = true;
          if (visited.has(cross.handlerId)) {
            terminal = "truncated";
            candidate = true;
            break;
          }
          visited.add(cross.handlerId);
          steps.push({ node: cross.handlerId, edge });
          current = cross.handlerId;
          const det = detectTerminal(cross.handlerId, nodeMap, adj, externalHosts);
          terminal = det.terminal;
          if (det.candidate) candidate = true;
          if (det.extraStep) steps.push(det.extraStep);
          break;
        }
        terminal = "unresolved";
        candidate = true;
        steps.push({ node: nextId, edge });
        break;
      }

      const local = findEndpointHandler(nodes, target.method, target.path);
      if (local) {
        if (local.dynamic) candidate = true;
        if (edge.provenance === "template-prefix") candidate = true;
        if (visited.has(local.handlerId)) {
          terminal = "truncated";
          candidate = true;
          break;
        }
        visited.add(local.handlerId);
        steps.push({ node: local.handlerId, edge });
        current = local.handlerId;
        const det = detectTerminal(local.handlerId, nodeMap, adj, externalHosts);
        terminal = det.terminal;
        if (det.candidate) candidate = true;
        if (det.extraStep) steps.push(det.extraStep);
        break;
      }

      terminal = "unresolved";
      candidate = true;
      steps.push({ node: nextId, edge });
      break;
    }

    if (visited.has(nextId)) {
      terminal = "truncated";
      candidate = true;
      break;
    }
    visited.add(nextId);
    steps.push({ node: nextId, edge });
    current = nextId;
    depth++;
  }

  if (depth >= MAX_DEPTH) {
    terminal = "truncated";
    candidate = true;
  }

  return { steps, candidate, terminal };
}

export function buildFlows(
  nodes: SutraNode[],
  edges: SutraEdge[],
  crossRepoIndex?: CrossRepoIndex,
): BuildFlowsResult {
  const nodeMap = buildNodeMap(nodes);
  const adj = buildAdjacency(edges);
  const proxyPrefixes = collectProxyPrefixes(nodes);
  const externalHosts = new Set(collectExternalHosts(nodes));
  const entries = findEntryPoints(nodes, edges, adj);

  const flows: SutraFlow[] = [];

  for (const entry of entries) {
    const { steps, candidate, terminal } = walkFromEntry(
      entry,
      nodeMap,
      adj,
      nodes,
      proxyPrefixes,
      externalHosts,
      crossRepoIndex,
    );

    if (steps.length < 2) continue;

    const hasHttp = steps.some((s) => s.edge?.kind === "http");
    const hasCalls = steps.some((s) => s.edge?.kind === "calls");
    const confirmed =
      !candidate &&
      (hasHttp || hasCalls) &&
      terminal !== "unresolved";

    flows.push({
      id: `flow:${entry.id}`,
      entry: entry.id,
      steps,
      terminal,
      confidence: confirmed ? "confirmed" : "candidate",
    });
  }

  flows.sort((a, b) => a.id.localeCompare(b.id));

  let confirmedCount = 0;
  let candidateCount = 0;
  for (const f of flows) {
    if (f.confidence === "confirmed") confirmedCount++;
    else candidateCount++;
  }

  return { flows, confirmed: confirmedCount, candidate: candidateCount };
}
