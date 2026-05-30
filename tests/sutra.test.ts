/**
 * Sutra Phase 0 — integration tests for scanner + checks + features.
 *
 * Contract under test (documented signatures, sibling agents implement):
 *   scan(repoRoot)              → { nodes, edges }
 *   runChecks(nodes, edges)     → SutraIssue[]
 *   buildFeatures(nodes, issues)→ SutraFeature[]
 *
 * Fixtures:
 *   tests/fixtures/broken/  — triggers all three IssueKinds
 *   tests/fixtures/clean/   — zero issues
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "../src/scanner.js";
import { runChecks, checkContractDrift } from "../src/checks.js";
import { buildFeatures, computeFeatureHealth, bandForScore, GREEN_MIN, AMBER_MIN } from "../src/features.js";
import { loadContracts } from "../src/contracts.js";
import { renderView } from "../src/view.js";
import {
  GRAPH_VERSION,
  CONFIDENCE,
  type SutraNode,
  type SutraEdge,
  type SutraIssue,
  type Provenance,
} from "../src/types.js";

// ── path helpers ──────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BROKEN = path.resolve(__dirname, "fixtures/broken");
const CLEAN = path.resolve(__dirname, "fixtures/clean");
const PROXIED = path.resolve(__dirname, "fixtures/proxied");
const ASSETS = path.resolve(__dirname, "fixtures/assets");
const EXTERNAL = path.resolve(__dirname, "fixtures/external");
const DYNAMIC = path.resolve(__dirname, "fixtures/dynamic");
const DYNAMIC_MISMATCH = path.resolve(__dirname, "fixtures/dynamic-mismatch");
const CONTRACT_DECLARED = path.resolve(__dirname, "fixtures/contract-declared");
const CONTRACT_CLEAN = path.resolve(__dirname, "fixtures/contract-clean");
const CONTRACT_PARSE_ERROR = path.resolve(__dirname, "fixtures/contract-parse-error");
const TEMPLATE_URL = path.resolve(__dirname, "fixtures/template-url");

// ── helpers ───────────────────────────────────────────────────────────────────
function sortedIds(nodes: SutraNode[]): string[] {
  return nodes.map((n) => n.id).sort();
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. SCANNER — broken fixture
// ═════════════════════════════════════════════════════════════════════════════
describe("scanner — broken fixture", () => {
  it("emits a non-zero number of nodes and edges", () => {
    const { nodes, edges } = scan(BROKEN);
    expect(nodes.length).toBeGreaterThan(0);
    expect(edges.length).toBeGreaterThan(0);
  });

  it("finds at least one node of type 'route' or 'handler'", () => {
    const { nodes } = scan(BROKEN);
    const routeOrHandler = nodes.filter(
      (n) => n.type === "route" || n.type === "handler"
    );
    expect(routeOrHandler.length).toBeGreaterThan(0);
  });

  it("finds at least one node of type 'endpoint' (client fetch call)", () => {
    const { nodes } = scan(BROKEN);
    const endpoints = nodes.filter((n) => n.type === "endpoint");
    expect(endpoints.length).toBeGreaterThan(0);
  });

  it("finds at least one node of type 'test'", () => {
    const { nodes } = scan(BROKEN);
    const tests = nodes.filter((n) => n.type === "test");
    expect(tests.length).toBeGreaterThan(0);
  });

  it("finds at least one node of type 'module' or 'function'", () => {
    const { nodes } = scan(BROKEN);
    const modOrFn = nodes.filter(
      (n) => n.type === "module" || n.type === "function"
    );
    expect(modOrFn.length).toBeGreaterThan(0);
  });

  it("emits an http edge whose 'to' encodes POST /api/capture", () => {
    const { edges } = scan(BROKEN);
    const httpEdges = edges.filter((e: SutraEdge) => e.kind === "http");
    // At least one http edge must reference POST /api/capture
    const captureEdge = httpEdges.find((e) =>
      e.to.includes("POST") && e.to.includes("/api/capture")
    );
    expect(
      captureEdge,
      "expected an http edge to POST /api/capture"
    ).toBeDefined();
  });

  it("emits at least one imports edge", () => {
    const { edges } = scan(BROKEN);
    const importEdges = edges.filter((e: SutraEdge) => e.kind === "imports");
    expect(importEdges.length).toBeGreaterThan(0);
  });

  it("every node has feature populated (non-empty string)", () => {
    const { nodes } = scan(BROKEN);
    for (const node of nodes) {
      expect(typeof node.feature).toBe("string");
      expect(node.feature.length).toBeGreaterThan(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. SCANNER — deterministic ids
// ═════════════════════════════════════════════════════════════════════════════
describe("scanner — deterministic ids", () => {
  it("two scans of the broken fixture produce identical sorted id lists", () => {
    const first = sortedIds(scan(BROKEN).nodes);
    const second = sortedIds(scan(BROKEN).nodes);
    expect(first).toEqual(second);
  });

  it("two scans of the clean fixture produce identical sorted id lists", () => {
    const first = sortedIds(scan(CLEAN).nodes);
    const second = sortedIds(scan(CLEAN).nodes);
    expect(first).toEqual(second);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. CHECKS — broken fixture: all three issue kinds present
// ═════════════════════════════════════════════════════════════════════════════
describe("runChecks — broken fixture", () => {
  let nodes: SutraNode[];
  let edges: SutraEdge[];
  let issues: SutraIssue[];

  // Scan once, reuse
  (() => {
    const result = scan(BROKEN);
    nodes = result.nodes;
    edges = result.edges;
    issues = runChecks(nodes, edges);
  })();

  it("returns at least one issue total", () => {
    expect(issues.length).toBeGreaterThan(0);
  });

  it("returns at least one orphaned_endpoint issue", () => {
    const orphans = issues.filter((i) => i.kind === "orphaned_endpoint");
    expect(orphans.length, "expected at least one orphaned_endpoint").toBeGreaterThan(0);
  });

  it("the orphaned_endpoint issue names POST /api/capture", () => {
    const orphan = issues.find(
      (i) =>
        i.kind === "orphaned_endpoint" &&
        i.node.includes("POST") &&
        i.node.includes("/api/capture")
    );
    expect(orphan, "orphaned_endpoint for POST /api/capture not found").toBeDefined();
  });

  it("returns at least one missing_handler issue", () => {
    const missing = issues.filter((i) => i.kind === "missing_handler");
    expect(missing.length, "expected at least one missing_handler").toBeGreaterThan(0);
  });

  it("the missing_handler issue references nonexistent-handler or captureHandler", () => {
    const missing = issues.find(
      (i) =>
        i.kind === "missing_handler" &&
        (i.node.includes("nonexistent-handler") ||
          i.node.includes("captureHandler") ||
          i.message.includes("nonexistent-handler") ||
          i.message.includes("captureHandler"))
    );
    expect(missing, "missing_handler for nonexistent-handler not found").toBeDefined();
  });

  it("returns at least one dangling_test_ref issue", () => {
    const dangling = issues.filter((i) => i.kind === "dangling_test_ref");
    expect(dangling.length, "expected at least one dangling_test_ref").toBeGreaterThan(0);
  });

  it("the dangling_test_ref issue references gone.js or gone", () => {
    const dangling = issues.find(
      (i) =>
        i.kind === "dangling_test_ref" &&
        (i.node.includes("gone") || i.message.includes("gone"))
    );
    expect(dangling, "dangling_test_ref for gone.js not found").toBeDefined();
  });

  it("every issue has severity set (error | warn | info)", () => {
    const validSeverities = new Set(["error", "warn", "info"]);
    for (const issue of issues) {
      expect(validSeverities.has(issue.severity)).toBe(true);
    }
  });

  it("every issue has a non-empty message", () => {
    for (const issue of issues) {
      expect(issue.message.length).toBeGreaterThan(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. CHECKS — no false positive on the valid GET /api/ping pair
// ═════════════════════════════════════════════════════════════════════════════
describe("runChecks — broken fixture: no false positive on valid pair", () => {
  it("does NOT flag GET /api/ping as orphaned_endpoint", () => {
    const { nodes, edges } = scan(BROKEN);
    const issues = runChecks(nodes, edges);
    const pingOrphan = issues.find(
      (i) =>
        i.kind === "orphaned_endpoint" &&
        i.node.includes("GET") &&
        i.node.includes("/api/ping")
    );
    expect(pingOrphan, "GET /api/ping should NOT be flagged as orphaned").toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. CHECKS — clean fixture: zero issues
// ═════════════════════════════════════════════════════════════════════════════
describe("runChecks — clean fixture", () => {
  it("returns zero issues for the clean fixture", () => {
    const { nodes, edges } = scan(CLEAN);
    const issues = runChecks(nodes, edges);
    expect(issues).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. BUILD FEATURES
// ═════════════════════════════════════════════════════════════════════════════
describe("buildFeatures", () => {
  it("returns at least one feature for the broken fixture", () => {
    const { nodes, edges } = scan(BROKEN);
    const issues = runChecks(nodes, edges);
    const features = buildFeatures(nodes, issues, edges);
    expect(features.length).toBeGreaterThan(0);
  });

  it("every feature node_id is present in the nodes list (broken fixture)", () => {
    const { nodes, edges } = scan(BROKEN);
    const issues = runChecks(nodes, edges);
    const features = buildFeatures(nodes, issues, edges);
    const nodeIdSet = new Set(nodes.map((n) => n.id));
    for (const feat of features) {
      for (const nid of feat.node_ids) {
        expect(
          nodeIdSet.has(nid),
          `feature '${feat.id}' references unknown node id '${nid}'`
        ).toBe(true);
      }
    }
  });

  it("every feature node_id is present in the nodes list (clean fixture)", () => {
    const { nodes, edges } = scan(CLEAN);
    const issues = runChecks(nodes, edges);
    const features = buildFeatures(nodes, issues, edges);
    const nodeIdSet = new Set(nodes.map((n) => n.id));
    for (const feat of features) {
      for (const nid of feat.node_ids) {
        expect(
          nodeIdSet.has(nid),
          `feature '${feat.id}' references unknown node id '${nid}'`
        ).toBe(true);
      }
    }
  });

  it("feature issue_count matches the issues assigned to nodes in that feature (broken fixture)", () => {
    const { nodes, edges } = scan(BROKEN);
    const issues = runChecks(nodes, edges);
    const features = buildFeatures(nodes, issues, edges);
    // For each feature, collect issue count from the issues array by feature field match
    for (const feat of features) {
      const relatedIssues = issues.filter((i) => i.feature === feat.id);
      expect(feat.issue_count).toBe(relatedIssues.length);
    }
  });

  it("feature ids are unique", () => {
    const { nodes, edges } = scan(BROKEN);
    const issues = runChecks(nodes, edges);
    const features = buildFeatures(nodes, issues, edges);
    const ids = features.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("clean fixture features have issue_count === 0 for every feature", () => {
    const { nodes, edges } = scan(CLEAN);
    const issues = runChecks(nodes, edges);
    const features = buildFeatures(nodes, issues, edges);
    for (const feat of features) {
      expect(feat.issue_count).toBe(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. PROXY-BLINDNESS FIX — proxied fixture: zero orphaned_endpoint issues
// ═════════════════════════════════════════════════════════════════════════════
describe("runChecks — proxied fixture (proxy-blindness fix)", () => {
  it("emits at least one http edge (fetch calls are detected)", () => {
    const { edges } = scan(PROXIED);
    const httpEdges = edges.filter((e: SutraEdge) => e.kind === "http");
    expect(httpEdges.length, "expected at least one http edge from fetch calls").toBeGreaterThan(0);
  });

  it("emits PROXY nodes from next.config.js rewrites", () => {
    const { nodes } = scan(PROXIED);
    const proxyNodes = nodes.filter((n: SutraNode) => n.type === "route" && n.name.startsWith("PROXY "));
    expect(proxyNodes.length, "expected at least one PROXY node from next.config.js").toBeGreaterThan(0);
  });

  it("returns ZERO orphaned_endpoint issues (all fetches are proxied)", () => {
    const { nodes, edges } = scan(PROXIED);
    const issues = runChecks(nodes, edges);
    const orphans = issues.filter((i) => i.kind === "orphaned_endpoint");
    expect(
      orphans,
      `Expected 0 orphaned_endpoint but got ${orphans.length}: ${orphans.map((o) => o.node).join(", ")}`
    ).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. ASSET IMPORT FIX — assets fixture: no missing_handler for .css/.svg/.png
// ═════════════════════════════════════════════════════════════════════════════
describe("runChecks — assets fixture (asset-import fix)", () => {
  it("emits at least one imports edge (Button.tsx imports are scanned)", () => {
    const { edges } = scan(ASSETS);
    const importEdges = edges.filter((e: SutraEdge) => e.kind === "imports");
    expect(importEdges.length).toBeGreaterThan(0);
  });

  it("returns ZERO missing_handler issues for .css / .svg / .png imports", () => {
    const { nodes, edges } = scan(ASSETS);
    const issues = runChecks(nodes, edges);
    const assetMissing = issues.filter(
      (i) =>
        i.kind === "missing_handler" &&
        (i.node.endsWith(".css") ||
          i.node.endsWith(".scss") ||
          i.node.endsWith(".svg") ||
          i.node.endsWith(".png") ||
          i.node.endsWith(".jpg"))
    );
    expect(
      assetMissing,
      `Expected no asset missing_handler but got: ${assetMissing.map((i) => i.node).join(", ")}`
    ).toHaveLength(0);
  });

  it("returns ZERO total issues for the assets fixture", () => {
    const { nodes, edges } = scan(ASSETS);
    const issues = runChecks(nodes, edges);
    expect(issues, `Expected 0 issues but got ${issues.length}: ${issues.map((i) => `${i.kind}:${i.node}`).join(", ")}`).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. REGRESSION — broken fixture still flags POST /api/capture (no proxy)
// ═════════════════════════════════════════════════════════════════════════════
describe("runChecks — broken fixture regression: orphan still detected without proxy", () => {
  it("still flags POST /api/capture as orphaned_endpoint (no next.config in broken fixture)", () => {
    const { nodes, edges } = scan(BROKEN);
    const issues = runChecks(nodes, edges);
    const orphan = issues.find(
      (i) =>
        i.kind === "orphaned_endpoint" &&
        i.node.includes("POST") &&
        i.node.includes("/api/capture")
    );
    expect(
      orphan,
      "REGRESSION: POST /api/capture should still be flagged as orphaned_endpoint in broken fixture (no next.config)"
    ).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. EXTERNAL-HOST ALLOWLIST — external fixture: zero orphaned_endpoint
// ═════════════════════════════════════════════════════════════════════════════
describe("runChecks — external fixture (external-host allowlist)", () => {
  it("emits an http edge with api.telegram.org host suffix", () => {
    const { edges } = scan(EXTERNAL);
    const httpEdges = edges.filter((e: SutraEdge) => e.kind === "http");
    const telegramEdge = httpEdges.find((e) => e.to.includes("api.telegram.org"));
    expect(
      telegramEdge,
      "expected http edge with api.telegram.org host for Telegram fetch"
    ).toBeDefined();
  });

  it("emits EXTERNAL registry nodes for known external hosts", () => {
    const { nodes } = scan(EXTERNAL);
    const externalNodes = nodes.filter(
      (n: SutraNode) => n.type === "route" && n.name.startsWith("EXTERNAL ")
    );
    expect(externalNodes.length).toBeGreaterThan(0);
    expect(externalNodes.some((n) => n.name.includes("api.telegram.org"))).toBe(true);
  });

  it("returns ZERO orphaned_endpoint issues for Telegram external fetch", () => {
    const { nodes, edges } = scan(EXTERNAL);
    const issues = runChecks(nodes, edges);
    const orphans = issues.filter((i) => i.kind === "orphaned_endpoint");
    expect(
      orphans,
      `Expected 0 orphaned_endpoint but got ${orphans.length}: ${orphans.map((o) => o.node).join(", ")}`
    ).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. DYNAMIC-SEGMENT RESOLVER — template literals ↔ [id] / :id routes
// ═════════════════════════════════════════════════════════════════════════════
describe("runChecks — dynamic fixture (template literal route matching)", () => {
  it("emits http edges with :dynamic segment for template literal fetches", () => {
    const { edges } = scan(DYNAMIC);
    const httpEdges = edges.filter((e: SutraEdge) => e.kind === "http");
    const dynamicEdge = httpEdges.find(
      (e) => e.to.includes("/api/todos") && e.to.includes(":dynamic")
    );
    expect(
      dynamicEdge,
      "expected http edge path pattern containing :dynamic for /api/todos/${id}"
    ).toBeDefined();
  });

  it("emits GET and DELETE endpoint nodes for /api/todos/:id route file", () => {
    const { nodes } = scan(DYNAMIC);
    const todoRoutes = nodes.filter(
      (n) =>
        n.type === "endpoint" &&
        n.name.includes("/api/todos") &&
        n.name.includes(":id")
    );
    expect(todoRoutes.length).toBeGreaterThanOrEqual(2);
  });

  it("returns ZERO orphaned_endpoint issues when template fetch matches [id] route", () => {
    const { nodes, edges } = scan(DYNAMIC);
    const issues = runChecks(nodes, edges);
    const orphans = issues.filter((i) => i.kind === "orphaned_endpoint");
    expect(
      orphans,
      `Expected 0 orphaned_endpoint but got ${orphans.length}: ${orphans.map((o) => o.node).join(", ")}`
    ).toHaveLength(0);
  });
});

describe("runChecks — dynamic-mismatch fixture (wrong static path)", () => {
  it("flags GET /api/todos as orphaned when only /api/todos/:id route exists", () => {
    const { nodes, edges } = scan(DYNAMIC_MISMATCH);
    const issues = runChecks(nodes, edges);
    const orphan = issues.find(
      (i) =>
        i.kind === "orphaned_endpoint" &&
        i.node.includes("GET") &&
        i.node.includes("/api/todos") &&
        !i.node.includes(":dynamic")
    );
    expect(
      orphan,
      "GET /api/todos should be orphaned — no collection route, only [id] route"
    ).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. CONTRACT FILES — feature.sutra.md parser (SUTRA-2.1)
// ═════════════════════════════════════════════════════════════════════════════
describe("loadContracts — contract-declared fixture", () => {
  it("parses feature name and declared endpoints", () => {
    const { contracts, issues } = loadContracts(CONTRACT_DECLARED);
    expect(issues).toHaveLength(0);
    expect(contracts).toHaveLength(1);
    expect(contracts[0]!.feature).toBe("greet");
    expect(contracts[0]!.file).toBe("feature.sutra.md");
    const methods = contracts[0]!.endpoints.map((e) => `${e.method} ${e.path}`);
    expect(methods).toContain("GET /api/greet");
    expect(methods).toContain("POST /api/greet");
    expect(methods).toContain("DELETE /api/greet");
  });

  it("scan + runChecks regression unchanged (zero structural issues)", () => {
    const { nodes, edges } = scan(CONTRACT_DECLARED);
    const issues = runChecks(nodes, edges);
    expect(issues).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. CONTRACT DRIFT — declared vs observed routes (SUTRA-2.2)
// ═════════════════════════════════════════════════════════════════════════════
describe("checkContractDrift — contract-declared fixture (missing route)", () => {
  it("flags contract_missing_route for declared endpoint with no route node", () => {
    const { nodes } = scan(CONTRACT_DECLARED);
    const { contracts } = loadContracts(CONTRACT_DECLARED);
    const drift = checkContractDrift(contracts, nodes);
    const missing = drift.filter((i) => i.kind === "contract_missing_route");
    expect(missing.length).toBeGreaterThan(0);
    const deleteMissing = missing.find(
      (i) => i.node.includes("DELETE") && i.node.includes("/api/greet"),
    );
    expect(
      deleteMissing,
      "DELETE /api/greet declared but not implemented should fire contract_missing_route",
    ).toBeDefined();
    expect(deleteMissing!.severity).toBe("error");
  });

  it("does not flag GET or POST /api/greet when route handlers exist", () => {
    const { nodes } = scan(CONTRACT_DECLARED);
    const { contracts } = loadContracts(CONTRACT_DECLARED);
    const drift = checkContractDrift(contracts, nodes);
    const missing = drift.filter((i) => i.kind === "contract_missing_route");
    expect(missing.find((i) => i.node.includes("GET /api/greet"))).toBeUndefined();
    expect(missing.find((i) => i.node.includes("POST /api/greet"))).toBeUndefined();
  });
});

describe("checkContractDrift — contract-clean fixture (fully aligned)", () => {
  it("returns zero contract drift issues when contract matches routes", () => {
    const { nodes } = scan(CONTRACT_CLEAN);
    const { contracts } = loadContracts(CONTRACT_CLEAN);
    const drift = checkContractDrift(contracts, nodes);
    const contractIssues = drift.filter(
      (i) => i.kind === "contract_missing_route" || i.kind === "contract_undeclared_route",
    );
    expect(contractIssues).toHaveLength(0);
  });
});

describe("checkContractDrift — contract-declared fixture (undeclared route)", () => {
  it("warns contract_undeclared_route when route exists but not in contract", () => {
    const { nodes } = scan(CONTRACT_DECLARED);
    const { contracts } = loadContracts(CONTRACT_DECLARED);
    const drift = checkContractDrift(contracts, nodes);
    const undeclared = drift.filter((i) => i.kind === "contract_undeclared_route");
    expect(undeclared.length).toBeGreaterThan(0);
    const pingUndeclared = undeclared.find(
      (i) => i.node.includes("GET") && i.node.includes("/api/ping"),
    );
    expect(
      pingUndeclared,
      "GET /api/ping route not in contract should fire contract_undeclared_route",
    ).toBeDefined();
    expect(pingUndeclared!.severity).toBe("warn");
  });
});

describe("checkContractDrift — clean fixture (no contract file)", () => {
  it("returns zero contract drift issues when no feature.sutra.md present", () => {
    const { nodes } = scan(CLEAN);
    const { contracts } = loadContracts(CLEAN);
    expect(contracts).toHaveLength(0);
    const drift = checkContractDrift(contracts, nodes);
    expect(drift).toHaveLength(0);
  });
});

describe("loadContracts — contract-parse-error fixture", () => {
  it("emits contract_parse_error warn for bad endpoint line", () => {
    const { contracts, issues } = loadContracts(CONTRACT_PARSE_ERROR);
    const parseErrors = issues.filter((i) => i.kind === "contract_parse_error");
    expect(parseErrors.length).toBeGreaterThan(0);
    expect(parseErrors.every((i) => i.severity === "warn")).toBe(true);
    // Valid lines still parsed
    expect(contracts[0]?.endpoints.length).toBeGreaterThanOrEqual(2);
  });
});

describe("loadContracts — clean fixture (no contract file)", () => {
  it("returns empty contracts and no parse issues", () => {
    const { contracts, issues } = loadContracts(CLEAN);
    expect(contracts).toHaveLength(0);
    expect(issues).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 14. CONFIDENCE & PROVENANCE — Story 1.3
// ═════════════════════════════════════════════════════════════════════════════
describe("confidence & provenance (Story 1.3)", () => {
  const VALID_PROVENANCE = new Set<Provenance>([
    "ast-exact",
    "heuristic",
    "template-prefix",
    "ai-inferred",
  ]);

  it("GRAPH_VERSION is 3 after feature health schema bump", () => {
    expect(GRAPH_VERSION).toBe(3);
  });

  it("runChecks issues have provenance in union and confidence in [0,1]", () => {
    const { nodes, edges } = scan(BROKEN);
    const issues = runChecks(nodes, edges);
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.provenance).toBeDefined();
      expect(VALID_PROVENANCE.has(issue.provenance!)).toBe(true);
      expect(issue.confidence).toBeDefined();
      expect(issue.confidence!).toBeGreaterThanOrEqual(0);
      expect(issue.confidence!).toBeLessThanOrEqual(1);
    }
  });

  it("broken POST /api/capture orphan is ast-exact with higher confidence", () => {
    const { nodes, edges } = scan(BROKEN);
    const issues = runChecks(nodes, edges);
    const captureOrphan = issues.find(
      (i) =>
        i.kind === "orphaned_endpoint" &&
        i.node.includes("POST") &&
        i.node.includes("/api/capture"),
    );
    expect(captureOrphan).toBeDefined();
    expect(captureOrphan!.provenance).toBe("ast-exact");
    expect(captureOrphan!.confidence).toBe(CONFIDENCE.AST_EXACT);
  });

  it("broken missing_handler is ast-exact with high confidence", () => {
    const { nodes, edges } = scan(BROKEN);
    const issues = runChecks(nodes, edges);
    const missing = issues.find((i) => i.kind === "missing_handler");
    expect(missing).toBeDefined();
    expect(missing!.provenance).toBe("ast-exact");
    expect(missing!.confidence).toBe(CONFIDENCE.AST_EXACT);
  });

  it("template-url orphan is template-prefix with lower confidence than broken capture", () => {
    const { nodes, edges } = scan(TEMPLATE_URL);
    const issues = runChecks(nodes, edges);
    const templateOrphan = issues.find((i) => i.kind === "orphaned_endpoint");
    expect(templateOrphan, "expected orphaned_endpoint for template URL").toBeDefined();
    expect(templateOrphan!.provenance).toBe("template-prefix");
    expect(templateOrphan!.confidence).toBe(CONFIDENCE.TEMPLATE_PREFIX);

    const { nodes: brokenNodes, edges: brokenEdges } = scan(BROKEN);
    const brokenIssues = runChecks(brokenNodes, brokenEdges);
    const captureOrphan = brokenIssues.find(
      (i) =>
        i.kind === "orphaned_endpoint" &&
        i.node.includes("POST") &&
        i.node.includes("/api/capture"),
    );
    expect(captureOrphan!.confidence!).toBeGreaterThan(templateOrphan!.confidence!);
  });

  it("http edges from template literals carry template-prefix provenance", () => {
    const { edges } = scan(TEMPLATE_URL);
    const httpEdges = edges.filter((e) => e.kind === "http");
    expect(httpEdges.length).toBeGreaterThan(0);
    expect(httpEdges.some((e) => e.provenance === "template-prefix")).toBe(true);
  });

  it("http edges from string literals carry ast-exact provenance", () => {
    const { edges } = scan(BROKEN);
    const captureEdge = edges.find(
      (e) => e.kind === "http" && e.to.includes("POST") && e.to.includes("/api/capture"),
    );
    expect(captureEdge?.provenance).toBe("ast-exact");
  });

  it("PROXY and EXTERNAL nodes carry heuristic provenance", () => {
    const { nodes } = scan(PROXIED);
    const proxyNode = nodes.find((n) => n.name.startsWith("PROXY "));
    expect(proxyNode?.provenance).toBe("heuristic");

    const { nodes: extNodes } = scan(EXTERNAL);
    const externalNode = extNodes.find((n) => n.name.startsWith("EXTERNAL "));
    expect(externalNode?.provenance).toBe("heuristic");
  });

  it("determinism: two scans produce identical confidence/provenance per issue", () => {
    const run = () => {
      const { nodes, edges } = scan(BROKEN);
      return runChecks(nodes, edges).map((i) => ({
        kind: i.kind,
        node: i.node,
        provenance: i.provenance,
        confidence: i.confidence,
      }));
    };
    expect(run()).toEqual(run());
  });

  it("renderView degrades gracefully when confidence/provenance absent", () => {
    const { nodes, edges } = scan(CLEAN);
    const issues = runChecks(nodes, edges);
    const features = buildFeatures(nodes, issues, edges);
    const legacyGraph = {
      version: 0,
      repo: "legacy",
      scanned_at: "2026-01-01T00:00:00.000Z",
      commit: "abc1234",
      nodes,
      edges,
      issues: issues.map(({ provenance: _p, confidence: _c, ...rest }) => rest),
      features,
      contracts: [],
    };
    expect(() => renderView(legacyGraph)).not.toThrow();
    const html = renderView(legacyGraph);
    expect(html).toContain("<!DOCTYPE html>");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 15. FEATURE HEALTH — Story 2.4
// ═════════════════════════════════════════════════════════════════════════════
describe("feature health — clean fixture (Story 2.4)", () => {
  it("zero-issue feature scores 100 / green", () => {
    const { nodes, edges } = scan(CLEAN);
    const issues = runChecks(nodes, edges);
    const features = buildFeatures(nodes, issues, edges);
    expect(features.length).toBeGreaterThan(0);
    for (const feat of features) {
      expect(feat.health.score).toBe(100);
      expect(feat.health.band).toBe("green");
      const issueInput = feat.health.inputs.find((i) => i.signal === "issue_load");
      expect(issueInput?.available).toBe(true);
      expect(issueInput?.penalty).toBe(0);
    }
  });

  it("deterministic health across two buildFeatures runs", () => {
    const { nodes, edges } = scan(CLEAN);
    const issues = runChecks(nodes, edges);
    const a = buildFeatures(nodes, issues, edges);
    const b = buildFeatures(nodes, issues, edges);
    expect(a.map((f) => f.health)).toEqual(b.map((f) => f.health));
  });
});

describe("feature health — broken fixture (Story 2.4)", () => {
  it("orphaned_endpoint drives score down with orphan_ratio penalty > 0", () => {
    const { nodes, edges } = scan(BROKEN);
    const issues = runChecks(nodes, edges);
    const features = buildFeatures(nodes, issues, edges);
    const libFeature = features.find((f) =>
      f.node_ids.some((id) => id.includes("lib/client")),
    );
    expect(libFeature).toBeDefined();
    expect(libFeature!.health.score).toBeLessThan(100);
    const orphanInput = libFeature!.health.inputs.find((i) => i.signal === "orphan_ratio");
    expect(orphanInput?.penalty).toBeGreaterThan(0);
    expect(["amber", "red"]).toContain(libFeature!.health.band);
  });
});

describe("feature health — band thresholds", () => {
  it("boundary 49 → red, 50 → amber, 79 → amber, 80 → green", () => {
    expect(bandForScore(49)).toBe("red");
    expect(bandForScore(50)).toBe("amber");
    expect(bandForScore(79)).toBe("amber");
    expect(bandForScore(80)).toBe("green");
    expect(GREEN_MIN).toBe(80);
    expect(AMBER_MIN).toBe(50);
  });
});

describe("feature health — optional signal gating", () => {
  it("confidence/contract/coverage unavailable when data absent", () => {
    const { nodes, edges } = scan(CLEAN);
    const issues = runChecks(nodes, edges);
    const features = buildFeatures(nodes, issues, edges);
    const feat = features[0]!;
    const optional = ["confidence", "contract_drift", "test_coverage"];
    for (const sig of optional) {
      const input = feat.health.inputs.find((i) => i.signal === sig);
      expect(input?.available).toBe(false);
      expect(input?.penalty).toBe(0);
      expect(feat.health.available_signals).not.toContain(sig);
    }
    const alwaysOn = feat.health.inputs.filter((i) =>
      ["issue_load", "orphan_ratio"].includes(i.signal),
    );
    expect(alwaysOn.every((i) => i.available)).toBe(true);
  });
});

describe("feature health — schema guard", () => {
  it("every feature has valid health score and band", () => {
    const { nodes, edges } = scan(BROKEN);
    const issues = runChecks(nodes, edges);
    const features = buildFeatures(nodes, issues, edges);
    for (const feat of features) {
      expect(feat.health.score).toBeGreaterThanOrEqual(0);
      expect(feat.health.score).toBeLessThanOrEqual(100);
      expect(["green", "amber", "red"]).toContain(feat.health.band);
      expect(Number.isInteger(feat.health.score)).toBe(true);
    }
  });
});
