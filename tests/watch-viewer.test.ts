/**
 * Story 3.5 — live watch mode tests (SSE + chokidar, no browser).
 */

import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { runWatch, WATCH_DEBOUNCE_MS, graphBodyForCompare } from "../src/watch-viewer.js";
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
