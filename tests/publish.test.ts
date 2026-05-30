/**
 * SUTRA-12.1 — npm publish prep dry-run tests.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

describe("npm publish prep (SUTRA-12.1)", () => {
  it("package.json has publish metadata", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.version).toBe("0.1.0");
    expect(pkg.files).toEqual(["dist", "README.md", "LICENSE"]);
    expect(pkg.scripts.prepublishOnly).toContain("build");
    expect(pkg.scripts.prepublishOnly).toContain("test");
    expect(pkg.bin["forge-sutra"]).toBe("./dist/cli.js");
  });

  it("npm pack --dry-run lists only intended files (no tests/fixtures)", () => {
    const out = execSync("npm pack --dry-run 2>&1", {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(out).toContain("dist/");
    expect(out).toContain("README.md");
    expect(out).toContain("LICENSE");
    expect(out).not.toContain("tests/fixtures");
    expect(out).not.toContain("tests/sutra.test");
  });
});
