/**
 * Story 8.7 — Regression: frappe-clean + withrun bench slice.
 *
 * Fixture: tests/fixtures/frappe-withrun-slice/
 * Layout:  apps/wr/wr/...  (production bench depth — mirrors real withrun app structure)
 *   apps/wr/hooks.py                              — doc_events + scheduler_events
 *   apps/wr/wr/api/delivery.py                    — @frappe.whitelist endpoints
 *   apps/wr/wr/order/handler.py                   — feature-module handler functions
 *   apps/wr/wr/order/helpers.py                   — relative-import helper
 *   apps/wr/wr/utils/sync.py                      — validate + scheduler job (http edge)
 *   apps/wr/wr/doctype/delivery_order/delivery_order.py  — DocType controller
 *
 * ACs verified (Story 8.7):
 *   AC2a — at least two `calls` edges between distinct files
 *   AC2b — at least one `http` edge
 *   AC2c — buildFlows → flows.length >= 1 with a `calls` step in the path
 *   AC2d — no `calls` edge `to` id missing from `nodes`
 *   AC3  — frappe-clean regression: unchanged node/edge/flow counts from Story 4.2
 *
 * Pinned counts (derived from actual scan output, not guessed):
 *   frappe-withrun-slice: 21 nodes, 6 calls edges, 1 http edge, 1 flow
 *   frappe-clean:         17 nodes, 3 calls edges, 1 http edge, 1 flow
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "../src/scanner.js";
import { buildFlows } from "../src/flows.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WR_SLICE = path.resolve(__dirname, "fixtures/frappe-withrun-slice");
const FRAPPE_CLEAN = path.resolve(__dirname, "fixtures/frappe-clean");

// ── withrun-slice integration tests ───────────────────────────────────────────

describe("python/frappe extractor — withrun bench slice (Story 8.7)", () => {
  // ── AC2a: at least two calls edges between distinct files ──────────────────

  it("AC2a — at least two calls edges between distinct source files", () => {
    const { nodes, edges } = scan(WR_SLICE);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const callsEdges = edges.filter((e) => e.kind === "calls" && nodeIds.has(e.to));

    // Collect distinct file pairs (from-file → to-file, excluding same-file calls)
    const distinctFilePairs = new Set(
      callsEdges
        .map((e) => {
          const fromFile = e.from.split("#")[0];
          const toFile = e.to.split("#")[0];
          return fromFile !== toFile ? `${fromFile}→${toFile}` : null;
        })
        .filter(Boolean),
    );

    expect(
      distinctFilePairs.size,
      `expected ≥2 cross-file calls edges, got ${distinctFilePairs.size}: ${[...distinctFilePairs].join(", ")}`,
    ).toBeGreaterThanOrEqual(2);
  });

  // ── AC2b: at least one http edge ───────────────────────────────────────────

  it("AC2b — at least one http edge emitted from the slice", () => {
    const { edges } = scan(WR_SLICE);
    const httpEdges = edges.filter((e) => e.kind === "http");
    expect(httpEdges.length).toBeGreaterThanOrEqual(1);
  });

  // ── AC2c: buildFlows → flows.length >= 1 with a calls step ────────────────

  it("AC2c — buildFlows produces at least one flow with a calls step in the path", () => {
    const { nodes, edges } = scan(WR_SLICE);
    const { flows } = buildFlows(nodes, edges);

    expect(flows.length, "expected at least one flow from withrun-slice scan").toBeGreaterThanOrEqual(1);

    const flowWithCallsStep = flows.find((f) =>
      f.steps.some((s) => s.edge?.kind === "calls"),
    );
    expect(
      flowWithCallsStep,
      "at least one flow must contain a step with a calls edge",
    ).toBeDefined();
  });

  // ── AC2d: no calls edge `to` id missing from nodes ───────────────────────

  it("AC2d — no calls edge `to` id is missing from nodes (no invented targets)", () => {
    const { nodes, edges } = scan(WR_SLICE);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const callsEdges = edges.filter((e) => e.kind === "calls");

    expect(callsEdges.length, "must have at least one calls edge to check").toBeGreaterThan(0);

    for (const e of callsEdges) {
      expect(
        nodeIds.has(e.to),
        `calls edge to id not in nodes: ${e.to}`,
      ).toBe(true);
    }
  });

  // ── pinned regression: slice shape unchanged between scans ────────────────

  it("pinned — two scans of withrun-slice produce identical sorted id lists", () => {
    const toSortedIds = () =>
      scan(WR_SLICE).nodes.map((n) => n.id).sort();
    expect(toSortedIds()).toEqual(toSortedIds());
  });

  it("pinned — two scans produce identical sorted calls-edge lists", () => {
    const toSortedCalls = () =>
      scan(WR_SLICE)
        .edges.filter((e) => e.kind === "calls")
        .map((e) => `${e.from}→${e.to}`)
        .sort();
    expect(toSortedCalls()).toEqual(toSortedCalls());
  });

  // ── bench-depth structural assertions ────────────────────────────────────

  it("slice fixture isFrappe-like — hooks.py resolves doc_events to handler in order/handler.py", () => {
    const { nodes, edges } = scan(WR_SLICE);
    const handlerFn = nodes.find(
      (n) => n.name === "on_delivery_submit" && n.file.includes("order/handler.py"),
    );
    expect(handlerFn, "on_delivery_submit must be a node").toBeDefined();

    const hookEdge = edges.find(
      (e) => e.kind === "calls" && e.to === handlerFn!.id,
    );
    expect(hookEdge, "doc_events calls edge to on_delivery_submit must exist").toBeDefined();
  });

  it("slice fixture — create_delivery endpoint emits calls edge to process_delivery (cross-module)", () => {
    const { nodes, edges } = scan(WR_SLICE);
    const ep = nodes.find(
      (n) => n.type === "endpoint" && n.name.includes("create_delivery"),
    );
    expect(ep, "create_delivery endpoint node must exist").toBeDefined();

    const handlerFn = nodes.find(
      (n) => n.name === "process_delivery" && n.file.includes("order/handler.py"),
    );
    expect(handlerFn, "process_delivery function node must exist").toBeDefined();

    const edge = edges.find(
      (e) => e.kind === "calls" && e.from === ep!.id && e.to === handlerFn!.id,
    );
    expect(edge, "calls edge from create_delivery to process_delivery must exist").toBeDefined();
  });

  it("slice fixture — DocType controller node exists for DeliveryOrder", () => {
    const { nodes } = scan(WR_SLICE);
    const handler = nodes.find(
      (n) => n.type === "handler" && n.name === "DeliveryOrder",
    );
    expect(handler, "DeliveryOrder DocType controller handler node must exist").toBeDefined();
  });

  it("slice fixture — scheduler hooks.py resolves to run_delivery_sync in utils/sync.py", () => {
    const { nodes, edges } = scan(WR_SLICE);
    const syncFn = nodes.find(
      (n) => n.name === "run_delivery_sync" && n.file.includes("utils/sync.py"),
    );
    expect(syncFn, "run_delivery_sync must be a node").toBeDefined();

    const schedEdge = edges.find(
      (e) => e.kind === "calls" && e.to === syncFn!.id,
    );
    expect(schedEdge, "scheduler calls edge to run_delivery_sync must exist").toBeDefined();
  });

  // ── pinned counts ─────────────────────────────────────────────────────────

  it("pinned counts — 21 nodes, 6 calls edges, 1 http edge, 1 flow", () => {
    const { nodes, edges } = scan(WR_SLICE);
    const { flows } = buildFlows(nodes, edges);

    const callsEdges = edges.filter((e) => e.kind === "calls");
    const httpEdges = edges.filter((e) => e.kind === "http");

    expect(nodes.length, "pinned node count").toBe(21);
    expect(callsEdges.length, "pinned calls-edge count").toBe(6);
    expect(httpEdges.length, "pinned http-edge count").toBe(1);
    expect(flows.length, "pinned flow count").toBe(1);
  });
});

// ── frappe-clean regression (AC3) ────────────────────────────────────────────

describe("python/frappe extractor — frappe-clean regression guard (Story 8.7 AC3)", () => {
  it("frappe-clean: node count unchanged (pinned at 17)", () => {
    const { nodes } = scan(FRAPPE_CLEAN);
    expect(nodes.length, "frappe-clean node count must stay at 17").toBe(17);
  });

  it("frappe-clean: calls-edge count unchanged (pinned at 3)", () => {
    const { edges } = scan(FRAPPE_CLEAN);
    const callsEdges = edges.filter((e) => e.kind === "calls");
    expect(callsEdges.length, "frappe-clean calls-edge count must stay at 3").toBe(3);
  });

  it("frappe-clean: http-edge count unchanged (pinned at 1)", () => {
    const { edges } = scan(FRAPPE_CLEAN);
    const httpEdges = edges.filter((e) => e.kind === "http");
    expect(httpEdges.length, "frappe-clean http-edge count must stay at 1").toBe(1);
  });

  it("frappe-clean: flow count unchanged (pinned at 1)", () => {
    const { nodes, edges } = scan(FRAPPE_CLEAN);
    const { flows } = buildFlows(nodes, edges);
    expect(flows.length, "frappe-clean flow count must stay at 1").toBe(1);
  });

  it("frappe-clean: endpoint node for myapp.api.widget.get_widget still present", () => {
    const { nodes } = scan(FRAPPE_CLEAN);
    const ep = nodes.find(
      (n) => n.type === "endpoint" && n.name === "myapp.api.widget.get_widget",
    );
    expect(ep, "get_widget endpoint must still exist").toBeDefined();
  });

  it("frappe-clean: calls edge from get_widget → load_widget_data still present", () => {
    const { nodes, edges } = scan(FRAPPE_CLEAN);
    const ep = nodes.find((n) => n.type === "endpoint" && n.name === "myapp.api.widget.get_widget");
    const helperId = nodes.find(
      (n) => n.name === "load_widget_data" && n.file === "myapp/utils/helpers.py",
    )?.id;
    expect(ep).toBeDefined();
    expect(helperId).toBeDefined();
    const callEdge = edges.find(
      (e) => e.kind === "calls" && e.from === ep!.id && e.to === helperId,
    );
    expect(callEdge, "calls edge get_widget → load_widget_data must still exist").toBeDefined();
  });

  it("frappe-clean: external http edge from load_widget_data still emits", () => {
    const { nodes, edges } = scan(FRAPPE_CLEAN);
    const helperId = nodes.find(
      (n) => n.name === "load_widget_data" && n.file === "myapp/utils/helpers.py",
    )?.id;
    expect(helperId).toBeDefined();
    const http = edges.find(
      (e) =>
        e.kind === "http" &&
        e.from === helperId &&
        e.to.includes("api.telegram.org"),
    );
    expect(http, "external http edge from load_widget_data must still emit").toBeDefined();
  });

  it("frappe-clean: all calls-edge `to` ids still in nodes (no regression in edge integrity)", () => {
    const { nodes, edges } = scan(FRAPPE_CLEAN);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const callsEdges = edges.filter((e) => e.kind === "calls");
    for (const e of callsEdges) {
      expect(nodeIds.has(e.to), `calls edge to unknown id: ${e.to}`).toBe(true);
    }
  });
});

// ── optional env-gated test (AC4) ─────────────────────────────────────────────
// Set SUTRA_WITHRUN_SLICE=/path/to/bench/apps/wr to run against a real checkout.
// Skipped when env var is unset (CI-safe).

const WITHRUN_SLICE_PATH = process.env["SUTRA_WITHRUN_SLICE"];

describe.skipIf(!WITHRUN_SLICE_PATH)(
  "python/frappe extractor — optional real withrun checkout (Story 8.7 AC4)",
  () => {
    it("real withrun slice: buildFlows produces at least one flow", () => {
      const { nodes, edges } = scan(WITHRUN_SLICE_PATH!);
      const { flows } = buildFlows(nodes, edges);
      expect(flows.length, "real withrun checkout must produce at least one flow").toBeGreaterThan(0);
    });

    it("real withrun slice: no calls edge `to` id missing from nodes", () => {
      const { nodes, edges } = scan(WITHRUN_SLICE_PATH!);
      const nodeIds = new Set(nodes.map((n) => n.id));
      for (const e of edges.filter((e) => e.kind === "calls")) {
        expect(nodeIds.has(e.to), `dangling calls edge target: ${e.to}`).toBe(true);
      }
    });
  },
);
