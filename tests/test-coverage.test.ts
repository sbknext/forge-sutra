/**
 * Test-coverage mapping — Story 2.6
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "../src/scanner.js";
import { runChecks, checkUntestedFeatures } from "../src/checks.js";
import { buildFeatures } from "../src/features.js";
import { GRAPH_VERSION } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTED = path.resolve(__dirname, "fixtures/clean");
const UNTESTED = path.resolve(__dirname, "fixtures/test-coverage-untested");
const DANGLING = path.resolve(__dirname, "fixtures/test-coverage-dangling");

function scanFeatures(repo: string) {
  const { nodes, edges } = scan(repo);
  const checkIssues = runChecks(nodes, edges);
  const features = buildFeatures(nodes, checkIssues, edges);
  const untested = checkUntestedFeatures(features);
  return { nodes, edges, issues: [...checkIssues, ...untested], features, untested };
}

describe("test-coverage mapping (Story 2.6)", () => {
  it("GRAPH_VERSION is 5 after test linkage schema bump", () => {
    expect(GRAPH_VERSION).toBe(5);
  });

  it("tested fixture has tested true and test edges", () => {
    const { features } = scanFeatures(TESTED);
    const libFeat = features.find((f) => f.node_ids.some((id) => id.includes("lib/greeter")));
    expect(libFeat).toBeDefined();
    expect(libFeat!.tested).toBe(true);
    expect(libFeat!.test_edge_count).toBeGreaterThanOrEqual(1);
    expect(libFeat!.test_node_ids.length).toBeGreaterThanOrEqual(1);
  });

  it("untested fixture has tested false and emits untested_feature", () => {
    const { features, untested } = scanFeatures(UNTESTED);
    expect(features.some((f) => !f.tested)).toBe(true);
    expect(untested.length).toBeGreaterThan(0);
    expect(untested.every((i) => i.kind === "untested_feature")).toBe(true);
    expect(untested.every((i) => i.severity === "info")).toBe(true);
    expect(untested[0]!.message).toContain("Static test linkage");
    expect(untested[0]!.message).not.toMatch(/%/);
    expect(untested[0]!.message.toLowerCase()).not.toContain("coverage percentage");
  });

  it("dangling test ref does not mark feature tested", () => {
    const { nodes, edges } = scan(DANGLING);
    const issues = runChecks(nodes, edges);
    expect(issues.some((i) => i.kind === "dangling_test_ref")).toBe(true);
    const features = buildFeatures(nodes, issues, edges);
    const widgetFeat = features.find((f) => f.id.includes("lib") || f.node_ids.some((id) => id.includes("widget")));
    if (widgetFeat) {
      expect(widgetFeat.tested).toBe(false);
    }
  });

  it("deterministic test_node_ids ordering across two runs", () => {
    const run = () => scanFeatures(TESTED).features.map((f) => f.test_node_ids);
    expect(run()).toEqual(run());
  });
});
