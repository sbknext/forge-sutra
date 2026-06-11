/**
 * Story 3.5 / 1.5.1 — live watch mode: incremental re-scan + SSE push to viewer.
 * Reuses runScanPipeline; viewer stays a leaf consumer.
 * AC: changedFeatureIds delta injected into SSE payload for card highlighting.
 */

import path from "node:path";
import { execSync } from "node:child_process";
import chokidar from "chokidar";
import { runScanPipeline } from "./watch.js";
import { startViewerServer, DEFAULT_VIEWER_PORT } from "./viewer/server.js";
import {
  EXCLUDED_DIRS,
  SCAN_EXTENSIONS,
  type SutraGraph,
} from "./types.js";

/** Default debounce window (ms). Configurable via --debounce flag. */
export const WATCH_DEBOUNCE_MS = 500;

export interface RunWatchOptions {
  port?: number;
  debounceMs?: number;
  open?: boolean;
}

export interface RunWatchHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

function getCommit(repoRoot: string): string {
  try {
    return execSync(`git -C "${repoRoot}" rev-parse --short HEAD`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

function chokidarIgnored(relativePath: string): boolean {
  const parts = relativePath.split(/[/\\]/);
  for (const part of parts) {
    if (EXCLUDED_DIRS.has(part)) return true;
  }
  const ext = path.extname(relativePath);
  if (ext && !SCAN_EXTENSIONS.has(ext)) return true;
  return false;
}

/** Run watch: initial scan, viewer server with SSE, debounced re-scan on FS change. */
export async function runWatch(
  repoRoot: string,
  cwd: string,
  opts?: RunWatchOptions,
): Promise<RunWatchHandle> {
  const commit = getCommit(repoRoot);
  const debounceMs = opts?.debounceMs ?? WATCH_DEBOUNCE_MS;
  const port = opts?.port ?? DEFAULT_VIEWER_PORT;

  const server = await startViewerServer(cwd, { port, sse: true });

  let lastGoodGraph: SutraGraph | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let scanning = false;

  const doScan = (): void => {
    if (scanning) return;
    scanning = true;
    try {
      const result = runScanPipeline(repoRoot, cwd, commit);
      const prevGraph = lastGoodGraph;
      lastGoodGraph = result.graph;

      // Print incremental cache stats: N cached · M parsed
      if (result.cacheStats) {
        const { hits, misses } = result.cacheStats;
        process.stderr.write(`  cache: ${hits} cached · ${misses} parsed\n`);
      }

      // Compute delta for changed-card highlighting (candidate UI)
      const changedFeatureIds = prevGraph
        ? computeChangedFeatureIds(prevGraph, result.graph)
        : [];

      // Inject changedFeatureIds alongside the full graph in the SSE payload
      const payload = { ...result.graph, changedFeatureIds };
      server.broadcastGraph?.(payload);
    } catch (err) {
      server.broadcastScanError?.(String(err));
    } finally {
      scanning = false;
    }
  };

  doScan();

  const watcher = chokidar.watch(repoRoot, {
    ignored: (p) => {
      const rel = path.relative(repoRoot, p);
      if (!rel || rel === ".") return false;
      return chokidarIgnored(rel);
    },
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
  });

  const scheduleScan = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(doScan, debounceMs);
  };

  watcher.on("all", scheduleScan);

  return {
    url: server.url,
    port: server.port,
    close: async () => {
      if (timer) clearTimeout(timer);
      await watcher.close();
      await server.close();
    },
  };
}

export function graphBodyForCompare(
  graph: SutraGraph,
): Omit<SutraGraph, "scanned_at" | "commit"> {
  const { scanned_at: _, commit: __, ...rest } = graph;
  return rest;
}

/**
 * Compute which feature IDs changed between prev and next scan.
 * "Changed" = node_ids set, issue_count, or health.score differs.
 * Candidate label: structural change only — not semantic code meaning.
 */
export function computeChangedFeatureIds(
  prev: SutraGraph,
  next: SutraGraph,
): string[] {
  const prevMap = new Map(prev.features.map((f) => [f.id, f]));
  const changed: string[] = [];

  for (const feat of next.features) {
    const p = prevMap.get(feat.id);
    if (!p) {
      // new feature — mark as changed
      changed.push(feat.id);
      continue;
    }
    const prevNodeSet = new Set(p.node_ids);
    const nodeSetChanged =
      feat.node_ids.length !== p.node_ids.length ||
      feat.node_ids.some((id) => !prevNodeSet.has(id));
    const issueCountChanged = feat.issue_count !== p.issue_count;
    const healthChanged =
      (feat.health?.score ?? null) !== (p.health?.score ?? null);

    if (nodeSetChanged || issueCountChanged || healthChanged) {
      changed.push(feat.id);
    }
  }

  return changed;
}
