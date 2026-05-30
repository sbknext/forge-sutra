/**
 * Story 3.2 — feature cards grid tests (pure logic).
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  cardModel,
  sortCards,
  filterByHealth,
  defaultSort,
} from "../src/viewer/feature-cards.js";
import { edgeCount } from "../src/viewer/render-shared.js";
import type { SutraGraph } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadGraph(name: string): SutraGraph {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", name, "graph.json"), "utf8"),
  ) as SutraGraph;
}

describe("feature-cards — cardModel mapping (Story 3.2)", () => {
  const graph = loadGraph("features-enriched");

  it("maps AI name when present", () => {
    const models = cardModel(graph);
    const auth = models.find((m) => m.id === "auth")!;
    expect(auth.isAiName).toBe(true);
    expect(auth.name).toBe("User Authentication");
  });

  it("falls back to label when no AI name", () => {
    const models = cardModel(graph);
    const chat = models.find((m) => m.id === "chat")!;
    expect(chat.isAiName).toBe(false);
    expect(chat.name).toBe("Chat");
  });

  it("edgeCount matches shared helper", () => {
    const feat = graph.features.find((f) => f.id === "auth")!;
    const models = cardModel(graph);
    const auth = models.find((m) => m.id === "auth")!;
    expect(auth.edgeCount).toBe(edgeCount(graph, new Set(feat.node_ids)));
  });

  it("contract status from contracts array", () => {
    const models = cardModel(graph);
    expect(models.find((m) => m.id === "auth")!.contractStatus).toBe("has_contract");
    expect(models.find((m) => m.id === "chat")!.contractStatus).toBe("none");
  });
});

describe("feature-cards — health fallback (Story 3.2)", () => {
  it("unknown health when field absent — never healthy", () => {
    const graph = loadGraph("features-phase0");
    const models = cardModel(graph);
    for (const m of models) {
      expect(m.health).toBe("unknown");
      expect(m.health).not.toBe("healthy");
    }
  });
});

describe("feature-cards — sort (Story 3.2)", () => {
  const graph = loadGraph("features-enriched");

  it("default sort is health worst-first", () => {
    const sorted = defaultSort(cardModel(graph));
    expect(sorted[0]!.id).toBe("legacy");
    expect(sorted[sorted.length - 1]!.id).toBe("auth");
  });

  it("name sort with stable id tiebreak", () => {
    const a = sortCards(cardModel(graph), "name", "asc");
    const b = sortCards(cardModel(graph), "name", "asc");
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
  });

  it("issue count sort descending", () => {
    const sorted = sortCards(cardModel(graph), "issues", "desc");
    expect(sorted[0]!.issueCount).toBeGreaterThanOrEqual(sorted[1]!.issueCount);
  });
});

describe("feature-cards — filter (Story 3.2)", () => {
  const models = cardModel(loadGraph("features-enriched"));

  it("filters by unhealthy only", () => {
    const filtered = filterByHealth(models, ["unhealthy"]);
    expect(filtered.every((m) => m.health === "unhealthy")).toBe(true);
    expect(filtered).toHaveLength(1);
  });

  it("composes with sort", () => {
    const filtered = filterByHealth(models, ["unhealthy", "warn"]);
    const sorted = sortCards(filtered, "health", "asc");
    expect(sorted[0]!.health).toBe("unhealthy");
  });
});
