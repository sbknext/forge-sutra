/**
 * SUTRA-4.1 — scaffold generation tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { scan } from "../src/scanner.js";
import { runChecks } from "../src/checks.js";
import { buildFeatures } from "../src/features.js";
import { buildFlows } from "../src/flows.js";
import { loadContracts } from "../src/contracts.js";
import { checkContractDrift } from "../src/checks.js";
import {
  generateStub,
  scaffoldFileName,
  writeScaffolds,
  SCAFFOLD_BANNER,
} from "../src/scaffold.js";
import type { SutraGraph } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BROKEN = path.resolve(__dirname, "fixtures/broken");

function buildGraph(repoRoot: string): SutraGraph {
  const { nodes, edges } = scan(repoRoot);
  const checkIssues = runChecks(nodes, edges);
  const { contracts, issues: contractIssues } = loadContracts(repoRoot);
  const driftIssues = checkContractDrift(contracts, nodes);
  const issues = [...checkIssues, ...contractIssues, ...driftIssues];
  const features = buildFeatures(nodes, issues, edges, { contracts });
  const { flows } = buildFlows(nodes, edges);
  return {
    version: 1,
    repo: path.basename(repoRoot),
    scanned_at: new Date().toISOString(),
    commit: "test",
    nodes,
    edges,
    issues,
    features,
    contracts,
    flows,
  };
}

describe("generateStub — SUTRA-4.1", () => {
  it("includes CANDIDATE banner", () => {
    const stub = generateStub({
      severity: "error",
      kind: "orphaned_endpoint",
      node: "POST /api/capture",
      feature: "api",
      message: "no matching route",
    });
    expect(stub).toContain(SCAFFOLD_BANNER);
  });

  it("references METHOD and path in stub", () => {
    const stub = generateStub({
      severity: "error",
      kind: "orphaned_endpoint",
      node: "POST /api/capture",
      feature: "api",
      message: "no matching route",
    });
    expect(stub).toContain("POST /api/capture");
    expect(stub).toContain("orphaned_endpoint");
  });

  it("produces deterministic file name from issue", () => {
    const name = scaffoldFileName({
      severity: "error",
      kind: "orphaned_endpoint",
      node: "POST /api/capture",
      feature: "api",
      message: "test",
    });
    expect(name).toBe("orphaned_endpoint-post--api-capture.test.ts");
  });
});

describe("writeScaffolds — broken fixture", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-scaffold-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes scaffold containing POST /api/capture for broken fixture", () => {
    const graph = buildGraph(BROKEN);
    const outDir = path.join(tmpDir, "scaffold");
    const result = writeScaffolds(graph, {
      outDir,
      kinds: ["orphaned_endpoint"],
    });

    expect(result.written.length).toBeGreaterThan(0);
    const contents = result.written
      .map((f) => fs.readFileSync(f, "utf8"))
      .join("\n");
    expect(contents).toContain("POST /api/capture");
    expect(contents).toContain(SCAFFOLD_BANNER);
  });

  it("does not overwrite existing files without --force", () => {
    const graph = buildGraph(BROKEN);
    const outDir = path.join(tmpDir, "scaffold");
    const first = writeScaffolds(graph, { outDir, kinds: ["orphaned_endpoint"] });
    expect(first.written.length).toBeGreaterThan(0);

    fs.writeFileSync(first.written[0]!, "CUSTOM");
    const second = writeScaffolds(graph, { outDir, kinds: ["orphaned_endpoint"] });
    expect(second.skipped.length).toBeGreaterThan(0);
    expect(fs.readFileSync(second.skipped[0]!, "utf8")).toBe("CUSTOM");
  });

  it("overwrites when force is true", () => {
    const graph = buildGraph(BROKEN);
    const outDir = path.join(tmpDir, "scaffold");
    const first = writeScaffolds(graph, { outDir, kinds: ["orphaned_endpoint"] });
    fs.writeFileSync(first.written[0]!, "CUSTOM");

    const result = writeScaffolds(graph, {
      outDir,
      kinds: ["orphaned_endpoint"],
      force: true,
    });
    expect(result.written.length).toBeGreaterThan(0);
    expect(fs.readFileSync(result.written[0]!, "utf8")).toContain(SCAFFOLD_BANNER);
  });
});
