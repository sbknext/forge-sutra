import {
  type SutraNode,
  type SutraIssue,
  type SutraFeature,
  type SutraEdge,
  type SutraContract,
  type FeatureHealth,
  type FeatureHealthInput,
  type HealthBand,
} from "./types.js";

/** Band thresholds — documented constants. */
export const GREEN_MIN = 80;
export const AMBER_MIN = 50;

const STRUCTURAL_KINDS = new Set([
  "orphaned_endpoint",
  "missing_handler",
  "dangling_test_ref",
]);

const CONTRACT_KINDS = new Set([
  "contract_missing_route",
  "contract_undeclared_route",
  "contract_parse_error",
]);

const SEV_WEIGHT: Record<string, number> = { error: 3, warn: 2, info: 1 };

/** Fixed signal ordering for deterministic output. */
const SIGNAL_ORDER = [
  "issue_load",
  "orphan_ratio",
  "confidence",
  "contract_drift",
  "test_coverage",
] as const;

export interface BuildFeaturesOptions {
  contracts?: SutraContract[];
  /** Per-feature tested flag from test-coverage mapping (Story 2.6). */
  testedByFeature?: Map<string, boolean>;
}

export interface ComputeHealthContext {
  featureIssues: SutraIssue[];
  nodeCount: number;
  hasConfidenceData: boolean;
  hasContractData: boolean;
  hasTestCoverageData: boolean;
  tested?: boolean;
}

/** Derive health band from score using documented thresholds. */
export function bandForScore(score: number): HealthBand {
  if (score >= GREEN_MIN) return "green";
  if (score >= AMBER_MIN) return "amber";
  return "red";
}

function issueLoadPenalty(issues: SutraIssue[], nodeCount: number): number {
  let sum = 0;
  for (const iss of issues) {
    sum += SEV_WEIGHT[iss.severity] ?? 1;
  }
  if (sum === 0) return 0;
  const denom = Math.max(nodeCount, 1);
  return Math.min(100, Math.round((sum / denom) * 30));
}

function orphanRatioPenalty(issues: SutraIssue[], nodeCount: number): number {
  const structural = issues.filter((i) => STRUCTURAL_KINDS.has(i.kind));
  if (structural.length === 0) return 0;
  const denom = Math.max(nodeCount, 1);
  return Math.min(100, Math.round((structural.length / denom) * 50));
}

function confidencePenalty(issues: SutraIssue[]): number {
  const withConf = issues.filter((i) => i.confidence !== undefined);
  if (withConf.length === 0) return 0;
  const mean =
    withConf.reduce((s, i) => s + (i.confidence ?? 0), 0) / withConf.length;
  return Math.min(100, Math.round((1 - mean) * 100));
}

function contractDriftPenalty(issues: SutraIssue[]): number {
  const drift = issues.filter((i) => CONTRACT_KINDS.has(i.kind));
  if (drift.length === 0) return 0;
  return Math.min(100, drift.length * 25);
}

function testCoveragePenalty(tested: boolean | undefined): number {
  if (tested === undefined) return 0;
  return tested ? 0 : 60;
}

/**
 * Compute composite structural health for one feature.
 * Deterministic — stable signal order, no random/time inputs.
 */
export function computeFeatureHealth(ctx: ComputeHealthContext): FeatureHealth {
  const {
    featureIssues,
    nodeCount,
    hasConfidenceData,
    hasContractData,
    hasTestCoverageData,
    tested,
  } = ctx;

  const issuePenalty = issueLoadPenalty(featureIssues, nodeCount);
  const orphanPenalty = orphanRatioPenalty(featureIssues, nodeCount);

  const confidenceAvailable =
    hasConfidenceData && featureIssues.some((i) => i.confidence !== undefined);
  const contractAvailable =
    hasContractData && featureIssues.some((i) => CONTRACT_KINDS.has(i.kind));
  const testCoverageAvailable = hasTestCoverageData && tested !== undefined;

  const confPenalty = confidenceAvailable
    ? confidencePenalty(featureIssues)
    : 0;
  const contractPenalty = contractAvailable
    ? contractDriftPenalty(featureIssues)
    : 0;
  const testPenalty = testCoverageAvailable ? testCoveragePenalty(tested) : 0;

  const allInputs: FeatureHealthInput[] = [
    {
      signal: "issue_load",
      available: true,
      weight: 0.35,
      penalty: issuePenalty,
      detail: `${featureIssues.length} issue(s) weighted by severity, normalized by ${nodeCount} node(s)`,
    },
    {
      signal: "orphan_ratio",
      available: true,
      weight: 0.35,
      penalty: orphanPenalty,
      detail: `Structural issues (orphan/missing/dangling) vs feature size`,
    },
    {
      signal: "confidence",
      available: confidenceAvailable,
      weight: 0.1,
      penalty: confPenalty,
      detail: confidenceAvailable
        ? `Mean issue confidence → penalty ${confPenalty}`
        : "No confidence data on issues",
    },
    {
      signal: "contract_drift",
      available: contractAvailable,
      weight: 0.1,
      penalty: contractPenalty,
      detail: contractAvailable
        ? `Contract drift issues → penalty ${contractPenalty}`
        : "No contract drift data",
    },
    {
      signal: "test_coverage",
      available: testCoverageAvailable,
      weight: 0.1,
      penalty: testPenalty,
      detail: testCoverageAvailable
        ? tested
          ? "At least one confirmed test edge (static presence)"
          : "No test references resolve into this feature (static)"
        : "Test coverage mapping not available",
    },
  ];

  // Stable ordering
  allInputs.sort(
    (a, b) =>
      SIGNAL_ORDER.indexOf(a.signal as (typeof SIGNAL_ORDER)[number]) -
      SIGNAL_ORDER.indexOf(b.signal as (typeof SIGNAL_ORDER)[number]),
  );

  const available = allInputs.filter((i) => i.available);
  const totalWeight = available.reduce((s, i) => s + i.weight, 0);
  let totalPenalty = 0;
  if (totalWeight > 0) {
    totalPenalty = available.reduce(
      (s, i) => s + (i.penalty * i.weight) / totalWeight,
      0,
    );
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));
  const band = bandForScore(score);

  return {
    score,
    band,
    inputs: allInputs,
    available_signals: available.map((i) => i.signal),
  };
}

/**
 * Group nodes by heuristic feature id, count issues, compute health.
 * Returns SutraFeature[] sorted by id (ascending).
 */
export function buildFeatures(
  nodes: SutraNode[],
  issues: SutraIssue[],
  edges: SutraEdge[] = [],
  opts: BuildFeaturesOptions = {},
): SutraFeature[] {
  void edges; // reserved for future edge-based signals

  const featureNodes = new Map<string, string[]>();
  for (const node of nodes) {
    const feat = node.feature;
    if (!featureNodes.has(feat)) featureNodes.set(feat, []);
    featureNodes.get(feat)!.push(node.id);
  }

  const issueCount = new Map<string, number>();
  const issuesByFeature = new Map<string, SutraIssue[]>();
  for (const issue of issues) {
    const f = issue.feature;
    issueCount.set(f, (issueCount.get(f) ?? 0) + 1);
    if (!issuesByFeature.has(f)) issuesByFeature.set(f, []);
    issuesByFeature.get(f)!.push(issue);
  }

  const hasConfidenceData = issues.some((i) => i.confidence !== undefined);
  const hasContractData =
    (opts.contracts?.length ?? 0) > 0 ||
    issues.some((i) => CONTRACT_KINDS.has(i.kind));
  const hasTestCoverageData = opts.testedByFeature !== undefined;

  const features: SutraFeature[] = [];
  for (const [id, node_ids] of featureNodes) {
    const featureIssues = issuesByFeature.get(id) ?? [];
    const health = computeFeatureHealth({
      featureIssues,
      nodeCount: node_ids.length,
      hasConfidenceData,
      hasContractData,
      hasTestCoverageData,
      tested: opts.testedByFeature?.get(id),
    });

    features.push({
      id,
      label: toTitleCase(id),
      node_ids,
      issue_count: issueCount.get(id) ?? 0,
      health,
    });
  }

  features.sort((a, b) => a.id.localeCompare(b.id));
  return features;
}

function toTitleCase(s: string): string {
  return s
    .split(/[-_/\s]+/)
    .map((word) =>
      word.length === 0 ? "" : word[0]!.toUpperCase() + word.slice(1),
    )
    .join(" ");
}
