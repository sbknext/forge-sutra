/**
 * Graph schema migration — structure only, does not re-scan.
 */

import fs from "node:fs";
import path from "node:path";
import { GRAPH_VERSION, type SutraGraph } from "./types.js";

export const SUPPORTED_MIGRATIONS: Array<{ from: number; to: number }> = [
  { from: 0, to: 1 },
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
