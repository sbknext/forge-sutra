/**
 * Story 3.3 — induced feature sub-graph (pure, unit-testable).
 */

import type { SutraGraph, SutraFeature, SutraEdge, SutraNode } from "../types.js";

export interface FeatureSubgraph {
  nodeIds: Set<string>;
  nodes: SutraNode[];
  edges: SutraEdge[];
}

/** Edges with both endpoints in feature node set; retains synthetic http:/PROXY targets. */
export function subgraph(feature: SutraFeature, graph: SutraGraph): FeatureSubgraph {
  const nodeIds = new Set(feature.node_ids);

  // Include synthetic targets reachable from feature nodes
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) continue;
    if (
      edge.to.startsWith("http:") ||
      edge.to.includes("PROXY") ||
      !graph.nodes.some((n) => n.id === edge.to)
    ) {
      nodeIds.add(edge.to);
    }
  }

  const nodes = graph.nodes.filter((n) => nodeIds.has(n.id));
  const edges = graph.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  return { nodeIds, nodes, edges };
}

/** Issues for a feature, grouped by kind, ordered by severity. */
export function featureIssues(
  graph: SutraGraph,
  featureId: string,
): Map<string, typeof graph.issues> {
  const severityOrder = { error: 0, warn: 1, info: 2 };
  const filtered = graph.issues
    .filter((i) => i.feature === featureId)
    .slice()
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const byKind = new Map<string, typeof graph.issues>();
  for (const iss of filtered) {
    if (!byKind.has(iss.kind)) byKind.set(iss.kind, []);
    byKind.get(iss.kind)!.push(iss);
  }
  return byKind;
}

/** Flows whose entry node belongs to the feature. */
export function featureFlows(graph: SutraGraph, feature: SutraFeature) {
  const nodeSet = new Set(feature.node_ids);
  return (graph.flows ?? []).filter((f) => nodeSet.has(f.entry));
}

/** Inbound/outbound edges for a node within the feature subgraph. */
export function nodeEdgesInFeature(
  nodeId: string,
  sub: FeatureSubgraph,
): { inbound: SutraEdge[]; outbound: SutraEdge[] } {
  return {
    inbound: sub.edges.filter((e) => e.to === nodeId),
    outbound: sub.edges.filter((e) => e.from === nodeId),
  };
}
