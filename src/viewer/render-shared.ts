/**
 * Shared pure render helpers for static view.html and the viewer SPA.
 * Renderer is a leaf — consumes graph.json only.
 */

import type { SutraGraph, SutraFeature, SutraIssue, Severity } from "../types.js";

export const CAP = 60;

export const DISCLAIMER =
  "Heuristic grouping — candidate results, not complete. Feature boundaries are approximate. Review findings before acting on them.";

/** Escape text for safe HTML insertion. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Build issue list item with optional provenance/confidence chip. */
export function formatIssueRow(iss: SutraIssue): string {
  const lowConf =
    iss.provenance === "template-prefix" ||
    (iss.confidence !== undefined && iss.confidence < 0.7);
  const extraClass = lowConf ? " issue-low-confidence" : "";
  const chip =
    iss.provenance !== undefined && iss.confidence !== undefined
      ? `<span class="prov-chip">${esc(iss.provenance)} · ${iss.confidence.toFixed(2)}</span> `
      : "";
  return `<li class="issue issue-${esc(iss.severity)}${extraClass}"><span class="sev">${esc(iss.severity.toUpperCase())}</span> ${chip}${esc(iss.message)}</li>`;
}

/** Sanitize a label for use inside a Mermaid flowchart. */
export function mermaidLabel(s: string): string {
  const clean = s
    .replace(/["'`]/g, "")
    .replace(/[(){}[\]<>;#\\]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `"${clean}"`;
}

/** Map node type to a Mermaid shape prefix/suffix pair. */
export function mermaidShape(type: string): [string, string] {
  switch (type) {
    case "route":
    case "endpoint":
      return ["([", "])"];
    case "component":
      return ["[/", "/]"];
    case "test":
      return ["{{", "}}"];
    case "handler":
    case "function":
      return ["[", "]"];
    default:
      return ["(", ")"];
  }
}

/** Badge color from structural health band (heuristic). */
export function healthBadgeClass(band: string): string {
  switch (band) {
    case "green":
      return "badge-health-green";
    case "amber":
      return "badge-health-amber";
    case "red":
      return "badge-health-red";
    default:
      return "badge-ok";
  }
}

/** Fallback badge color based on issue severity set. */
export function badgeClass(issues: SutraIssue[]): string {
  if (issues.length === 0) return "badge-ok";
  if (issues.some((i) => i.severity === "error")) return "badge-error";
  return "badge-warn";
}

/** Count edges that touch at least one node in the set. */
export function edgeCount(graph: SutraGraph, nodeIds: Set<string>): number {
  return graph.edges.filter((e) => nodeIds.has(e.from) || nodeIds.has(e.to)).length;
}

/** Build a Mermaid flowchart source for nodes whose ids are in nodeIds. */
export function buildMermaid(
  graph: SutraGraph,
  nodeIds: Set<string>,
  truncated: boolean,
): string {
  const lines: string[] = ["flowchart LR"];

  const safeid = (id: string): string => "n" + id.replace(/[^a-zA-Z0-9]/g, "_");

  const nodeSet = new Set(nodeIds);

  for (const node of graph.nodes) {
    if (!nodeSet.has(node.id)) continue;
    const sid = safeid(node.id);
    const [open, close] = mermaidShape(node.type);
    lines.push(`  ${sid}${open}${mermaidLabel(node.name)}${close}`);
  }

  const kindArrow: Record<string, string> = {
    calls: "-->",
    imports: "-.->",
    renders: "==>",
    tests: "--o",
    http: "--x",
  };

  for (const edge of graph.edges) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) continue;
    const arrow = kindArrow[edge.kind] ?? "-->";
    lines.push(`  ${safeid(edge.from)} ${arrow} ${safeid(edge.to)}`);
  }

  if (truncated) {
    lines.push(`  truncated["⚠ truncated — too many nodes"]`);
  }

  return lines.join("\n");
}

/** Build the detail panel HTML for one feature. */
export function buildDetailPanel(
  graph: SutraGraph,
  feature: SutraFeature,
  featureIssues: SutraIssue[],
): string {
  const allIds = new Set(feature.node_ids);
  const truncated = allIds.size > CAP;
  const cappedIds: Set<string> = truncated
    ? new Set([...allIds].slice(0, CAP))
    : allIds;

  const mermaidSrc = buildMermaid(graph, cappedIds, truncated);
  const issueRows = featureIssues.map((iss) => formatIssueRow(iss)).join("\n");

  return `
<div class="detail-panel" id="detail-${esc(feature.id)}" style="display:none">
  <h3>${esc(feature.label)}</h3>
  <p class="meta">${feature.node_ids.length} node(s)${truncated ? ` — showing first ${CAP}` : ""}</p>
  <div class="mermaid-wrap">
    <pre class="mermaid" data-feature="${esc(feature.id)}">${esc(mermaidSrc)}</pre>
  </div>
  ${featureIssues.length > 0 ? `<ul class="issue-list">${issueRows}</ul>` : '<p class="no-issues">No issues.</p>'}
</div>`;
}

/** Build feature card HTML for one feature. */
export function buildFeatureCard(
  graph: SutraGraph,
  feat: SutraFeature,
  issues: SutraIssue[],
): string {
  const nodeIds = new Set(feat.node_ids);
  const ec = edgeCount(graph, nodeIds);
  const healthBand =
    feat.health?.band ??
    (issues.length === 0
      ? "green"
      : issues.some((i) => i.severity === "error")
        ? "red"
        : "amber");
  const hcls = healthBadgeClass(healthBand);
  const healthScore = feat.health?.score ?? 0;
  const isAi = feat.label_source === "ai-inferred" && feat.ai_name;
  const displayLabel = isAi ? feat.ai_name! : feat.label;
  const aiBadge = isAi
    ? `<span class="badge badge-ai" title="ai-inferred label">AI</span>`
    : "";
  const aiSummary =
    isAi && feat.ai_summary
      ? `<div class="card-ai-summary">${esc(feat.ai_summary)}</div>`
      : "";

  return `
<div class="card" data-feature="${esc(feat.id)}" tabindex="0" role="button" aria-expanded="false">
  <div class="card-header">
    <span class="card-label">${esc(displayLabel)} ${aiBadge}</span>
    <span class="badge ${hcls}" title="Heuristic structural health score">${healthScore} · ${esc(healthBand)}</span>
  </div>
  ${aiSummary}
  <div class="card-meta">${feat.node_ids.length} node${feat.node_ids.length !== 1 ? "s" : ""} &middot; ${ec} edge${ec !== 1 ? "s" : ""} &middot; ${feat.issue_count} issue${feat.issue_count !== 1 ? "s" : ""}</div>
  <div class="card-health-note">Heuristic structural health score — not runtime correctness</div>
</div>`;
}

/** Shared viewer stylesheet (static view + SPA). */
export function renderStyles(): string {
  return `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #1a1a1a; padding: 1.5rem; }
header { background: #1e293b; color: #f1f5f9; border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; }
header h1 { font-size: 1.3rem; font-weight: 700; margin-bottom: 0.4rem; }
header .meta { font-size: 0.82rem; color: #94a3b8; line-height: 1.6; }
header .counts { margin-top: 0.5rem; display: flex; gap: 1.25rem; font-size: 0.85rem; flex-wrap: wrap; }
header .counts span { background: #334155; padding: 0.15rem 0.6rem; border-radius: 4px; }
.disclaimer { background: #fef9c3; border: 1px solid #fde047; border-radius: 6px; padding: 0.6rem 1rem; font-size: 0.82rem; color: #713f12; margin-bottom: 1.25rem; }
.toolbar { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
.toolbar button { padding: 0.4rem 0.85rem; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; cursor: pointer; font-size: 0.85rem; }
.toolbar button:hover { background: #f1f5f9; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.85rem; margin-bottom: 1.5rem; }
.card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.9rem 1rem; cursor: pointer; transition: box-shadow 0.15s, border-color 0.15s; user-select: none; }
.card:hover, .card:focus { box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-color: #6366f1; outline: none; }
.card.active { border-color: #6366f1; box-shadow: 0 0 0 2px #c7d2fe; }
.card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.35rem; }
.card-label { font-weight: 600; font-size: 0.9rem; line-height: 1.3; }
.badge { font-size: 0.72rem; font-weight: 700; padding: 0.15rem 0.45rem; border-radius: 999px; white-space: nowrap; flex-shrink: 0; }
.badge-ok { background: #dcfce7; color: #166534; }
.badge-warn { background: #fef9c3; color: #854d0e; }
.badge-error { background: #fee2e2; color: #991b1b; }
.badge-health-green { background: #dcfce7; color: #166534; }
.badge-health-amber { background: #fef9c3; color: #854d0e; }
.badge-health-red { background: #fee2e2; color: #991b1b; }
.badge-ai { background: #ede9fe; color: #5b21b6; font-size: 0.65rem; margin-left: 0.25rem; }
.card-ai-summary { font-size: 0.78rem; color: #64748b; margin: 0.25rem 0 0.35rem; line-height: 1.35; }
.card-health-note { font-size: 0.68rem; color: #94a3b8; margin-top: 0.35rem; font-style: italic; }
.card-meta { font-size: 0.78rem; color: #64748b; }
.detail-panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; }
.detail-panel h3 { font-size: 1.05rem; font-weight: 700; margin-bottom: 0.3rem; }
.detail-panel .meta { font-size: 0.8rem; color: #64748b; margin-bottom: 0.85rem; }
.mermaid-wrap { overflow-x: auto; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 1rem; margin-bottom: 1rem; }
.mermaid { font-size: 0.82rem; }
.issue-list { list-style: none; display: flex; flex-direction: column; gap: 0.4rem; }
.issue { font-size: 0.82rem; padding: 0.35rem 0.65rem; border-radius: 5px; }
.issue-error { background: #fee2e2; color: #7f1d1d; }
.issue-warn { background: #fef9c3; color: #713f12; }
.issue-info { background: #e0f2fe; color: #0c4a6e; }
.issue-low-confidence { opacity: 0.85; border-left: 3px solid #94a3b8; }
.prov-chip { font-size: 0.72rem; font-weight: 600; color: #64748b; background: #f1f5f9; padding: 0.1rem 0.35rem; border-radius: 3px; margin-right: 0.25rem; }
.sev { font-weight: 700; margin-right: 0.4rem; }
.no-issues { font-size: 0.82rem; color: #16a34a; }
.error-state { background: #fee2e2; border: 1px solid #fca5a5; border-radius: 8px; padding: 1rem 1.25rem; color: #991b1b; margin-bottom: 1rem; }
.hidden { display: none !important; }
`;
}

/** Index issues by feature id. */
export function indexIssuesByFeature(
  issues: SutraIssue[],
): Map<string, SutraIssue[]> {
  const map = new Map<string, SutraIssue[]>();
  for (const iss of issues) {
    if (!map.has(iss.feature)) map.set(iss.feature, []);
    map.get(iss.feature)!.push(iss);
  }
  return map;
}

export const severityOrder: Record<Severity, number> = {
  error: 0,
  warn: 1,
  info: 2,
};
