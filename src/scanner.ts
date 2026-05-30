/**
 * Scan orchestrator — selects extractors, merges results.
 * Language-specific logic lives in src/extractors/*.
 */

import path from "node:path";
import type { SutraNode, SutraEdge } from "./types.js";
import { TsExtractor } from "./extractors/ts.js";
import type { Extractor } from "./extractor.js";

export { collectFiles } from "./extractors/ts.js";

const EXTRACTORS: Extractor[] = [new TsExtractor()];

export function scan(repoRoot: string): { nodes: SutraNode[]; edges: SutraEdge[] } {
  const absRoot = path.resolve(repoRoot);
  const allNodes: SutraNode[] = [];
  const allEdges: SutraEdge[] = [];

  for (const extractor of EXTRACTORS) {
    if (extractor.appliesTo && !extractor.appliesTo(absRoot)) continue;
    const result = extractor.extract({ repoRoot: absRoot });
    allNodes.push(...result.nodes);
    allEdges.push(...result.edges);
  }

  return { nodes: allNodes, edges: allEdges };
}

/** Registered extractors (ordered). */
export function registeredExtractors(): readonly Extractor[] {
  return EXTRACTORS;
}
