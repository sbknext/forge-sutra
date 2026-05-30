/**
 * Story 4.1 — language-agnostic graph core tests.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { scan, registeredExtractors } from "../src/scanner.js";
import { runChecks } from "../src/checks.js";
import { buildFeatures } from "../src/features.js";
import { GRAPH_VERSION, type SutraNode } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLEAN = path.resolve(__dirname, "fixtures/clean");
const BROKEN = path.resolve(__dirname, "fixtures/broken");

function sortedNodeIds(nodes: SutraNode[]): string[] {
  return nodes.map((n) => n.id).sort();
}

function sortedEdgeKeys(edges: { from: string; to: string; kind: string }[]): string[] {
  return edges.map((e) => `${e.from}\0${e.to}\0${e.kind}`).sort();
}

describe("language-agnostic core (Story 4.1)", () => {
  it("GRAPH_VERSION bumped for language field on nodes", () => {
    expect(GRAPH_VERSION).toBe(6);
  });

  it("every emitted node has language === ts from TsExtractor", () => {
    const { nodes } = scan(CLEAN);
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node.language).toBe("ts");
    }
  });

  it("two scans produce identical sorted node and edge ids (regression guard)", () => {
    const a = scan(BROKEN);
    const b = scan(BROKEN);
    expect(sortedNodeIds(a.nodes)).toEqual(sortedNodeIds(b.nodes));
    expect(sortedEdgeKeys(a.edges)).toEqual(sortedEdgeKeys(b.edges));
  });

  it("checks and features modules do not import ts-morph or extractors/ts", () => {
    const checksSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/checks.ts"),
      "utf8",
    );
    const featuresSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/features.ts"),
      "utf8",
    );
    for (const src of [checksSrc, featuresSrc]) {
      expect(src).not.toMatch(/from\s+["']ts-morph/);
      expect(src).not.toMatch(/extractors\/ts/);
    }
  });

  it("only extractors/ts.ts imports ts-morph under src/", () => {
    const srcDir = path.resolve(__dirname, "../src");
    const offenders: string[] = [];
    function walk(dir: string) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) {
          walk(full);
        } else if (name.endsWith(".ts")) {
          const rel = path.relative(srcDir, full);
          const content = fs.readFileSync(full, "utf8");
          if (/from\s+["']ts-morph/.test(content) && rel !== "extractors/ts.ts") {
            offenders.push(rel);
          }
        }
      }
    }
    walk(srcDir);
    expect(offenders).toEqual([]);
  });

  it("unclaimed .py file is skipped without error", () => {
    const tmp = fs.mkdtempSync(path.join(path.dirname(CLEAN), "lang-core-"));
    try {
      fs.writeFileSync(path.join(tmp, "stub.py"), "def hello(): pass\n", "utf8");
      fs.writeFileSync(
        path.join(tmp, "index.ts"),
        "export const x = 1;\n",
        "utf8",
      );
      const { nodes } = scan(tmp);
      expect(nodes.some((n) => n.file.endsWith(".py"))).toBe(false);
      expect(nodes.some((n) => n.language === "ts")).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("scan output is stable except version and language vs pre-4.1 ids", () => {
    const { nodes, edges } = scan(CLEAN);
    const issues = runChecks(nodes, edges);
    const features = buildFeatures(nodes, issues, edges);
    expect(nodes.length).toBeGreaterThan(0);
    expect(features.length).toBeGreaterThan(0);
    const ids = sortedNodeIds(nodes);
    const again = sortedNodeIds(scan(CLEAN).nodes);
    expect(ids).toEqual(again);
  });

  it("extractor registry contains TsExtractor only", () => {
    const reg = registeredExtractors();
    expect(reg.length).toBe(1);
    expect(reg[0]!.language).toBe("ts");
  });
});
