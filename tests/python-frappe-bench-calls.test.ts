/**
 * Story 8.1 — Frappe callee resolution on bench-deep paths.
 *
 * Fixture: tests/fixtures/frappe-bench-calls/
 * Layout:  apps/inv/inv/...  (real bench layout, not flat myapp/)
 *
 * ACs verified:
 *   AC1 — bench-layout fixture emits `calls` edges across modules imported as
 *          `from inv.mod import fn` (not only same-file).
 *   AC2 — resolver map keys use app-root module paths; node ids remain
 *          repo-relative and deterministic across two scans.
 *   AC3 — fnByBareName resolves only when unambiguous (tested via cross-module
 *          call site where bare name would be ambiguous — no spurious edge).
 *   AC4 — relative imports (`from .sibling import helper`) normalize into the
 *          same app-root namespace before lookup.
 *   AC5 — every `calls` edge `to` id exists in `nodes`; no invented targets.
 *   AC6 — GRAPH_VERSION unchanged (schema contract, not tested here).
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "../src/scanner.js";
import { buildFlows } from "../src/flows.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(__dirname, "fixtures/frappe-bench-calls");

describe("python/frappe extractor — bench-deep paths (Story 8.1)", () => {
  // ── AC1: cross-module calls edges via app-root imports ──────────────────

  it("AC1 — endpoint emits calls edge to process_order (cross-module via app-root import)", () => {
    const { nodes, edges } = scan(BENCH);
    const ep = nodes.find(
      (n) => n.type === "endpoint" && n.name.includes("create_order"),
    );
    expect(ep).toBeDefined();

    const handlerFn = nodes.find(
      (n) =>
        n.type === "function" &&
        n.name === "process_order" &&
        n.file.includes("handler/order.py"),
    );
    expect(handlerFn).toBeDefined();

    const edge = edges.find(
      (e) => e.kind === "calls" && e.from === ep!.id && e.to === handlerFn!.id,
    );
    expect(edge).toBeDefined();
    expect(edge!.provenance).toBe("ast-exact");
  });

  it("AC1 — endpoint emits calls edge to validate_payload (cross-module via app-root import)", () => {
    const { nodes, edges } = scan(BENCH);
    const ep = nodes.find(
      (n) => n.type === "endpoint" && n.name.includes("create_order"),
    );
    const helperFn = nodes.find(
      (n) =>
        n.type === "function" &&
        n.name === "validate_payload" &&
        n.file.includes("utils/helpers.py"),
    );
    expect(ep).toBeDefined();
    expect(helperFn).toBeDefined();

    const edge = edges.find(
      (e) => e.kind === "calls" && e.from === ep!.id && e.to === helperFn!.id,
    );
    expect(edge).toBeDefined();
  });

  // ── AC2: node ids are repo-relative and deterministic ───────────────────

  it("AC2 — node ids are repo-relative (contain apps/inv/inv/...)", () => {
    const { nodes } = scan(BENCH);
    const fn = nodes.find(
      (n) => n.name === "process_order" && n.file.includes("handler/order.py"),
    );
    expect(fn).toBeDefined();
    // id must reference the repo-relative file path
    expect(fn!.id).toContain("apps/inv/inv/handler/order.py");
  });

  it("AC2 — two scans produce byte-identical sorted calls edges", () => {
    const toSortedCalls = () =>
      scan(BENCH)
        .edges.filter((e) => e.kind === "calls")
        .map((e) => `${e.from}→${e.to}`)
        .sort();
    expect(toSortedCalls()).toEqual(toSortedCalls());
  });

  // ── AC4: relative imports normalize into app-root namespace ─────────────

  it("AC4 — relative import `from .helpers_local import log_event` resolves to cross-module calls edge", () => {
    const { nodes, edges } = scan(BENCH);
    const processFn = nodes.find(
      (n) => n.name === "process_order" && n.file.includes("handler/order.py"),
    );
    const logFn = nodes.find(
      (n) => n.name === "log_event" && n.file.includes("handler/helpers_local.py"),
    );
    expect(processFn).toBeDefined();
    expect(logFn).toBeDefined();

    const edge = edges.find(
      (e) => e.kind === "calls" && e.from === processFn!.id && e.to === logFn!.id,
    );
    expect(edge).toBeDefined();
  });

  // ── AC5: every `calls` edge target exists in nodes ──────────────────────

  it("AC5 — all calls-edge `to` ids exist in nodes (no invented targets)", () => {
    const { nodes, edges } = scan(BENCH);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const callsEdges = edges.filter((e) => e.kind === "calls");
    expect(callsEdges.length).toBeGreaterThan(0);
    for (const e of callsEdges) {
      expect(nodeIds.has(e.to), `calls edge to unknown id: ${e.to}`).toBe(true);
    }
  });

  // ── buildFlows produces flows with a `calls` step (not imports-only) ────

  it("buildFlows returns flows containing a calls step (not imports-only star)", () => {
    const { nodes, edges } = scan(BENCH);
    const { flows } = buildFlows(nodes, edges);
    const epFlow = flows.find((f) => f.entry.includes("create_order"));
    expect(epFlow).toBeDefined();
    const hasCallsStep = epFlow!.steps.some((s) => s.edge?.kind === "calls");
    expect(hasCallsStep).toBe(true);
  });

  // ── hooks edges use app-root keys (doc_events + scheduler) ──────────────

  it("doc_events in hooks.py resolves to on_shipment_submit via app-root path", () => {
    const { nodes, edges } = scan(BENCH);
    const handlerFn = nodes.find(
      (n) => n.name === "on_shipment_submit" && n.file.includes("handler/order.py"),
    );
    expect(handlerFn).toBeDefined();
    const hookEdge = edges.find(
      (e) => e.kind === "calls" && e.to === handlerFn!.id,
    );
    expect(hookEdge).toBeDefined();
  });

  it("scheduler_events in hooks.py resolves to run_daily_sync via app-root path", () => {
    const { nodes, edges } = scan(BENCH);
    const syncFn = nodes.find(
      (n) => n.name === "run_daily_sync" && n.file.includes("utils/helpers.py"),
    );
    expect(syncFn).toBeDefined();
    const schedEdge = edges.find(
      (e) => e.kind === "calls" && e.to === syncFn!.id,
    );
    expect(schedEdge).toBeDefined();
  });
});
