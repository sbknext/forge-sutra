/**
 * Graph diff — structural delta between two SutraGraph scans.
 * Candidate structural comparison only; does not explain why code changed.
 */

import fs from "node:fs";
import type {
  SutraGraph,
  SutraNode,
  SutraEdge,
  SutraIssue,
} from "./types.js";

export const DIFF_VERSION = 0;

export interface SutraIssueChange {
  before: SutraIssue;
  after: SutraIssue;
}

export interface SutraDiff {
  diff_version: number;
  nodes_added: SutraNode[];
  nodes_removed: SutraNode[];
  edges_added: SutraEdge[];
  edges_removed: SutraEdge[];
  issues_added: SutraIssue[];
  issues_removed: SutraIssue[];
  issues_changed: SutraIssueChange[];
}

function edgeKey(e: SutraEdge): string {
  return `${e.from}\0${e.to}\0${e.kind}`;
}

/** Stable identity for an issue (kind + node + feature). */
function issueKey(i: SutraIssue): string {
  return `${i.kind}\0${i.node}\0${i.feature}`;
}

function issuesEqual(a: SutraIssue, b: SutraIssue): boolean {
  return (
    a.severity === b.severity &&
    a.kind === b.kind &&
    a.node === b.node &&
    a.feature === b.feature &&
    a.message === b.message
  );
}

export function loadGraphFile(filePath: string): SutraGraph {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Graph file not found: ${filePath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as SutraGraph;
  } catch (err) {
    throw new Error(`Failed to read graph file ${filePath}: ${String(err)}`);
  }
}

export function diffGraphs(a: SutraGraph, b: SutraGraph): SutraDiff {
  const nodesA = new Map(a.nodes.map((n) => [n.id, n]));
  const nodesB = new Map(b.nodes.map((n) => [n.id, n]));

  const nodes_added: SutraNode[] = [];
  const nodes_removed: SutraNode[] = [];

  for (const [id, node] of nodesB) {
    if (!nodesA.has(id)) nodes_added.push(node);
  }
  for (const [id, node] of nodesA) {
    if (!nodesB.has(id)) nodes_removed.push(node);
  }

  const edgesA = new Map(a.edges.map((e) => [edgeKey(e), e]));
  const edgesB = new Map(b.edges.map((e) => [edgeKey(e), e]));

  const edges_added: SutraEdge[] = [];
  const edges_removed: SutraEdge[] = [];

  for (const [key, edge] of edgesB) {
    if (!edgesA.has(key)) edges_added.push(edge);
  }
  for (const [key, edge] of edgesA) {
    if (!edgesB.has(key)) edges_removed.push(edge);
  }

  const issuesA = new Map(a.issues.map((i) => [issueKey(i), i]));
  const issuesB = new Map(b.issues.map((i) => [issueKey(i), i]));

  const issues_added: SutraIssue[] = [];
  const issues_removed: SutraIssue[] = [];
  const issues_changed: SutraIssueChange[] = [];

  for (const [key, issue] of issuesB) {
    const prev = issuesA.get(key);
    if (!prev) {
      issues_added.push(issue);
    } else if (!issuesEqual(prev, issue)) {
      issues_changed.push({ before: prev, after: issue });
    }
  }
  for (const [key, issue] of issuesA) {
    if (!issuesB.has(key)) issues_removed.push(issue);
  }

  return {
    diff_version: DIFF_VERSION,
    nodes_added,
    nodes_removed,
    edges_added,
    edges_removed,
    issues_added,
    issues_removed,
    issues_changed,
  };
}

/** Human-readable counts-only summary line. */
export function formatDiffSummary(diff: SutraDiff): string {
  const parts = [
    `+${diff.nodes_added.length} nodes`,
    `-${diff.nodes_removed.length} nodes`,
    `+${diff.edges_added.length} edges`,
    `-${diff.edges_removed.length} edges`,
    `+${diff.issues_added.length} issues`,
    `-${diff.issues_removed.length} issues`,
    `~${diff.issues_changed.length} issues changed`,
  ];
  return parts.join(", ");
}
