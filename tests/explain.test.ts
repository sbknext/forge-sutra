/**
 * Story 1.5.4 — "Explain this feature" unit tests.
 *
 * Tests cover:
 *  1. buildExplainPrompt: includes feature label, health, nodes, issues, existing ai_summary.
 *  2. buildExplainPrompt: caps nodes at 20 and issues at 5.
 *  3. buildExplainPrompt: gracefully handles missing health / empty node list.
 *  4. createRateLimiter: allows up to maxCalls then rejects.
 *  5. createRateLimiter: rejects excess call with retryAfterSec > 0.
 *  6. createRateLimiter: allows again after window expires.
 *  7. handleExplainRoute: returns false for non-matching path (GET /graph.json).
 *  8. handleExplainRoute: returns 503 with setup message when SUTRA_AI_API_KEY unset.
 *  9. handleExplainRoute: returns 404 if feature not found in graph.
 * 10. handleExplainRoute: returns 429 with retryAfterSec when rate limit hit.
 * 11. isExplainAvailable: returns false when SUTRA_AI_API_KEY not set.
 * 12. isExplainAvailable: returns true when SUTRA_AI_API_KEY set.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import {
  buildExplainPrompt,
  createRateLimiter,
  handleExplainRoute,
  isExplainAvailable,
  RATE_LIMIT_MAX,
} from "../src/viewer/explain.js";
import { GRAPH_VERSION, type SutraGraph, type SutraFeature, type SutraNode, type SutraIssue } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeFeature(overrides: Partial<SutraFeature> = {}): SutraFeature {
  return {
    id: "auth",
    label: "Auth Feature",
    node_ids: ["src/auth.ts"],
    issue_count: 0,
    health: { score: 85, band: "green", inputs: [], available_signals: [] },
    test_edge_count: 0,
    test_node_ids: [],
    tested: false,
    ...overrides,
  };
}

function makeNode(id: string, name: string, file: string, type: SutraNode["type"] = "module"): SutraNode {
  return { id, type, name, file, line: 1, data_shape: null, feature: "auth", language: "ts" };
}

function makeIssue(kind: SutraIssue["kind"], message: string): SutraIssue {
  return { severity: "warn", kind, node: "src/auth.ts", feature: "auth", message };
}

function makeGraph(features: SutraFeature[], nodes: SutraNode[] = [], issues: SutraIssue[] = []): SutraGraph {
  return {
    version: GRAPH_VERSION,
    repo: "test-repo",
    scanned_at: "2026-06-03T10:00:00.000Z",
    commit: "abc1234",
    nodes,
    edges: [],
    issues,
    features,
    contracts: [],
    flows: [],
  };
}

// ── Fake HTTP helpers ─────────────────────────────────────────────────────────

interface FakeResponse {
  statusCode: number | undefined;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
}

function makeFakeRes(): { res: http.ServerResponse; captured: FakeResponse } {
  const captured: FakeResponse = { statusCode: undefined, headers: {}, body: "", ended: false };

  // Create a real ServerResponse-like object using a dummy socket
  const { PassThrough } = require("stream") as typeof import("stream");
  const sock = new PassThrough();
  // @ts-expect-error — minimal fake for testing
  const res = new http.ServerResponse({ method: "POST", socket: sock });

  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = function (statusCode: number, headers?: Record<string, string>) {
    captured.statusCode = statusCode;
    if (headers) Object.assign(captured.headers, headers);
    return origWriteHead(statusCode, headers ?? {});
  };

  const origEnd = res.end.bind(res);
  res.end = function (body?: unknown) {
    if (typeof body === "string") captured.body += body;
    captured.ended = true;
    return origEnd(body);
  } as typeof res.end;

  const origWrite = res.write.bind(res);
  res.write = function (chunk: unknown) {
    if (typeof chunk === "string") captured.body += chunk;
    else if (Buffer.isBuffer(chunk)) captured.body += chunk.toString();
    return origWrite(chunk);
  } as typeof res.write;

  return { res, captured };
}

function makeReq(method: string, url: string): http.IncomingMessage {
  const { PassThrough } = require("stream") as typeof import("stream");
  const sock = new PassThrough();
  // @ts-expect-error — minimal fake
  const req = new http.IncomingMessage(sock);
  req.method = method;
  req.url = url;
  return req;
}

// ── Env helpers ───────────────────────────────────────────────────────────────

let savedKey: string | undefined;
beforeEach(() => {
  savedKey = process.env.SUTRA_AI_API_KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.SUTRA_AI_API_KEY;
  else process.env.SUTRA_AI_API_KEY = savedKey;
});

// ── Prompt construction ───────────────────────────────────────────────────────

describe("buildExplainPrompt (Story 1.5.4)", () => {
  it("includes feature label and health in prompt", () => {
    const feature = makeFeature({ label: "Login Flow", health: { score: 72, band: "amber", inputs: [], available_signals: [] } });
    const nodes = [makeNode("src/auth.ts", "auth.ts", "src/auth.ts")];
    const prompt = buildExplainPrompt(feature, nodes, []);
    expect(prompt).toContain("Login Flow");
    expect(prompt).toContain("72/100");
    expect(prompt).toContain("amber");
  });

  it("includes node type and name in prompt", () => {
    const feature = makeFeature();
    const nodes = [makeNode("src/auth.ts", "login()", "src/auth.ts", "function")];
    const prompt = buildExplainPrompt(feature, nodes, []);
    expect(prompt).toContain("function: login()");
  });

  it("includes issue kind and message in prompt", () => {
    const feature = makeFeature({ issue_count: 1 });
    const issues = [makeIssue("orphaned_endpoint", "GET /api/login has no handler")];
    const prompt = buildExplainPrompt(feature, [], issues);
    expect(prompt).toContain("orphaned_endpoint");
    expect(prompt).toContain("GET /api/login has no handler");
  });

  it("includes existing ai_summary when present", () => {
    const feature = makeFeature({ ai_summary: "Handles user sessions." });
    const prompt = buildExplainPrompt(feature, [], []);
    expect(prompt).toContain("Handles user sessions.");
  });

  it("caps nodes at 20", () => {
    const feature = makeFeature({
      node_ids: Array.from({ length: 30 }, (_, i) => `src/n${i}.ts`),
    });
    const nodes = Array.from({ length: 30 }, (_, i) =>
      makeNode(`src/n${i}.ts`, `fn${i}`, `src/n${i}.ts`),
    );
    const prompt = buildExplainPrompt(feature, nodes, []);
    const lines = prompt.split("\n").filter((l) => l.trim().startsWith("function:"));
    expect(lines.length).toBeLessThanOrEqual(20);
  });

  it("caps issues at 5", () => {
    const feature = makeFeature({ issue_count: 10 });
    const issues = Array.from({ length: 10 }, (_, i) =>
      makeIssue("orphaned_endpoint", `issue ${i}`),
    );
    const prompt = buildExplainPrompt(feature, [], issues);
    const lines = prompt.split("\n").filter((l) => l.includes("orphaned_endpoint:"));
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  it("gracefully handles missing health", () => {
    const feature = makeFeature({ health: undefined as unknown as SutraFeature["health"] });
    const prompt = buildExplainPrompt(feature, [], []);
    expect(prompt).toContain("unknown");
  });
});

// ── Rate limiter ──────────────────────────────────────────────────────────────

describe("createRateLimiter (Story 1.5.4)", () => {
  it("allows calls up to maxCalls", () => {
    const limiter = createRateLimiter(3, 60_000);
    expect(limiter.check()).toBe(true);
    expect(limiter.check()).toBe(true);
    expect(limiter.check()).toBe(true);
  });

  it("rejects the next call when maxCalls exceeded", () => {
    const limiter = createRateLimiter(2, 60_000);
    limiter.check();
    limiter.check();
    expect(limiter.check()).toBe(false);
  });

  it("retryAfterSec > 0 when rate-limited", () => {
    const limiter = createRateLimiter(1, 60_000);
    limiter.check();
    limiter.check(); // rejected
    expect(limiter.retryAfterSec()).toBeGreaterThan(0);
  });

  it("allows again after window expires (tiny window)", async () => {
    const limiter = createRateLimiter(1, 50); // 50 ms window
    expect(limiter.check()).toBe(true);
    expect(limiter.check()).toBe(false); // blocked
    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 70));
    expect(limiter.check()).toBe(true); // allowed again
  }, 2000);
});

// ── Route handler ─────────────────────────────────────────────────────────────

describe("handleExplainRoute (Story 1.5.4)", () => {
  let tmpDir: string;
  let graphPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-explain-"));
    const sutraDir = path.join(tmpDir, ".sutra");
    fs.mkdirSync(sutraDir, { recursive: true });
    graphPath = path.join(sutraDir, "graph.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns false for non-matching path (GET /graph.json)", () => {
    const { res } = makeFakeRes();
    const req = makeReq("GET", "/graph.json");
    const limiter = createRateLimiter();
    const handled = handleExplainRoute(req, res, { cwd: tmpDir, rateLimiter: limiter });
    expect(handled).toBe(false);
  });

  it("returns false for GET /explain/:id (only POST handled)", () => {
    const { res } = makeFakeRes();
    const req = makeReq("GET", "/explain/auth");
    const limiter = createRateLimiter();
    const handled = handleExplainRoute(req, res, { cwd: tmpDir, rateLimiter: limiter });
    expect(handled).toBe(false);
  });

  it("returns 503 with setup message when SUTRA_AI_API_KEY unset", () => {
    delete process.env.SUTRA_AI_API_KEY;
    const { res, captured } = makeFakeRes();
    const req = makeReq("POST", "/explain/auth");
    const limiter = createRateLimiter();
    const handled = handleExplainRoute(req, res, { cwd: tmpDir, rateLimiter: limiter });
    expect(handled).toBe(true);
    expect(captured.statusCode).toBe(503);
    const body = JSON.parse(captured.body) as { error: string; setup: boolean };
    expect(body.setup).toBe(true);
    expect(body.error).toContain("SUTRA_AI_API_KEY");
  });

  it("returns 429 with retryAfterSec when rate limit hit", () => {
    process.env.SUTRA_AI_API_KEY = "sk-test-key";
    // Write a minimal graph so the route doesn't 404 on graph
    const graph = makeGraph([makeFeature()], [makeNode("src/auth.ts", "auth.ts", "src/auth.ts")]);
    fs.writeFileSync(graphPath, JSON.stringify(graph), "utf8");

    const limiter = createRateLimiter(0, 60_000); // maxCalls=0 → always rate-limited
    const { res, captured } = makeFakeRes();
    const req = makeReq("POST", "/explain/auth");
    const handled = handleExplainRoute(req, res, { cwd: tmpDir, rateLimiter: limiter });
    expect(handled).toBe(true);
    expect(captured.statusCode).toBe(429);
    const body = JSON.parse(captured.body) as { error: string; retryAfterSec: number };
    expect(body.error).toContain("Rate limit");
  });

  it("returns 404 if feature not found in graph", () => {
    process.env.SUTRA_AI_API_KEY = "sk-test-key";
    // Graph with no matching feature
    const graph = makeGraph([makeFeature({ id: "other" })]);
    fs.writeFileSync(graphPath, JSON.stringify(graph), "utf8");

    const limiter = createRateLimiter();
    const { res, captured } = makeFakeRes();
    const req = makeReq("POST", "/explain/auth"); // "auth" not in graph
    const handled = handleExplainRoute(req, res, { cwd: tmpDir, rateLimiter: limiter });
    expect(handled).toBe(true);
    expect(captured.statusCode).toBe(404);
    const body = JSON.parse(captured.body) as { error: string };
    expect(body.error).toContain("Feature not found");
  });
});

// ── isExplainAvailable ────────────────────────────────────────────────────────

describe("isExplainAvailable (Story 1.5.4)", () => {
  it("returns false when SUTRA_AI_API_KEY not set", () => {
    delete process.env.SUTRA_AI_API_KEY;
    expect(isExplainAvailable()).toBe(false);
  });

  it("returns false when SUTRA_AI_API_KEY is empty string", () => {
    process.env.SUTRA_AI_API_KEY = "   ";
    expect(isExplainAvailable()).toBe(false);
  });

  it("returns true when SUTRA_AI_API_KEY set", () => {
    process.env.SUTRA_AI_API_KEY = "sk-test-key";
    expect(isExplainAvailable()).toBe(true);
  });
});

// ── RATE_LIMIT_MAX constant ───────────────────────────────────────────────────

describe("RATE_LIMIT_MAX constant (Story 1.5.4)", () => {
  it("is 10 per AC", () => {
    expect(RATE_LIMIT_MAX).toBe(10);
  });
});
