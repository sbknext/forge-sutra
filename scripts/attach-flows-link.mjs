#!/usr/bin/env node
/**
 * Post-merge helper: attach flows[] and write link.json for a graph.json path.
 * Usage: node attach-flows-link.mjs <graph.json> [artifactDir]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFlows } from "../dist/flows.js";
import { emptyLinkResult, writeLinkFile } from "../dist/link.js";

const graphPath = path.resolve(process.argv[2] ?? "");
const artifactDir = path.resolve(process.argv[3] ?? path.dirname(path.dirname(graphPath)));

if (!graphPath || !fs.existsSync(graphPath)) {
  console.error("Usage: node attach-flows-link.mjs <graph.json> [artifactDir]");
  process.exit(2);
}

const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
const { flows, confirmed, candidate } = buildFlows(graph.nodes, graph.edges);
graph.flows = flows;
fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2), "utf8");

writeLinkFile(
  artifactDir,
  emptyLinkResult(graph.repo ?? "merged", artifactDir, graph.commit),
  { onlyIfAbsent: true },
);

console.log(
  `  flows: ${flows.length} traced (${confirmed} confirmed, ${candidate} candidate)`,
);
console.log(`  wrote flows → ${graphPath}`);
console.log(`  link.json → ${path.join(artifactDir, ".sutra", "link.json")}`);
