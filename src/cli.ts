#!/usr/bin/env node
/**
 * Sutra CLI — Phase 0.
 * Two commands: scan [repoPath] and view.
 * Static structural analysis; candidate results, not complete.
 */

import { Command } from "commander";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { scan } from "./scanner.js";
import { runChecks, checkContractDrift } from "./checks.js";
import { buildFeatures } from "./features.js";
import { renderView } from "./view.js";
import { loadContracts } from "./contracts.js";
import {
  GRAPH_VERSION,
  SUTRA_DIR,
  GRAPH_FILE,
  GRAPH_PREV_FILE,
  VIEW_FILE,
  type SutraGraph,
} from "./types.js";
import { diffGraphs, formatDiffSummary, loadGraphFile } from "./diff.js";

// ── helpers ───────────────────────────────────────────────────────────────────

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

function graphFilePath(cwd: string): string {
  return path.join(sutraDir(cwd), GRAPH_FILE);
}

function viewFilePath(cwd: string): string {
  return path.join(sutraDir(cwd), VIEW_FILE);
}

// ── scan command ──────────────────────────────────────────────────────────────

function cmdScan(repoPath: string | undefined, opts: { watch?: boolean }): void {
  if (opts.watch) {
    console.log("watch mode: not implemented in Phase 0");
    process.exit(0);
  }

  const cwd = process.cwd();
  const repoRoot = path.resolve(repoPath ?? cwd);

  console.log(chalk.bold(`\nSutra scan → ${repoRoot}\n`));

  // Run pipeline
  const { nodes, edges } = scan(repoRoot);
  const checkIssues = runChecks(nodes, edges);
  const { contracts, issues: contractIssues } = loadContracts(repoRoot);
  const driftIssues = checkContractDrift(contracts, nodes);
  const issues = [...checkIssues, ...contractIssues, ...driftIssues];
  const features = buildFeatures(nodes, issues);
  const commit = getCommit(repoRoot);

  const graph: SutraGraph = {
    version: GRAPH_VERSION,
    repo: path.basename(repoRoot),
    scanned_at: new Date().toISOString(),
    commit,
    nodes,
    edges,
    issues,
    features,
    contracts,
  };

  // Write graph.json
  const outDir = sutraDir(cwd);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = graphFilePath(cwd);
  fs.writeFileSync(outFile, JSON.stringify(graph, null, 2), "utf8");

  // Count parse-skips (nodes that are modules with no children aren't tracked
  // directly; scanner doesn't expose parseErrors, but we note module nodes).
  const moduleCount = nodes.filter((n) => n.type === "module").length;
  const endpointCount = nodes.filter((n) => n.type === "endpoint" || n.type === "route").length;
  const componentCount = nodes.filter((n) => n.type === "component").length;
  const testCount = nodes.filter((n) => n.type === "test").length;
  const fnCount = nodes.filter(
    (n) => n.type === "function" || n.type === "handler"
  ).length;

  // Summary
  console.log(chalk.bold("── Heuristic / candidate scan results ──────────────────"));
  console.log(`  ${chalk.cyan(String(nodes.length))} nodes`);
  console.log(`    ${moduleCount} modules · ${endpointCount} endpoints · ${componentCount} components · ${testCount} tests · ${fnCount} functions/handlers`);
  console.log(`  ${chalk.cyan(String(edges.length))} edges`);
  console.log(`  ${chalk.cyan(String(features.length))} features`);
  console.log(`  commit: ${chalk.gray(commit)}`);
  console.log();

  if (issues.length === 0) {
    console.log(chalk.green("  No issues found (heuristic; static approximation)."));
  } else {
    // Group by kind + severity
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
        console.log(`    · ${iss.feature}: ${iss.message}`);
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

// ── view command ──────────────────────────────────────────────────────────────

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

  const html = renderView(graph);
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

// ── program ───────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("sutra")
  .description(
    "Static structural graph tool. Scans a repo and writes .sutra/graph.json + view.html. " +
    "Candidate results only — approximation, not complete analysis."
  )
  .version("0.0.0");

program
  .command("scan [repoPath]")
  .description(
    "Scan a repo and write .sutra/graph.json. " +
    "Default repoPath = current working directory."
  )
  .option("--watch", "watch mode (not implemented in Phase 0)")
  .action((repoPath: string | undefined, opts: { watch?: boolean }) => {
    cmdScan(repoPath, opts);
  });

program
  .command("view")
  .description(
    "Read .sutra/graph.json and write .sutra/view.html, then open it."
  )
  .action(() => {
    cmdView();
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

program.parse(process.argv);
