/**
 * Story 6.7 — Self-CI dogfood: regression-guard tests for scan --check gate.
 *
 * Tests use a committed fixture (tests/fixtures/self-check-gate/) with a
 * pre-recorded baseline so they never depend on forge-sutra's live src/.
 * All assertions are on exit code + issue diff, not log text.
 */

import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GRAPH_VERSION, type SutraGraph } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../dist/cli.js");
const FIXTURE = path.resolve(__dirname, "fixtures/self-check-gate");
const FIXTURE_BASELINE = path.resolve(FIXTURE, ".sutra/baseline.json");

function runScanCheck(
  repoPath: string,
  baselinePath: string,
  extra = "",
): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(
      `node "${CLI}" scan "${repoPath}" --check --baseline "${baselinePath}" ${extra}`,
      { encoding: "utf8" },
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

// Track temp dirs for cleanup
const tmps: string[] = [];
function makeTmp(): string {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-self-check-"));
  tmps.push(t);
  return t;
}

afterEach(() => {
  for (const t of tmps.splice(0)) {
    try { fs.rmSync(t, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("Story 6.7 — self-check gate regression guard", () => {
  // ── Test 1: clean tree passes ────────────────────────────────────────────
  it("clean fixture exits 0 with zero new error-severity issues", () => {
    const result = runScanCheck(FIXTURE, FIXTURE_BASELINE);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/No structural drift|Gate: PASS/);
  });

  // ── Test 2: regression fails ─────────────────────────────────────────────
  it("new error-severity issue exits 1 (gate bites)", () => {
    // Inject a synthetic orphaned client call into a temp copy of the fixture
    const tmp = makeTmp();
    // Copy fixture files to tmp
    fs.cpSync(FIXTURE, tmp, { recursive: true });
    // Add an orphaned endpoint — client fetches /api/shipments which has no handler
    const clientFile = path.join(tmp, "lib/client.ts");
    const original = fs.readFileSync(clientFile, "utf8");
    fs.writeFileSync(
      clientFile,
      original + `\n// SYNTHETIC BREAK\nexport async function getShipments() {\n  const res = await fetch("/api/shipments", { method: "GET" });\n  return res.json();\n}\n`,
    );
    // Run gate against the committed (clean) baseline — must exit 1
    const result = runScanCheck(tmp, FIXTURE_BASELINE);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/new error issues:\s+[1-9]/);
  });

  // ── Test 3: warn/info does not fail ──────────────────────────────────────
  it("new info-severity issue only exits 0 (gate threshold is error)", () => {
    // Modify baseline to have no issues at all, then scan the clean fixture.
    // The scan will produce info issues (untested_feature) — gate must still pass.
    const tmp = makeTmp();
    fs.mkdirSync(path.join(tmp, ".sutra"), { recursive: true });
    const cleanBaseline: SutraGraph = JSON.parse(
      fs.readFileSync(FIXTURE_BASELINE, "utf8"),
    ) as SutraGraph;
    // Strip all issues from the baseline so info issues appear as "new"
    cleanBaseline.issues = cleanBaseline.issues.filter(
      (i) => i.severity === "error",
    );
    fs.writeFileSync(
      path.join(tmp, ".sutra/baseline.json"),
      JSON.stringify(cleanBaseline, null, 2),
    );
    // Scan clean fixture against stripped baseline — new info issues will surface
    const result = runScanCheck(FIXTURE, path.join(tmp, ".sutra/baseline.json"));
    expect(result.status).toBe(0);
    // May have new info issues but gate stays open
    expect(result.stdout).toMatch(/Gate: PASS/);
  });

  // ── Test 4: baseline determinism ─────────────────────────────────────────
  it("two scans over unchanged fixture produce identical node ids", () => {
    const tmp1 = makeTmp();
    const tmp2 = makeTmp();
    execSync(`node "${CLI}" baseline "${FIXTURE}" --output-dir "${tmp1}"`, {
      encoding: "utf8",
    });
    execSync(`node "${CLI}" baseline "${FIXTURE}" --output-dir "${tmp2}"`, {
      encoding: "utf8",
    });
    const g1 = JSON.parse(
      fs.readFileSync(path.join(tmp1, ".sutra/baseline.json"), "utf8"),
    ) as SutraGraph;
    const g2 = JSON.parse(
      fs.readFileSync(path.join(tmp2, ".sutra/baseline.json"), "utf8"),
    ) as SutraGraph;
    // Node ids must be identical across runs (makeNodeId is deterministic)
    const ids1 = g1.nodes.map((n) => n.id).sort();
    const ids2 = g2.nodes.map((n) => n.id).sort();
    expect(ids1).toEqual(ids2);
    // Edge ids too
    const edges1 = g1.edges.map((e) => `${e.from}->${e.to}`).sort();
    const edges2 = g2.edges.map((e) => `${e.from}->${e.to}`).sort();
    expect(edges1).toEqual(edges2);
  });

  // ── Test 5: baseline version skew yields exit 2 ──────────────────────────
  it("baseline with wrong graph version exits 2", () => {
    const tmp = makeTmp();
    fs.mkdirSync(path.join(tmp, ".sutra"), { recursive: true });
    const skewed: SutraGraph = JSON.parse(
      fs.readFileSync(FIXTURE_BASELINE, "utf8"),
    ) as SutraGraph;
    skewed.version = 99; // force mismatch
    fs.writeFileSync(
      path.join(tmp, ".sutra/baseline.json"),
      JSON.stringify(skewed, null, 2),
    );
    const result = runScanCheck(FIXTURE, path.join(tmp, ".sutra/baseline.json"));
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/different graph version/);
  });

  // ── Test 6: committed baseline version matches GRAPH_VERSION ─────────────
  it("committed fixture baseline version equals current GRAPH_VERSION", () => {
    const baseline = JSON.parse(
      fs.readFileSync(FIXTURE_BASELINE, "utf8"),
    ) as SutraGraph;
    expect(baseline.version).toBe(GRAPH_VERSION);
  });

  // ── Test 7: self-scan of forge-sutra exits 0 on unchanged tree ───────────
  it("forge-sutra self-scan exits 0 on unchanged working tree", () => {
    const repoRoot = path.resolve(__dirname, "..");
    const baseline = path.resolve(repoRoot, ".sutra/baseline.json");
    // Skip if no committed baseline yet (CI pre-bootstrap)
    if (!fs.existsSync(baseline)) {
      console.log("skip: .sutra/baseline.json not found (run npm run sutra:baseline)");
      return;
    }
    const result = runScanCheck(repoRoot, baseline);
    expect(result.status).toBe(0);
  });
});
