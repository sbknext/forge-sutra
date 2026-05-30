/**
 * Story 3.6 — pure graph filter matching (deterministic substring).
 */

import type { SutraGraph, SutraFeature, SutraNode, SutraIssue, HealthBand } from "../types.js";
import type { ViewFilterState } from "./viewState.js";

function matchesSearch(text: string, query: string): boolean {
  if (!query) return true;
  return text.toLowerCase().includes(query.toLowerCase());
}

function featureBand(feat: SutraFeature): HealthBand | "unscored" {
  if (!feat.health?.band) return "unscored";
  return feat.health.band;
}

function passesBandFilter(band: HealthBand | "unscored", state: ViewFilterState): boolean {
  const activeBands = state.bands.length > 0;
  if (!activeBands && state.unscored) return true;
  if (band === "unscored") return state.unscored;
  if (!activeBands) return true;
  return state.bands.includes(band);
}

function passesConfidence(feat: SutraFeature, graph: SutraGraph, threshold: number): boolean {
  if (threshold <= 0) return true;
  const featIssues = graph.issues.filter((i) => i.feature === feat.id);
  const nodes = graph.nodes.filter((n) => feat.node_ids.includes(n.id));

  for (const n of nodes) {
    if (n.confidence === undefined) continue;
    if (n.confidence >= threshold) return true;
  }
  for (const i of featIssues) {
    if (i.confidence === undefined) continue;
    if (i.confidence >= threshold) return true;
  }
  const hasScored = nodes.some((n) => n.confidence !== undefined) || featIssues.some((i) => i.confidence !== undefined);
  return !hasScored && threshold === 0;
}

export function featureMatchesFilter(
  graph: SutraGraph,
  feat: SutraFeature,
  state: ViewFilterState,
): boolean {
  if (!passesBandFilter(featureBand(feat), state)) return false;

  const featIssues = graph.issues.filter((i) => i.feature === feat.id);
  if (state.issueKinds.length > 0) {
    if (!featIssues.some((i) => state.issueKinds.includes(i.kind))) return false;
  }

  const q = state.search.trim();
  if (q) {
    const nameMatch =
      matchesSearch(feat.label, q) || (feat.ai_name && matchesSearch(feat.ai_name, q));
    const nodeMatch = graph.nodes
      .filter((n) => feat.node_ids.includes(n.id))
      .some((n) => matchesSearch(n.name, q) || matchesSearch(n.id, q));
    if (!nameMatch && !nodeMatch) return false;
  }

  if (!passesConfidence(feat, graph, state.confidence)) return false;

  return true;
}

export function filterGraphFeatures(
  graph: SutraGraph,
  state: ViewFilterState,
): SutraFeature[] {
  return graph.features.filter((f) => featureMatchesFilter(graph, f, state));
}

export function distinctIssueKinds(graph: SutraGraph): string[] {
  return [...new Set(graph.issues.map((i) => i.kind))].sort();
}

export function countVisible(
  graph: SutraGraph,
  state: ViewFilterState,
): { features: number; nodes: number; totalFeatures: number; totalNodes: number } {
  const visible = filterGraphFeatures(graph, state);
  const nodeIds = new Set<string>();
  for (const f of visible) {
    for (const id of f.node_ids) nodeIds.add(id);
  }
  return {
    features: visible.length,
    nodes: nodeIds.size,
    totalFeatures: graph.features.length,
    totalNodes: graph.nodes.length,
  };
}
