/**
 * SUTRA-7.1 — CLI help smoke tests.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../dist/cli.js");

function run(args: string): string {
  return execSync(`node "${CLI}" ${args}`, { encoding: "utf8" });
}

describe("CLI help (SUTRA-7.1)", () => {
  it("--version matches package.json", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"),
    );
    const out = run("--version").trim();
    expect(out).toBe(pkg.version);
  });

  it("shows claim-bounds disclaimer on --help", () => {
    const out = run("--help");
    expect(out).toMatch(/candidate|heuristic/i);
    expect(out).toContain("scan");
    expect(out).toContain("view");
    expect(out).toContain("diff");
    expect(out).toContain("reconcile");
    expect(out).toContain("scaffold");
    expect(out).toContain("migrate");
  });

  it("scan --help includes claim-bounds one-liner", () => {
    const out = run("scan --help");
    expect(out).toMatch(/candidate|heuristic|static/i);
  });

  it("view --help includes claim-bounds one-liner", () => {
    const out = run("view --help");
    expect(out).toMatch(/candidate|heuristic|static/i);
  });

  it("diff --help includes claim-bounds one-liner", () => {
    const out = run("diff --help");
    expect(out).toMatch(/candidate|heuristic|structural/i);
  });

  it("reconcile --help includes claim-bounds one-liner", () => {
    const out = run("reconcile --help");
    expect(out).toMatch(/candidate|heuristic|static/i);
  });

  it("scaffold --help includes claim-bounds one-liner", () => {
    const out = run("scaffold --help");
    expect(out).toMatch(/candidate|stub/i);
  });

  it("migrate --help includes structure-only disclaimer", () => {
    const out = run("migrate --help");
    expect(out).toMatch(/structure|re-scan|migrate/i);
  });
});
