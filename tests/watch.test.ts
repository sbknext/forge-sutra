/**
 * SUTRA-5.1 — watch mode tests (programmatic rescan, no CI watch loop).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { runScanPipeline } from "../src/watch.js";

function writeFile(dir: string, rel: string, content: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

describe("runScanPipeline — watch rescan (SUTRA-5.1)", () => {
  let tmpDir: string;
  let repoRoot: string;
  let outCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-watch-"));
    repoRoot = path.join(tmpDir, "repo");
    outCwd = path.join(tmpDir, "out");
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(outCwd, { recursive: true });

    writeFile(
      repoRoot,
      "lib/a.ts",
      `export function foo() { return 1; }\n`,
    );
    writeFile(
      repoRoot,
      "lib/b.ts",
      `import { foo } from "./a.js";\nexport function bar() { return foo(); }\n`,
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("initial scan writes graph.json", () => {
    const result = runScanPipeline(repoRoot, outCwd, "abc123");
    expect(fs.existsSync(result.graphPath)).toBe(true);
    expect(result.graph.nodes.length).toBeGreaterThan(0);
    expect(result.diffSummary).toBeUndefined();
  });

  it("rescan after adding file increases node count and writes diff", () => {
    const first = runScanPipeline(repoRoot, outCwd, "abc123");
    const firstCount = first.graph.nodes.length;

    writeFile(
      repoRoot,
      "lib/c.ts",
      `export function baz() { return 3; }\n`,
    );

    const second = runScanPipeline(repoRoot, outCwd, "abc123");
    expect(second.graph.nodes.length).toBeGreaterThan(firstCount);
    expect(second.diffSummary).toBeDefined();
    expect(second.diffSummary).toMatch(/\+/);

    const diffPath = path.join(outCwd, ".sutra", "diff.json");
    const prevPath = path.join(outCwd, ".sutra", "graph.prev.json");
    expect(fs.existsSync(diffPath)).toBe(true);
    expect(fs.existsSync(prevPath)).toBe(true);
  });
});

describe("startWatch — SIGINT cleanup", () => {
  it("cleanup function closes watchers without error", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-watch-cleanup-"));
    const repoRoot = path.join(tmpDir, "repo");
    fs.mkdirSync(repoRoot, { recursive: true });
    writeFile(repoRoot, "index.ts", "export const x = 1;\n");

    const { startWatch } = await import("../src/watch.js");
    const stop = startWatch({
      repoRoot,
      cwd: tmpDir,
      commit: "test",
      debounceMs: 50,
    });
    stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});
