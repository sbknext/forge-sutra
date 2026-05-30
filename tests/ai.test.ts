/**
 * AI feature inference tests — Story 2.3 (offline stubbed LLM).
 */

import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "../src/scanner.js";
import { runChecks } from "../src/checks.js";
import { buildFeatures } from "../src/features.js";
import { buildFlows } from "../src/flows.js";
import { inferFeatureLabels, AI_SUMMARY_MAX } from "../src/ai/infer-features.js";
import { setLlmProvider, type LlmProvider } from "../src/ai/llm.js";
import { GRAPH_VERSION, type SutraGraph } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AI_FEATURES = path.resolve(__dirname, "fixtures/ai-features");
const CLEAN = path.resolve(__dirname, "fixtures/clean");

function buildGraph(repoRoot: string): SutraGraph {
  const { nodes, edges } = scan(repoRoot);
  const issues = runChecks(nodes, edges);
  const features = buildFeatures(nodes, issues, edges);
  const { flows } = buildFlows(nodes, edges);
  return {
    version: GRAPH_VERSION,
    repo: path.basename(repoRoot),
    scanned_at: "2026-01-01T00:00:00.000Z",
    commit: "test",
    nodes,
    edges,
    issues,
    features,
    contracts: [],
    flows,
  };
}

afterEach(() => {
  setLlmProvider(null);
});

describe("AI feature inference — default off (Story 2.3)", () => {
  it("inferFeatureLabels disabled keeps heuristic label_source", async () => {
    const graph = buildGraph(AI_FEATURES);
    const out = await inferFeatureLabels(graph, { enabled: false });
    expect(out.length).toBeGreaterThanOrEqual(2);
    for (const f of out) {
      expect(f.label_source).toBe("heuristic");
      expect(f.ai_name).toBeUndefined();
      expect(f.ai_summary).toBeUndefined();
    }
  });

  it("deterministic features across two runs without AI", async () => {
    const a = await inferFeatureLabels(buildGraph(AI_FEATURES), { enabled: false });
    const b = await inferFeatureLabels(buildGraph(AI_FEATURES), { enabled: false });
    expect(a).toEqual(b);
  });
});

describe("AI feature inference — stubbed success", () => {
  it("returns ai-inferred names without changing id/label/node_ids", async () => {
    let call = 0;
    const stub: LlmProvider = {
      isAvailable: () => true,
      complete: async () => {
        call++;
        const names = ["Authentication", "Chat Sessions"];
        const summaries = [
          "User login and OTP verification.",
          "Chat session listing for the product.",
        ];
        const idx = Math.min(call - 1, names.length - 1);
        return JSON.stringify({ name: names[idx], summary: summaries[idx] });
      },
    };
    setLlmProvider(stub);

    const graph = buildGraph(AI_FEATURES);
    const origIds = graph.features.map((f) => ({
      id: f.id,
      label: f.label,
      node_ids: [...f.node_ids],
    }));

    const out = await inferFeatureLabels(graph, { enabled: true });
    expect(out.some((f) => f.label_source === "ai-inferred")).toBe(true);
    const aiFeat = out.find((f) => f.label_source === "ai-inferred");
    expect(aiFeat?.ai_name).toBeTruthy();
    expect(aiFeat?.ai_summary).toBeTruthy();

    for (let i = 0; i < origIds.length; i++) {
      expect(out[i]!.id).toBe(origIds[i]!.id);
      expect(out[i]!.label).toBe(origIds[i]!.label);
      expect(out[i]!.node_ids).toEqual(origIds[i]!.node_ids);
    }
  });
});

describe("AI feature inference — offline fallback", () => {
  it("no-key provider falls back to heuristic without throwing", async () => {
    const stub: LlmProvider = {
      isAvailable: () => false,
      complete: async () => {
        throw new Error("should not call");
      },
    };
    setLlmProvider(stub);
    const graph = buildGraph(AI_FEATURES);
    const out = await inferFeatureLabels(graph, { enabled: true });
    expect(out.every((f) => f.label_source === "heuristic")).toBe(true);
    expect(out.every((f) => f.ai_name === undefined)).toBe(true);
  });
});

describe("AI feature inference — per-feature resilience", () => {
  it("one feature ai-inferred, other heuristic when stub throws", async () => {
    let call = 0;
    const stub: LlmProvider = {
      isAvailable: () => true,
      complete: async () => {
        call++;
        if (call === 1) {
          return JSON.stringify({ name: "Auth", summary: "Login flow." });
        }
        throw new Error("garbage");
      },
    };
    setLlmProvider(stub);

    const graph = buildGraph(AI_FEATURES);
    const out = await inferFeatureLabels(graph, { enabled: true });
    const aiCount = out.filter((f) => f.label_source === "ai-inferred").length;
    const heurCount = out.filter((f) => f.label_source === "heuristic").length;
    expect(aiCount).toBe(1);
    expect(heurCount).toBe(out.length - 1);
  });
});

describe("AI feature inference — length bound", () => {
  it("truncates overlong multi-line summary to single line within cap", async () => {
    const stub: LlmProvider = {
      isAvailable: () => true,
      complete: async () =>
        JSON.stringify({
          name: "A".repeat(100),
          summary: "Line one.\nLine two is much longer and should be trimmed.",
        }),
    };
    setLlmProvider(stub);

    const graph = buildGraph(AI_FEATURES);
    const out = await inferFeatureLabels(graph, { enabled: true });
    const ai = out.find((f) => f.label_source === "ai-inferred");
    expect(ai?.ai_summary).toBeDefined();
    expect(ai!.ai_summary!.length).toBeLessThanOrEqual(AI_SUMMARY_MAX);
    expect(ai!.ai_summary!.includes("\n")).toBe(false);
  });
});

describe("AI feature inference — regression", () => {
  it("clean fixture buildFeatures unchanged without AI path", async () => {
    const graph = buildGraph(CLEAN);
    const out = await inferFeatureLabels(graph, { enabled: false });
    expect(out.every((f) => f.label_source === "heuristic")).toBe(true);
    expect(graph.issues).toHaveLength(0);
  });
});
