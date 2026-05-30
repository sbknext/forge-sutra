/**
 * Phase 6 hooks tests.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadHooksConfig, runPostScanHooks } from "../src/hooks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("hooks (Phase 6)", () => {
  it("loadHooksConfig returns empty when no hooks.json", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-hooks-"));
    expect(loadHooksConfig(tmp)).toEqual({});
  });

  it("loadHooksConfig parses post_scan hooks", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-hooks-"));
    const sutraDir = path.join(tmp, ".sutra");
    fs.mkdirSync(sutraDir);
    fs.writeFileSync(
      path.join(sutraDir, "hooks.json"),
      JSON.stringify({ post_scan: ["./scripts/check.js"] }),
    );
    const config = loadHooksConfig(tmp);
    expect(config.post_scan).toEqual(["./scripts/check.js"]);
  });

  it("runPostScanHooks warns on missing hook file", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-hooks-"));
    fs.mkdirSync(path.join(tmp, ".sutra"));
    fs.writeFileSync(
      path.join(tmp, ".sutra", "hooks.json"),
      JSON.stringify({ post_scan: ["./missing-hook.js"] }),
    );
    const graphPath = path.join(tmp, ".sutra", "graph.json");
    fs.writeFileSync(graphPath, "{}");
    const issues = runPostScanHooks(tmp, graphPath);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe("hook_failure");
  });

  it("runPostScanHooks runs successful hook", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-hooks-"));
    fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "scripts", "ok.js"),
      'console.log("ok"); process.exit(0);',
    );
    fs.mkdirSync(path.join(tmp, ".sutra"));
    fs.writeFileSync(
      path.join(tmp, ".sutra", "hooks.json"),
      JSON.stringify({ post_scan: ["./scripts/ok.js"] }),
    );
    const graphPath = path.join(tmp, ".sutra", "graph.json");
    fs.writeFileSync(graphPath, "{}");
    const issues = runPostScanHooks(tmp, graphPath);
    expect(issues).toHaveLength(0);
  });
});
