// graph.json contract — THE single source of truth. Every consumer reads this.
// Phase 0. Keep ids stable + deterministic so future phases can diff scans.

export const GRAPH_VERSION = 4;

/**
 * How a graph element was derived:
 * - ast-exact: resolved directly from parsed AST, no guessing
 * - heuristic: directory/name-based inference
 * - template-prefix: only the static prefix of a template literal was extractable
 * - ai-inferred: produced by an LLM (never asserted as fact)
 */
export type Provenance = "ast-exact" | "heuristic" | "template-prefix" | "ai-inferred";

/** Deterministic confidence heuristics (0..1). Not a statistical model. */
export const CONFIDENCE = {
  AST_EXACT: 0.9,
  HEURISTIC: 0.6,
  TEMPLATE_PREFIX: 0.4,
  AI_INFERRED: 0.5,
} as const;

/** Map provenance label to fixed confidence score. */
export function confidenceForProvenance(p: Provenance): number {
  switch (p) {
    case "ast-exact":
      return CONFIDENCE.AST_EXACT;
    case "heuristic":
      return CONFIDENCE.HEURISTIC;
    case "template-prefix":
      return CONFIDENCE.TEMPLATE_PREFIX;
    case "ai-inferred":
      return CONFIDENCE.AI_INFERRED;
  }
}

export type NodeType =
  | "route"
  | "handler"
  | "component"
  | "test"
  | "endpoint"
  | "module"
  | "function";

export type EdgeKind = "calls" | "imports" | "renders" | "tests" | "http";

export type Severity = "error" | "warn" | "info";

export type IssueKind =
  | "orphaned_endpoint"
  | "missing_handler"
  | "dangling_test_ref"
  | "contract_parse_error"
  | "contract_missing_route"
  | "contract_undeclared_route"
  | "cross_repo_orphan"
  | "hook_failure";

export interface SutraNode {
  /** Stable deterministic id: `relative/path#symbol`. */
  id: string;
  type: NodeType;
  name: string;
  /** Repo-relative POSIX path. */
  file: string;
  line: number;
  /** Best-effort param/return shape, e.g. "{ email: string }". null if unknown. */
  data_shape: string | null;
  /** Heuristic feature grouping id. */
  feature: string;
  /** Certainty score 0..1 inclusive; absent = unknown. */
  confidence?: number;
  /** How this finding was derived; absent = unknown. */
  provenance?: Provenance;
}

export interface SutraEdge {
  /** node id (or a synthetic id for an http target/endpoint). */
  from: string;
  to: string;
  kind: EdgeKind;
  /** Certainty score 0..1 inclusive; absent = unknown. */
  confidence?: number;
  /** How this finding was derived; absent = unknown. */
  provenance?: Provenance;
}

export interface SutraIssue {
  severity: Severity;
  kind: IssueKind;
  /** The thing in question (node id, "METHOD /path", symbol, etc.). */
  node: string;
  feature: string;
  message: string;
  /** Certainty score 0..1 inclusive; absent = unknown. */
  confidence?: number;
  /** How this finding was derived; absent = unknown. */
  provenance?: Provenance;
}

export type HealthBand = "green" | "amber" | "red";

export interface FeatureHealthInput {
  signal: string;
  available: boolean;
  weight: number;
  penalty: number;
  detail: string;
}

/** Heuristic structural health — not runtime correctness. */
export interface FeatureHealth {
  score: number;
  band: HealthBand;
  inputs: FeatureHealthInput[];
  available_signals: string[];
}

export interface SutraFeature {
  id: string;
  label: string;
  node_ids: string[];
  issue_count: number;
  /** Composite structural health score (heuristic, code-derived). */
  health: FeatureHealth;
}

/** Author-declared endpoint from feature.sutra.md (intent, not ground truth). */
export interface SutraContractEndpoint {
  method: string;
  path: string;
}

/** Parsed contract file — candidate declaration only. */
export interface SutraContract {
  feature: string;
  /** Repo-relative path to the contract file. */
  file: string;
  endpoints: SutraContractEndpoint[];
}

export type FlowTerminal =
  | "handler"
  | "db"
  | "external"
  | "unresolved"
  | "truncated";

export interface SutraFlowStep {
  node: string;
  edge: SutraEdge | null;
}

export interface SutraFlow {
  id: string;
  entry: string;
  steps: SutraFlowStep[];
  terminal: FlowTerminal;
  confidence: "confirmed" | "candidate";
}

export interface SutraGraph {
  version: number;
  repo: string;
  /** ISO 8601 UTC. */
  scanned_at: string;
  /** Short commit hash, or "unknown" if not a git repo. */
  commit: string;
  nodes: SutraNode[];
  edges: SutraEdge[];
  issues: SutraIssue[];
  features: SutraFeature[];
  /** Parsed from feature.sutra.md when present; empty otherwise. */
  contracts: SutraContract[];
  /** Ordered request paths entry → terminal (Story 2.5). */
  flows: SutraFlow[];
}

export const SUTRA_DIR = ".sutra";
export const GRAPH_FILE = "graph.json";
export const GRAPH_PREV_FILE = "graph.prev.json";
export const DIFF_FILE = "diff.json";
export const VIEW_FILE = "view.html";
export const RECONCILE_FILE = "reconcile.json";

/** Directories never scanned. */
export const EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".sutra",
  ".git",
  "coverage",
  "out",
]);

/** Extensions scanned this phase. */
export const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

/** True for files we skip even if extension matches (e.g. minified). */
export function isExcludedFile(fileName: string): boolean {
  return fileName.endsWith(".min.js") || fileName.endsWith(".d.ts");
}
