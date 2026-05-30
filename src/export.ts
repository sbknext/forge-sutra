/**
 * SUTRA-13.2 — export subcommands for contracts, schema, issues.
 */

import fs from "node:fs";
import path from "node:path";
import type { SutraGraph, SutraIssue } from "./types.js";
import { GRAPH_VERSION } from "./types.js";

export function exportContracts(graph: SutraGraph): string {
  return JSON.stringify(graph.contracts, null, 2);
}

export function exportGraphSchema(): string {
  const schema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "SutraGraph",
    description: "graph.json schema for forge-sutra scans (candidate/heuristic)",
    type: "object",
    required: ["version", "repo", "scanned_at", "commit", "nodes", "edges", "issues", "features", "contracts"],
    properties: {
      version: { type: "integer", const: GRAPH_VERSION },
      repo: { type: "string" },
      scanned_at: { type: "string", format: "date-time" },
      commit: { type: "string" },
      nodes: { type: "array", items: { $ref: "#/definitions/SutraNode" } },
      edges: { type: "array", items: { $ref: "#/definitions/SutraEdge" } },
      issues: { type: "array", items: { $ref: "#/definitions/SutraIssue" } },
      features: { type: "array", items: { $ref: "#/definitions/SutraFeature" } },
      contracts: { type: "array", items: { $ref: "#/definitions/SutraContract" } },
    },
    definitions: {
      SutraNode: {
        type: "object",
        required: ["id", "type", "name", "file", "line", "feature"],
        properties: {
          id: { type: "string" },
          type: { enum: ["route", "handler", "component", "test", "endpoint", "module", "function"] },
          name: { type: "string" },
          file: { type: "string" },
          line: { type: "integer" },
          data_shape: { type: ["string", "null"] },
          feature: { type: "string" },
        },
      },
      SutraEdge: {
        type: "object",
        required: ["from", "to", "kind"],
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          kind: { enum: ["calls", "imports", "renders", "tests", "http"] },
        },
      },
      SutraIssue: {
        type: "object",
        required: ["severity", "kind", "node", "feature", "message"],
        properties: {
          severity: { enum: ["error", "warn", "info"] },
          kind: { type: "string" },
          node: { type: "string" },
          feature: { type: "string" },
          message: { type: "string" },
        },
      },
      SutraFeature: {
        type: "object",
        required: ["id", "label", "node_ids", "issue_count", "health"],
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          node_ids: { type: "array", items: { type: "string" } },
          issue_count: { type: "integer" },
          health: {
            type: "object",
            required: ["score", "band", "inputs", "available_signals"],
            properties: {
              score: { type: "integer", minimum: 0, maximum: 100 },
              band: { enum: ["green", "amber", "red"] },
              inputs: { type: "array" },
              available_signals: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
      SutraContract: {
        type: "object",
        required: ["feature", "file", "endpoints"],
        properties: {
          feature: { type: "string" },
          file: { type: "string" },
          endpoints: {
            type: "array",
            items: {
              type: "object",
              required: ["method", "path"],
              properties: {
                method: { type: "string" },
                path: { type: "string" },
              },
            },
          },
        },
      },
    },
  };
  return JSON.stringify(schema, null, 2);
}

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportIssues(graph: SutraGraph, format: "json" | "csv"): string {
  if (format === "json") {
    return JSON.stringify(graph.issues, null, 2);
  }
  const header = "severity,kind,node,feature,message";
  const rows = graph.issues.map((i: SutraIssue) =>
    [i.severity, i.kind, i.node, i.feature, i.message].map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n");
}

export function writeExport(content: string, outPath?: string): void {
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content, "utf8");
  } else {
    process.stdout.write(content + (content.endsWith("\n") ? "" : "\n"));
  }
}
