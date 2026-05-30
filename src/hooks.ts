/**
 * SUTRA-16.1/16.2 — hooks config loader + runner.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { SutraIssue } from "./types.js";

export const HOOKS_FILE = "hooks.json";

export interface HooksConfig {
  post_scan?: string[];
}

export function loadHooksConfig(repoRoot: string): HooksConfig {
  const hooksPath = path.join(repoRoot, ".sutra", HOOKS_FILE);
  if (!fs.existsSync(hooksPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(hooksPath, "utf8")) as HooksConfig;
  } catch {
    return {};
  }
}

export function runPostScanHooks(
  repoRoot: string,
  graphPath: string,
): SutraIssue[] {
  const config = loadHooksConfig(repoRoot);
  const hooks = config.post_scan ?? [];
  const issues: SutraIssue[] = [];

  for (const hook of hooks) {
    const hookPath = path.resolve(repoRoot, hook);
    if (!fs.existsSync(hookPath)) {
      issues.push({
        severity: "warn",
        kind: "hook_failure",
        node: hook,
        feature: "hooks",
        message: `Post-scan hook not found: ${hook}`,
      });
      continue;
    }
    try {
      execSync(`node "${hookPath}" "${graphPath}"`, {
        cwd: repoRoot,
        stdio: "pipe",
        timeout: 30_000,
      });
    } catch (err) {
      issues.push({
        severity: "warn",
        kind: "hook_failure",
        node: hook,
        feature: "hooks",
        message: `Post-scan hook failed: ${hook} — ${String(err)}`,
      });
    }
  }

  return issues;
}
