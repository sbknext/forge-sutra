/**
 * Story 4.2 — Python / Frappe extractor tests.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "../src/scanner.js";
import { runChecks } from "../src/checks.js";
import { isFrappeRepo } from "../src/extractors/python-frappe.js";
import type { SutraNode } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRAPPE_CLEAN = path.resolve(__dirname, "fixtures/frappe-clean");
const FRAPPE_BROKEN = path.resolve(__dirname, "fixtures/frappe-broken");
const BROKEN = path.resolve(__dirname, "fixtures/broken");
const PROXIED = path.resolve(__dirname, "fixtures/proxied");

function sortedIds(nodes: SutraNode[]): string[] {
  return nodes.map((n) => n.id).sort();
}

describe("python/frappe extractor — clean (Story 4.2 §10)", () => {
  it("detects Frappe repo layout", () => {
    expect(isFrappeRepo(FRAPPE_CLEAN)).toBe(true);
    expect(isFrappeRepo(BROKEN)).toBe(false);
  });

  it("emits endpoint for whitelisted function with dotted-path name", () => {
    const { nodes } = scan(FRAPPE_CLEAN);
    const ep = nodes.find(
      (n) => n.type === "endpoint" && n.name === "myapp.api.widget.get_widget",
    );
    expect(ep).toBeDefined();
    expect(ep!.language).toBe("python-frappe");
  });

  it("emits handler node for Widget Document controller", () => {
    const { nodes } = scan(FRAPPE_CLEAN);
    const handler = nodes.find(
      (n) => n.type === "handler" && n.name === "Widget",
    );
    expect(handler).toBeDefined();
  });

  it("doc_events produces calls edge to resolved handler", () => {
    const { nodes, edges } = scan(FRAPPE_CLEAN);
    const handlerId = nodes.find(
      (n) => n.file === "myapp/events/handlers.py" && n.name === "on_widget_submit",
    )?.id;
    expect(handlerId).toBeDefined();
    const hookEdge = edges.find(
      (e) => e.kind === "calls" && e.to === handlerId,
    );
    expect(hookEdge).toBeDefined();
  });

  it("runChecks returns zero issues on clean Frappe fixture", () => {
    const { nodes, edges } = scan(FRAPPE_CLEAN);
    const issues = runChecks(nodes, edges);
    expect(issues).toHaveLength(0);
  });
});

describe("python/frappe extractor — broken (Story 4.2 §11)", () => {
  it("unresolved doc_events handler yields missing_handler", () => {
    const { nodes, edges } = scan(FRAPPE_BROKEN);
    const issues = runChecks(nodes, edges);
    const missing = issues.filter((i) => i.kind === "missing_handler");
    expect(missing.length).toBeGreaterThan(0);
    const docMissing = missing.find(
      (i) =>
        i.node.includes("missing_handler") ||
        i.message.includes("missing_handler"),
    );
    expect(docMissing).toBeDefined();
  });

  it("unresolved scheduler job yields missing_handler", () => {
    const { nodes, edges } = scan(FRAPPE_BROKEN);
    const issues = runChecks(nodes, edges);
    const missing = issues.find(
      (i) =>
        i.kind === "missing_handler" &&
        (i.node.includes("removed_job") || i.message.includes("removed_job")),
    );
    expect(missing).toBeDefined();
  });
});

describe("python/frappe extractor — deterministic ids (Story 4.2 §12)", () => {
  it("two scans of frappe-clean produce identical sorted id lists", () => {
    expect(sortedIds(scan(FRAPPE_CLEAN).nodes)).toEqual(
      sortedIds(scan(FRAPPE_CLEAN).nodes),
    );
  });
});

describe("python/frappe extractor — TS regression guard", () => {
  it("broken TS fixture still flags POST /api/capture orphan", () => {
    const { nodes, edges } = scan(BROKEN);
    const issues = runChecks(nodes, edges);
    const orphan = issues.find(
      (i) =>
        i.kind === "orphaned_endpoint" &&
        i.node.includes("POST") &&
        i.node.includes("/api/capture"),
    );
    expect(orphan).toBeDefined();
  });

  it("proxied fixture still has zero orphaned_endpoint issues", () => {
    const { nodes, edges } = scan(PROXIED);
    const issues = runChecks(nodes, edges);
    expect(issues.filter((i) => i.kind === "orphaned_endpoint")).toHaveLength(0);
  });
});
