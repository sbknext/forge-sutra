/**
 * Language-neutral extractor interface — graph producers plug in here.
 * No ts-morph or language-specific imports in this module.
 */

import type { SutraNode, SutraEdge } from "./types.js";

export interface ExtractorResult {
  nodes: SutraNode[];
  edges: SutraEdge[];
}

export interface ExtractorInput {
  repoRoot: string;
  /** When set, TS extractor reads/writes .sutra/cache under this directory. */
  cacheRoot?: string;
}

/** Pluggable language extractor. Checks/features run downstream in cli.ts. */
export interface Extractor {
  /** Stable language id, e.g. "ts" or "python-frappe". */
  language: string;
  /** True when this extractor claims the file (by extension/path). */
  matches(filePath: string): boolean;
  /** Optional repo-level gate — skip extractor when false. */
  appliesTo?(repoRoot: string): boolean;
  /** Extract structural nodes/edges from the repo. */
  extract(input: ExtractorInput): ExtractorResult;
}
