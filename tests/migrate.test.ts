/**
 * SUTRA-8.1 — graph.json schema migration tests.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { migrateGraph, migrateFile } from "../src/migrate.js";
import { GRAPH_VERSION } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const V0_FIXTURE = path.resolve(__dirname, "fixtures/migrate/graph-v0.json");

describe("migrateGraph (SUTRA-8.1)", () => {
  it("v0 → v1 adds contracts: [] and bumps version", () => {
    const raw = JSON.parse(fs.readFileSync(V0_FIXTURE, "utf8")) as Record<string, unknown>;
    expect(raw.version).toBe(0);
    expect(raw.contracts).toBeUndefined();

    const graph = migrateGraph(raw);
    expect(graph.version).toBe(1);
    expect(graph.contracts).toEqual([]);
    expect(graph.nodes.length).toBe(1);
    expect(graph.features.length).toBe(1);
  });

  it("already current version is no-op", () => {
    const v0 = JSON.parse(fs.readFileSync(V0_FIXTURE, "utf8")) as Record<string, unknown>;
    const v1 = migrateGraph(v0);
    const again = migrateGraph(v1 as unknown as Record<string, unknown>);
    expect(again.version).toBe(GRAPH_VERSION);
  });

  it("unknown future version throws", () => {
    const raw = { version: 99, nodes: [], edges: [], issues: [], features: [], contracts: [] };
    expect(() => migrateGraph(raw)).toThrow(/newer than supported/);
  });

  it("migrateFile writes migrated graph to disk", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-migrate-"));
    const dest = path.join(tmp, "graph.json");
    fs.copyFileSync(V0_FIXTURE, dest);

    const result = migrateFile(dest);
    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(1);

    const written = JSON.parse(fs.readFileSync(dest, "utf8"));
    expect(written.version).toBe(1);
    expect(written.contracts).toEqual([]);
  });

  it("migrateFile no-op on current version", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-migrate-"));
    const dest = path.join(tmp, "graph.json");
    const v0 = JSON.parse(fs.readFileSync(V0_FIXTURE, "utf8"));
    const v1 = migrateGraph(v0);
    fs.writeFileSync(dest, JSON.stringify(v1, null, 2));

    const result = migrateFile(dest);
    expect(result.migrated).toBe(false);
    expect(result.fromVersion).toBe(GRAPH_VERSION);
  });
});
