/**
 * Story 3.5 / 1.5.1 — live watch mode tests (SSE + chokidar, no browser).
 */

import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { runWatch, WATCH_DEBOUNCE_MS, graphBodyForCompare, computeChangedFeatureIds } from "../src/watch-viewer.js";
import { runScanPipeline } from "../src/watch.js";
import { GRAPH_VERSION, SUTRA_DIR, type SutraGraph } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WATCH_REPO = path.resolve(__dirname, "fixtures/watch-repo");

function copyFixture(): { tmp: string; repoRoot: string; outCwd: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-watch-live-"));
  const repoRoot = path.join(tmp, "repo");
  const outCwd = path.join(tmp, "out");
  fs.cpSync(WATCH_REPO, repoRoot, { recursive: true });
  fs.mkdirSync(outCwd, { recursive: true });
  return { tmp, repoRoot, outCwd };
}

function writeFile(dir: string, rel: string, content: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function readSseEvents(
  baseUrl: string,
  timeoutMs: number,
): Promise<Array<{ event: string; data: string }>> {
  return new Promise((resolve, reject) => {
    const events: Array<{ event: string; data: string }> = [];
    const url = new URL("events", baseUrl);

    const req = http.get(url, (res) => {
      let buffer = "";
      const timer = setTimeout(() => {
        req.destroy();
        resolve(events);
      }, timeoutMs);

      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          if (!block.trim() || block.startsWith(":")) continue;
          const lines = block.split("\n");
          let eventName = "message";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventName = line.slice(7);
            if (line.startsWith("data: ")) data = line.slice(6);
          }
          if (data) events.push({ event: eventName, data });
        }
      });

      res.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    req.on("error", reject);
  });
}

let handle: Awaited<ReturnType<typeof runWatch>> | null = null;
let tmpDir: string | null = null;

afterEach(async () => {
  if (handle) {
    await handle.close();
    handle = null;
  }
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe("sutra watch — startup (Story 3.5)", () => {
  it("binds 127.0.0.1 and serves valid graph.json", async () => {
    const { tmp, repoRoot, outCwd } = copyFixture();
    tmpDir = tmp;
    handle = await runWatch(repoRoot, outCwd, { port: 0 });
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    const res = await fetch(`${handle.url}graph.json`);
    const graph = (await res.json()) as SutraGraph;
    expect(graph.version).toBe(GRAPH_VERSION);
    expect(graph.nodes.length).toBeGreaterThan(0);
  });
});

describe("sutra watch — live update (Story 3.5)", () => {
  it(
    "pushes graph event after file edit",
    async () => {
      const { tmp, repoRoot, outCwd } = copyFixture();
      tmpDir = tmp;
      handle = await runWatch(repoRoot, outCwd, { port: 0, debounceMs: 150 });

      const ssePromise = readSseEvents(handle.url, 5000);

      await new Promise((r) => setTimeout(r, 400));
      writeFile(
        repoRoot,
        "lib/extra.ts",
        "export function extraFn() { return 42; }\n",
      );

      const events = await ssePromise;
      const graphEvents = events.filter((e) => e.event === "graph");
      expect(graphEvents.length).toBeGreaterThanOrEqual(1);

      const pushed = JSON.parse(graphEvents[graphEvents.length - 1]!.data) as SutraGraph;
      expect(pushed.version).toBe(GRAPH_VERSION);
      expect(pushed.nodes.some((n) => n.file.includes("extra.ts"))).toBe(true);

      const diskGraph = JSON.parse(
        fs.readFileSync(path.join(outCwd, SUTRA_DIR, "graph.json"), "utf8"),
      ) as SutraGraph;
      expect(diskGraph.nodes.some((n) => n.file.includes("extra.ts"))).toBe(true);
    },
    15000,
  );
});

describe("sutra watch — debounce (Story 3.5)", () => {
  it(
    "coalesces rapid writes into one graph push",
    async () => {
      const { tmp, repoRoot, outCwd } = copyFixture();
      tmpDir = tmp;
      handle = await runWatch(repoRoot, outCwd, {
        port: 0,
        debounceMs: WATCH_DEBOUNCE_MS,
      });

      const target = path.join(repoRoot, "lib/rapid.ts");
      const ssePromise = readSseEvents(handle.url, 4000);
      await new Promise((r) => setTimeout(r, 300));

      fs.writeFileSync(target, "export const a = 1;\n", "utf8");
      fs.unlinkSync(target);
      fs.writeFileSync(target, "export const b = 2;\n", "utf8");

      const events = await ssePromise;
      const graphEvents = events.filter((e) => e.event === "graph");
      const rapidPushes = graphEvents.filter((e) => {
        const g = JSON.parse(e.data) as SutraGraph;
        return g.nodes.some((n) => n.file.includes("rapid.ts"));
      });
      expect(rapidPushes.length).toBeLessThanOrEqual(2);
    },
    12000,
  );
});

describe("sutra watch — determinism parity (Story 3.5)", () => {
  it("pushed graph matches scan pipeline modulo scanned_at", async () => {
    const { tmp, repoRoot, outCwd } = copyFixture();
    tmpDir = tmp;
    const pipeline = runScanPipeline(repoRoot, outCwd, "unknown");
    handle = await runWatch(repoRoot, outCwd, { port: 0 });

    const res = await fetch(`${handle.url}graph.json`);
    const served = (await res.json()) as SutraGraph;

    expect(graphBodyForCompare(served)).toEqual(graphBodyForCompare(pipeline.graph));
  });
});

// ── Story 1.5.1 — changedFeatureIds delta (new tests) ─────────────────────────

describe("computeChangedFeatureIds (Story 1.5.1)", () => {
  function makeGraph(features: SutraGraph["features"]): SutraGraph {
    return {
      version: GRAPH_VERSION,
      repo: "test",
      scanned_at: new Date().toISOString(),
      commit: "abc",
      nodes: [],
      edges: [],
      issues: [],
      features,
      contracts: [],
      flows: [],
    };
  }

  it("returns empty array when nothing changed", () => {
    const feat = {
      id: "f1",
      label: "F1",
      node_ids: ["n1", "n2"],
      issue_count: 0,
      health: { score: 1.0, band: "green" as const },
      tested: true,
    };
    const prev = makeGraph([feat]);
    const next = makeGraph([{ ...feat }]);
    expect(computeChangedFeatureIds(prev, next)).toEqual([]);
  });

  it("detects new feature", () => {
    const prev = makeGraph([]);
    const next = makeGraph([
      { id: "f1", label: "F1", node_ids: ["n1"], issue_count: 0, health: undefined, tested: false },
    ]);
    const changed = computeChangedFeatureIds(prev, next);
    expect(changed).toContain("f1");
  });

  it("detects node_ids change", () => {
    const base = { id: "f1", label: "F1", node_ids: ["n1"], issue_count: 0, health: undefined, tested: false };
    const prev = makeGraph([base]);
    const next = makeGraph([{ ...base, node_ids: ["n1", "n2"] }]);
    expect(computeChangedFeatureIds(prev, next)).toContain("f1");
  });

  it("detects issue_count change", () => {
    const base = { id: "f1", label: "F1", node_ids: ["n1"], issue_count: 0, health: undefined, tested: false };
    const prev = makeGraph([base]);
    const next = makeGraph([{ ...base, issue_count: 2 }]);
    expect(computeChangedFeatureIds(prev, next)).toContain("f1");
  });

  it("detects health score change", () => {
    const base = {
      id: "f1", label: "F1", node_ids: ["n1"], issue_count: 0,
      health: { score: 1.0, band: "green" as const }, tested: true,
    };
    const prev = makeGraph([base]);
    const next = makeGraph([{ ...base, health: { score: 0.5, band: "amber" as const } }]);
    expect(computeChangedFeatureIds(prev, next)).toContain("f1");
  });

  it("unchanged features not in result", () => {
    const f1 = { id: "f1", label: "F1", node_ids: ["n1"], issue_count: 0, health: undefined, tested: false };
    const f2 = { id: "f2", label: "F2", node_ids: ["n2"], issue_count: 1, health: undefined, tested: false };
    const prev = makeGraph([f1, f2]);
    const next = makeGraph([f1, { ...f2, issue_count: 2 }]);
    const changed = computeChangedFeatureIds(prev, next);
    expect(changed).not.toContain("f1");
    expect(changed).toContain("f2");
  });
});

describe("WATCH_DEBOUNCE_MS default (Story 1.5.1)", () => {
  it("default debounce is 500 ms per AC", () => {
    expect(WATCH_DEBOUNCE_MS).toBe(500);
  });
});

describe("sutra watch — SSE retry preamble (Story 1.5.1)", () => {
  it("SSE /events response includes retry: line", async () => {
    const { tmp, repoRoot, outCwd } = copyFixture();
    tmpDir = tmp;
    handle = await runWatch(repoRoot, outCwd, { port: 0 });

    const sseChunks = await new Promise<string>((resolve, reject) => {
      const url = new URL("events", handle!.url);
      const req = http.get(url, (res) => {
        let buf = "";
        const t = setTimeout(() => { req.destroy(); resolve(buf); }, 800);
        res.on("data", (c: Buffer) => { buf += c.toString(); });
        res.on("error", (err) => { clearTimeout(t); reject(err); });
      });
      req.on("error", reject);
    });

    expect(sseChunks).toMatch(/retry:\s*\d+/);
  }, 5000);
});

describe("sutra watch — changedFeatureIds in SSE payload (Story 1.5.1)", () => {
  it(
    "initial push has changedFeatureIds array",
    async () => {
      const { tmp, repoRoot, outCwd } = copyFixture();
      tmpDir = tmp;
      handle = await runWatch(repoRoot, outCwd, { port: 0, debounceMs: 150 });

      const ssePromise = new Promise<Array<{ event: string; data: string }>>((resolve, reject) => {
        const events: Array<{ event: string; data: string }> = [];
        const url = new URL("events", handle!.url);
        const req = http.get(url, (res) => {
          let buf = "";
          const t = setTimeout(() => { req.destroy(); resolve(events); }, 3000);
          res.on("data", (c: Buffer) => {
            buf += c.toString();
            const blocks = buf.split("\n\n");
            buf = blocks.pop() ?? "";
            for (const block of blocks) {
              if (!block.trim() || block.startsWith(":")) continue;
              const lines = block.split("\n");
              let ev = "message"; let data = "";
              for (const l of lines) {
                if (l.startsWith("event: ")) ev = l.slice(7);
                if (l.startsWith("data: ")) data = l.slice(6);
              }
              if (data) events.push({ event: ev, data });
            }
          });
          res.on("error", (err) => { clearTimeout(t); reject(err); });
        });
        req.on("error", reject);
      });

      // trigger a rescan
      await new Promise((r) => setTimeout(r, 400));
      fs.writeFileSync(path.join(repoRoot, "lib/delta-test.ts"), "export const x = 1;\n", "utf8");

      const events = await ssePromise;
      const graphEvents = events.filter((e) => e.event === "graph");
      expect(graphEvents.length).toBeGreaterThanOrEqual(1);

      const payload = JSON.parse(graphEvents[graphEvents.length - 1]!.data) as SutraGraph & { changedFeatureIds: string[] };
      expect(Array.isArray(payload.changedFeatureIds)).toBe(true);
    },
    15000,
  );
});
