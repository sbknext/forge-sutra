/**
 * Story 4.2 — Python / Frappe extractor tests.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "../src/scanner.js";
import { runChecks } from "../src/checks.js";
import { buildFlows } from "../src/flows.js";
import { isFrappeRepo } from "../src/extractors/python-frappe.js";
import { hasWhitelistDecorator } from "../src/util/python-ast.js";
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

  it("whitelist endpoint emits calls edge to imported helper", () => {
    const { nodes, edges } = scan(FRAPPE_CLEAN);
    const ep = nodes.find(
      (n) => n.type === "endpoint" && n.name === "myapp.api.widget.get_widget",
    );
    expect(ep).toBeDefined();
    const helperId = nodes.find(
      (n) => n.name === "load_widget_data" && n.file === "myapp/utils/helpers.py",
    )?.id;
    expect(helperId).toBeDefined();
    const call = edges.find(
      (e) => e.kind === "calls" && e.from === ep!.id && e.to === helperId,
    );
    expect(call).toBeDefined();
  });

  it("helper emits http edge for requests.get with literal path", () => {
    const { nodes, edges } = scan(FRAPPE_CLEAN);
    const helperId = nodes.find(
      (n) => n.name === "load_widget_data" && n.file === "myapp/utils/helpers.py",
    )?.id;
    expect(helperId).toBeDefined();
    const http = edges.find(
      (e) =>
        e.kind === "http" &&
        e.from === helperId &&
        e.to.includes("GET") &&
        e.to.includes("api.telegram.org"),
    );
    expect(http).toBeDefined();
  });

  it("buildFlows produces non-empty flows from Frappe endpoint entry", () => {
    const { nodes, edges } = scan(FRAPPE_CLEAN);
    const { flows } = buildFlows(nodes, edges);
    expect(flows.length).toBeGreaterThan(0);
    const epFlow = flows.find((f) => f.entry.includes("get_widget"));
    expect(epFlow).toBeDefined();
    expect(epFlow!.steps.length).toBeGreaterThan(1);
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

describe("python/frappe extractor — whitelist forms (Story 6.3 AC1)", () => {
  // Unit-test hasWhitelistDecorator directly to avoid adding fixture files that
  // would shift the regression-pinned node/edge/flow counts in frappe-clean.
  // The decorator text passed here matches what decoratorText() extracts from the
  // tree-sitter AST for each real Python form (stripping surrounding whitespace).

  it("bare @frappe.whitelist (no call parens) returns true", () => {
    // Python: @frappe.whitelist  — no parens; Python calls it automatically
    expect(hasWhitelistDecorator(["@frappe.whitelist"])).toBe(true);
  });

  it("@frappe.whitelist() (empty call) returns true", () => {
    expect(hasWhitelistDecorator(["@frappe.whitelist()"])).toBe(true);
  });

  it("@frappe.whitelist(allow_guest=True) returns true", () => {
    expect(hasWhitelistDecorator(["@frappe.whitelist(allow_guest=True)"])).toBe(true);
  });

  it("@frappe.whitelist(methods=['POST']) returns true", () => {
    expect(hasWhitelistDecorator(['@frappe.whitelist(methods=["POST"])'])).toBe(true);
  });

  it("unrelated decorator returns false", () => {
    expect(hasWhitelistDecorator(["@staticmethod"])).toBe(false);
    expect(hasWhitelistDecorator(["@login_required"])).toBe(false);
    expect(hasWhitelistDecorator([])).toBe(false);
  });

  it("mixed decorators: true when at least one is whitelist", () => {
    expect(hasWhitelistDecorator(["@staticmethod", "@frappe.whitelist"])).toBe(true);
    expect(hasWhitelistDecorator(["@frappe.whitelist()", "@login_required"])).toBe(true);
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
