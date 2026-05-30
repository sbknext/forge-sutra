#!/usr/bin/env bash
# SUTRA-14.2 — regression guard for key fixtures.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build >/dev/null

node --input-type=module <<'EOF'
import { scan } from "./dist/scanner.js";
import { runChecks } from "./dist/checks.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(root, "tests/fixtures");

function assert(name, fn) {
  fn();
  console.log(`  ✓ ${name}`);
}

assert("broken → orphaned_endpoint", () => {
  const { nodes, edges } = scan(path.join(fixtures, "broken"));
  const issues = runChecks(nodes, edges);
  const orphan = issues.find((i) => i.kind === "orphaned_endpoint" && i.node.includes("POST /api/capture"));
  if (!orphan) throw new Error("expected POST /api/capture orphaned_endpoint");
});

assert("proxied → zero orphaned_endpoint", () => {
  const { nodes, edges } = scan(path.join(fixtures, "proxied"));
  const issues = runChecks(nodes, edges).filter((i) => i.kind === "orphaned_endpoint");
  if (issues.length !== 0) throw new Error(`expected 0 orphans, got ${issues.length}`);
});

assert("assets → zero asset missing_handler", () => {
  const { nodes, edges } = scan(path.join(fixtures, "assets"));
  const issues = runChecks(nodes, edges).filter((i) => i.kind === "missing_handler");
  if (issues.length !== 0) throw new Error(`expected 0 missing_handler, got ${issues.length}`);
});

assert("clean → zero issues", () => {
  const { nodes, edges } = scan(path.join(fixtures, "clean"));
  const issues = runChecks(nodes, edges);
  if (issues.length !== 0) throw new Error(`expected 0 issues, got ${issues.length}`);
});

console.log("\nRegression guard: all fixtures passed.");
EOF
