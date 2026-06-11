#!/usr/bin/env node
/**
 * Post-merge helper: attach flows[] and write link.json for a graph.json path.
 * Story 8.5: delegates entirely to attachFlowsAndLink() in src/link.ts (no duplicated logic).
 * Usage: node attach-flows-link.mjs GRAPH_PATH [artifactDir]
 */
import fs from "node:fs";
import path from "node:path";
import { attachFlowsAndLink } from "../dist/link.js";

const graphPath = path.resolve(process.argv[2] ?? "");
const artifactDir = path.resolve(process.argv[3] ?? path.dirname(path.dirname(graphPath)));

if (!graphPath || !fs.existsSync(graphPath)) {
  console.error("Usage: node attach-flows-link.mjs GRAPH_PATH [artifactDir]");
  process.exit(2);
}

const { flowsCount, confirmed, candidate, linkPath, multiApp } = attachFlowsAndLink(
  graphPath,
  artifactDir,
  { onlyIfAbsent: true },
);

console.log(
  `  flows: ${flowsCount} traced (${confirmed} confirmed, ${candidate} candidate)`,
);
console.log(`  wrote flows → ${graphPath}`);
console.log(`  link.json [${multiApp ? "multi-app" : "single-app"}] → ${linkPath}`);
