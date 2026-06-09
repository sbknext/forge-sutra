/**
 * Story 1.5.3 — Shareable graph link.
 *
 * Produces a self-contained HTML artifact at .sutra/share/view-<repo>-<YYYYMMDD-HHMMSS>.html
 * that embeds the graph data and the viewer SPA inline — no external dependencies,
 * no server required to open it.
 *
 * Honesty rules (sutra+fuse core principle):
 * - The snapshot label is mandatory. Recipients must know it's a point-in-time export.
 * - If scanned_at is missing from graph, label is "Snapshot — scan date unknown."
 * - The artifact does NOT include API keys or secrets from the scanned repo.
 *   Scan runs in the same masking context as the normal viewer (external-host allowlist,
 *   no raw values emitted to the graph).
 * - The CTA is factual: "Host this file on any static server."
 *   Sutra does not host anything.
 * - "Copy local path" not "Copy link" — we can only copy a local path, not a hosted URL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SutraGraph } from "../types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Absolute path to the viewer/ directory (contains app.js, styles.css, etc.) */
const VIEWER_DIR = path.resolve(__dirname, "../../viewer");

const BRAIN_INSTALL_LINK = "https://docs.sbknext.com/brain/install";

export interface ShareOptions {
  /** Override default output path (.sutra/share/view-<repo>-<ts>.html). */
  out?: string;
}

export interface ShareResult {
  /** Absolute path of the written HTML artifact. */
  outPath: string;
  /** Approximate file size in bytes. */
  sizeBytes: number;
}

/**
 * Format timestamp as YYYYMMDD-HHMMSS (UTC) — deterministic-ish + human-readable.
 * If date is invalid, returns "unknown".
 */
export function formatTimestamp(d: Date): string {
  if (isNaN(d.getTime())) return "unknown";
  const p = (n: number, len = 2): string => String(n).padStart(len, "0");
  return (
    `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

/** Sanitize repo name for use in a filename: keep alphanumeric, dash, dot; replace everything else. */
function sanitizeRepoName(repo: string): string {
  return repo.replace(/[^a-zA-Z0-9.\-]/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "") || "repo";
}

/**
 * Build the default output path for a share artifact.
 * Pattern: <cwd>/.sutra/share/view-<repo>-<YYYYMMDD-HHMMSS>.html
 */
export function defaultSharePath(cwd: string, repoName: string, timestamp: Date): string {
  const ts = formatTimestamp(timestamp);
  const safe = sanitizeRepoName(repoName);
  return path.join(cwd, ".sutra", "share", `view-${safe}-${ts}.html`);
}

/**
 * Inline all CSS and JS assets from the viewer directory into the HTML template.
 * The resulting HTML is a single self-contained file with no external dependencies
 * except mermaid (loaded from CDN — document the CDN requirement).
 *
 * SSE + Reload + Export View are suppressed via window.__SUTRA_STATIC__ = true.
 * Graph data is inlined as window.__SUTRA_GRAPH__.
 */
export function buildShareHtml(graph: SutraGraph): string {
  // Read viewer assets
  const readAsset = (name: string): string => {
    const p = path.join(VIEWER_DIR, name);
    if (!fs.existsSync(p)) return `/* ${name} not found */`;
    return fs.readFileSync(p, "utf8");
  };

  const styles = readAsset("styles.css");
  const ecosystemJs = readAsset("ecosystem.js");
  const drilldownJs = readAsset("drilldown.js");
  const appJs = readAsset("app.js");

  const scannedAt = graph.scanned_at ?? "";
  const snapshotLabel = scannedAt
    ? `Snapshot taken: ${scannedAt}`
    : "Snapshot — scan date unknown";

  // Inline graph JSON. JSON.stringify produces safe JSON (no </script> injection).
  // We additionally escape </script> in the graph data for defense-in-depth.
  const graphJson = JSON.stringify(graph).replace(/<\/script>/gi, "<\\/script>");

  // Local file path for "Copy local path" feature (filled in post-write if out path is known).
  // We embed a placeholder; the caller may substitute it after writing.
  const SHARE_PATH_PLACEHOLDER = "__SUTRA_SHARE_PATH_PLACEHOLDER__";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sutra snapshot — ${escapeHtml(graph.repo)}</title>
<!-- Mermaid loaded from CDN — required for feature graph diagrams.
     This is the only external dependency in this self-contained artifact. -->
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>
/* === Sutra viewer styles (inlined) === */
${styles}
/* === Share artifact overrides === */
.sutra-snapshot-label {
  display: inline-block;
  background: #f1f5f9;
  color: #475569;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  margin-top: 0.3rem;
  border: 1px solid #cbd5e1;
}
.sutra-share-cta {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  padding: 0.5rem 0.9rem;
  font-size: 0.8rem;
  color: #1d4ed8;
  margin-bottom: 1rem;
}
.sutra-share-cta a { color: #1d40af; }
</style>
</head>
<body>

<!-- Sutra share artifact — self-contained snapshot.
     Generated by: forge-sutra share
     Repo: ${escapeHtml(graph.repo)}
     ${snapshotLabel}
     No server required to open this file.
     Mermaid diagrams require internet access (CDN). -->

<div id="view-grid">

<header id="app-header">
  <h1>Sutra — ${escapeHtml(graph.repo)}</h1>
  <div class="meta" id="header-meta">Loading graph…</div>
  <div class="counts" id="header-counts"></div>
  <div class="sutra-snapshot-label" id="snapshot-label" title="Point-in-time export — not a live feed">
    &#128247; ${escapeHtml(snapshotLabel)}
  </div>
  <!-- live-status hidden in static mode via __SUTRA_STATIC__ gate -->
  <div id="live-status" class="live-status-badge live-disconnected" style="display:none"></div>
</header>

<div class="sutra-share-cta">
  &#127758; Host this file on any static server (GitHub Pages, Cloudflare Pages, Netlify) &mdash; or
  give it memory: <a href="${BRAIN_INSTALL_LINK}" target="_blank" rel="noopener">Brain install &#8599;</a>
  &nbsp;&middot;&nbsp;
  <em>Candidate results only &mdash; heuristic structural scan, not complete analysis.</em>
</div>

<div class="disclaimer" id="disclaimer">
  &#9432; Heuristic grouping &mdash; candidate results, not complete. Feature boundaries are approximate. Review findings before acting on them.
</div>

<div class="toolbar">
  <!-- btn-reload hidden in static mode -->
  <button type="button" id="btn-reload" style="display:none">Reload graph</button>
  <button type="button" id="tab-ecosystem" class="disabled" title="Ecosystem view requires live viewer">Ecosystem</button>
  <label>Sort
    <select id="sort-key">
      <option value="health" selected>Health (worst first)</option>
      <option value="health-best">Health (best first)</option>
      <option value="issues">Issue count</option>
      <option value="name">Name A–Z</option>
    </select>
  </label>
  <span id="health-filter" class="health-filter"></span>
  <label>Search <input type="search" id="filter-search" placeholder="feature, endpoint, node…"></label>
  <label>Confidence ≥ <input type="range" id="filter-confidence" min="0" max="1" step="0.05" value="0"> <span id="conf-readout">0.00</span></label>
  <span id="issue-kind-filter"></span>
  <span id="filter-readout" class="meta"></span>
  <!-- Share button: copies local path + hash in static mode -->
  <button type="button" id="btn-share">Copy local path</button>
  <!-- Export view hidden in static mode (POST /export-view needs a live server) -->
  <button type="button" id="btn-export" style="display:none">Export view</button>
  <div id="filter-empty" class="error-state hidden">0 features match — clear filters</div>
</div>

<div id="error-state" class="error-state hidden"></div>

<div class="grid" id="feature-grid"></div>

<div id="detail-root"></div>
</div>

<div id="view-drilldown" class="hidden"></div>
<div id="view-ecosystem" class="hidden"></div>

<!-- Static mode: graph inlined, no server fetch needed. -->
<script>
window.SUTRA_GRAPH_VERSION = ${graph.version ?? 0};
window.SUTRA_LINK_VERSION = 0;
window.__SUTRA_STATIC__ = true;
window.__SUTRA_SHARE_PATH__ = "${SHARE_PATH_PLACEHOLDER}";
window.__SUTRA_GRAPH__ = ${graphJson};
</script>
<script>
/* === Sutra ecosystem SPA (inlined) === */
${ecosystemJs}
</script>
<script>
/* === Sutra drilldown SPA (inlined) === */
${drilldownJs}
</script>
<script>
/* === Sutra viewer SPA (inlined) === */
${appJs}
</script>
</body>
</html>`;
}

/** Minimal HTML escaping for attribute / text values. */
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Write the share artifact.
 * Returns the absolute path written and its size in bytes.
 */
export function writeShareArtifact(
  graph: SutraGraph,
  cwd: string,
  opts?: ShareOptions,
): ShareResult {
  const timestamp = new Date(graph.scanned_at ?? Date.now());
  const outPath = opts?.out
    ? path.resolve(opts.out)
    : defaultSharePath(cwd, graph.repo, timestamp);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // Build HTML then substitute the placeholder with the real path.
  let html = buildShareHtml(graph);
  // Escape the path for safe embedding inside a JS string literal inside a <script> block.
  // Order matters: backslash first, then the remaining special chars.
  const safePath = outPath
    .replace(/\\/g, "\\\\")   // backslash
    .replace(/"/g, '\\"')      // double-quote (string delimiter)
    .replace(/\r/g, "\\r")     // carriage return (line terminator → breaks string literal)
    .replace(/\n/g, "\\n")     // newline (line terminator → breaks string literal)
    .replace(/<!--/g, "<\\!--") // HTML comment open (can confuse script parsers)
    .replace(/<\/script/gi, "<\\/script"); // </script would close the enclosing <script> tag
  html = html.replace("__SUTRA_SHARE_PATH_PLACEHOLDER__", safePath);

  fs.writeFileSync(outPath, html, "utf8");

  const sizeBytes = Buffer.byteLength(html, "utf8");
  return { outPath, sizeBytes };
}
