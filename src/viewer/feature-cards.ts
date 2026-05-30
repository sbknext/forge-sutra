/**
 * Story 3.2 — pure feature card model, sort, and filter (no DOM).
 */

import type { SutraGraph, SutraFeature, HealthBand } from "../types.js";
import { edgeCount } from "./render-shared.js";

export type CardHealth = "healthy" | "warn" | "unhealthy" | "unknown";
export type ContractStatus = "has_contract" | "none";

export interface FeatureCardModel {
  id: string;
  name: string;
  isAiName: boolean;
  aiSummary?: string;
  nodeCount: number;
  edgeCount: number;
  contractStatus: ContractStatus;
  issueCount: number;
  health: CardHealth;
  healthBand?: HealthBand;
  healthScore?: number;
}

export type SortKey = "health" | "issues" | "name";
export type SortDir = "asc" | "desc";

const HEALTH_RANK: Record<CardHealth, number> = {
  unhealthy: 0,
  warn: 1,
  unknown: 2,
  healthy: 3,
};

export function bandToCardHealth(
  band: HealthBand | undefined,
  hasHealthField: boolean,
): CardHealth {
  if (!hasHealthField || band === undefined) return "unknown";
  switch (band) {
    case "green":
      return "healthy";
    case "amber":
      return "warn";
    case "red":
      return "unhealthy";
    default:
      return "unknown";
  }
}

export function cardModel(graph: SutraGraph): FeatureCardModel[] {
  const contractFeatures = new Set(graph.contracts.map((c) => c.feature));

  return graph.features.map((feat) => {
    const nodeIds = new Set(feat.node_ids);
    const hasHealth = feat.health !== undefined && feat.health.band !== undefined;
    const isAi = feat.label_source === "ai-inferred" && !!feat.ai_name;

    return {
      id: feat.id,
      name: isAi ? feat.ai_name! : feat.label,
      isAiName: isAi,
      aiSummary: isAi ? feat.ai_summary : undefined,
      nodeCount: feat.node_ids.length,
      edgeCount: edgeCount(graph, nodeIds),
      contractStatus: contractFeatures.has(feat.id) ? "has_contract" : "none",
      issueCount: feat.issue_count,
      health: bandToCardHealth(feat.health?.band, hasHealth),
      healthBand: feat.health?.band,
      healthScore: feat.health?.score,
    };
  });
}

export function sortCards(
  models: FeatureCardModel[],
  key: SortKey,
  dir: SortDir,
): FeatureCardModel[] {
  const out = models.slice();
  const sign = dir === "asc" ? 1 : -1;

  out.sort((a, b) => {
    let cmp = 0;
    if (key === "health") {
      cmp = HEALTH_RANK[a.health] - HEALTH_RANK[b.health];
      if (dir === "desc") cmp = -cmp;
    } else if (key === "issues") {
      cmp = (b.issueCount - a.issueCount) * sign;
    } else if (key === "name") {
      cmp = a.name.localeCompare(b.name) * sign;
    }
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id);
  });

  return out;
}

/** Default: health worst-first. */
export function defaultSort(models: FeatureCardModel[]): FeatureCardModel[] {
  return sortCards(models, "health", "asc");
}

export function filterByHealth(
  models: FeatureCardModel[],
  states: CardHealth[],
): FeatureCardModel[] {
  if (states.length === 0) return models;
  const set = new Set(states);
  return models.filter((m) => set.has(m.health));
}
