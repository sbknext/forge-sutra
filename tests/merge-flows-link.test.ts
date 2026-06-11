/**
 * Story 8.5 — merge graph attach flows+link integration test.
 * AC1: buildFlows runs over merged graph → flows persisted.
 * AC2: multi-app node ids (two+ app:: prefixes) → valid link.json written.
 * AC3: single-app merge → valid empty link.json.
 * AC4: attachFlowsAndLink is the single implementation (no duplicated logic).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  attachFlowsAndLink,
  isMultiAppGraph,
  linkFilePath,
} from "../src/link.js";
import { LINK_VERSION } from "../src/types.js";
import type { SutraGraph, SutraNode, SutraEdge } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeGraph(dir: string, graph: SutraGraph): string {
  const sutraDir = path.join(dir, ".sutra");
  fs.mkdirSync(sutraDir, { recursive: true });
  const p = path.join(sutraDir, "graph.json");
  fs.writeFileSync(p, JSON.stringify(graph, null, 2), "utf8");
  return p;
}

function makeNode(id: string, type: SutraNode["type"] = "endpoint"): SutraNode {
  return {
    id,
    type,
    name: id.split("#")[1] ?? id,
    file: id.split("#")[0] ?? id,
    line: 1,
    data_shape: null,
    feature: "api",
  };
}

function makeEdge(from: string, to: string, kind: SutraEdge["kind"] = "http"): SutraEdge {
  return { from, to, kind };
}

// ---------------------------------------------------------------------------
// Minimal multi-app merged graph:
//   app-alpha nodes drive flows via calls edges (no http unresolved needed).
// ---------------------------------------------------------------------------

function buildMultiAppGraph(): SutraGraph {
  return {
    version: 1,
    repo: "merged",
    scanned_at: new Date().toISOString(),
    commit: "test-sha",
    nodes: [
      // app-alpha: route → handler (flow path)
      makeNode("app-alpha::routes/orders.ts#GET /orders", "route"),
      makeNode("app-alpha::handlers/orders.ts#listOrders", "handler"),
      // app-beta: route → handler
      makeNode("app-beta::routes/items.ts#GET /items", "route"),
      makeNode("app-beta::handlers/items.ts#listItems", "handler"),
    ],
    edges: [
      makeEdge(
        "app-alpha::routes/orders.ts#GET /orders",
        "app-alpha::handlers/orders.ts#listOrders",
        "calls",
      ),
      makeEdge(
        "app-beta::routes/items.ts#GET /items",
        "app-beta::handlers/items.ts#listItems",
        "calls",
      ),
    ],
    issues: [],
    features: [],
    contracts: [],
  };
}

// ---------------------------------------------------------------------------
// Minimal single-app merged graph
// ---------------------------------------------------------------------------

function buildSingleAppGraph(): SutraGraph {
  return {
    version: 1,
    repo: "my-app",
    scanned_at: new Date().toISOString(),
    commit: "single-sha",
    nodes: [
      makeNode("routes/index.ts#GET /", "route"),
      makeNode("handlers/index.ts#home", "handler"),
    ],
    edges: [
      makeEdge("routes/index.ts#GET /", "handlers/index.ts#home", "calls"),
    ],
    issues: [],
    features: [],
    contracts: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-merge-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("isMultiAppGraph (Story 8.5)", () => {
  it("returns false for nodes without app:: prefix", () => {
    const nodes = [makeNode("routes/a.ts#fn"), makeNode("handlers/b.ts#fn2")];
    expect(isMultiAppGraph(nodes)).toBe(false);
  });

  it("returns false for nodes sharing a single app:: prefix", () => {
    const nodes = [makeNode("app-alpha::routes/a.ts#fn"), makeNode("app-alpha::handlers/b.ts#fn2")];
    expect(isMultiAppGraph(nodes)).toBe(false);
  });

  it("returns true when two distinct app:: prefixes are present", () => {
    const nodes = [
      makeNode("app-alpha::routes/a.ts#fn"),
      makeNode("app-beta::routes/b.ts#fn2"),
    ];
    expect(isMultiAppGraph(nodes)).toBe(true);
  });

  it("returns true for the multi-app merged graph fixture", () => {
    expect(isMultiAppGraph(buildMultiAppGraph().nodes)).toBe(true);
  });
});

describe("attachFlowsAndLink — multi-app merge (AC1 + AC2, Story 8.5)", () => {
  it("persists flows on merged graph and produces parseable link.json", () => {
    const graphPath = writeGraph(tmp, buildMultiAppGraph());

    const result = attachFlowsAndLink(graphPath, tmp);

    // AC1: flows built and written to graphPath
    expect(result.flowsCount).toBeGreaterThan(0);
    const persisted = JSON.parse(fs.readFileSync(graphPath, "utf8")) as SutraGraph;
    expect(Array.isArray(persisted.flows)).toBe(true);
    expect((persisted.flows ?? []).length).toBeGreaterThan(0);

    // AC2: link.json written and parseable, never missing
    expect(fs.existsSync(result.linkPath)).toBe(true);
    const link = JSON.parse(fs.readFileSync(result.linkPath, "utf8"));
    expect(link.version).toBe(LINK_VERSION);
    expect(Array.isArray(link.repos)).toBe(true);
    expect(link.repos.length).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(link.edges)).toBe(true);

    // multiApp flag correct
    expect(result.multiApp).toBe(true);
  });

  it("link.json path matches linkFilePath(artifactDir)", () => {
    const graphPath = writeGraph(tmp, buildMultiAppGraph());
    const result = attachFlowsAndLink(graphPath, tmp);
    expect(result.linkPath).toBe(linkFilePath(tmp));
  });
});

describe("attachFlowsAndLink — single-app merge (AC3, Story 8.5)", () => {
  it("writes valid empty link.json for single-app merged graph", () => {
    const graphPath = writeGraph(tmp, buildSingleAppGraph());

    const result = attachFlowsAndLink(graphPath, tmp);

    // flows still traced (AC1 applies here too)
    expect(result.flowsCount).toBeGreaterThan(0);

    // AC3: valid empty link.json
    expect(fs.existsSync(result.linkPath)).toBe(true);
    const link = JSON.parse(fs.readFileSync(result.linkPath, "utf8"));
    expect(link.version).toBe(LINK_VERSION);
    expect(link.repos).toHaveLength(1);
    expect(link.edges).toEqual([]);

    expect(result.multiApp).toBe(false);
  });

  it("onlyIfAbsent skips overwrite of richer single-app link", () => {
    const graphPath = writeGraph(tmp, buildSingleAppGraph());
    // Pre-write a multi-repo link (richer than empty)
    const richLink = {
      version: LINK_VERSION,
      linked_at: "2020-01-01T00:00:00.000Z",
      repos: [{ name: "a", path: "/a" }, { name: "b", path: "/b" }],
      edges: [{ from: "a::x", to: "b::y", kind: "http", resolution: "confirmed", method: "GET", path: "/y" }],
    };
    const lp = linkFilePath(tmp);
    fs.mkdirSync(path.dirname(lp), { recursive: true });
    fs.writeFileSync(lp, JSON.stringify(richLink, null, 2));

    attachFlowsAndLink(graphPath, tmp, { onlyIfAbsent: true });

    // rich link preserved
    const after = JSON.parse(fs.readFileSync(lp, "utf8"));
    expect(after.repos).toHaveLength(2);
  });
});
