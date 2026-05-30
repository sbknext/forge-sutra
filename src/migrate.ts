/**
 * Graph schema migration — structure only, does not re-scan.
 */

import fs from "node:fs";
import path from "node:path";
import { GRAPH_VERSION, type SutraGraph } from "./types.js";
import { buildFeatures } from "./features.js";

export const SUPPORTED_MIGRATIONS: Array<{ from: number; to: number }> = [
  { from: 0, to: 1 },
  { from: 1, to: 2 },
  { from: 2, to: 3 },
];

/** Migrate a graph object in-memory. Returns migrated graph. */
export function migrateGraph(raw: Record<string, unknown>): SutraGraph {
  let version = typeof raw.version === "number" ? raw.version : 0;

  if (version > GRAPH_VERSION) {
    throw new Error(
      `Graph version ${version} is newer than supported (${GRAPH_VERSION}). Upgrade Sutra.`,
    );
  }

  if (version === GRAPH_VERSION) {
    return raw as unknown as SutraGraph;
  }

  // v0 → v1: add contracts: [] if missing
  if (version === 0) {
    if (!Array.isArray(raw.contracts)) {
      raw.contracts = [];
    }
    raw.version = 1;
    version = 1;
  }

  // v1 → v2: confidence/provenance are optional on nodes/edges/issues — structure unchanged
  if (version === 1) {
    raw.version = 2;
    version = 2;
  }

  // v2 → v3: required health on each feature
  if (version === 2) {
    const g = raw as unknown as SutraGraph;
    const nodes = Array.isArray(g.nodes) ? g.nodes : [];
    const edges = Array.isArray(g.edges) ? g.edges : [];
    const issueList = Array.isArray(g.issues) ? g.issues : [];
    const contracts = Array.isArray(g.contracts) ? g.contracts : [];
    raw.features = buildFeatures(nodes, issueList, edges, { contracts });
    raw.version = 3;
    version = 3;
  }

  if (version !== GRAPH_VERSION) {
    const supported = SUPPORTED_MIGRATIONS.map((m) => `${m.from}→${m.to}`).join(", ");
    throw new Error(
      `Unsupported graph version ${version}. Supported migrations: ${supported}, current: ${GRAPH_VERSION}.`,
    );
  }

  return raw as unknown as SutraGraph;
}

export interface MigrateResult {
  migrated: boolean;
  fromVersion: number;
  toVersion: number;
  graph: SutraGraph;
}

/** Read, migrate if needed, and optionally write back. */
export function migrateFile(filePath: string, write = true): MigrateResult {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(abs, "utf8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Could not parse ${abs}: ${String(err)}`);
  }

  const fromVersion = typeof raw.version === "number" ? raw.version : 0;

  if (fromVersion === GRAPH_VERSION) {
    return {
      migrated: false,
      fromVersion,
      toVersion: GRAPH_VERSION,
      graph: raw as unknown as SutraGraph,
    };
  }

  const graph = migrateGraph(raw);

  if (write) {
    fs.writeFileSync(abs, JSON.stringify(graph, null, 2), "utf8");
  }

  return {
    migrated: true,
    fromVersion,
    toVersion: graph.version,
    graph,
  };
}
