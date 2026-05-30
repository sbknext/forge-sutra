/**
 * Story 1.5 — incremental scan cache (content-hash per file).
 * Stores per-file node/edge contributions under .sutra/cache/index.json.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { GRAPH_VERSION, type SutraEdge, type SutraNode } from "./types.js";

export const CACHE_VERSION = 1;

export const CACHE_DIR = "cache";
export const CACHE_INDEX = "index.json";

export interface CacheEntry {
  contentHash: string;
  graphVersion: number;
  cacheVersion: number;
  nodes: SutraNode[];
  edges: SutraEdge[];
}

export interface CacheIndex {
  cacheVersion: number;
  entries: Record<string, CacheEntry>;
}

export interface CacheStats {
  hits: number;
  misses: number;
}

export function hashContent(content: string | Buffer): string {
  return createHash("sha1").update(content).digest("hex");
}

export function cacheIndexPath(cacheRoot: string): string {
  return path.join(cacheRoot, CACHE_INDEX);
}

/** Read cache index; returns empty index on missing/corrupt/version mismatch. Never throws. */
export function loadCache(cacheRoot: string): CacheIndex {
  const indexPath = cacheIndexPath(cacheRoot);
  try {
    if (!fs.existsSync(indexPath)) {
      return { cacheVersion: CACHE_VERSION, entries: {} };
    }
    const raw = fs.readFileSync(indexPath, "utf8");
    const parsed = JSON.parse(raw) as CacheIndex;
    if (parsed.cacheVersion !== CACHE_VERSION || typeof parsed.entries !== "object") {
      return { cacheVersion: CACHE_VERSION, entries: {} };
    }
    return parsed;
  } catch {
    return { cacheVersion: CACHE_VERSION, entries: {} };
  }
}

/** Write cache index with key-sorted entries for byte stability. */
export function saveCache(cacheRoot: string, index: CacheIndex): void {
  fs.mkdirSync(cacheRoot, { recursive: true });
  const sortedEntries: Record<string, CacheEntry> = {};
  for (const key of Object.keys(index.entries).sort()) {
    sortedEntries[key] = index.entries[key]!;
  }
  const payload: CacheIndex = {
    cacheVersion: CACHE_VERSION,
    entries: sortedEntries,
  };
  fs.writeFileSync(cacheIndexPath(cacheRoot), JSON.stringify(payload, null, 2), "utf8");
}

export function isCacheHit(
  entry: CacheEntry | undefined,
  contentHash: string,
): boolean {
  if (!entry) return false;
  return (
    entry.contentHash === contentHash &&
    entry.graphVersion === GRAPH_VERSION &&
    entry.cacheVersion === CACHE_VERSION
  );
}

export function sortNodes(nodes: SutraNode[]): SutraNode[] {
  return [...nodes].sort((a, b) => a.id.localeCompare(b.id));
}

export function sortEdges(edges: SutraEdge[]): SutraEdge[] {
  return [...edges].sort((a, b) => {
    const ka = `${a.from}|${a.to}|${a.kind}`;
    const kb = `${b.from}|${b.to}|${b.kind}`;
    return ka.localeCompare(kb);
  });
}
