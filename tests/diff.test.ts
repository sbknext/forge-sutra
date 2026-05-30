/**
 * SUTRA-3.1 — graph diff unit tests (minimal fixtures, no full repo scan).
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { diffGraphs, formatDiffSummary, loadGraphFile } from "../src/diff.js";
import type { SutraGraph } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, "fixtures/diff");
const GRAPH_A = path.join(FIXTURE_DIR, "graph-a.json");
const GRAPH_B = path.join(FIXTURE_DIR, "graph-b.json");

function readGraph(filePath: string): SutraGraph {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as SutraGraph;
}

describe("diffGraphs — fixture delta", () => {
  const graphA = readGraph(GRAPH_A);
  const graphB = readGraph(GRAPH_B);
  const diff = diffGraphs(graphA, graphB);

  it("reports nodes_removed for lib/a.ts#foo", () => {
    const removedIds = diff.nodes_removed.map((n) => n.id);
    expect(removedIds).toContain("lib/a.ts#foo");
  });

  it("reports nodes_added for lib/b.ts", () => {
    const addedIds = diff.nodes_added.map((n) => n.id);
    expect(addedIds).toContain("lib/b.ts");
  });

  it("reports edges_removed for calls edge a→foo", () => {
    const removed = diff.edges_removed.some(
      (e) => e.from === "lib/a.ts" && e.to === "lib/a.ts#foo" && e.kind === "calls",
    );
    expect(removed).toBe(true);
  });

  it("reports edges_added for imports edge a→b", () => {
    const added = diff.edges_added.some(
      (e) => e.from === "lib/a.ts" && e.to === "lib/b.ts" && e.kind === "imports",
    );
    expect(added).toBe(true);
  });

  it("reports issues_removed for contract_undeclared_route", () => {
    const removed = diff.issues_removed.some(
      (i) => i.kind === "contract_undeclared_route" && i.node === "GET /api/ping",
    );
    expect(removed).toBe(true);
  });

  it("reports issues_added for missing_handler", () => {
    const added = diff.issues_added.some(
      (i) => i.kind === "missing_handler" && i.node === "lib/missing.ts",
    );
    expect(added).toBe(true);
  });

  it("reports issues_changed when same kind+node but message differs", () => {
    const changed = diff.issues_changed.find(
      (c) => c.before.kind === "orphaned_endpoint" && c.before.node === "POST /api/x",
    );
    expect(changed).toBeDefined();
    expect(changed!.before.message).toBe("no matching route");
    expect(changed!.after.message).toBe("no route handler found");
  });

  it("includes diff_version in result", () => {
    expect(diff.diff_version).toBe(0);
  });
});

describe("formatDiffSummary", () => {
  it("returns counts-only human summary line", () => {
    const graphA = readGraph(GRAPH_A);
    const graphB = readGraph(GRAPH_B);
    const diff = diffGraphs(graphA, graphB);
    const summary = formatDiffSummary(diff);
    expect(summary).toMatch(/\+1 nodes/);
    expect(summary).toMatch(/-1 nodes/);
    expect(summary).toMatch(/\+1 edges/);
    expect(summary).toMatch(/-1 edges/);
    expect(summary).toMatch(/\+1 issues/);
    expect(summary).toMatch(/-1 issues/);
    expect(summary).toMatch(/~1 issues changed/);
  });
});

describe("loadGraphFile", () => {
  it("loads a valid graph JSON file", () => {
    const graph = loadGraphFile(GRAPH_A);
    expect(graph.repo).toBe("diff-fixture");
    expect(graph.nodes.length).toBe(2);
  });

  it("throws on missing file", () => {
    expect(() => loadGraphFile("/nonexistent/graph.json")).toThrow();
  });
});

describe("diffGraphs — identical graphs", () => {
  it("returns empty deltas when graphs are the same", () => {
    const graph = readGraph(GRAPH_A);
    const diff = diffGraphs(graph, graph);
    expect(diff.nodes_added).toHaveLength(0);
    expect(diff.nodes_removed).toHaveLength(0);
    expect(diff.edges_added).toHaveLength(0);
    expect(diff.edges_removed).toHaveLength(0);
    expect(diff.issues_added).toHaveLength(0);
    expect(diff.issues_removed).toHaveLength(0);
    expect(diff.issues_changed).toHaveLength(0);
  });
});
