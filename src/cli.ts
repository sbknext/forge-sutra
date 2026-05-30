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
import { renderView } from "./view.js";
import {
  SUTRA_DIR,
  GRAPH_FILE,
  GRAPH_PREV_FILE,
  DIFF_FILE,
  VIEW_FILE,
  type SutraGraph,
} from "./types.js";
import { diffGraphs, formatDiffSummary, loadGraphFile, type SutraDiff } from "./diff.js";
import { writeScaffolds, SCAFFOLD_KINDS } from "./scaffold.js";
import { runScanPipeline, startWatch } from "./watch.js";
import type { IssueKind } from "./types.js";

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

function printScanSummary(graph: SutraGraph, outFile: string): void {
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
  console.log(`  commit: ${chalk.gray(graph.commit)}`);
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

function cmdScan(repoPath: string | undefined, opts: { watch?: boolean }): void {
  const cwd = process.cwd();
  const repoRoot = path.resolve(repoPath ?? cwd);
  const commit = getCommit(repoRoot);

  if (opts.watch) {
    console.log(chalk.bold(`\nSutra watch → ${repoRoot}\n`));
    console.log(chalk.gray("  Static re-scan on file change (candidate). Ctrl+C to stop.\n"));

    const initial = runScanPipeline(repoRoot, cwd, commit);
    printScanSummary(initial.graph, initial.graphPath);

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

  console.log(chalk.bold(`\nSutra scan → ${repoRoot}\n`));

  const { graph, graphPath } = runScanPipeline(repoRoot, cwd, commit);
  printScanSummary(graph, graphPath);
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

  const html = renderView(graph, diff);
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
  .option("--watch", "Re-scan on file changes (debounced, static scan only)")
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

program.parse(process.argv);
