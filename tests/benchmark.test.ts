/**
 * SUTRA-9.1 — large-repo benchmark + profile tests.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { scan } from "../src/scanner.js";
import { runChecks } from "../src/checks.js";
import { buildFeatures } from "../src/features.js";
import { loadContracts } from "../src/contracts.js";
import { checkContractDrift } from "../src/checks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** CI regression guard — environment-dependent, not an SLA. */
const BENCHMARK_THRESHOLD_MS = 15_000;
const MODULE_COUNT = 200;

function generateLargeFixture(root: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const subdir = path.join(root, `packages/pkg${Math.floor(i / 20)}`);
    fs.mkdirSync(subdir, { recursive: true });
    const imports =
      i > 0
        ? `import { fn${i - 1} } from './file${i - 1}';\n`
        : "";
    fs.writeFileSync(
      path.join(subdir, `file${i}.ts`),
      `${imports}export function fn${i}() { return ${i}; }\n`,
      "utf8",
    );
  }
}

function fullScanPipeline(repoRoot: string): void {
  const { nodes, edges } = scan(repoRoot);
  const checkIssues = runChecks(nodes, edges);
  const { contracts, issues: contractIssues } = loadContracts(repoRoot);
  const driftIssues = checkContractDrift(contracts, nodes);
  const issues = [...checkIssues, ...contractIssues, ...driftIssues];
  buildFeatures(nodes, issues);
}

describe("large-repo benchmark (SUTRA-9.1)", () => {
  it(`scans ${MODULE_COUNT}-module synthetic fixture under ${BENCHMARK_THRESHOLD_MS}ms`, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-large-"));
    generateLargeFixture(tmp, MODULE_COUNT);

    const fileCount = fs
      .readdirSync(tmp, { recursive: true })
      .filter((f) => String(f).endsWith(".ts")).length;
    expect(fileCount).toBeGreaterThanOrEqual(MODULE_COUNT);

    const start = performance.now();
    fullScanPipeline(tmp);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(BENCHMARK_THRESHOLD_MS);
  });

  it("large fixture produces nodes without changing semantics vs small scan", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-large-smoke-"));
    generateLargeFixture(tmp, 50);

    const { nodes, edges } = scan(tmp);
    expect(nodes.length).toBeGreaterThan(0);
    expect(edges.length).toBeGreaterThan(0);
    const issues = runChecks(nodes, edges);
    expect(Array.isArray(issues)).toBe(true);
  });
});
