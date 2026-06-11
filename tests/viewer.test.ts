/**
 * Story 3.1 — viewer app shell tests (HTTP only, no browser).
 */

import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { startViewerServer } from "../src/viewer/server.js";
import { renderView } from "../src/view.js";
import {
  GRAPH_VERSION,
  LINK_VERSION,
  SUTRA_DIR,
  GRAPH_FILE,
  type SutraGraph,
} from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, "fixtures/viewer");

let server: Awaited<ReturnType<typeof startViewerServer>> | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe("viewer — Section 10 app shell (Story 3.1)", () => {
  it("serves graph.json fresh with no-store", async () => {
    server = await startViewerServer(FIXTURE_DIR, { port: 0 });
    const res = await fetch(`${server.url}graph.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const graph = (await res.json()) as SutraGraph;
    expect(graph.version).toBe(GRAPH_VERSION);
    expect(graph.repo).toBe("viewer-fixture");
  });

  it("reads graph from disk per request (no-rebuild refresh proof)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-viewer-"));
    const sutraDir = path.join(tmp, SUTRA_DIR);
    fs.mkdirSync(sutraDir, { recursive: true });

    const graphA: SutraGraph = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, SUTRA_DIR, GRAPH_FILE), "utf8"),
    ) as SutraGraph;
    const graphB = { ...graphA, nodes: [...graphA.nodes, graphA.nodes[0]!] };

    fs.writeFileSync(path.join(sutraDir, GRAPH_FILE), JSON.stringify(graphA), "utf8");
    server = await startViewerServer(tmp, { port: 0 });

    const resA = await fetch(`${server.url}graph.json`);
    const bodyA = (await resA.json()) as SutraGraph;
    expect(bodyA.nodes.length).toBe(graphA.nodes.length);

    fs.writeFileSync(path.join(sutraDir, GRAPH_FILE), JSON.stringify(graphB), "utf8");
    const resB = await fetch(`${server.url}graph.json`);
    const bodyB = (await resB.json()) as SutraGraph;
    expect(bodyB.nodes.length).toBe(graphB.nodes.length);
    expect(bodyB.nodes.length).toBeGreaterThan(bodyA.nodes.length);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("serves SPA shell with heuristic disclaimer", async () => {
    server = await startViewerServer(FIXTURE_DIR, { port: 0 });
    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('id="feature-grid"');
    expect(html).toContain("Heuristic");
    expect(html).toContain("candidate");
    expect(html).toContain("/vendor/cytoscape.min.js");
    expect(html).toContain(String(LINK_VERSION));
  });

  it("serves vendored cytoscape bundle", async () => {
    server = await startViewerServer(FIXTURE_DIR, { port: 0 });
    const res = await fetch(`${server.url}vendor/cytoscape.min.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    const body = await res.text();
    expect(body.length).toBeGreaterThan(1000);
    expect(body).toContain("cytoscape");
  });

  it("returns 404 JSON when graph.json missing", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-viewer-empty-"));
    server = await startViewerServer(tmp, { port: 0 });
    const res = await fetch(`${server.url}graph.json`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("scan");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("binds to 127.0.0.1 only", async () => {
    server = await startViewerServer(FIXTURE_DIR, { port: 0 });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it("rejects path traversal for static assets", async () => {
    server = await startViewerServer(FIXTURE_DIR, { port: 0 });
    const res = await fetch(`${server.url}../package.json`);
    expect(res.status).toBe(404);
  });

  it("renderView output unchanged after render-shared refactor", () => {
    const graph = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, SUTRA_DIR, GRAPH_FILE), "utf8"),
    ) as SutraGraph;
    const html = renderView(graph);
    expect(html).toContain("Heuristic grouping");
    expect(html).toContain("feature-grid");
    expect(html).toContain(graph.repo);
  });
});

describe("viewer — Story 8.6 empty-state routes", () => {
  it("GET /favicon.ico returns 204 (AC5 — no browser console error)", async () => {
    server = await startViewerServer(FIXTURE_DIR, { port: 0 });
    const res = await fetch(`${server.url}favicon.ico`);
    expect(res.status).toBe(204);
  });

  it("GET /events without SSE enabled returns 204 (AC4 — no red console error)", async () => {
    // viewer mode (no sse option) must not 404 /events
    server = await startViewerServer(FIXTURE_DIR, { port: 0 });
    const res = await fetch(`${server.url}events`);
    expect(res.status).toBe(204);
  });

  it("GET /events with SSE enabled returns 200 text/event-stream", async () => {
    server = await startViewerServer(FIXTURE_DIR, { port: 0, sse: true });
    const ctrl = new AbortController();
    const res = await fetch(`${server.url}events`, { signal: ctrl.signal }).catch(() => null);
    if (res) {
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
    }
    ctrl.abort();
  });

  it("GET /link.json absent on disk returns 200 with empty stub (AC1)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-viewer-nolink-"));
    fs.mkdirSync(path.join(tmp, ".sutra"), { recursive: true });
    // write graph.json but no link.json
    const baseGraph = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, ".sutra", "graph.json"), "utf8"),
    ) as SutraGraph;
    fs.writeFileSync(path.join(tmp, ".sutra", "graph.json"), JSON.stringify(baseGraph));
    server = await startViewerServer(tmp, { port: 0 });
    const res = await fetch(`${server.url}link.json`);
    expect(res.status).toBe(200);
    const link = await res.json() as { repos: unknown[]; edges: unknown[] };
    expect(Array.isArray(link.repos)).toBe(true);
    expect(Array.isArray(link.edges)).toBe(true);
    expect(link.edges).toHaveLength(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
