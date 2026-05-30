/**
 * Story 3.6 — filtered static export (reuses renderView leaf).
 */

import type { SutraGraph } from "../types.js";
import type { ViewFilterState } from "./viewState.js";
import { filterGraphFeatures } from "./filter.js";
import { renderView } from "../view.js";

/** Render static HTML for a filtered subset of features. */
export function renderFilteredView(graph: SutraGraph, state: ViewFilterState): string {
  const visible = filterGraphFeatures(graph, state);
  const filtered: SutraGraph = {
    ...graph,
    features: visible,
    issues: graph.issues.filter((i) => visible.some((f) => f.id === i.feature)),
    nodes: graph.nodes.filter((n) => visible.some((f) => f.node_ids.includes(n.id))),
    edges: graph.edges.filter(
      (e) =>
        visible.some((f) => f.node_ids.includes(e.from)) &&
        visible.some((f) => f.node_ids.includes(e.to)),
    ),
  };
  return renderView(filtered);
}
