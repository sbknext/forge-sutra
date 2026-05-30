/**
 * SUTRA-3.2 — view HTML diff panel (fragment tests, no browser).
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { renderView } from "../src/view.js";
import { diffGraphs, loadGraphFile } from "../src/diff.js";
import { scan } from "../src/scanner.js";
import { loadContracts } from "../src/contracts.js";
import { checkContractDrift, runChecks } from "../src/checks.js";
import { buildFeatures } from "../src/features.js";
import { GRAPH_VERSION, type SutraGraph } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, "fixtures/diff");
const CONTRACT_DECLARED = path.resolve(__dirname, "fixtures/contract-declared");
const GRAPH_A = path.join(FIXTURE_DIR, "graph-a.json");
const GRAPH_B = path.join(FIXTURE_DIR, "graph-b.json");

function readGraph(filePath: string): SutraGraph {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as SutraGraph;
}

describe("renderView — diff panel (SUTRA-3.2)", () => {
  const graphB = readGraph(GRAPH_B);
  const diff = diffGraphs(readGraph(GRAPH_A), graphB);

  it("shows 'Changes since last scan' panel when diff is provided", () => {
    const html = renderView(graphB, diff);
    expect(html).toContain("Changes since last scan");
    expect(html).toContain("diff-panel");
    expect(html).toContain("heuristic");
  });

  it("includes diff summary counts in the panel", () => {
    const html = renderView(graphB, diff);
    expect(html).toContain("+1 nodes");
    expect(html).toContain("-1 nodes");
    expect(html).toContain("+1 edges");
    expect(html).toContain("-1 edges");
    expect(html).toContain("+1 issues");
    expect(html).toContain("-1 issues");
    expect(html).toContain("~1 issues changed");
  });

  it("lists added/removed node ids in the panel", () => {
    const html = renderView(graphB, diff);
    expect(html).toContain("lib/b.ts");
    expect(html).toContain("lib/a.ts#foo");
  });

  it("omits diff panel when diff is not provided", () => {
    const html = renderView(graphB);
    expect(html).not.toContain("Changes since last scan");
    expect(html).not.toMatch(/<section class="diff-panel"/);
  });

  it("omits diff panel when diff has zero deltas", () => {
    const graph = readGraph(GRAPH_A);
    const emptyDiff = diffGraphs(graph, graph);
    const html = renderView(graph, emptyDiff);
    expect(html).not.toContain("Changes since last scan");
  });
});

function buildGraphFromFixture(repoRoot: string): SutraGraph {
  const { nodes, edges } = scan(repoRoot);
  const checkIssues = runChecks(nodes, edges);
  const { contracts, issues: contractIssues } = loadContracts(repoRoot);
  const driftIssues = checkContractDrift(contracts, nodes);
  const issues = [...checkIssues, ...contractIssues, ...driftIssues];
  return {
    version: GRAPH_VERSION,
    repo: "test",
    scanned_at: new Date().toISOString(),
    commit: "test",
    nodes,
    edges,
    issues,
    features: buildFeatures(nodes, issues),
    contracts,
  };
}

describe("renderView — contract drift panel (SUTRA-11.1)", () => {
  it("shows contract drift panel when contracts and drift issues exist", () => {
    const graph = buildGraphFromFixture(CONTRACT_DECLARED);
    expect(graph.contracts.length).toBeGreaterThan(0);
    expect(graph.issues.some((i) => i.kind.startsWith("contract_"))).toBe(true);

    const html = renderView(graph);
    expect(html).toContain("Contract drift");
    expect(html).toContain("contract-drift-panel");
    expect(html).toContain("heuristic");
    expect(html).toContain("feature.sutra.md");
  });

  it("omits contract drift panel when no contracts", () => {
    const graph = readGraph(GRAPH_B);
    const html = renderView(graph);
    expect(html).not.toContain("Contract drift");
    expect(html).not.toMatch(/<section class="contract-drift-panel"/);
  });
});

describe("cmdView diff.json integration", () => {
  it("loadGraphFile + diffGraphs produce valid diff for view", () => {
    const graphA = loadGraphFile(GRAPH_A);
    const graphB = loadGraphFile(GRAPH_B);
    const diff = diffGraphs(graphA, graphB);
    const html = renderView(graphB, diff);
    expect(html).toMatch(/<section class="diff-panel"/);
  });
});
