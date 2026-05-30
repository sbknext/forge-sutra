// graph.json contract — THE single source of truth. Every consumer reads this.
// Phase 0. Keep ids stable + deterministic so future phases can diff scans.

export const GRAPH_VERSION = 1;

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
}

export interface SutraEdge {
  /** node id (or a synthetic id for an http target/endpoint). */
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface SutraIssue {
  severity: Severity;
  kind: IssueKind;
  /** The thing in question (node id, "METHOD /path", symbol, etc.). */
  node: string;
  feature: string;
  message: string;
}

export interface SutraFeature {
  id: string;
  label: string;
  node_ids: string[];
  issue_count: number;
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
