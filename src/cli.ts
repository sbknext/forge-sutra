#!/usr/bin/env node
/**
 * Sutra CLI — Phase 0.
 * Two commands: scan [repoPath] and view.
 * Static structural analysis; candidate results, not complete.
 */

import { Command } from "commander";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { renderView } from "./view.js";
import {
  SUTRA_DIR,
  GRAPH_FILE,
  BASELINE_FILE,
  GRAPH_PREV_FILE,
  DIFF_FILE,
  VIEW_FILE,
  RECONCILE_FILE,
  GRAPH_VERSION,
  type Severity,
} from "./types.js";
import { diffGraphs, formatDiffSummary, loadGraphFile, type SutraDiff } from "./diff.js";
import {
  gateFromDiff,
  formatGateSummary,
  gateToJson,
  assertGraphVersionsMatch,
  GraphVersionMismatchError,
} from "./gate.js";
import { formatPrComment } from "./pr-comment.js";
import { writeScaffolds, SCAFFOLD_KINDS } from "./scaffold.js";
import { runScanPipeline, startWatch, type ScanTimings } from "./watch.js";
import { runWatch } from "./watch-viewer.js";
import { reconcileGraphs, buildReconcileOutput, type ReconcileOutput } from "./reconcile.js";
import { linkGraphs, writeLinkFile } from "./link.js";
import { migrateFile } from "./migrate.js";
import { exportContracts, exportGraphSchema, exportIssues, writeExport } from "./export.js";
import { inferFeatureLabels, countAiLabels } from "./ai/infer-features.js";
import type { IssueKind, SutraGraph, SutraIssue } from "./types.js";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Format severity + optional provenance/confidence for CLI issue lines. */
function formatIssueBadge(iss: SutraIssue): string {
  const sev = iss.severity.toUpperCase();
  if (iss.provenance !== undefined && iss.confidence !== undefined) {
    return `[${sev} · ${iss.provenance} · ${iss.confidence.toFixed(2)}]`;
  }
  return `[${sev}]`;
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

function sutraDir(cwd: string): string {
  return path.join(cwd, SUTRA_DIR);
}

/** Artifact root: where .sutra/ is written (defaults to process.cwd()). */
function resolveArtifactRoot(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  const env = process.env.SUTRA_OUTPUT_DIR?.trim();
  if (env) return path.resolve(env);
  return process.cwd();
}

/** Viewer reads .sutra/graph.json under this directory (defaults to cwd). */
function resolveViewerRoot(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  const env = process.env.SUTRA_REPO?.trim();
  if (env) return path.resolve(env);
  return process.cwd();
}

function graphFilePath(cwd: string): string {
  return path.join(sutraDir(cwd), GRAPH_FILE);
}

function viewFilePath(cwd: string): string {
  return path.join(sutraDir(cwd), VIEW_FILE);
}

function baselineFilePath(cwd: string): string {
  return path.join(sutraDir(cwd), BASELINE_FILE);
}

function parseFailOn(value: string): Severity {
  if (value === "error" || value === "warn" || value === "info") return value;
  console.error(
    chalk.red(`\nError: --fail-on must be error, warn, or info (got "${value}")\n`),
  );
  process.exit(2);
}

function runCheckGate(
  baselinePath: string,
  current: SutraGraph,
  opts: {
    failOn: Severity;
    format: "text" | "json";
    prComment?: string;
  },
): never {
  if (!fs.existsSync(baselinePath)) {
    console.error(
      chalk.red(
        "\nno baseline found; run `sutra baseline` to record one\n",
      ),
    );
    process.exit(2);
  }

  let baseline: SutraGraph;
  try {
    baseline = loadGraphFile(baselinePath);
  } catch (err) {
    console.error(chalk.red(`\nError loading baseline: ${String(err)}\n`));
    process.exit(2);
  }

  try {
    assertGraphVersionsMatch(baseline, current);
  } catch (err) {
    if (err instanceof GraphVersionMismatchError) {
      console.error(
        chalk.red(
          `\nbaseline is from a different graph version; re-record it with \`sutra baseline\`\n` +
            `  baseline v${err.baselineVersion}, current v${err.currentVersion}\n`,
        ),
      );
      process.exit(2);
    }
    throw err;
  }

  const diff = diffGraphs(baseline, current);
  const gate = gateFromDiff(diff, { failOn: opts.failOn });

  if (opts.prComment !== undefined) {
    const md = formatPrComment(gate);
    if (opts.prComment) {
      fs.mkdirSync(path.dirname(path.resolve(opts.prComment)), { recursive: true });
      fs.writeFileSync(path.resolve(opts.prComment), md, "utf8");
    } else {
      console.log(md);
    }
  }

  if (opts.format === "json") {
    console.log(JSON.stringify(gateToJson(gate), null, 2));
  } else if (opts.prComment === undefined) {
    console.log(formatGateSummary(gate));
  }

  process.exit(gate.exitCode);
}

async function cmdBaseline(
  repoPath: string | undefined,
  opts: { outputDir?: string },
): Promise<void> {
  const cwd = resolveArtifactRoot(opts.outputDir);
  const repoRoot = path.resolve(repoPath ?? process.cwd());
  const commit = getCommit(repoRoot);

  console.log(chalk.bold(`\nSutra baseline → ${repoRoot}\n`));

  const { graph } = runScanPipeline(repoRoot, cwd, commit);
  const outPath = baselineFilePath(cwd);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(graph, null, 2), "utf8");

  console.log(chalk.gray(`  Wrote ${outPath}`));
  console.log(chalk.gray(`  graph version: ${graph.version} · ${graph.issues.length} issues\n`));
}

// ── scan command ──────────────────────────────────────────────────────────────

function printScanSummary(
  graph: SutraGraph,
  outFile: string,
  cacheStats?: { hits: number; misses: number },
): void {
  const { nodes, edges, issues, features } = graph;
  const moduleCount = nodes.filter((n) => n.type === "module").length;
  const endpointCount = nodes.filter((n) => n.type === "endpoint" || n.type === "route").length;
  const componentCount = nodes.filter((n) => n.type === "component").length;
  const testCount = nodes.filter((n) => n.type === "test").length;
  const fnCount = nodes.filter(
    (n) => n.type === "function" || n.type === "handler",
  ).length;

  console.log(chalk.bold("── Heuristic / candidate scan results ──────────────────"));
  console.log(`  ${chalk.cyan(String(nodes.length))} nodes`);
  console.log(
    `    ${moduleCount} modules · ${endpointCount} endpoints · ${componentCount} components · ${testCount} tests · ${fnCount} functions/handlers`,
  );
  console.log(`  ${chalk.cyan(String(edges.length))} edges`);
  console.log(`  ${chalk.cyan(String(features.length))} features`);

  const healthDist = { green: 0, amber: 0, red: 0 };
  for (const f of features) {
    const band = f.health?.band ?? "green";
    if (band in healthDist) healthDist[band as keyof typeof healthDist]++;
  }
  console.log(
    `  health: ${chalk.green(String(healthDist.green))} green · ${chalk.yellow(String(healthDist.amber))} amber · ${chalk.red(String(healthDist.red))} red (heuristic structural)`,
  );

  const flowCount = graph.flows?.length ?? 0;
  if (flowCount > 0) {
    const confirmed = graph.flows.filter((f) => f.confidence === "confirmed").length;
    const candidate = flowCount - confirmed;
    console.log(
      `  flows: ${chalk.cyan(String(flowCount))} traced (${confirmed} confirmed, ${candidate} candidate)`,
    );
  }

  console.log(`  commit: ${chalk.gray(graph.commit)}`);
  if (cacheStats) {
    console.log(
      chalk.gray(`  cache: ${cacheStats.hits} cached · ${cacheStats.misses} parsed`),
    );
  }
  console.log();

  if (issues.length === 0) {
    console.log(chalk.green("  No issues found (heuristic; static approximation)."));
  } else {
    const byKind = new Map<string, typeof issues>();
    for (const iss of issues) {
      const key = `${iss.severity}:${iss.kind}`;
      if (!byKind.has(key)) byKind.set(key, []);
      byKind.get(key)!.push(iss);
    }

    console.log(chalk.bold(`  Issues (${issues.length}) — heuristic / candidate:`));
    for (const [key, group] of [...byKind.entries()].sort()) {
      const [sev, kind] = key.split(":");
      const label =
        sev === "error"
          ? chalk.red(`[${(sev ?? "").toUpperCase()}]`)
          : sev === "warn"
            ? chalk.yellow(`[${(sev ?? "").toUpperCase()}]`)
            : chalk.blue(`[${(sev ?? "").toUpperCase()}]`);
      console.log(`  ${label} ${chalk.bold(kind ?? "")} (${group.length})`);
      for (const iss of group.slice(0, 5)) {
        const badge = formatIssueBadge(iss);
        console.log(`    · ${badge} ${iss.feature}: ${iss.message}`);
      }
      if (group.length > 5) {
        console.log(`    … and ${group.length - 5} more`);
      }
    }
  }

  console.log();
  console.log(chalk.gray(`  Wrote ${outFile}`));
  console.log(chalk.gray("  Run `node dist/cli.js view` to open the HTML view.\n"));
}

function printProfile(timings: ScanTimings): void {
  console.error(chalk.gray("  Profile (candidate timings, environment-dependent):"));
  console.error(chalk.gray(`    walk:   ${timings.walkMs.toFixed(0)}ms`));
  console.error(chalk.gray(`    parse:  ${timings.parseMs.toFixed(0)}ms`));
  console.error(chalk.gray(`    checks: ${timings.checksMs.toFixed(0)}ms`));
  console.error(chalk.gray(`    write:  ${timings.writeMs.toFixed(0)}ms`));
  console.error(chalk.gray(`    total:  ${timings.totalMs.toFixed(0)}ms\n`));
}

async function cmdScan(
  repoPath: string | undefined,
  opts: {
    watch?: boolean;
    profile?: boolean;
    ai?: boolean;
    check?: boolean;
    baseline?: string;
    failOn?: string;
    format?: string;
    prComment?: string | boolean;
    outputDir?: string;
  },
): Promise<void> {
  const cwd = resolveArtifactRoot(opts.outputDir);
  const repoRoot = path.resolve(repoPath ?? process.cwd());
  const commit = getCommit(repoRoot);

  if (opts.watch) {
    console.log(chalk.bold(`\nSutra watch → ${repoRoot}\n`));
    console.log(chalk.gray("  Static re-scan on file change (candidate). Ctrl+C to stop.\n"));

    const initial = runScanPipeline(repoRoot, cwd, commit);
    printScanSummary(initial.graph, initial.graphPath, initial.cacheStats);

    const stop = startWatch({
      repoRoot,
      cwd,
      commit,
      onRescan: (result) => {
        console.log(chalk.bold(`\n── Re-scan ${result.graph.scanned_at} ──`));
        console.log(`  ${chalk.cyan(String(result.graph.nodes.length))} nodes · ${chalk.cyan(String(result.graph.issues.length))} issues`);
        if (result.diffSummary) {
          console.log(chalk.gray(`  Δ ${result.diffSummary}`));
        }
        console.log(chalk.gray(`  Wrote ${result.graphPath}\n`));
      },
    });

    const onSigint = (): void => {
      stop();
      console.log(chalk.gray("\n  Watch stopped.\n"));
      process.exit(0);
    };
    process.on("SIGINT", onSigint);
    return;
  }

  const quietCheck = opts.check && opts.format === "json";
  if (!quietCheck) {
    console.log(chalk.bold(`\nSutra scan → ${repoRoot}\n`));
  }

  const { graph, graphPath, cacheStats } = await (async () => {
    const result = runScanPipeline(repoRoot, cwd, commit, {
      profile: opts.profile,
      onProfile: opts.profile ? printProfile : undefined,
    });
    if (opts.ai) {
      const features = await inferFeatureLabels(result.graph, {
        enabled: true,
        onSkip: (reason) => {
          console.error(chalk.yellow(`  ${reason}`));
        },
      });
      result.graph.features = features;
      const counts = countAiLabels(features);
      console.error(
        chalk.gray(
          `  AI naming: ${counts.ai} ai-inferred · ${counts.heuristic} heuristic`,
        ),
      );
      fs.writeFileSync(
        result.graphPath,
        JSON.stringify(result.graph, null, 2),
        "utf8",
      );
    }
    return result;
  })();
  if (!opts.check) {
    printScanSummary(graph, graphPath, cacheStats);
  }

  if (opts.check) {
    const baselinePath = path.resolve(
      opts.baseline ?? baselineFilePath(cwd),
    );
    const failOn = parseFailOn(opts.failOn ?? "error");
    const format = opts.format === "json" ? "json" : "text";
    const prComment =
      opts.prComment === true
        ? ""
        : typeof opts.prComment === "string"
          ? opts.prComment
          : undefined;
    runCheckGate(baselinePath, graph, { failOn, format, prComment });
  }
}

// ── watch command (Story 3.5) ─────────────────────────────────────────────────

async function cmdWatch(
  repoPath: string | undefined,
  opts: { port?: number; outputDir?: string },
): Promise<void> {
  const cwd = resolveArtifactRoot(opts.outputDir);
  const repoRoot = path.resolve(repoPath ?? process.cwd());

  const handle = await runWatch(repoRoot, cwd, { port: opts.port });

  console.log(chalk.bold(`\nSutra watch → ${repoRoot}\n`));
  console.log(chalk.cyan(`  Viewer: ${handle.url}`));
  console.log(chalk.gray("  Live re-scan on file change · Ctrl+C to stop.\n"));

  if (process.platform === "darwin") {
    try {
      execSync(`open "${handle.url}"`, { stdio: "ignore" });
    } catch {
      /* ignore */
    }
  }

  const onSigint = async (): Promise<void> => {
    await handle.close();
    console.log(chalk.gray("\n  Watch stopped.\n"));
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void onSigint();
  });
}

// ── diff command ──────────────────────────────────────────────────────────────

function cmdDiff(
  pathA: string | undefined,
  pathB: string | undefined,
  opts: { out?: string },
): void {
  const cwd = process.cwd();
  const defaultA = path.join(cwd, SUTRA_DIR, GRAPH_FILE);
  const defaultB = path.join(cwd, SUTRA_DIR, GRAPH_PREV_FILE);

  const fileA = path.resolve(pathA ?? defaultA);
  const fileB = path.resolve(pathB ?? defaultB);

  let graphA: SutraGraph;
  let graphB: SutraGraph;
  try {
    graphA = loadGraphFile(fileA);
    graphB = loadGraphFile(fileB);
  } catch (err) {
    console.error(chalk.red(`\nError: ${String(err)}\n`));
    process.exit(1);
  }

  const diff = diffGraphs(graphA, graphB);
  const summary = formatDiffSummary(diff);

  console.log(chalk.bold(`\nSutra diff: ${fileA} → ${fileB}`));
  console.log(chalk.gray(`  ${summary}\n`));

  const json = JSON.stringify(diff, null, 2);
  if (opts.out) {
    const outPath = path.resolve(opts.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, json, "utf8");
    console.log(chalk.gray(`  Wrote ${outPath}\n`));
  } else {
    console.log(json);
  }
}

// ── reconcile command ─────────────────────────────────────────────────────────

function cmdLink(
  graphs: string[],
  opts: { outputDir?: string; cwd?: string },
): void {
  if (graphs.length < 2) {
    console.error(
      chalk.red("\nError: provide at least two graph.json paths (client, server).\n"),
    );
    process.exit(2);
  }

  const loaded: SutraGraph[] = [];
  const repoPaths: string[] = [];
  for (const g of graphs) {
    const resolved = path.resolve(g);
    try {
      loaded.push(loadGraphFile(resolved));
      repoPaths.push(path.dirname(path.dirname(resolved)));
    } catch (err) {
      console.error(chalk.red(`\nError: ${String(err)}\n`));
      process.exit(1);
    }
  }

  const link = linkGraphs(loaded, repoPaths);
  const cwd = resolveArtifactRoot(opts.outputDir ?? opts.cwd);
  const out = writeLinkFile(cwd, link);
  console.log(chalk.bold(`\nSutra link — cross-repo map (candidate)\n`));
  console.log(`  Repos: ${link.repos.map((r) => r.name).join(" · ")}`);
  console.log(`  Edges: ${link.edges.length} (${link.edges.filter((e) => e.resolution === "confirmed").length} confirmed)`);
  console.log(chalk.gray(`  Wrote ${out}\n`));
}

function cmdReconcile(opts: { client: string; server: string; out?: string }): void {
  let clientGraph: SutraGraph;
  let serverGraph: SutraGraph;
  try {
    clientGraph = loadGraphFile(path.resolve(opts.client));
    serverGraph = loadGraphFile(path.resolve(opts.server));
  } catch (err) {
    console.error(chalk.red(`\nError: ${String(err)}\n`));
    process.exit(1);
  }

  const result = reconcileGraphs(clientGraph, serverGraph);
  const output = buildReconcileOutput(clientGraph, serverGraph, result);

  console.log(chalk.bold(`\nSutra reconcile — candidate cross-repo match\n`));
  console.log(`  Client: ${chalk.cyan(clientGraph.repo)} (${opts.client})`);
  console.log(`  Server: ${chalk.cyan(serverGraph.repo)} (${opts.server})`);
  console.log(`  Checked: ${result.checked} calls · Matched: ${result.matched}`);
  console.log(chalk.gray("  Static match only — ignores auth, env URLs, proxy rewrites.\n"));

  if (result.issues.length === 0) {
    console.log(chalk.green("  No cross-repo orphans found (heuristic)."));
  } else {
    console.log(chalk.bold(`  cross_repo_orphan (${result.issues.length}) — candidate:`));
    for (const iss of result.issues) {
      console.log(`    · ${iss.node}: ${iss.message}`);
    }
  }

  if (opts.out) {
    const outPath = path.resolve(opts.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");
    console.log(chalk.gray(`\n  Wrote ${outPath}\n`));
  } else {
    console.log();
  }
}

// ── scaffold command ──────────────────────────────────────────────────────────

function parseScaffoldKinds(fromIssues?: string): IssueKind[] {
  if (!fromIssues) return [...SCAFFOLD_KINDS];
  const allowed = new Set<string>(SCAFFOLD_KINDS);
  const kinds = fromIssues.split(",").map((k) => k.trim());
  for (const k of kinds) {
    if (!allowed.has(k)) {
      console.error(
        chalk.red(
          `\nError: unknown issue kind "${k}". Allowed: ${[...allowed].join(", ")}\n`,
        ),
      );
      process.exit(1);
    }
  }
  return kinds as IssueKind[];
}

function cmdScaffold(opts: { fromIssues?: string; force?: boolean }): void {
  const cwd = process.cwd();
  const graphFile = graphFilePath(cwd);

  if (!fs.existsSync(graphFile)) {
    console.error(
      chalk.red(
        `\nError: ${graphFile} not found.\nRun \`sutra scan\` first.\n`,
      ),
    );
    process.exit(1);
  }

  let graph: SutraGraph;
  try {
    graph = JSON.parse(fs.readFileSync(graphFile, "utf8")) as SutraGraph;
  } catch (err) {
    console.error(chalk.red(`\nError reading graph.json: ${String(err)}\n`));
    process.exit(1);
  }

  const kinds = parseScaffoldKinds(opts.fromIssues);
  const outDir = path.join(sutraDir(cwd), "scaffold");
  const result = writeScaffolds(graph, {
    outDir,
    kinds,
    force: opts.force,
  });

  console.log(chalk.bold("\nSutra scaffold — candidate stubs only, not run in CI\n"));
  console.log(`  Wrote ${chalk.cyan(String(result.written.length))} file(s)`);
  for (const f of result.written) {
    console.log(chalk.gray(`    ${f}`));
  }
  if (result.skipped.length > 0) {
    console.log(`  Skipped ${chalk.yellow(String(result.skipped.length))} existing file(s) (use --force to overwrite)`);
  }
  console.log();
}

// ── view command ──────────────────────────────────────────────────────────────

async function cmdViewer(opts: { port?: number; repo?: string }): Promise<void> {
  const cwd = resolveViewerRoot(opts.repo);
  const graphFile = graphFilePath(cwd);

  if (!fs.existsSync(graphFile)) {
    console.error(
      chalk.red(
        `\nError: ${graphFile} not found.\nRun \`sutra scan\` first to generate it.\n`,
      ),
    );
    process.exit(1);
  }

  const { startViewerServer, DEFAULT_VIEWER_PORT } = await import("./viewer/server.js");
  const port = opts.port ?? DEFAULT_VIEWER_PORT;
  const server = await startViewerServer(cwd, { port });

  console.log(chalk.bold(`\nSutra viewer → ${server.url}`));
  console.log(chalk.gray(`  Graph: ${graphFile}`));
  console.log(chalk.gray("  Localhost only · Ctrl+C to stop.\n"));

  if (process.platform === "darwin") {
    try {
      execSync(`open "${server.url}"`, { stdio: "ignore" });
      console.log(chalk.gray("  Opened in default browser.\n"));
    } catch {
      console.log(chalk.gray(`  Open manually: ${server.url}\n`));
    }
  } else {
    console.log(chalk.gray(`  Open manually: ${server.url}\n`));
  }

  const onSigint = async (): Promise<void> => {
    await server.close();
    console.log(chalk.gray("\n  Viewer stopped.\n"));
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void onSigint();
  });
}

function cmdView(): void {
  const cwd = process.cwd();
  const graphFile = graphFilePath(cwd);

  if (!fs.existsSync(graphFile)) {
    console.error(
      chalk.red(
        `\nError: ${graphFile} not found.\nRun \`sutra scan\` first to generate it.\n`
      )
    );
    process.exit(1);
  }

  let graph: SutraGraph;
  try {
    graph = JSON.parse(fs.readFileSync(graphFile, "utf8")) as SutraGraph;
  } catch (err) {
    console.error(chalk.red(`\nError reading graph.json: ${String(err)}\n`));
    process.exit(1);
  }

  let diff: SutraDiff | undefined;
  const diffFile = path.join(sutraDir(cwd), DIFF_FILE);
  if (fs.existsSync(diffFile)) {
    try {
      diff = JSON.parse(fs.readFileSync(diffFile, "utf8")) as SutraDiff;
    } catch {
      console.warn(chalk.yellow(`  Warning: could not read ${diffFile}; skipping diff panel.`));
    }
  }

  let reconcile: ReconcileOutput | undefined;
  const reconcileFile = path.join(sutraDir(cwd), RECONCILE_FILE);
  if (fs.existsSync(reconcileFile)) {
    try {
      reconcile = JSON.parse(fs.readFileSync(reconcileFile, "utf8")) as ReconcileOutput;
    } catch {
      console.warn(chalk.yellow(`  Warning: could not read ${reconcileFile}; skipping reconcile panel.`));
    }
  }

  const html = renderView(graph, diff, reconcile);
  const viewFile = viewFilePath(cwd);
  fs.writeFileSync(viewFile, html, "utf8");
  console.log(chalk.bold(`\nView written → ${viewFile}`));

  // Open on macOS; on other platforms just print the path.
  if (process.platform === "darwin") {
    try {
      execSync(`open "${viewFile}"`, { stdio: "ignore" });
      console.log(chalk.gray("  Opened in default browser.\n"));
    } catch {
      console.log(chalk.gray(`  Open manually: ${viewFile}\n`));
    }
  } else {
    console.log(chalk.gray(`  Open manually: ${viewFile}\n`));
  }
}

// ── export command ────────────────────────────────────────────────────────────

function cmdExport(
  target: string,
  opts: { out?: string; format?: string },
): void {
  const cwd = process.cwd();
  const graphFile = graphFilePath(cwd);

  if (target === "schema") {
    const content = exportGraphSchema();
    if (opts.out) {
      writeExport(content, path.resolve(opts.out));
      console.log(chalk.gray(`\n  Wrote ${path.resolve(opts.out)}\n`));
    } else {
      writeExport(content);
    }
    return;
  }

  if (!fs.existsSync(graphFile)) {
    console.error(chalk.red(`\nError: ${graphFile} not found. Run scan first.\n`));
    process.exit(1);
  }

  let graph: SutraGraph;
  try {
    graph = JSON.parse(fs.readFileSync(graphFile, "utf8")) as SutraGraph;
  } catch (err) {
    console.error(chalk.red(`\nError reading graph.json: ${String(err)}\n`));
    process.exit(1);
  }

  let content: string;
  if (target === "contracts") {
    content = exportContracts(graph);
  } else if (target === "issues") {
    const fmt = opts.format === "csv" ? "csv" : "json";
    content = exportIssues(graph, fmt);
  } else {
    console.error(chalk.red(`\nError: unknown export target "${target}". Use: contracts, schema, issues\n`));
    process.exit(1);
  }

  if (opts.out) {
    writeExport(content, path.resolve(opts.out));
    console.log(chalk.gray(`\n  Wrote ${path.resolve(opts.out)}\n`));
  } else {
    writeExport(content);
  }
}

// ── migrate command ───────────────────────────────────────────────────────────

function cmdMigrate(graphPath: string | undefined): void {
  const cwd = process.cwd();
  const file = path.resolve(graphPath ?? path.join(cwd, SUTRA_DIR, GRAPH_FILE));

  try {
    const result = migrateFile(file);
    if (result.migrated) {
      console.log(
        chalk.bold(`\nMigrated ${file}: v${result.fromVersion} → v${result.toVersion}\n`),
      );
    } else {
      console.log(
        chalk.green(`\n${file} is already version ${result.toVersion} — no migration needed.\n`),
      );
    }
  } catch (err) {
    console.error(chalk.red(`\nError: ${String(err)}\n`));
    process.exit(1);
  }
}

// ── program ───────────────────────────────────────────────────────────────────

const require = createRequire(fileURLToPath(import.meta.url));
const { version: pkgVersion } = require("../package.json") as { version: string };

const program = new Command();

const CLAIM_BOUNDS =
  "Candidate results only — static heuristic approximation, not complete analysis.";

program
  .name("forge-sutra")
  .description(
    "Static structural graph tool for JS/TS repos. Writes .sutra/graph.json + view.html. " +
    CLAIM_BOUNDS
  )
  .version(pkgVersion);

program
  .command("scan [repoPath]")
  .description(
    "Scan a repo and write .sutra/graph.json (default: cwd). " +
    "Static structural scan — candidate results."
  )
  .option("--watch", "Re-scan on file changes (debounced, static scan only)")
  .option("--profile", "Print phase timings to stderr (candidate, environment-dependent)")
  .option("--ai", "Enable LLM feature naming (requires SUTRA_AI_API_KEY; opt-in)")
  .option(
    "--check",
    "Compare scan to committed baseline; exit 1 on new error-severity issues",
  )
  .option(
    "--baseline <path>",
    "Baseline graph for --check (default: .sutra/baseline.json)",
  )
  .option(
    "--fail-on <severity>",
    "Gate threshold: error (default), warn, or info",
    "error",
  )
  .option("--format <fmt>", "Output format for --check: text (default) or json")
  .option(
    "--pr-comment [path]",
    "Write PR comment Markdown for --check (stdout or file)",
  )
  .option(
    "--output-dir <dir>",
    "Write .sutra/ artifacts here instead of process.cwd() (scan repo unchanged)",
  )
  .action(
    async (
      repoPath: string | undefined,
      opts: {
        watch?: boolean;
        profile?: boolean;
        ai?: boolean;
        check?: boolean;
        baseline?: string;
        failOn?: string;
        format?: string;
        prComment?: string | boolean;
        outputDir?: string;
      },
    ) => {
      await cmdScan(repoPath, opts);
    },
  );

program
  .command("baseline [repoPath]")
  .description(
    "Scan repo and write .sutra/baseline.json for CI --check gating.",
  )
  .option(
    "--output-dir <dir>",
    "Write .sutra/baseline.json here instead of process.cwd()",
  )
  .action(async (repoPath: string | undefined, opts: { outputDir?: string }) => {
    await cmdBaseline(repoPath, opts);
  });

program
  .command("view")
  .description(
    "Read .sutra/graph.json and write .sutra/view.html, then open it. " +
    "Display-only — heuristic / candidate."
  )
  .action(() => {
    cmdView();
  });

program
  .command("viewer")
  .description(
    "Start local viewer SPA (reads .sutra/graph.json over HTTP). " +
    "Reload in browser to refresh — no rebuild. Localhost only."
  )
  .option("--port <n>", "Port to bind (default 4577)", (v) => parseInt(v, 10))
  .option(
    "--repo <dir>",
    "Directory containing .sutra/graph.json (default: cwd; or SUTRA_REPO)",
  )
  .action(async (opts: { port?: number; repo?: string }) => {
    await cmdViewer(opts);
  });

program
  .command("watch [repoPath]")
  .description(
    "Live watch: re-scan on file change and push graph to viewer SPA (SSE). " +
    "Starts local viewer on 127.0.0.1. Static scan only — candidate results.",
  )
  .option("--port <n>", "Viewer port (default 4577)", (v) => parseInt(v, 10))
  .option("--output-dir <dir>", "Write .sutra/ artifacts here (live rescan)")
  .action(async (repoPath: string | undefined, opts: { port?: number; outputDir?: string }) => {
    await cmdWatch(repoPath, opts);
  });

program
  .command("diff [pathA] [pathB]")
  .description(
    "Diff two graph.json files. Defaults: .sutra/graph.json vs .sutra/graph.prev.json. " +
    "With one path: that file vs .sutra/graph.prev.json. Structural delta only — candidate."
  )
  .option(
    "--out <file>",
    "Write diff JSON to file instead of stdout (e.g. .sutra/diff.json)",
  )
  .action(
    (
      pathA: string | undefined,
      pathB: string | undefined,
      opts: { out?: string },
    ) => {
      cmdDiff(pathA, pathB, opts);
    },
  );

program
  .command("link <graphs...>")
  .description(
    "Link two or more scan graphs into .sutra/link.json for the ecosystem viewer. " +
    "Candidate cross-repo HTTP resolution only.",
  )
  .option(
    "--output-dir <dir>",
    "Write link.json here (default: cwd or SUTRA_OUTPUT_DIR)",
  )
  .action((graphs: string[], opts: { outputDir?: string }) => {
    cmdLink(graphs, opts);
  });

program
  .command("reconcile")
  .description(
    "Match client graph HTTP calls against server graph routes. " +
    "Cross-repo static match — candidate results for human review.",
  )
  .requiredOption("--client <graph>", "Path to client graph.json")
  .requiredOption("--server <graph>", "Path to server graph.json")
  .option("--out <file>", "Write reconcile JSON (e.g. .sutra/reconcile.json)")
  .action((opts: { client: string; server: string; out?: string }) => {
    cmdReconcile(opts);
  });

program
  .command("scaffold")
  .description(
    "Emit candidate test stubs from graph issues into .sutra/scaffold/. " +
    "Stubs only — may not compile, not run in CI.",
  )
  .option(
    "--from-issues <kinds>",
    "Comma-separated issue kinds (orphaned_endpoint, contract_missing_route)",
  )
  .option("--force", "Overwrite existing scaffold files")
  .action((opts: { fromIssues?: string; force?: boolean }) => {
    cmdScaffold(opts);
  });

program
  .command("export <target>")
  .description(
    "Export contracts, graph JSON Schema, or issues from graph.json. " +
    "Targets: contracts, schema, issues. Candidate/read-only.",
  )
  .option("--out <file>", "Write to file instead of stdout")
  .option("--format <fmt>", "For issues: json (default) or csv")
  .action((target: string, opts: { out?: string; format?: string }) => {
    cmdExport(target, opts);
  });

program
  .command("migrate [graphPath]")
  .description(
    "Migrate graph.json to current schema version. " +
    "Structure only — does not re-scan or fix semantic issues.",
  )
  .action((graphPath: string | undefined) => {
    cmdMigrate(graphPath);
  });

program.parse(process.argv);
