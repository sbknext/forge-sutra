/**
 * Phase 3 export + view tests.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportContracts, exportGraphSchema, exportIssues } from "../src/export.js";
import { renderView } from "../src/view.js";
import { scan } from "../src/scanner.js";
import { loadContracts } from "../src/contracts.js";
import { runChecks, checkContractDrift } from "../src/checks.js";
import { buildFeatures } from "../src/features.js";
import { GRAPH_VERSION, type SutraGraph } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_MULTI = path.resolve(__dirname, "fixtures/contract-multi");

function buildGraph(repoRoot: string): SutraGraph {
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

describe("export (Phase 3)", () => {
  it("exportContracts returns contracts array JSON", () => {
    const graph = buildGraph(CONTRACT_MULTI);
    const out = exportContracts(graph);
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].feature).toBeDefined();
  });

  it("exportGraphSchema includes version const", () => {
    const out = exportGraphSchema();
    const schema = JSON.parse(out);
    expect(schema.title).toBe("SutraGraph");
    expect(schema.properties.version.const).toBe(GRAPH_VERSION);
  });

  it("exportIssues csv format", () => {
    const graph = buildGraph(CONTRACT_MULTI);
    const csv = exportIssues(graph, "csv");
    expect(csv.startsWith("severity,kind,node,feature,message")).toBe(true);
  });
});

describe("view contract UX (Phase 3)", () => {
  it("shows contract count in header (SUTRA-13.1)", () => {
    const graph = buildGraph(CONTRACT_MULTI);
    const html = renderView(graph);
    expect(html).toContain("2 contracts");
    expect(html).toContain("declared endpoints");
  });

  it("shows contract filter dropdown (SUTRA-13.3)", () => {
    const graph = buildGraph(CONTRACT_MULTI);
    const html = renderView(graph);
    expect(html).toContain("contract-filter-select");
    expect(html).toContain("features/todos.sutra.md");
  });
});
