/**
 * SUTRA-6.1 — cross-repo reconciliation tests.
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
        },
      ],
    };
    const result = reconcileGraphs(client, serverFull);
    expect(result.issues).toHaveLength(0);
    expect(result.matched).toBe(2);
  });

  it("buildReconcileOutput produces reconcile_version 0 JSON (SUTRA-11.2)", () => {
    const result = reconcileGraphs(client, server);
    const output = buildReconcileOutput(client, server, result);
    expect(output.reconcile_version).toBe(RECONCILE_VERSION);
    expect(output.client_repo).toBe("client-app");
    expect(output.server_repo).toBe("server-api");
    expect(output.checked).toBe(2);
    expect(output.issues.length).toBeGreaterThan(0);
  });
});
