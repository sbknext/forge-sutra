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
import { runChecks } from "../src/checks.js";
import { buildFeatures } from "../src/features.js";
import { loadContracts } from "../src/contracts.js";
import type { SutraNode, SutraEdge, SutraIssue } from "../src/types.js";

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
const CONTRACT_PARSE_ERROR = path.resolve(__dirname, "fixtures/contract-parse-error");

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
    const features = buildFeatures(nodes, issues);
    expect(features.length).toBeGreaterThan(0);
  });

  it("every feature node_id is present in the nodes list (broken fixture)", () => {
    const { nodes, edges } = scan(BROKEN);
    const issues = runChecks(nodes, edges);
    const features = buildFeatures(nodes, issues);
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
    const features = buildFeatures(nodes, issues);
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
    const features = buildFeatures(nodes, issues);
    // For each feature, collect issue count from the issues array by feature field match
    for (const feat of features) {
      const relatedIssues = issues.filter((i) => i.feature === feat.id);
      expect(feat.issue_count).toBe(relatedIssues.length);
    }
  });

  it("feature ids are unique", () => {
    const { nodes, edges } = scan(BROKEN);
    const issues = runChecks(nodes, edges);
    const features = buildFeatures(nodes, issues);
    const ids = features.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("clean fixture features have issue_count === 0 for every feature", () => {
    const { nodes, edges } = scan(CLEAN);
    const issues = runChecks(nodes, edges);
    const features = buildFeatures(nodes, issues);
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
  });

  it("scan + runChecks regression unchanged (zero structural issues)", () => {
    const { nodes, edges } = scan(CONTRACT_DECLARED);
    const issues = runChecks(nodes, edges);
    expect(issues).toHaveLength(0);
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
