/**
 * Scan orchestrator — selects extractors, merges results.
 * Language-specific logic lives in src/extractors/*.
 */

import path from "node:path";
import type { SutraNode, SutraEdge } from "./types.js";
import { CACHE_DIR } from "./cache.js";
import type { CacheStats } from "./cache.js";
import { TsExtractor } from "./extractors/ts.js";
import { PythonFrappeExtractor } from "./extractors/python-frappe.js";
import type { Extractor, ExtractorInput, ExtractorResult } from "./extractor.js";

export { collectFiles } from "./extractors/ts.js";

const EXTRACTORS: Extractor[] = [new TsExtractor(), new PythonFrappeExtractor()];

export interface ScanResult {
  nodes: SutraNode[];
  edges: SutraEdge[];
  cacheStats?: CacheStats;
}

export function scan(repoRoot: string, options?: { cacheRoot?: string }): ScanResult {
  const absRoot = path.resolve(repoRoot);
  const cacheRoot = options?.cacheRoot
    ? path.join(options.cacheRoot, CACHE_DIR)
    : undefined;
  const allNodes: SutraNode[] = [];
  const allEdges: SutraEdge[] = [];
  let cacheStats: CacheStats | undefined;

  for (const extractor of EXTRACTORS) {
    if (extractor.appliesTo && !extractor.appliesTo(absRoot)) continue;
    const result = extractor.extract({
      repoRoot: absRoot,
      cacheRoot: extractor.language === "ts" ? cacheRoot : undefined,
    }) as ExtractorResult & { cacheStats?: CacheStats };
    allNodes.push(...result.nodes);
    allEdges.push(...result.edges);
    if (result.cacheStats) {
      cacheStats = result.cacheStats;
    }
  }

  return { nodes: allNodes, edges: allEdges, cacheStats };
}

/** Registered extractors (ordered). */
export function registeredExtractors(): readonly Extractor[] {
  return EXTRACTORS;
}
