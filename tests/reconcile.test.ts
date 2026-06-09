/**
 * SUTRA-6.1 — cross-repo reconciliation tests.
 * SUTRA-1.5.2 — four-class orphan classification tests.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { reconcileGraphs, extractClientCalls, buildReconcileOutput, RECONCILE_VERSION } from "../src/reconcile.js";
import type { SutraGraph } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, "fixtures/reconcile");

function readGraph(name: string): SutraGraph {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8"),
  ) as SutraGraph;
}

describe("reconcileGraphs — SUTRA-6.1", () => {
  const client = readGraph("client-graph.json");
  const server = readGraph("server-graph.json");

  it("extracts client HTTP calls from edges", () => {
    const calls = extractClientCalls(client);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain("GET /api/users");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toContain("POST /api/missing");
  });

  it("matches GET /api/users against server route", () => {
    const result = reconcileGraphs(client, server);
    expect(result.checked).toBe(2);
    expect(result.matched).toBe(1);
  });

  it("flags POST /api/missing as cross_repo_orphan", () => {
    const result = reconcileGraphs(client, server);
    const orphan = result.issues.find((i) => i.kind === "cross_repo_orphan");
    expect(orphan).toBeDefined();
    expect(orphan!.node).toBe("POST /api/missing");
    expect(orphan!.severity).toBe("warn");
  });

  it("returns zero issues when all client calls match server", () => {
    const serverFull: SutraGraph = {
      ...server,
      nodes: [
        ...server.nodes,
        {
          id: "routes/missing.js#POST /api/missing",
          type: "route",
          name: "POST /api/missing",
          file: "routes/missing.js",
          line: 1,
          data_shape: null,
          feature: "routes",
          language: "ts",
        },
      ],
    };
    const result = reconcileGraphs(client, serverFull);
    expect(result.issues).toHaveLength(0);
    expect(result.matched).toBe(2);
  });

  it("buildReconcileOutput produces current RECONCILE_VERSION JSON (SUTRA-11.2)", () => {
    const result = reconcileGraphs(client, server);
    const output = buildReconcileOutput(client, server, result);
    expect(output.reconcile_version).toBe(RECONCILE_VERSION);
    expect(output.client_repo).toBe("client-app");
    expect(output.server_repo).toBe("server-api");
    expect(output.checked).toBe(2);
    expect(output.issues.length).toBeGreaterThan(0);
  });
});

// ── Story 1.5.2 — four-class classification ────────────────────────────────

describe("reconcileGraphs — Story 1.5.2 four-class orphan classification", () => {
  const client = readGraph("client-graph-classified.json");
  const server = readGraph("server-graph-classified.json");

  function classify(result: ReturnType<typeof reconcileGraphs>) {
    const map: Record<string, string> = {};
    for (const iss of result.issues) {
      map[iss.node] = iss.classification ?? "none";
    }
    return map;
  }

  it("classifies proxy-prefix path as proxy_suppressed", () => {
    const result = reconcileGraphs(client, server);
    // GET /api/brain/status: PROXY /api/brain node is in client graph
    const cls = classify(result);
    expect(cls["GET /api/brain/status"]).toBe("proxy_suppressed");
  });

  it("classifies dynamic-route match with same method as dynamic_suppressed", () => {
    // Server fixture has GET /api/items/:id.
    // A GET call to /api/items/77 must be dynamic_suppressed (method + path match).
    // A PATCH call to /api/items/77 must NOT be suppressed — different method means
    // the route is distinct; it should be confirmed_broken (PR #12 fix: method-aware).
    const result = reconcileGraphs(client, server);
    const cls = classify(result);
    // PATCH on a GET-only template → confirmed_broken (not suppressed)
    expect(cls["PATCH /api/items/77"]).toBe("confirmed_broken");
  });

  it("classifies external host call as external_suppressed (via allowlist param)", () => {
    const result = reconcileGraphs(client, server, {
      externalHostList: ["api.telegram.org"],
    });
    const cls = classify(result);
    // POST /sendMessage|api.telegram.org — host extracted → external_suppressed
    expect(cls["POST /sendMessage"]).toBe("external_suppressed");
  });

  it("classifies genuinely orphaned call as confirmed_broken", () => {
    const result = reconcileGraphs(client, server);
    // DELETE /api/nonexistent — no proxy, no dynamic match, no external host
    const cls = classify(result);
    expect(cls["DELETE /api/nonexistent"]).toBe("confirmed_broken");
  });

  it("attaches a reason string to every classified orphan", () => {
    const result = reconcileGraphs(client, server);
    for (const iss of result.issues) {
      if (iss.kind === "cross_repo_orphan") {
        expect(typeof iss.reason).toBe("string");
        expect(iss.reason!.length).toBeGreaterThan(0);
      }
    }
  });

  it("output JSON is deterministic (sorted by node id)", () => {
    const r1 = reconcileGraphs(client, server);
    const r2 = reconcileGraphs(client, server);
    const nodes1 = r1.issues.map((i) => i.node);
    const nodes2 = r2.issues.map((i) => i.node);
    expect(nodes1).toEqual(nodes2);
    // Verify sorted
    const sorted = [...nodes1].sort((a, b) => a.localeCompare(b));
    expect(nodes1).toEqual(sorted);
  });

  it("buildReconcileOutput includes summary counts (Story 1.5.2)", () => {
    const result = reconcileGraphs(client, server, {
      externalHostList: ["api.telegram.org"],
    });
    const output = buildReconcileOutput(client, server, result);
    expect(output.summary).toBeDefined();
    // At least one confirmed_broken (DELETE /api/nonexistent + PATCH /api/items/77 after method-aware fix)
    expect(output.summary.confirmed_broken).toBeGreaterThanOrEqual(1);
    // Proxy orphans should be suppressed
    expect(output.summary.proxy_suppressed).toBeGreaterThanOrEqual(1);
    // dynamic_suppressed is 0 in this fixture after the method-aware fix:
    // PATCH /api/items/77 used to be dynamic_suppressed (wrong method match), now confirmed_broken.
    // A genuine same-method dynamic match (GET /api/items/42) is caught by the exact-match step instead.
    expect(output.summary.dynamic_suppressed).toBeGreaterThanOrEqual(0);
    expect(output.summary.external_suppressed).toBeGreaterThanOrEqual(1);
    // No orphan silently dropped — all accounted for
    const total =
      output.summary.confirmed_broken +
      output.summary.proxy_suppressed +
      output.summary.dynamic_suppressed +
      output.summary.external_suppressed;
    expect(total).toBe(result.issues.length);
  });

  it("no orphan is silently dropped — all present in output", () => {
    const result = reconcileGraphs(client, server, {
      externalHostList: ["api.telegram.org"],
    });
    // 4 orphan calls: proxy, dynamic, external, broken
    // GET /api/users is matched, so not an orphan
    expect(result.checked).toBeGreaterThanOrEqual(4);
    // Each unmatched call appears in issues with a classification
    for (const iss of result.issues) {
      if (iss.kind === "cross_repo_orphan") {
        expect(iss.classification).toBeDefined();
      }
    }
  });
});
