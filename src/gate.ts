/**
 * CI gate — classifies diff issues by severity for scan --check.
 */

import type { SutraDiff } from "./diff.js";
import type { Severity, SutraIssue, SutraGraph } from "./types.js";
import { GRAPH_VERSION } from "./types.js";

export interface GateResult {
  exitCode: number;
  newErrors: SutraIssue[];
  newWarns: SutraIssue[];
  newInfos: SutraIssue[];
  resolvedCount: number;
  graphVersion: number;
  diff: SutraDiff;
}

export class GraphVersionMismatchError extends Error {
  readonly baselineVersion: number;
  readonly currentVersion: number;

  constructor(baselineVersion: number, currentVersion: number) {
    super(
      `Graph version mismatch: baseline v${baselineVersion}, current v${currentVersion}`,
    );
    this.baselineVersion = baselineVersion;
    this.currentVersion = currentVersion;
  }
}

/** Severity rank for --fail-on threshold (higher = more severe). */
export function severityRank(severity: Severity): number {
  switch (severity) {
    case "error":
      return 2;
    case "warn":
      return 1;
    case "info":
      return 0;
  }
}

export function assertGraphVersionsMatch(baseline: SutraGraph, current: SutraGraph): void {
  if (baseline.version !== current.version) {
    throw new GraphVersionMismatchError(baseline.version, current.version);
  }
}

/** Partition new issues and compute exit code from diff (issues only). */
export function gateFromDiff(
  diff: SutraDiff,
  opts: { failOn: Severity },
): GateResult {
  const newErrors = diff.issues_added.filter((i) => i.severity === "error");
  const newWarns = diff.issues_added.filter((i) => i.severity === "warn");
  const newInfos = diff.issues_added.filter((i) => i.severity === "info");
  const failRank = severityRank(opts.failOn);
  const gating = diff.issues_added.filter(
    (i) => severityRank(i.severity) >= failRank,
  );

  return {
    exitCode: gating.length > 0 ? 1 : 0,
    newErrors,
    newWarns,
    newInfos,
    resolvedCount: diff.issues_removed.length,
    graphVersion: GRAPH_VERSION,
    diff,
  };
}

/** Human-readable gate summary (candidate language). */
export function formatGateSummary(result: GateResult): string {
  const lines: string[] = [
    "── CI gate (baseline vs current) — candidate structural delta ──",
    `  new error issues:   ${result.newErrors.length}`,
    `  new warn issues:    ${result.newWarns.length}`,
    `  new info issues:    ${result.newInfos.length}`,
    `  resolved in snapshot: ${result.resolvedCount}`,
  ];

  for (const iss of result.newErrors) {
    lines.push(`  [ERROR · new structural issue] ${iss.kind} → ${iss.node}`);
  }
  for (const iss of result.newWarns) {
    lines.push(`  [WARN · new structural issue] ${iss.kind} → ${iss.node}`);
  }
  for (const iss of result.newInfos) {
    lines.push(`  [INFO · new structural issue] ${iss.kind} → ${iss.node}`);
  }

  if (
    result.newErrors.length === 0 &&
    result.newWarns.length === 0 &&
    result.newInfos.length === 0 &&
    result.resolvedCount === 0
  ) {
    lines.push("  No structural drift vs baseline.");
  }

  lines.push(
    result.exitCode === 0
      ? "  Gate: PASS (no new issues at fail-on threshold)"
      : "  Gate: FAIL (new structural issue(s) vs baseline)",
  );

  return lines.join("\n");
}

export interface GateJsonOutput {
  graphVersion: number;
  exitCode: number;
  newErrors: SutraIssue[];
  newWarns: SutraIssue[];
  newInfos: SutraIssue[];
  resolvedCount: number;
  diff: SutraDiff;
}

export function gateToJson(result: GateResult): GateJsonOutput {
  return {
    graphVersion: result.graphVersion,
    exitCode: result.exitCode,
    newErrors: result.newErrors,
    newWarns: result.newWarns,
    newInfos: result.newInfos,
    resolvedCount: result.resolvedCount,
    diff: result.diff,
  };
}
