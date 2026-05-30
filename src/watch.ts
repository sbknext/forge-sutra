/**
 * SUTRA-5.1 — watch mode: debounced re-scan on file changes.
 * Re-runs static scan only — not a runtime monitor.
 */

import fs from "node:fs";
import path from "node:path";
import { scan, collectFiles } from "./scanner.js";
import { runChecks, checkContractDrift, checkUntestedFeatures } from "./checks.js";
import { buildFeatures, computeFeatureHealth } from "./features.js";
import { buildFlows } from "./flows.js";
import { loadContracts } from "./contracts.js";
import { runPostScanHooks } from "./hooks.js";
import { diffGraphs, formatDiffSummary } from "./diff.js";
import {
  GRAPH_VERSION,
  SUTRA_DIR,
  GRAPH_FILE,
  GRAPH_PREV_FILE,
  DIFF_FILE,
  SCAN_EXTENSIONS,
  EXCLUDED_DIRS,
  type SutraGraph,
} from "./types.js";

export interface ScanTimings {
  walkMs: number;
  parseMs: number;
  checksMs: number;
  writeMs: number;
  totalMs: number;
}

export interface ScanPipelineOptions {
  profile?: boolean;
  onProfile?: (timings: ScanTimings) => void;
}

export interface ScanPipelineResult {
  graph: SutraGraph;
  graphPath: string;
  diffSummary?: string;
  profile?: ScanTimings;
  flowStats?: { confirmed: number; candidate: number };
}

export interface WatchOptions {
  repoRoot: string;
  cwd: string;
  commit: string;
  debounceMs?: number;
  onRescan?: (result: ScanPipelineResult) => void;
}

/** Run full scan pipeline and write graph.json. Optionally snapshots prev + diff. */
export function runScanPipeline(
  repoRoot: string,
  cwd: string,
  commit: string,
  options?: ScanPipelineOptions,
): ScanPipelineResult {
  const totalStart = performance.now();
  const timings: ScanTimings = { walkMs: 0, parseMs: 0, checksMs: 0, writeMs: 0, totalMs: 0 };

  const outDir = path.join(cwd, SUTRA_DIR);
  const graphPath = path.join(outDir, GRAPH_FILE);
  const prevPath = path.join(outDir, GRAPH_PREV_FILE);
  const diffPath = path.join(outDir, DIFF_FILE);

  let prevGraph: SutraGraph | undefined;
  if (fs.existsSync(graphPath)) {
    try {
      prevGraph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as SutraGraph;
      fs.copyFileSync(graphPath, prevPath);
    } catch {
      // ignore corrupt prev
    }
  }

  const walkStart = performance.now();
  collectFiles(repoRoot);
  timings.walkMs = performance.now() - walkStart;

  const parseStart = performance.now();
  const { nodes, edges } = scan(repoRoot);
  timings.parseMs = performance.now() - parseStart;

  const checksStart = performance.now();
  const checkIssues = runChecks(nodes, edges);
  const { contracts, issues: contractIssues } = loadContracts(repoRoot);
  const driftIssues = checkContractDrift(contracts, nodes);
  let issues = [...checkIssues, ...contractIssues, ...driftIssues];
  timings.checksMs = performance.now() - checksStart;

  const graph: SutraGraph = {
    version: GRAPH_VERSION,
    repo: path.basename(repoRoot),
    scanned_at: new Date().toISOString(),
    commit,
    nodes,
    edges,
    issues: [],
    features: [],
    contracts,
    flows: [],
  };

  const writeStart = performance.now();
  fs.mkdirSync(outDir, { recursive: true });

  const graphPathForHooks = path.join(outDir, GRAPH_FILE);
  const hookIssues = runPostScanHooks(repoRoot, graphPathForHooks);
  issues = [...issues, ...hookIssues];
  graph.issues = issues;
  graph.features = buildFeatures(nodes, issues, edges, { contracts });
  const untestedIssues = checkUntestedFeatures(graph.features);
  if (untestedIssues.length > 0) {
    issues = [...issues, ...untestedIssues];
    graph.issues = issues;
    for (const feat of graph.features) {
      feat.issue_count = issues.filter((i) => i.feature === feat.id).length;
      const featureIssues = issues.filter((i) => i.feature === feat.id);
      feat.health = computeFeatureHealth({
        featureIssues,
        nodeCount: feat.node_ids.length,
        hasConfidenceData: issues.some((i) => i.confidence !== undefined),
        hasContractData:
          contracts.length > 0 ||
          issues.some((i) =>
            ["contract_missing_route", "contract_undeclared_route", "contract_parse_error"].includes(i.kind),
          ),
        hasTestCoverageData: true,
        tested: feat.tested,
      });
    }
  }
  const flowResult = buildFlows(nodes, edges);
  graph.flows = flowResult.flows;

  fs.writeFileSync(graphPathForHooks, JSON.stringify(graph, null, 2), "utf8");
  timings.writeMs = performance.now() - writeStart;

  let diffSummary: string | undefined;
  if (prevGraph) {
    const diff = diffGraphs(prevGraph, graph);
    fs.writeFileSync(diffPath, JSON.stringify(diff, null, 2), "utf8");
    diffSummary = formatDiffSummary(diff);
  }

  timings.totalMs = performance.now() - totalStart;

  if (options?.profile) {
    options.onProfile?.(timings);
  }

  return {
    graph,
    graphPath: graphPathForHooks,
    diffSummary,
    profile: options?.profile ? timings : undefined,
    flowStats: {
      confirmed: flowResult.confirmed,
      candidate: flowResult.candidate,
    },
  };
}

/** Collect watchable source files under repoRoot. */
export function collectWatchFiles(repoRoot: string): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (EXCLUDED_DIRS.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name);
        if (SCAN_EXTENSIONS.has(ext)) files.push(full);
      }
    }
  }

  walk(repoRoot);
  return files;
}

/** Debounced watch — returns cleanup function. Exported for testing via onRescan callback. */
export function startWatch(opts: WatchOptions): () => void {
  const debounceMs = opts.debounceMs ?? 300;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  const watchers: fs.FSWatcher[] = [];

  const trigger = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (running) return;
      running = true;
      try {
        const result = runScanPipeline(opts.repoRoot, opts.cwd, opts.commit);
        opts.onRescan?.(result);
      } finally {
        running = false;
      }
    }, debounceMs);
  };

  const files = collectWatchFiles(opts.repoRoot);
  const watchedDirs = new Set<string>();
  for (const f of files) {
    const dir = path.dirname(f);
    if (watchedDirs.has(dir)) continue;
    watchedDirs.add(dir);
    try {
      const w = fs.watch(dir, { recursive: false }, (_event, filename) => {
        if (!filename) return;
        const ext = path.extname(filename);
        if (!SCAN_EXTENSIONS.has(ext)) return;
        trigger();
      });
      watchers.push(w);
    } catch {
      // fs.watch may fail on some platforms for certain dirs
    }
  }

  return () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}
