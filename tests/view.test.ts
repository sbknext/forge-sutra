/**
 * SUTRA-3.2 — view HTML diff panel (fragment tests, no browser).
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { renderView } from "../src/view.js";
import { diffGraphs, loadGraphFile } from "../src/diff.js";
import type { SutraGraph } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, "fixtures/diff");
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

describe("cmdView diff.json integration", () => {
  it("loadGraphFile + diffGraphs produce valid diff for view", () => {
    const graphA = loadGraphFile(GRAPH_A);
    const graphB = loadGraphFile(GRAPH_B);
    const diff = diffGraphs(graphA, graphB);
    const html = renderView(graphB, diff);
    expect(html).toMatch(/<section class="diff-panel"/);
  });
});
