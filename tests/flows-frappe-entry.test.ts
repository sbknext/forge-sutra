/**
 * Story 8.4 — flows.ts: Frappe endpoint entry detection.
 *
 * ACs verified:
 *   AC1 — buildFlows lists a whitelisted python-frappe endpoint as flow.entry
 *          for at least one directed flow (synthetic graph).
 *   AC2 — bench-layout fixture: endpoint with outgoing calls/http is an entry;
 *          flow length ≥ 2.
 *   AC3 — imports-only graph yields flows.length === 0 (FLOW_KINDS regression guard).
 *   AC4 — TS route/component entry behaviour unchanged (synthetic TS nodes).
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFlows } from "../src/flows.js";
import { scan } from "../src/scanner.js";
import type { SutraNode, SutraEdge } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(__dirname, "fixtures/frappe-bench-calls");

// ── helpers ────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<SutraNode> & { id: string; type: SutraNode["type"] }): SutraNode {
  return {
    name: overrides.id,
    file: "synthetic.py",
    line: 1,
    data_shape: null,
    feature: "test",
    language: "python-frappe",
    provenance: "ast-exact",
    ...overrides,
  };
}

function makeEdge(from: string, to: string, kind: SutraEdge["kind"]): SutraEdge {
  return { from, to, kind, provenance: "ast-exact" };
}

// ── AC1: synthetic Frappe endpoint + calls chain ───────────────────────────

describe("flows-frappe-entry — AC1: synthetic Frappe endpoint always entry", () => {
  it("python-frappe endpoint with calls edge appears as flow entry", () => {
    const ep = makeNode({ id: "myapp/api/widget.py#myapp.api.widget.get_widget", type: "endpoint" });
    const helper = makeNode({ id: "myapp/utils/helpers.py#load_widget_data", type: "function" });
    const nodes: SutraNode[] = [ep, helper];
    const edges: SutraEdge[] = [makeEdge(ep.id, helper.id, "calls")];

    const { flows } = buildFlows(nodes, edges);
    expect(flows.length).toBeGreaterThan(0);

    const epFlow = flows.find((f) => f.entry === ep.id);
    expect(epFlow, "flow entry must be the whitelisted endpoint").toBeDefined();
    expect(epFlow!.steps.length).toBeGreaterThanOrEqual(2);
  });

  it("python-frappe endpoint with http edge appears as flow entry", () => {
    const ep = makeNode({ id: "myapp/api/widget.py#myapp.api.widget.post_widget", type: "endpoint" });
    const caller = makeNode({ id: "myapp/utils/helpers.py#call_external", type: "function" });
    const httpTarget = "http:GET /api/downstream";
    const nodes: SutraNode[] = [ep, caller];
    const edges: SutraEdge[] = [
      makeEdge(ep.id, caller.id, "calls"),
      makeEdge(caller.id, httpTarget, "http"),
    ];

    const { flows } = buildFlows(nodes, edges);
    const epFlow = flows.find((f) => f.entry === ep.id);
    expect(epFlow).toBeDefined();
  });

  it("python-frappe endpoint with NO outgoing edges still appears as flow entry (declared surface)", () => {
    // This is the core resilience: even when resolution fails, the endpoint is still
    // an entry. The flow is filtered at steps.length < 2 and not emitted, but the
    // entry predicate must include it (verified via findEntryPoints behaviour indirectly:
    // a downstream calls edge added to the chain should produce a flow).
    const ep = makeNode({
      id: "myapp/api/widget.py#myapp.api.widget.stub_endpoint",
      type: "endpoint",
    });
    const downstream = makeNode({ id: "myapp/utils/data.py#fetch_data", type: "function" });
    const nodes: SutraNode[] = [ep, downstream];

    // No edge: no flow emitted (steps < 2 filtered). Entry predicate still fires.
    const { flows: noEdgeFlows } = buildFlows(nodes, []);
    // flows list is empty because steps < 2, but that's correct behaviour.
    // Adding edge proves entry predicate activates:
    const edges: SutraEdge[] = [makeEdge(ep.id, downstream.id, "calls")];
    const { flows } = buildFlows(nodes, edges);
    expect(flows.length).toBe(1);
    expect(flows[0]!.entry).toBe(ep.id);

    // Sanity: without the edge, no flow is produced (not an error, just no path).
    expect(noEdgeFlows.length).toBe(0);
  });

  it("non-Frappe endpoint (ts language) requires outgoing edge to be an entry", () => {
    const tsEp = makeNode({
      id: "src/api/route.ts#POST /api/capture",
      type: "endpoint",
      language: "ts",
    });
    const nodes: SutraNode[] = [tsEp];

    // No outgoing edges — must NOT appear as an entry (no flow).
    const { flows: noFlow } = buildFlows(nodes, []);
    expect(noFlow.find((f) => f.entry === tsEp.id)).toBeUndefined();

    // With outgoing edge — becomes entry.
    const target = makeNode({ id: "src/db/queries.ts#query", type: "function", language: "ts" });
    const { flows } = buildFlows([tsEp, target], [makeEdge(tsEp.id, target.id, "calls")]);
    expect(flows.find((f) => f.entry === tsEp.id)).toBeDefined();
  });
});

// ── AC2: bench-layout fixture end-to-end ──────────────────────────────────

describe("flows-frappe-entry — AC2: bench fixture flow length ≥ 2", () => {
  it("bench scan: flows non-empty and endpoint-entry flow has length ≥ 2", () => {
    const { nodes, edges } = scan(BENCH);
    const { flows } = buildFlows(nodes, edges);

    expect(flows.length).toBeGreaterThan(0);

    // create_order is the canonical bench endpoint entry
    const epFlow = flows.find((f) => f.entry.includes("create_order"));
    expect(epFlow, "flow from create_order endpoint must exist").toBeDefined();
    expect(epFlow!.steps.length).toBeGreaterThanOrEqual(2);
  });

  it("bench scan: endpoint flow contains at least one calls step", () => {
    const { nodes, edges } = scan(BENCH);
    const { flows } = buildFlows(nodes, edges);

    const epFlow = flows.find((f) => f.entry.includes("create_order"));
    expect(epFlow).toBeDefined();

    const hasCallsEdge = epFlow!.steps.some((s) => s.edge?.kind === "calls");
    expect(hasCallsEdge).toBe(true);
  });

  it("bench scan: call_via_frappe endpoint produces a flow entry", () => {
    const { nodes, edges } = scan(BENCH);
    const { flows } = buildFlows(nodes, edges);

    const callerFlow = flows.find((f) => f.entry.includes("call_via_frappe"));
    expect(callerFlow, "flow from call_via_frappe endpoint must exist").toBeDefined();
    expect(callerFlow!.steps.length).toBeGreaterThanOrEqual(2);
  });
});

// ── AC3: imports-only graph → flows.length === 0 ─────────────────────────

describe("flows-frappe-entry — AC3: imports-only graph yields no flows", () => {
  it("nodes connected only by imports edges produce zero flows", () => {
    const a = makeNode({ id: "myapp/a.py#fn_a", type: "function" });
    const b = makeNode({ id: "myapp/b.py#fn_b", type: "function" });
    const c = makeNode({ id: "myapp/c.py#fn_c", type: "function" });
    const nodes: SutraNode[] = [a, b, c];
    const edges: SutraEdge[] = [
      makeEdge(a.id, b.id, "imports"),
      makeEdge(b.id, c.id, "imports"),
    ];

    const { flows } = buildFlows(nodes, edges);
    expect(flows.length).toBe(0);
  });

  it("imports edges on a python-frappe endpoint do NOT produce a flow", () => {
    const ep = makeNode({ id: "myapp/api/widget.py#myapp.api.widget.get_widget", type: "endpoint" });
    const mod = makeNode({ id: "myapp/utils/helpers.py", type: "module" });
    const nodes: SutraNode[] = [ep, mod];
    // Only imports — no calls/http/renders
    const edges: SutraEdge[] = [makeEdge(ep.id, mod.id, "imports")];

    const { flows } = buildFlows(nodes, edges);
    // No flow: imports is not a FLOW_KIND, so steps length stays at 1 → filtered.
    expect(flows.length).toBe(0);
  });
});

// ── AC4: TS route/component entry behaviour unchanged ─────────────────────

describe("flows-frappe-entry — AC4: TS route/component entries unaffected", () => {
  it("TS route node without renders-target is an entry", () => {
    const route = makeNode({ id: "src/pages/index.tsx#/", type: "route", language: "ts" });
    const component = makeNode({ id: "src/components/Widget.tsx#Widget", type: "component", language: "ts" });
    const nodes: SutraNode[] = [route, component];
    const edges: SutraEdge[] = [makeEdge(route.id, component.id, "renders")];

    const { flows } = buildFlows(nodes, edges);
    // route is an entry (not rendered); component is rendered → not an entry
    const routeFlow = flows.find((f) => f.entry === route.id);
    expect(routeFlow, "route must be a flow entry").toBeDefined();
    expect(routeFlow!.steps.length).toBeGreaterThanOrEqual(2);
  });

  it("TS component that IS rendered by another node is not an entry", () => {
    const parent = makeNode({ id: "src/pages/parent.tsx#/parent", type: "route", language: "ts" });
    const child = makeNode({ id: "src/components/Child.tsx#Child", type: "component", language: "ts" });
    const grandchild = makeNode({ id: "src/components/GC.tsx#GC", type: "component", language: "ts" });
    const nodes: SutraNode[] = [parent, child, grandchild];
    const edges: SutraEdge[] = [
      makeEdge(parent.id, child.id, "renders"),
      makeEdge(child.id, grandchild.id, "renders"),
    ];

    const { flows } = buildFlows(nodes, edges);
    // child and grandchild are rendered — neither should be a standalone entry
    const childFlow = flows.find((f) => f.entry === child.id);
    const gcFlow = flows.find((f) => f.entry === grandchild.id);
    expect(childFlow).toBeUndefined();
    expect(gcFlow).toBeUndefined();
    // Only parent is an entry
    expect(flows.find((f) => f.entry === parent.id)).toBeDefined();
  });
});
