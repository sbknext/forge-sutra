/**
 * Story 3.3 — feature sub-graph and drill-down field tolerance tests.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { subgraph, featureIssues, featureFlows } from "../src/viewer/subgraph.js";
import type { SutraGraph, SutraFeature } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function load(name: string): SutraGraph {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", name, "graph.json"), "utf8"),
  ) as SutraGraph;
}

describe("Section 10 — feature sub-graph induction (Story 3.3)", () => {
  const graph = load("drilldown-basic");
  const feature = graph.features[0]!;

  it("returns in-feature nodes only plus synthetic http target", () => {
    const sub = subgraph(feature, graph);
    expect(sub.nodes.map((n) => n.id)).toContain("app/page.tsx");
    expect(sub.nodes.map((n) => n.id)).not.toContain("other/feature.ts");
    expect(sub.nodeIds.has("http:GET /api/widgets")).toBe(true);
  });

  it("excludes cross-feature edges", () => {
    const sub = subgraph(feature, graph);
    const cross = sub.edges.find((e) => e.from === "other/feature.ts");
    expect(cross).toBeUndefined();
  });

  it("includes in-feature renders edge", () => {
    const sub = subgraph(feature, graph);
    expect(sub.edges.some((e) => e.kind === "renders")).toBe(true);
  });
});

describe("Section 11 — drill-down field tolerance (Story 3.3)", () => {
  it("groups issues by kind with confidence when present", () => {
    const graph: SutraGraph = {
      ...load("drilldown-basic"),
      issues: [
        {
          severity: "warn",
          kind: "orphaned_endpoint",
          node: "http:GET /x",
          feature: "widgets",
          message: "low conf",
          confidence: 0.4,
          provenance: "template-prefix",
        },
        {
          severity: "error",
          kind: "missing_handler",
          node: "app/page.tsx",
          feature: "widgets",
          message: "missing",
          confidence: 0.9,
          provenance: "ast-exact",
        },
      ],
    };
    const groups = featureIssues(graph, "widgets");
    expect(groups.get("orphaned_endpoint")).toHaveLength(1);
    expect(groups.get("missing_handler")).toHaveLength(1);
    expect(groups.get("missing_handler")![0]!.confidence).toBe(0.9);
  });

  it("featureFlows empty when flows absent", () => {
    const graph = load("drilldown-basic");
    expect(featureFlows(graph, graph.features[0]!)).toHaveLength(0);
  });

  it("featureFlows returns matching flows when present", () => {
    const graph = load("drilldown-basic");
    const feat = graph.features[0]!;
    graph.flows = [
      {
        id: "flow-1",
        entry: "app/page.tsx",
        steps: [{ node: "app/page.tsx", edge: null }],
        terminal: "handler",
        confidence: "confirmed",
      },
    ];
    expect(featureFlows(graph, feat)).toHaveLength(1);
  });
});
