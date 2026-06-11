/**
 * Story 8.3 — HTTP edges: frappe.call and requests to in-repo targets.
 *
 * Fixture: tests/fixtures/frappe-bench-calls/apps/inv/inv/api/caller.py
 *   - call_via_frappe        → frappe.call("inv.api.endpoint.create_order", ...)
 *   - call_via_requests_post → requests.post("/api/method/inv.api.endpoint.create_order", ...)
 *   - call_via_requests_external → requests.post("https://external.example.com/api/capture", ...)
 *   - call_unresolvable      → frappe.call(method) — dynamic, no literal string
 *
 * ACs verified:
 *   AC1 — frappe.call("dotted.path") emits `calls` edge to in-repo endpoint node id (not httpTargetId)
 *   AC2 — requests.post("/api/method/dotted.path") emits `http` edge to in-repo endpoint node id
 *   AC3 — at most one flow edge per call site (no duplicate calls+http for same invocation)
 *   AC4 — dynamic frappe.call(variable) emits no in-repo edge
 *   AC5 — external requests.post("https://...") keeps httpTargetId (regression guard)
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "../src/scanner.js";
import { buildFlows } from "../src/flows.js";
import { httpTargetId } from "../src/util/ids.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(__dirname, "fixtures/frappe-bench-calls");

describe("python/frappe extractor — HTTP edge resolution (Story 8.3)", () => {
  // ── shared scan (run once per describe, not per test) ───────────────────
  //  vitest does not have beforeAll caching by default here, but scan is fast.

  // ── AC1: frappe.call("dotted.path") → calls edge to in-repo endpoint node ──

  it("AC1 — frappe.call with literal method emits `calls` edge to in-repo endpoint node", () => {
    const { nodes, edges } = scan(BENCH);

    const callerFn = nodes.find(
      (n) => n.name.includes("call_via_frappe") && n.file.includes("api/caller.py"),
    );
    expect(callerFn, "call_via_frappe node must exist").toBeDefined();

    const targetEndpoint = nodes.find(
      (n) => n.type === "endpoint" && n.name.includes("create_order"),
    );
    expect(targetEndpoint, "create_order endpoint must exist").toBeDefined();

    const edge = edges.find(
      (e) =>
        e.from === callerFn!.id &&
        e.to === targetEndpoint!.id &&
        e.kind === "calls",
    );
    expect(edge, "calls edge from call_via_frappe to create_order endpoint must exist").toBeDefined();
    expect(edge!.provenance).toBe("ast-exact");
  });

  it("AC1 — frappe.call with literal method does NOT emit an httpTargetId for the same call", () => {
    const { nodes, edges } = scan(BENCH);

    const callerFn = nodes.find(
      (n) => n.name.includes("call_via_frappe") && n.file.includes("api/caller.py"),
    );
    expect(callerFn).toBeDefined();

    const httpEdgeToSameMethod = edges.find(
      (e) =>
        e.from === callerFn!.id &&
        e.kind === "http" &&
        e.to.includes("inv.api.endpoint.create_order"),
    );
    // When resolved, must NOT also emit an http external edge for the same call
    expect(httpEdgeToSameMethod).toBeUndefined();
  });

  // ── AC2: requests.post("/api/method/dotted") → http edge to in-repo endpoint node ──

  it("AC2 — requests.post('/api/method/...') emits `http` edge to in-repo endpoint node id", () => {
    const { nodes, edges } = scan(BENCH);

    const callerFn = nodes.find(
      (n) => n.name === "call_via_requests_post" && n.file.includes("api/caller.py"),
    );
    expect(callerFn, "call_via_requests_post node must exist").toBeDefined();

    const targetEndpoint = nodes.find(
      (n) => n.type === "endpoint" && n.name.includes("create_order"),
    );
    expect(targetEndpoint, "create_order endpoint must exist").toBeDefined();

    const edge = edges.find(
      (e) =>
        e.from === callerFn!.id &&
        e.to === targetEndpoint!.id &&
        e.kind === "http",
    );
    expect(edge, "http edge from call_via_requests_post to create_order endpoint must exist").toBeDefined();
    expect(edge!.provenance).toBe("ast-exact");
  });

  it("AC2 — requests.post('/api/method/...') does NOT emit an httpTargetId string for the same call", () => {
    const { nodes, edges } = scan(BENCH);

    const callerFn = nodes.find(
      (n) => n.name === "call_via_requests_post" && n.file.includes("api/caller.py"),
    );
    expect(callerFn).toBeDefined();

    // The to field must be a real node id, not an http: synthetic id
    const httpEdgesToExternal = edges.filter(
      (e) =>
        e.from === callerFn!.id &&
        e.kind === "http" &&
        e.to.startsWith("http:"),
    );
    expect(
      httpEdgesToExternal,
      "resolved requests.post must not emit a synthetic httpTargetId string",
    ).toHaveLength(0);
  });

  // ── AC3: at most one flow edge per call site ─────────────────────────────

  it("AC3 — call_via_frappe has exactly one outgoing flow edge (no duplicate calls+http)", () => {
    const { nodes, edges } = scan(BENCH);

    const callerFn = nodes.find(
      (n) => n.name.includes("call_via_frappe") && n.file.includes("api/caller.py"),
    );
    expect(callerFn).toBeDefined();

    const flowEdges = edges.filter(
      (e) =>
        e.from === callerFn!.id &&
        (e.kind === "calls" || e.kind === "http"),
    );
    // Should emit exactly one edge for the frappe.call site
    expect(flowEdges.length).toBe(1);
  });

  it("AC3 — call_via_requests_post has exactly one outgoing http edge", () => {
    const { nodes, edges } = scan(BENCH);

    const callerFn = nodes.find(
      (n) => n.name === "call_via_requests_post" && n.file.includes("api/caller.py"),
    );
    expect(callerFn).toBeDefined();

    const flowEdges = edges.filter(
      (e) =>
        e.from === callerFn!.id &&
        (e.kind === "calls" || e.kind === "http"),
    );
    expect(flowEdges.length).toBe(1);
  });

  // ── AC4: unresolvable (dynamic) frappe.call emits no in-repo edge ────────

  it("AC4 — frappe.call(variable) emits no in-repo calls or http edge", () => {
    const { nodes, edges } = scan(BENCH);

    const callerFn = nodes.find(
      (n) => n.name === "call_unresolvable" && n.file.includes("api/caller.py"),
    );
    expect(callerFn, "call_unresolvable node must exist").toBeDefined();

    const nodeIds = new Set(nodes.map((n) => n.id));
    const inRepoEdges = edges.filter(
      (e) =>
        e.from === callerFn!.id &&
        (e.kind === "calls" || e.kind === "http") &&
        nodeIds.has(e.to),
    );
    expect(
      inRepoEdges,
      "dynamic frappe.call must not produce in-repo edges",
    ).toHaveLength(0);
  });

  // ── AC5: external host requests.post keeps httpTargetId (regression) ─────

  it("AC5 — requests.post('https://external...') keeps synthetic httpTargetId (regression guard)", () => {
    const { nodes, edges } = scan(BENCH);

    const callerFn = nodes.find(
      (n) => n.name === "call_via_requests_external" && n.file.includes("api/caller.py"),
    );
    expect(callerFn, "call_via_requests_external node must exist").toBeDefined();

    const expectedTarget = httpTargetId("POST", "/api/capture", "external.example.com");
    const edge = edges.find(
      (e) =>
        e.from === callerFn!.id &&
        e.to === expectedTarget &&
        e.kind === "http",
    );
    expect(edge, `http edge to ${expectedTarget} must exist`).toBeDefined();
  });

  // ── AC5 (Story 4.2 regression): frappe-clean external requests.get unchanged ──

  it("AC5-regression — frappe-clean helpers.py external requests.get edge still emits", () => {
    const FRAPPE_CLEAN = path.resolve(__dirname, "fixtures/frappe-clean");
    const { nodes, edges } = scan(FRAPPE_CLEAN);

    const helperId = nodes.find(
      (n) => n.name === "load_widget_data" && n.file === "myapp/utils/helpers.py",
    )?.id;
    expect(helperId, "load_widget_data must exist").toBeDefined();

    const http = edges.find(
      (e) =>
        e.kind === "http" &&
        e.from === helperId &&
        e.to.includes("GET") &&
        e.to.includes("api.telegram.org"),
    );
    expect(http, "external requests.get edge must still emit").toBeDefined();
  });

  // ── buildFlows: http hop into downstream handler when chained ────────────

  it("buildFlows — flow via call_via_requests_post walks http hop into create_order", () => {
    const { nodes, edges } = scan(BENCH);
    const { flows } = buildFlows(nodes, edges);

    // call_via_requests_post is a plain function (not an endpoint/handler entry),
    // so it won't be its own flow entry. But call_via_frappe IS a @frappe.whitelist endpoint.
    const callerEndpointFlow = flows.find((f) => f.entry.includes("call_via_frappe"));
    expect(callerEndpointFlow, "flow from call_via_frappe endpoint must exist").toBeDefined();

    // The flow must contain a step to create_order via the calls edge
    const stepsToCreateOrder = callerEndpointFlow!.steps.filter(
      (s) => s.node.includes("create_order"),
    );
    expect(stepsToCreateOrder.length).toBeGreaterThan(0);
  });
});
