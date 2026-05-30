/**
 * Opt-in LLM feature naming — structural context only, offline fallback.
 */

import type { SutraGraph, SutraFeature, SutraNode, SutraEdge } from "../types.js";
import { complete, isLlmAvailable, type LlmProvider } from "./llm.js";

export const AI_NAME_MAX = 60;
export const AI_SUMMARY_MAX = 160;

export interface InferFeaturesOptions {
  enabled: boolean;
  llm?: LlmProvider;
  onSkip?: (reason: string) => void;
}

function trimSingleLine(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + "…";
}

function buildStructuralPrompt(
  feature: SutraFeature,
  nodes: SutraNode[],
  edges: SutraEdge[],
): string {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const memberIds = new Set(feature.node_ids);
  const memberNodes = feature.node_ids
    .map((id) => nodeMap.get(id))
    .filter((n): n is SutraNode => n !== undefined);

  const nodeLines = memberNodes
    .slice(0, 12)
    .map((n) => `- ${n.type}: ${n.name} (${n.file})`);

  const edgeSample = edges
    .filter((e) => memberIds.has(e.from) || memberIds.has(e.to))
    .slice(0, 8)
    .map((e) => `- ${e.kind}: ${e.from} → ${e.to}`);

  return [
    "You name software features from structural graph data only (no source code).",
    `Feature id (stable key): ${feature.id}`,
    `Heuristic label: ${feature.label}`,
    "Member nodes:",
    ...nodeLines,
    "Sample edges:",
    ...edgeSample,
    'Reply with JSON only: {"name":"Short Feature Name","summary":"One sentence summary."}',
  ].join("\n");
}

function parseAiResponse(raw: string): { name: string; summary: string } | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { name?: unknown; summary?: unknown };
    if (typeof parsed.name !== "string" || typeof parsed.summary !== "string") {
      return null;
    }
    const name = trimSingleLine(parsed.name, AI_NAME_MAX);
    const summary = trimSingleLine(parsed.summary, AI_SUMMARY_MAX);
    if (!name || !summary) return null;
    return { name, summary };
  } catch {
    return null;
  }
}

async function inferOneFeature(
  feature: SutraFeature,
  graph: SutraGraph,
  llm: LlmProvider | undefined,
): Promise<SutraFeature> {
  const base: SutraFeature = {
    ...feature,
    label_source: "heuristic",
  };

  try {
    const prompt = buildStructuralPrompt(feature, graph.nodes, graph.edges);
    const raw = llm
      ? await llm.complete(prompt)
      : await complete(prompt);
    const parsed = parseAiResponse(raw);
    if (!parsed) return base;
    return {
      ...feature,
      label_source: "ai-inferred",
      ai_name: parsed.name,
      ai_summary: parsed.summary,
    };
  } catch {
    return base;
  }
}

/**
 * When enabled=false, stamps label_source heuristic and returns unchanged labels.
 * When enabled=true, attempts per-feature LLM inference with fallback.
 */
export async function inferFeatureLabels(
  graph: SutraGraph,
  opts: InferFeaturesOptions,
): Promise<SutraFeature[]> {
  if (!opts.enabled) {
    return graph.features.map((f) => ({
      ...f,
      label_source: "heuristic" as const,
    }));
  }

  const available = opts.llm ? opts.llm.isAvailable() : isLlmAvailable();
  if (!available) {
    opts.onSkip?.("AI skipped: no API key (set SUTRA_AI_API_KEY)");
    return graph.features.map((f) => ({
      ...f,
      label_source: "heuristic" as const,
    }));
  }

  const results: SutraFeature[] = [];
  for (const feature of graph.features) {
    results.push(await inferOneFeature(feature, graph, opts.llm));
  }
  return results;
}

export function countAiLabels(features: SutraFeature[]): {
  ai: number;
  heuristic: number;
} {
  let ai = 0;
  let heuristic = 0;
  for (const f of features) {
    if (f.label_source === "ai-inferred") ai++;
    else heuristic++;
  }
  return { ai, heuristic };
}
