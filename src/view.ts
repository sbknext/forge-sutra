import type { SutraGraph, SutraFeature, SutraIssue, Severity } from "./types.js";
import type { SutraDiff } from "./diff.js";
import type { ReconcileOutput } from "./reconcile.js";
import { formatDiffSummary } from "./diff.js";

/** Escape text for safe HTML insertion. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Build issue list item with optional provenance/confidence chip. */
function formatIssueRow(iss: SutraIssue): string {
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

/**
 * Sanitize a label for use inside a Mermaid flowchart.
 * Mermaid breaks on: ( ) { } [ ] " ' < > ; #
 * Strategy: strip/replace those chars, then wrap result in double-quotes.
 */
function mermaidLabel(s: string): string {
  const clean = s
    .replace(/["'`]/g, "")
    .replace(/[(){}[\]<>;#\\]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60); // keep labels short
  return `"${clean}"`;
}

/** Map node type to a Mermaid shape prefix/suffix pair. */
function mermaidShape(type: string): [string, string] {
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
function healthBadgeClass(band: string): string {
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
function badgeClass(issues: SutraIssue[]): string {
  if (issues.length === 0) return "badge-ok";
  if (issues.some((i) => i.severity === "error")) return "badge-error";
  return "badge-warn";
}

/** Count edges that touch at least one node in the set. */
function edgeCount(graph: SutraGraph, nodeIds: Set<string>): number {
  return graph.edges.filter((e) => nodeIds.has(e.from) || nodeIds.has(e.to)).length;
}

/** Build a Mermaid flowchart source for nodes whose ids are in nodeIds. */
function buildMermaid(graph: SutraGraph, nodeIds: Set<string>, truncated: boolean): string {
  const lines: string[] = ["flowchart LR"];

  // Safe node-id for Mermaid (alphanumeric + underscores only)
  const safeid = (id: string): string =>
    "n" + id.replace(/[^a-zA-Z0-9]/g, "_");

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

const CAP = 60;

/** True when diff has any structural delta. */
function diffHasChanges(diff: SutraDiff): boolean {
  return (
    diff.nodes_added.length > 0 ||
    diff.nodes_removed.length > 0 ||
    diff.edges_added.length > 0 ||
    diff.edges_removed.length > 0 ||
    diff.issues_added.length > 0 ||
    diff.issues_removed.length > 0 ||
    diff.issues_changed.length > 0
  );
}

/** Build reconcile summary panel — display-only, candidate. */
function buildReconcilePanel(reconcile: ReconcileOutput): string {
  if (!reconcile) return "";

  const orphanRows = reconcile.issues
    .map((iss) => formatIssueRow(iss))
    .join("\n");

  return `
<section class="reconcile-panel">
  <h2>Cross-repo reconcile</h2>
  <p class="reconcile-meta">
    Client: <code>${esc(reconcile.client_repo)}</code> &rarr;
    Server: <code>${esc(reconcile.server_repo)}</code>
    &mdash; ${reconcile.matched}/${reconcile.checked} matched.
    Static match only (heuristic / candidate).
  </p>
  ${reconcile.issues.length > 0 ? `<ul class="issue-list">${orphanRows}</ul>` : '<p class="no-issues">No cross-repo orphans.</p>'}
</section>`;
}

/** Build contract drift panel — display-only, heuristic. */
function buildContractDriftPanel(graph: SutraGraph): string {
  if (graph.contracts.length === 0) return "";

  const driftIssues = graph.issues.filter((i) => i.kind.startsWith("contract_"));
  if (driftIssues.length === 0) return "";

  const byFeature = new Map<string, SutraIssue[]>();
  for (const iss of driftIssues) {
    if (!byFeature.has(iss.feature)) byFeature.set(iss.feature, []);
    byFeature.get(iss.feature)!.push(iss);
  }

  const groups = [...byFeature.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([feature, issues]) => {
      const contract = graph.contracts.find((c) => c.feature === feature);
      const source = contract?.file ?? "unknown";
      const rows = issues
        .map((iss) => formatIssueRow(iss))
        .join("\n");
      return `<div class="drift-group"><strong>${esc(feature)}</strong> <span class="source">(${esc(source)})</span><ul class="issue-list">${rows}</ul></div>`;
    })
    .join("\n");

  return `
<section class="contract-drift-panel">
  <h2>Contract drift</h2>
  <p class="drift-meta">Declared vs observed routes &mdash; heuristic / candidate.</p>
  ${groups}
</section>`;
}

/** Build "Changes since last scan" panel — display-only, heuristic. */
function buildDiffPanel(diff: SutraDiff): string {
  if (!diffHasChanges(diff)) return "";

  const summary = formatDiffSummary(diff);
  const listItems = (label: string, items: string[]): string => {
    if (items.length === 0) return "";
    const rows = items
      .slice(0, 10)
      .map((id) => `<li><code>${esc(id)}</code></li>`)
      .join("\n");
    const more =
      items.length > 10
        ? `<li class="more">… and ${items.length - 10} more</li>`
        : "";
    return `<div class="diff-group"><strong>${esc(label)}</strong><ul>${rows}${more}</ul></div>`;
  };

  const nodeAdded = diff.nodes_added.map((n) => n.id);
  const nodeRemoved = diff.nodes_removed.map((n) => n.id);
  const issueAdded = diff.issues_added.map((i) => `${i.kind}: ${i.node}`);
  const issueRemoved = diff.issues_removed.map((i) => `${i.kind}: ${i.node}`);

  return `
<section class="diff-panel">
  <h2>Changes since last scan</h2>
  <p class="diff-meta">${esc(summary)} &mdash; structural delta only (heuristic / candidate).</p>
  ${listItems("Nodes added", nodeAdded)}
  ${listItems("Nodes removed", nodeRemoved)}
  ${listItems("Issues added", issueAdded)}
  ${listItems("Issues removed", issueRemoved)}
</section>`;
}

/** Build the detail panel HTML for one feature (rendered server-side into a hidden div). */
function buildDetailPanel(graph: SutraGraph, feature: SutraFeature, featureIssues: SutraIssue[]): string {
  const allIds = new Set(feature.node_ids);
  const truncated = allIds.size > CAP;

  // If truncated, keep first CAP ids
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

export function renderView(
  graph: SutraGraph,
  diff?: SutraDiff,
  reconcile?: ReconcileOutput,
): string {
  const totalNodes = graph.nodes.length;
  const totalEdges = graph.edges.length;
  const totalIssues = graph.issues.length;
  const contractCount = graph.contracts.length;
  const contractEndpoints = graph.contracts.reduce((n, c) => n + c.endpoints.length, 0);

  // Pre-index issues by feature
  const issuesByFeature = new Map<string, SutraIssue[]>();
  for (const iss of graph.issues) {
    if (!issuesByFeature.has(iss.feature)) issuesByFeature.set(iss.feature, []);
    issuesByFeature.get(iss.feature)!.push(iss);
  }

  const severityOrder: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

  // Feature cards
  const cards = graph.features
    .map((feat) => {
      const issues = issuesByFeature.get(feat.id) ?? [];
      const nodeIds = new Set(feat.node_ids);
      const ec = edgeCount(graph, nodeIds);
      const healthBand = feat.health?.band ?? (issues.length === 0 ? "green" : issues.some((i) => i.severity === "error") ? "red" : "amber");
      const hcls = healthBadgeClass(healthBand);
      const healthScore = feat.health?.score ?? 0;
      const isAi = feat.label_source === "ai-inferred" && feat.ai_name;
      const displayLabel = isAi ? feat.ai_name! : feat.label;
      const aiBadge = isAi
        ? `<span class="badge badge-ai" title="ai-inferred label">AI</span>`
        : "";
      const aiSummary = isAi && feat.ai_summary
        ? `<div class="card-ai-summary">${esc(feat.ai_summary)}</div>`
        : "";
      return `
<div class="card" data-feature="${esc(feat.id)}" tabindex="0" role="button" aria-expanded="false">
  <div class="card-header">
    <span class="card-label">${esc(displayLabel)} ${aiBadge}</span>
    <span class="badge ${hcls}" title="Heuristic structural health score">${healthScore} · ${esc(healthBand)}</span>
  </div>
  ${aiSummary}
  <div class="card-meta">${feat.node_ids.length} node${feat.node_ids.length !== 1 ? "s" : ""} &middot; ${ec} edge${ec !== 1 ? "s" : ""} &middot; ${feat.issue_count} issue${feat.issue_count !== 1 ? "s" : ""}${feat.tested !== undefined ? ` &middot; tests: ${feat.test_edge_count ?? 0} (static)` : ""}${feat.tested === false ? ' &middot; <span class="untested-tag">untested</span>' : ""}</div>
  <div class="card-health-note">Heuristic structural health score — not runtime correctness</div>
</div>`;
    })
    .join("\n");

  // Detail panels
  const panels = graph.features
    .map((feat) => {
      const issues = (issuesByFeature.get(feat.id) ?? []).slice().sort(
        (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
      );
      return buildDetailPanel(graph, feat, issues);
    })
    .join("\n");

  const graphJson = JSON.stringify(graph);
  const diffPanel = diff ? buildDiffPanel(diff) : "";
  const contractDriftPanel = buildContractDriftPanel(graph);
  const reconcilePanel = reconcile ? buildReconcilePanel(reconcile) : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sutra — ${esc(graph.repo)}</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #1a1a1a; padding: 1.5rem; }
header { background: #1e293b; color: #f1f5f9; border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; }
header h1 { font-size: 1.3rem; font-weight: 700; margin-bottom: 0.4rem; }
header .meta { font-size: 0.82rem; color: #94a3b8; line-height: 1.6; }
header .counts { margin-top: 0.5rem; display: flex; gap: 1.25rem; font-size: 0.85rem; }
header .counts span { background: #334155; padding: 0.15rem 0.6rem; border-radius: 4px; }
.disclaimer { background: #fef9c3; border: 1px solid #fde047; border-radius: 6px; padding: 0.6rem 1rem; font-size: 0.82rem; color: #713f12; margin-bottom: 1.25rem; }
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
.untested-tag { color: #64748b; font-style: italic; }
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
.issue-low-confidence .prov-chip { color: #92400e; background: #fef3c7; }
.sev { font-weight: 700; margin-right: 0.4rem; }
.no-issues { font-size: 0.82rem; color: #16a34a; }
.diff-panel { background: #fff; border: 1px solid #cbd5e1; border-left: 4px solid #6366f1; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
.diff-panel h2 { font-size: 1rem; font-weight: 700; margin-bottom: 0.35rem; }
.diff-meta { font-size: 0.8rem; color: #64748b; margin-bottom: 0.75rem; }
.diff-group { margin-bottom: 0.65rem; font-size: 0.82rem; }
.diff-group ul { list-style: none; margin-top: 0.25rem; padding-left: 0.5rem; }
.diff-group li { padding: 0.15rem 0; color: #334155; }
.diff-group li.more { color: #64748b; font-style: italic; }
.diff-group code { font-size: 0.78rem; background: #f1f5f9; padding: 0.1rem 0.35rem; border-radius: 3px; }
.contract-drift-panel { background: #fff; border: 1px solid #cbd5e1; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
.contract-drift-panel h2 { font-size: 1rem; font-weight: 700; margin-bottom: 0.35rem; }
.drift-meta { font-size: 0.8rem; color: #64748b; margin-bottom: 0.75rem; }
.drift-group { margin-bottom: 0.75rem; font-size: 0.82rem; }
.reconcile-panel { background: #fff; border: 1px solid #cbd5e1; border-left: 4px solid #8b5cf6; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
.reconcile-panel h2 { font-size: 1rem; font-weight: 700; margin-bottom: 0.35rem; }
.contract-filter { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 0.65rem 1rem; margin-bottom: 1rem; font-size: 0.82rem; }
.contract-filter label { margin-right: 0.5rem; color: #475569; }
.contract-filter select { padding: 0.25rem 0.5rem; border-radius: 4px; border: 1px solid #cbd5e1; }
.card.filtered-out { opacity: 0.35; pointer-events: none; }
</style>
</head>
<body>

<header>
  <h1>Sutra &mdash; ${esc(graph.repo)}</h1>
  <div class="meta">
    Scanned: ${esc(graph.scanned_at)} &nbsp;&middot;&nbsp; Commit: <code>${esc(graph.commit)}</code>
  </div>
  <div class="counts">
    <span>${totalNodes} nodes</span>
    <span>${totalEdges} edges</span>
    <span>${totalIssues} issues</span>
    <span>${graph.features.length} features</span>
    ${contractCount > 0 ? `<span>${contractCount} contracts · ${contractEndpoints} declared endpoints</span>` : ""}
  </div>
</header>

<div class="disclaimer">
  &#9432; Heuristic grouping &mdash; candidate results, not complete. Feature boundaries are approximate. Review findings before acting on them.
</div>

${graph.contracts.length > 0 ? `
<div class="contract-filter">
  <label for="contract-filter-select">Filter by contract feature:</label>
  <select id="contract-filter-select">
    <option value="">All features</option>
    ${graph.contracts.map((c) => `<option value="${esc(c.feature)}">${esc(c.feature)} (${esc(c.file)})</option>`).join("\n")}
  </select>
</div>` : ""}

${diffPanel}

${contractDriftPanel}

${reconcilePanel}

<div class="grid" id="feature-grid">
${cards}
</div>

<div id="detail-root">
${panels}
</div>

<script type="application/json" id="sutra-graph">${graphJson}</script>

<script>
(function () {
  "use strict";

  mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });

  var rendered = {};
  var activeCard = null;

  function showDetail(featureId) {
    var panel = document.getElementById("detail-" + featureId);
    if (!panel) return;

    // Hide all panels
    var allPanels = document.querySelectorAll(".detail-panel");
    for (var i = 0; i < allPanels.length; i++) {
      allPanels[i].style.display = "none";
    }

    // Deactivate previous card
    if (activeCard) {
      activeCard.classList.remove("active");
      activeCard.setAttribute("aria-expanded", "false");
    }

    panel.style.display = "block";
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });

    // Render mermaid lazily
    if (!rendered[featureId]) {
      rendered[featureId] = true;
      var pre = panel.querySelector(".mermaid");
      if (pre) {
        mermaid.run({ nodes: [pre] });
      }
    }
  }

  function toggleCard(card) {
    var featureId = card.getAttribute("data-feature");
    var panel = document.getElementById("detail-" + featureId);
    if (!panel) return;

    var isVisible = panel.style.display !== "none";

    if (isVisible && activeCard === card) {
      // clicking active card hides it
      panel.style.display = "none";
      card.classList.remove("active");
      card.setAttribute("aria-expanded", "false");
      activeCard = null;
    } else {
      showDetail(featureId);
      card.classList.add("active");
      card.setAttribute("aria-expanded", "true");
      activeCard = card;
    }
  }

  var grid = document.getElementById("feature-grid");
  if (grid) {
    grid.addEventListener("click", function (e) {
      var card = e.target.closest(".card");
      if (card) toggleCard(card);
    });
    grid.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        var card = e.target.closest(".card");
        if (card) { e.preventDefault(); toggleCard(card); }
      }
    });
  }

  var filterSelect = document.getElementById("contract-filter-select");
  if (filterSelect && grid) {
    filterSelect.addEventListener("change", function () {
      var val = filterSelect.value;
      var cards = grid.querySelectorAll(".card");
      for (var j = 0; j < cards.length; j++) {
        var c = cards[j];
        if (!val) {
          c.classList.remove("filtered-out");
        } else {
          var label = c.querySelector(".card-label");
          var text = label ? label.textContent : "";
          if (text.toLowerCase().indexOf(val.toLowerCase()) !== -1 || c.getAttribute("data-feature") === val) {
            c.classList.remove("filtered-out");
          } else {
            c.classList.add("filtered-out");
          }
        }
      }
    });
  }
})();
</script>

</body>
</html>`;
}
