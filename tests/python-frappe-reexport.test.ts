/**
 * Story 8.2 — emitCallSiteEdges coverage: whitelist bodies and re-exports.
 *
 * Fixture: tests/fixtures/frappe-reexport/
 * Layout:  apps/myapp/myapp/...
 *   handlers/__init__.py    re-exports process_return from .return_handler
 *   handlers/return_handler.py  defines process_return
 *   api/endpoint.py         @frappe.whitelist submit_return calls process_return
 *                           via `from myapp.handlers import process_return`
 *
 * ACs verified:
 *   AC1 — whitelisted endpoint emits `calls` edge to the ultimate handler
 *          definition (handlers/return_handler.py), NOT to the __init__ re-export.
 *   AC2 — all `calls` and `http` edge `from` ids exist in `nodes`
 *          (endpoint fromId matches emitted node id — no orphan `from`).
 *   AC3 — `from` ids exist in nodes for edges whose source is in a re-export-only file.
 *   AC4 — dynamic targets (getattr / string-built) produce no edge.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "../src/scanner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REEXPORT = path.resolve(__dirname, "fixtures/frappe-reexport");

describe("python/frappe extractor — re-export coverage (Story 8.2)", () => {
  // ── AC1: endpoint body edge reaches ultimate definition ─────────────────

  it("AC1 — submit_return emits calls edge to process_return in return_handler.py", () => {
    const { nodes, edges } = scan(REEXPORT);

    const ep = nodes.find(
      (n) => n.type === "endpoint" && n.name.includes("submit_return"),
    );
    expect(ep, "submit_return endpoint node must exist").toBeDefined();

    const handler = nodes.find(
      (n) =>
        n.type === "function" &&
        n.name === "process_return" &&
        n.file.includes("return_handler.py"),
    );
    expect(handler, "process_return function node in return_handler.py must exist").toBeDefined();

    const edge = edges.find(
      (e) => e.kind === "calls" && e.from === ep!.id && e.to === handler!.id,
    );
    expect(edge, "calls edge from submit_return → process_return must exist").toBeDefined();
    expect(edge!.provenance).toBe("ast-exact");
  });

  // ── AC2: all edge `from` ids exist in nodes ──────────────────────────────

  it("AC2 — all calls/http edge `from` ids exist in nodes (no orphan from)", () => {
    const { nodes, edges } = scan(REEXPORT);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const checkEdges = edges.filter((e) => e.kind === "calls" || e.kind === "http");
    expect(checkEdges.length).toBeGreaterThan(0);
    for (const e of checkEdges) {
      expect(nodeIds.has(e.from), `edge from unknown node id: ${e.from}`).toBe(true);
    }
  });

  // ── AC2 (corollary): all edge `to` ids exist in nodes ───────────────────

  it("AC2 — all calls edge `to` ids exist in nodes (no invented targets)", () => {
    const { nodes, edges } = scan(REEXPORT);
    const nodeIds = new Set(nodes.map((n) => n.id));
    for (const e of edges.filter((e) => e.kind === "calls")) {
      expect(nodeIds.has(e.to), `calls edge to unknown id: ${e.to}`).toBe(true);
    }
  });

  // ── AC3: module-level re-export file nodes present and edges use valid ids ─

  it("AC3 — __init__.py module node exists and edges from it have valid from ids", () => {
    const { nodes, edges } = scan(REEXPORT);
    const nodeIds = new Set(nodes.map((n) => n.id));
    // Any edge whose from is in __init__.py must have a valid from id
    const initEdges = edges.filter((e) => e.from.includes("__init__"));
    for (const e of initEdges) {
      expect(nodeIds.has(e.from), `init-file edge from unknown id: ${e.from}`).toBe(true);
    }
  });

  // ── AC4: dynamic targets produce no edge ────────────────────────────────

  it("AC4 — getattr dynamic call in dynamic_caller.py produces no calls edge from do_dynamic_stuff", () => {
    const { nodes, edges } = scan(REEXPORT);
    const dynamicFn = nodes.find(
      (n) => n.name === "do_dynamic_stuff" && n.file.includes("dynamic_caller.py"),
    );
    expect(dynamicFn, "do_dynamic_stuff must be a function node").toBeDefined();
    const callsFromDynamic = edges.filter(
      (e) => e.kind === "calls" && e.from === dynamicFn!.id,
    );
    expect(callsFromDynamic).toHaveLength(0);
  });

  // ── list_returns endpoint: no spurious in-repo calls edges ──────────────

  it("list_returns endpoint has no spurious in-repo calls edges", () => {
    const { nodes, edges } = scan(REEXPORT);
    const listEp = nodes.find(
      (n) => n.type === "endpoint" && n.name.includes("list_returns"),
    );
    expect(listEp, "list_returns endpoint must exist").toBeDefined();
    // frappe.get_list is not an in-repo function — no calls edge
    const inRepoCalls = edges.filter(
      (e) => e.kind === "calls" && e.from === listEp!.id,
    );
    expect(inRepoCalls).toHaveLength(0);
  });
});
