/**
 * Story 1.5.4 — "Explain this feature" backend route.
 *
 * POST /explain/:featureId
 *   Reads current graph.json, extracts the feature, builds a candid structural prompt,
 *   calls the configured AI provider, and streams the response token-by-token back to
 *   the browser via chunked transfer encoding.
 *
 * Honesty rules (core sutra principle):
 * - System prompt explicitly instructs the model to say "appears to," "structurally suggests,"
 *   "candidate" when inferring intent.
 * - UI label (not a content filter) is the safety net for overconfident model output.
 * - Every AI-generated explanation carries the mandatory AI label in the browser.
 * - Rate limit: 10 req/min per running instance (in-memory, not persistent).
 *   Candidate threshold — adjust based on provider costs.
 */

import type http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { SutraGraph, SutraFeature, SutraNode, SutraIssue } from "../types.js";
import { SUTRA_DIR, GRAPH_FILE } from "../types.js";

// ── Provider abstraction ──────────────────────────────────────────────────────

export type ExplainProvider = "openai" | "anthropic";

/**
 * Detects which provider to use from env.
 * SUTRA_AI_PROVIDER defaults to "openai".
 * AI — provider enum is candidate; extend as needed.
 */
function detectProvider(): ExplainProvider {
  const raw = (process.env.SUTRA_AI_PROVIDER ?? "openai").toLowerCase().trim();
  if (raw === "anthropic") return "anthropic";
  return "openai";
}

/** Check whether SUTRA_AI_API_KEY is set (non-empty). */
export function isExplainAvailable(): boolean {
  const key = process.env.SUTRA_AI_API_KEY?.trim();
  return Boolean(key && key.length > 0);
}

// ── Prompt construction ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are explaining a software feature based solely on static code structure — no runtime data, no docs.
Be candid: say "appears to," "structurally suggests," or "candidate" when inferring intent.
Never claim runtime correctness, test pass/fail, or security properties.
Keep it to 2–4 sentences. Start with what the feature does, then note any structural issues
(orphaned endpoints, low health) and what those might mean in plain English.`;

/**
 * Build the user prompt from feature graph data.
 * AI — constructed from graph only; no source code is sent to the model.
 */
export function buildExplainPrompt(
  feature: SutraFeature,
  nodes: SutraNode[],
  issues: SutraIssue[],
): string {
  const memberNodes = nodes
    .filter((n) => feature.node_ids.includes(n.id))
    .slice(0, 20);

  const featureIssues = issues
    .filter((i) => i.feature === feature.id)
    .slice(0, 5);

  const nodeSummary = memberNodes
    .map((n) => `  ${n.type}: ${n.name} (${n.file})`)
    .join("\n") || "  (no nodes)";

  const issueSummary = featureIssues.length > 0
    ? featureIssues.map((i) => `  ${i.kind}: ${i.message}`).join("\n")
    : "  (none)";

  const healthScore = feature.health?.score != null
    ? `${feature.health.score}/100 (${feature.health.band ?? "unknown"})`
    : "unknown";

  const lines: string[] = [
    `Feature: ${feature.label} (id: ${feature.id})`,
    `Health: ${healthScore} — ${feature.issue_count} issue(s)`,
    `Nodes (up to 20):`,
    nodeSummary,
    `Issues (up to 5):`,
    issueSummary,
  ];

  if (feature.ai_summary) {
    lines.push(`Existing ai_summary: ${feature.ai_summary}`);
  }

  return lines.join("\n");
}

// ── Rate limiter — sliding window, in-memory ──────────────────────────────────

export const RATE_LIMIT_MAX = 10;   // requests
export const RATE_LIMIT_WINDOW = 60_000; // ms

export interface RateLimiter {
  /** Returns true if the call is allowed; false if rate-limited. */
  check(): boolean;
  /** Seconds until the oldest entry ages out (approx); 0 if allowed. */
  retryAfterSec(): number;
}

/**
 * Create a sliding-window rate limiter.
 * Candidate implementation — not persistent across restarts.
 */
export function createRateLimiter(
  maxCalls = RATE_LIMIT_MAX,
  windowMs = RATE_LIMIT_WINDOW,
): RateLimiter {
  const calls: number[] = [];

  return {
    check(): boolean {
      const now = Date.now();
      // Prune old entries
      while (calls.length > 0 && calls[0]! < now - windowMs) {
        calls.shift();
      }
      if (calls.length >= maxCalls) return false;
      calls.push(now);
      return true;
    },
    retryAfterSec(): number {
      if (calls.length === 0) return 0;
      const oldest = calls[0]!;
      const remaining = Math.ceil((oldest + windowMs - Date.now()) / 1000);
      return Math.max(0, remaining);
    },
  };
}

// ── OpenAI streaming call ─────────────────────────────────────────────────────

async function streamOpenAI(
  prompt: string,
  key: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.SUTRA_AI_MODEL ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 300,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      onError(new Error(`OpenAI HTTP ${res.status}`));
      return;
    }

    if (!res.body) {
      onError(new Error("No response body from OpenAI"));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const raw = trimmed.slice(6);
        if (raw === "[DONE]") { onDone(); return; }
        try {
          const parsed = JSON.parse(raw) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
          };
          const text = parsed.choices?.[0]?.delta?.content;
          if (text) onChunk(text);
          if (parsed.choices?.[0]?.finish_reason === "stop") { onDone(); return; }
        } catch {
          /* ignore malformed SSE line */
        }
      }
    }
    onDone();
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    clearTimeout(timer);
  }
}

// ── Anthropic streaming call ──────────────────────────────────────────────────

async function streamAnthropic(
  prompt: string,
  key: string,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.SUTRA_AI_MODEL ?? "claude-3-haiku-20240307",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      onError(new Error(`Anthropic HTTP ${res.status}`));
      return;
    }

    if (!res.body) {
      onError(new Error("No response body from Anthropic"));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const raw = trimmed.slice(6);
        try {
          const parsed = JSON.parse(raw) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (parsed.type === "content_block_delta" && parsed.delta?.text) {
            onChunk(parsed.delta.text);
          }
          if (parsed.type === "message_stop") { onDone(); return; }
        } catch {
          /* ignore malformed SSE line */
        }
      }
    }
    onDone();
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    clearTimeout(timer);
  }
}

// ── Streaming handler ─────────────────────────────────────────────────────────

/**
 * Stream an explanation to the HTTP response via chunked transfer encoding.
 * Called from server.ts after all guards pass (key present, rate limit OK, feature found).
 */
export async function streamExplanation(
  feature: SutraFeature,
  nodes: SutraNode[],
  issues: SutraIssue[],
  key: string,
  res: http.ServerResponse,
): Promise<void> {
  const provider = detectProvider();
  const prompt = buildExplainPrompt(feature, nodes, issues);

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Transfer-Encoding": "chunked",
    "Cache-Control": "no-store",
    // Custom response marker — no Access-Control-Allow-Origin header is set;
    // the endpoint is served from the same origin as the viewer (no cross-origin access).
    "X-Sutra-Explain": "candidate",
  });

  const streamFn = provider === "anthropic" ? streamAnthropic : streamOpenAI;

  await streamFn(
    prompt,
    key,
    (text) => { res.write(text); },
    () => { res.end(); },
    (err) => {
      try {
        res.write(`\n\n[Explain error: ${err.message}]`);
        res.end();
      } catch {
        /* response already closed */
      }
    },
  );
}

// ── Route handler factory ─────────────────────────────────────────────────────

export interface ExplainRouteOptions {
  cwd: string;
  rateLimiter: RateLimiter;
}

/**
 * Handle POST /explain/:featureId.
 * Returns true if the request was handled (either successfully or with an error response).
 * Returns false if the URL does not match.
 */
export function handleExplainRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: ExplainRouteOptions,
): boolean {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  const match = url.pathname.match(/^\/explain\/(.+)$/);
  if (!match || req.method !== "POST") return false;

  const featureId = decodeURIComponent(match[1]!);

  // Gate: SUTRA_AI_API_KEY missing
  const key = process.env.SUTRA_AI_API_KEY?.trim();
  if (!key) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "AI explanations require SUTRA_AI_API_KEY — see README",
        setup: true,
      }),
    );
    return true;
  }

  // Gate: rate limit
  if (!opts.rateLimiter.check()) {
    const retryAfter = opts.rateLimiter.retryAfterSec();
    res.writeHead(429, {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
    });
    res.end(
      JSON.stringify({
        error: `Rate limit — try again in ${retryAfter} seconds`,
        retryAfterSec: retryAfter,
      }),
    );
    return true;
  }

  // Load graph
  const graphPath = path.join(opts.cwd, SUTRA_DIR, GRAPH_FILE);
  if (!fs.existsSync(graphPath)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "graph.json not found — run `sutra scan` first" }));
    return true;
  }

  let graph: SutraGraph;
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, "utf8")) as SutraGraph;
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "graph.json is unparseable" }));
    return true;
  }

  const feature = graph.features.find((f) => f.id === featureId);
  if (!feature) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Feature not found: ${featureId}` }));
    return true;
  }

  // Stream explanation — fire-and-forget; errors handled inside streamExplanation
  void streamExplanation(feature, graph.nodes, graph.issues, key, res);
  return true;
}
