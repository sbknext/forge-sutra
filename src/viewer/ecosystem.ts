/**
 * Story 3.4 — ecosystem map pure model (cluster + link rendering metadata).
 */

import type { LinkResult, LinkedEdge, SutraGraph } from "../types.js";
import { splitCrossRepoId } from "../util/ids.js";

export interface EcosystemCluster {
  name: string;
  path: string;
  commit?: string;
  totalNodes: number;
  endpointIds: string[];
}

export interface EcosystemLinkView {
  edge: LinkedEdge;
  sourceCluster: string;
  destCluster: string;
  reconStatus: string;
  reconConfirmed: boolean | null;
  renderClass: string;
  label: string;
}

export function buildClusters(
  link: LinkResult,
  graphsByRepo: Map<string, SutraGraph>,
): EcosystemCluster[] {
  return link.repos.map((repo) => {
    const graph = graphsByRepo.get(repo.name);
    const endpointIds = new Set<string>();
    for (const edge of link.edges) {
      const [, fromNode] = splitCrossRepoId(edge.from);
      const [toRepo, toNode] = splitCrossRepoId(edge.to);
      if (fromNode && edge.from.startsWith(repo.name + "::")) endpointIds.add(fromNode);
      if (toRepo === repo.name) endpointIds.add(toNode);
    }
    return {
      name: repo.name,
      path: repo.path,
      commit: repo.commit,
      totalNodes: graph?.nodes.length ?? 0,
      endpointIds: [...endpointIds],
    };
  });
}

export function linkViewModel(
  link: LinkResult,
  graphsByRepo: Map<string, SutraGraph>,
  showUnresolved: boolean,
): EcosystemLinkView[] {
  return link.edges
    .filter((e) => showUnresolved || e.resolution !== "unresolved")
    .map((edge) => {
      const [sourceCluster] = splitCrossRepoId(edge.from);
      const [destCluster] = splitCrossRepoId(edge.to);
      const destGraph = graphsByRepo.get(destCluster);
      let reconStatus = "n/a";
      let reconConfirmed: boolean | null = null;

      if (destGraph && edge.method && edge.path) {
        const orphan = destGraph.issues.find(
          (i) =>
            i.kind === "cross_repo_orphan" &&
            i.node.includes(edge.path) &&
            i.node.includes(edge.method),
        );
        if (!orphan && edge.resolution === "confirmed") {
          reconStatus = "matched";
          reconConfirmed = true;
        } else if (orphan) {
          reconStatus = "orphaned";
          reconConfirmed = false;
        }
      }

      const renderClass =
        edge.resolution === "confirmed"
          ? "link-confirmed"
          : edge.resolution === "broken"
            ? "link-broken"
            : "link-unresolved";

      return {
        edge,
        sourceCluster,
        destCluster,
        reconStatus,
        reconConfirmed,
        renderClass,
        label: edge.resolution,
      };
    });
}

/** Regression guard: broken/unresolved never share confirmed class. */
export function honestyClassesDistinct(views: EcosystemLinkView[]): boolean {
  const confirmed = views.find((v) => v.edge.resolution === "confirmed")?.renderClass;
  if (!confirmed) return true;
  return views
    .filter((v) => v.edge.resolution !== "confirmed")
    .every((v) => v.renderClass !== confirmed);
}
