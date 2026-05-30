/**
 * Story 3.6 — search, filter & share tests.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  encodeViewState,
  decodeViewState,
  slugifyViewState,
  type ViewFilterState,
} from "../src/viewer/viewState.js";
import {
  filterGraphFeatures,
  distinctIssueKinds,
  countVisible,
  featureMatchesFilter,
} from "../src/viewer/filter.js";
import { renderFilteredView } from "../src/viewer/export-view.js";
import { renderView } from "../src/view.js";
import type { SutraGraph } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function load(name: string): SutraGraph {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", name, "graph.json"), "utf8"),
  ) as SutraGraph;
}

describe("viewState encode/decode (Story 3.6)", () => {
  const sample: ViewFilterState = {
    search: "hello world",
    bands: ["red", "green"],
    unscored: false,
    confidence: 0.55,
    issueKinds: ["orphaned_endpoint", "missing_handler"],
  };

  it("round-trips representative state", () => {
    const enc = encodeViewState(sample);
    const dec = decodeViewState(enc);
    expect(dec).toEqual({
      search: "hello world",
      bands: ["green", "red"],
      unscored: false,
      confidence: 0.55,
      issueKinds: ["missing_handler", "orphaned_endpoint"],
    });
  });

  it("encode is byte-stable across calls", () => {
    expect(encodeViewState(sample)).toBe(encodeViewState(sample));
  });

  it("slugifyViewState is stable", () => {
    expect(slugifyViewState(sample)).toBe(slugifyViewState(sample));
  });
});

describe("filtered static export (Story 3.6)", () => {
  const graph = load("filter-rich");
  const state: ViewFilterState = {
    search: "",
    bands: ["red"],
    unscored: false,
    confidence: 0,
    issueKinds: [],
  };

  it("includes disclaimer and only matching features", () => {
    const html = renderFilteredView(graph, state);
    expect(html).toContain("Heuristic grouping");
    expect(html).toContain("Beta");
    expect(html).not.toContain("data-feature=\"alpha\"");
  });

  it("byte-stable for same graph + state", () => {
    const a = renderFilteredView(graph, state);
    const b = renderFilteredView(graph, state);
    expect(a).toBe(b);
    expect(slugifyViewState(state)).toBe(slugifyViewState(state));
  });
});

describe("honesty under filter (Story 3.6)", () => {
  it("confidence filter hides low-confidence feature but keeps labels when shown", () => {
    const graph = load("filter-rich");
    const strict: ViewFilterState = {
      search: "",
      bands: [],
      unscored: true,
      confidence: 0.85,
      issueKinds: [],
    };
    const visible = filterGraphFeatures(graph, strict);
    expect(visible.some((f) => f.id === "beta")).toBe(false);

    const loose: ViewFilterState = { ...strict, confidence: 0 };
    const html = renderFilteredView(graph, loose);
    expect(html).toContain("template-prefix");
    expect(html).toContain("candidate");
  });
});

describe("issue-kind toggles (Story 3.6)", () => {
  it("distinct kinds from graph only", () => {
    const kinds = distinctIssueKinds(load("filter-rich"));
    expect(kinds).toEqual(["missing_handler", "orphaned_endpoint"]);
  });
});

describe("empty-state filter (Story 3.6)", () => {
  it("all-hide search yields zero visible features", () => {
    const graph = load("filter-rich");
    const state: ViewFilterState = {
      search: "ZZZZNOTFOUND",
      bands: [],
      unscored: true,
      confidence: 0,
      issueKinds: [],
    };
    const counts = countVisible(graph, state);
    expect(counts.features).toBe(0);
    expect(counts.totalFeatures).toBeGreaterThan(0);
  });
});

describe("regression — unfiltered renderView unchanged (Story 3.6)", () => {
  it("renderView baseline stable", () => {
    const graph = load("filter-rich");
    const html = renderView(graph);
    expect(html).toContain("feature-grid");
    expect(graph.features.every((f) => featureMatchesFilter(graph, f, {
      search: "",
      bands: [],
      unscored: true,
      confidence: 0,
      issueKinds: [],
    }))).toBe(true);
  });
});
