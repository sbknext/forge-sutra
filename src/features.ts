import { type SutraNode, type SutraIssue, type SutraFeature } from "./types.js";

/**
 * Group nodes by their heuristic .feature id and count associated issues.
 * Returns SutraFeature[] sorted by id (ascending).
 */
export function buildFeatures(
  nodes: SutraNode[],
  issues: SutraIssue[]
): SutraFeature[] {
  // Build a map: feature id -> node ids
  const featureNodes = new Map<string, string[]>();
  for (const node of nodes) {
    const feat = node.feature;
    if (!featureNodes.has(feat)) featureNodes.set(feat, []);
    featureNodes.get(feat)!.push(node.id);
  }

  // Count issues per feature
  const issueCount = new Map<string, number>();
  for (const issue of issues) {
    const f = issue.feature;
    issueCount.set(f, (issueCount.get(f) ?? 0) + 1);
  }

  // Build features array
  const features: SutraFeature[] = [];
  for (const [id, node_ids] of featureNodes) {
    features.push({
      id,
      label: toTitleCase(id),
      node_ids,
      issue_count: issueCount.get(id) ?? 0,
    });
  }

  // Sort by id
  features.sort((a, b) => a.id.localeCompare(b.id));
  return features;
}

function toTitleCase(s: string): string {
  return s
    .split(/[-_/\s]+/)
    .map((word) =>
      word.length === 0 ? "" : word[0].toUpperCase() + word.slice(1)
    )
    .join(" ");
}
