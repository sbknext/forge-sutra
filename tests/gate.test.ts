/**
 * Story 4.4 — CI gate unit tests.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { diffGraphs } from "../src/diff.js";
import {
  gateFromDiff,
  formatGateSummary,
  gateToJson,
  assertGraphVersionsMatch,
  GraphVersionMismatchError,
} from "../src/gate.js";
import { formatPrComment } from "../src/pr-comment.js";
import { GRAPH_VERSION, type SutraGraph, type SutraIssue } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../dist/cli.js");
const CLEAN = path.resolve(__dirname, "fixtures/clean");

function issue(
  partial: Partial<SutraIssue> & Pick<SutraIssue, "kind" | "node">,
): SutraIssue {
  return {
    severity: "error",
    feature: "test",
    message: "candidate structural finding",
    ...partial,
  };
}

function minimalGraph(
  issues: SutraIssue[],
  version = GRAPH_VERSION,
): SutraGraph {
  return {
    version,
    repo: "test",
    scanned_at: "2026-05-30T00:00:00.000Z",
    commit: "abc",
    nodes: [],
    edges: [],
    issues,
    features: [],
    contracts: [],
    flows: [],
  };
}

describe("gateFromDiff (Story 4.4)", () => {
  it("new error in diff yields exitCode 1", () => {
    const baseline = minimalGraph([]);
    const current = minimalGraph([
      issue({ kind: "orphaned_endpoint", node: "POST /api/x" }),
    ]);
    const diff = diffGraphs(baseline, current);
    const gate = gateFromDiff(diff, { failOn: "error" });
    expect(gate.exitCode).toBe(1);
    expect(gate.newErrors).toHaveLength(1);
  });

  it("new warn only yields exitCode 0 by default", () => {
    const baseline = minimalGraph([]);
    const current = minimalGraph([
      issue({ kind: "contract_undeclared_route", node: "GET /a", severity: "warn" }),
    ]);
    const gate = gateFromDiff(diffGraphs(baseline, current), { failOn: "error" });
    expect(gate.exitCode).toBe(0);
    expect(gate.newWarns).toHaveLength(1);
  });

  it("new warn yields exitCode 1 with failOn warn", () => {
    const baseline = minimalGraph([]);
    const current = minimalGraph([
      issue({ kind: "contract_undeclared_route", node: "GET /a", severity: "warn" }),
    ]);
    const gate = gateFromDiff(diffGraphs(baseline, current), { failOn: "warn" });
    expect(gate.exitCode).toBe(1);
  });

  it("pre-existing errors unchanged yields exitCode 0", () => {
    const shared = issue({ kind: "missing_handler", node: "lib/x.ts#gone" });
    const baseline = minimalGraph([shared]);
    const current = minimalGraph([shared]);
    const gate = gateFromDiff(diffGraphs(baseline, current), { failOn: "error" });
    expect(gate.exitCode).toBe(0);
    expect(gate.newErrors).toHaveLength(0);
  });

  it("resolved issues do not affect exit code", () => {
    const baseline = minimalGraph([
      issue({ kind: "missing_handler", node: "a" }),
    ]);
    const current = minimalGraph([]);
    const gate = gateFromDiff(diffGraphs(baseline, current), { failOn: "error" });
    expect(gate.exitCode).toBe(0);
    expect(gate.resolvedCount).toBe(1);
  });

  it("formatGateSummary uses candidate language", () => {
    const baseline = minimalGraph([]);
    const current = minimalGraph([
      issue({ kind: "orphaned_endpoint", node: "POST /api/x" }),
    ]);
    const gate = gateFromDiff(diffGraphs(baseline, current), { failOn: "error" });
    const text = formatGateSummary(gate);
    expect(text).toMatch(/new structural issue/);
    expect(text).not.toMatch(/\bfixed\b/i);
    expect(text).not.toMatch(/\bbug\b/i);
  });

  it("gateToJson includes graphVersion and diff", () => {
    const gate = gateFromDiff(
      diffGraphs(minimalGraph([]), minimalGraph([])),
      { failOn: "error" },
    );
    const json = gateToJson(gate);
    expect(json.graphVersion).toBe(GRAPH_VERSION);
    expect(json.diff).toBeDefined();
    expect(json.exitCode).toBe(0);
  });

  it("formatPrComment lists errors first with details block for warns", () => {
    const gate = gateFromDiff(
      diffGraphs(
        minimalGraph([]),
        minimalGraph([
          issue({ kind: "orphaned_endpoint", node: "POST /e" }),
          issue({ kind: "contract_undeclared_route", node: "GET /w", severity: "warn" }),
        ]),
      ),
      { failOn: "error" },
    );
    const md = formatPrComment(gate);
    expect(md.indexOf("error-severity")).toBeLessThan(md.indexOf("<details>"));
    expect(md).toContain("orphaned_endpoint");
  });
});

describe("assertGraphVersionsMatch (Story 4.4)", () => {
  it("throws GraphVersionMismatchError on version skew", () => {
    expect(() =>
      assertGraphVersionsMatch(minimalGraph([], 5), minimalGraph([], GRAPH_VERSION)),
    ).toThrow(GraphVersionMismatchError);
  });
});

describe("scan --check CLI (Story 4.4)", () => {
  function runScanCheck(cwd: string, extra = ""): { status: number; stdout: string; stderr: string } {
    try {
      const stdout = execSync(
        `node "${CLI}" scan "${CLEAN}" --check ${extra}`,
        { cwd, encoding: "utf8" },
      );
      return { status: 0, stdout, stderr: "" };
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return {
        status: e.status ?? 1,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? "",
      };
    }
  }

  it("exit 2 when baseline missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-gate-"));
    const result = runScanCheck(tmp);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/no baseline found/);
  });

  it("exit 0 when baseline matches current scan", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-gate-"));
    execSync(`node "${CLI}" baseline "${CLEAN}"`, { cwd: tmp, encoding: "utf8" });
    const result = runScanCheck(tmp);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/PASS|No structural drift/);
  });

  it("exit 2 on version-skewed baseline", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-gate-"));
    execSync(`node "${CLI}" baseline "${CLEAN}"`, { cwd: tmp, encoding: "utf8" });
    const baselinePath = path.join(tmp, ".sutra", "baseline.json");
    const g = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as SutraGraph;
    g.version = 99;
    fs.writeFileSync(baselinePath, JSON.stringify(g, null, 2));
    const result = runScanCheck(tmp);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/different graph version/);
  });

  it("--format json emits parseable output", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-gate-"));
    execSync(`node "${CLI}" baseline "${CLEAN}"`, { cwd: tmp, encoding: "utf8" });
    const result = runScanCheck(tmp, "--format json");
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { graphVersion: number; exitCode: number };
    expect(parsed.graphVersion).toBe(GRAPH_VERSION);
    expect(parsed.exitCode).toBe(0);
  });
});
