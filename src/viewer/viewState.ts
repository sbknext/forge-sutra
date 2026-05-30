/**
 * Story 3.6 — view filter state codec (deterministic, DOM-free).
 */

import type { HealthBand, IssueKind } from "../types.js";

export interface ViewFilterState {
  search: string;
  bands: HealthBand[];
  unscored: boolean;
  confidence: number;
  issueKinds: IssueKind[];
}

const DEFAULT_STATE: ViewFilterState = {
  search: "",
  bands: [],
  unscored: true,
  confidence: 0,
  issueKinds: [],
};

function stableBands(bands: HealthBand[]): HealthBand[] {
  return [...new Set(bands)].sort();
}

function stableKinds(kinds: IssueKind[]): IssueKind[] {
  return [...new Set(kinds)].sort();
}

/** Canonical JSON encoding for hash + slug. */
export function encodeViewState(state: ViewFilterState): string {
  const payload = {
    bands: stableBands(state.bands),
    confidence: Number(state.confidence.toFixed(2)),
    issueKinds: stableKinds(state.issueKinds),
    search: state.search,
    unscored: state.unscored,
  };
  return JSON.stringify(payload);
}

export function decodeViewState(raw: string): ViewFilterState {
  if (!raw) return { ...DEFAULT_STATE };
  const trimmed = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!trimmed) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(decodeURIComponent(trimmed)) as Partial<ViewFilterState>;
    return {
      search: parsed.search ?? "",
      bands: stableBands((parsed.bands ?? []) as HealthBand[]),
      unscored: parsed.unscored !== false,
      confidence: Number((parsed.confidence ?? 0).toFixed(2)),
      issueKinds: stableKinds((parsed.issueKinds ?? []) as IssueKind[]),
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** Deterministic slug from encoded state (no time/randomness). */
export function slugifyViewState(state: ViewFilterState): string {
  const enc = encodeViewState(state);
  let hash = 0;
  for (let i = 0; i < enc.length; i++) {
    hash = (hash * 31 + enc.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
