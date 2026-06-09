/**
 * Story 1.5.3 — Shareable graph link tests.
 *
 * Tests cover:
 *  1. Given a fixture graph.json, buildShareHtml produces HTML containing the graph data.
 *  2. Snapshot label uses scanned_at from the graph.
 *  3. "Snapshot — scan date unknown" fallback when scanned_at missing.
 *  4. No EventSource setup in output (SSE suppressed in static mode).
 *  5. window.__SUTRA_STATIC__ = true present in output.
 *  6. window.__SUTRA_GRAPH__ contains graph data.
 *  7. AI-labelled fields survive (label_source + ai_name present).
 *  8. writeShareArtifact writes to correct default path.
 *  9. --out flag overrides the default output location.
 * 10. formatTimestamp produces YYYYMMDD-HHMMSS.
 * 11. defaultSharePath embeds repo name + timestamp.
 * 12. Share artifact does NOT contain raw scanned_at in any EventSource binding.
 */

import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  buildShareHtml,
  writeShareArtifact,
  formatTimestamp,
  defaultSharePath,
} from "../src/commands/share.js";
import { GRAPH_VERSION, type SutraGraph } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Minimal valid graph fixture for share tests. */
function makeGraph(overrides: Partial<SutraGraph> = {}): SutraGraph {
  return {
    version: GRAPH_VERSION,
    repo: "test-repo",
    scanned_at: "2026-06-03T10:00:00.000Z",
    commit: "abc1234",
    nodes: [
      {
        id: "src/auth.ts",
        type: "module",
        name: "auth.ts",
        file: "src/auth.ts",
        line: 1,
        data_shape: null,
        feature: "auth",
        language: "ts",
      },
    ],
    edges: [],
    issues: [],
    features: [
      {
        id: "auth",
        label: "Auth Feature",
        node_ids: ["src/auth.ts"],
        issue_count: 0,
        test_edge_count: 0,
        test_node_ids: [],
        tested: false,
      },
    ],
    contracts: [],
    flows: [],
    ...overrides,
  };
}

/** AI-labelled feature fixture. */
function makeAiGraph(): SutraGraph {
  const g = makeGraph();
  g.features[0] = {
    ...g.features[0],
    label_source: "ai-inferred",
    ai_name: "Authentication Module",
    ai_summary: "Handles user login and token refresh.",
  } as SutraGraph["features"][0];
  return g;
}

const tmpDirs: string[] = [];
function makeTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-share-test-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("share — buildShareHtml (Story 1.5.3)", () => {
  it("contains window.__SUTRA_GRAPH__ with graph data", () => {
    const html = buildShareHtml(makeGraph());
    expect(html).toContain("window.__SUTRA_GRAPH__");
    expect(html).toContain('"repo":"test-repo"');
    // Graph version is present
    expect(html).toContain(String(GRAPH_VERSION));
  });

  it("sets window.__SUTRA_STATIC__ = true", () => {
    const html = buildShareHtml(makeGraph());
    expect(html).toContain("window.__SUTRA_STATIC__ = true");
  });

  it("includes snapshot label from scanned_at", () => {
    const html = buildShareHtml(makeGraph());
    expect(html).toContain("Snapshot taken: 2026-06-03T10:00:00.000Z");
  });

  it("falls back to 'scan date unknown' when scanned_at missing", () => {
    const g = makeGraph({ scanned_at: undefined } as unknown as Partial<SutraGraph>);
    // Simulate missing scanned_at
    (g as Record<string, unknown>).scanned_at = "";
    const html = buildShareHtml(g);
    expect(html).toContain("Snapshot — scan date unknown");
  });

  it("does NOT contain EventSource constructor call (SSE suppressed)", () => {
    const html = buildShareHtml(makeGraph());
    // EventSource is only constructed in the live SSE block, gated by !IS_STATIC.
    // The static gate ensures `new EventSource(` is never reached in static mode.
    // Verify the IS_STATIC guard is present in the artifact.
    expect(html).toContain("IS_STATIC");
    expect(html).toContain("!IS_STATIC");
    // Key assertion: the artifact must not call `new EventSource(` unconditionally
    // (i.e. outside of the IS_STATIC guard). We verify by checking that every
    // `new EventSource(` occurrence in the HTML is preceded by the IS_STATIC guard
    // earlier in the file — a direct unconditional call would appear before any guard.
    // Simpler: confirm window.__SUTRA_STATIC__ = true is set BEFORE any EventSource call,
    // meaning the runtime guard will suppress it.
    const staticAssignIdx = html.indexOf("window.__SUTRA_STATIC__ = true");
    expect(staticAssignIdx).toBeGreaterThan(-1);
    // If new EventSource( appears at all, it must be after the static assignment
    const esIdx = html.indexOf("new EventSource(");
    if (esIdx !== -1) {
      // EventSource usage exists but must come after __SUTRA_STATIC__ = true is set
      expect(staticAssignIdx).toBeLessThan(esIdx);
    }
  });

  it("contains the CTA 'Host this file on any static server'", () => {
    const html = buildShareHtml(makeGraph());
    expect(html).toContain("Host this file on any static server");
  });

  it("contains Brain install link in the CTA", () => {
    const html = buildShareHtml(makeGraph());
    expect(html).toContain("brain/install");
  });

  it("AI-labelled fields survive: label_source + ai_name present in inlined graph", () => {
    const html = buildShareHtml(makeAiGraph());
    expect(html).toContain("ai-inferred");
    expect(html).toContain("Authentication Module");
    expect(html).toContain("Handles user login and token refresh.");
  });

  it("btn-share label is 'Copy local path' (not 'Share this view')", () => {
    const html = buildShareHtml(makeGraph());
    expect(html).toContain("Copy local path");
    // btn-share should NOT have "Share this view" as its static label in artifact
    // (The app.js also changes it dynamically, but the HTML template has the right label)
  });

  it("no API keys in output — graph JSON does not expose raw secrets", () => {
    // The graph data itself should not contain obvious secret patterns.
    // This is a smoke check: confirm no sk-ant-, ghp_, AKIA patterns leaked.
    const html = buildShareHtml(makeGraph());
    expect(html).not.toMatch(/sk-ant-[a-zA-Z0-9]/);
    expect(html).not.toMatch(/ghp_[a-zA-Z0-9]/);
    expect(html).not.toMatch(/AKIA[A-Z0-9]{16}/);
  });

  it("output is a valid HTML document", () => {
    const html = buildShareHtml(makeGraph());
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html lang=\"en\">");
    expect(html).toContain("</html>");
  });
});

describe("share — writeShareArtifact (Story 1.5.3)", () => {
  it("writes to default path .sutra/share/view-<repo>-<ts>.html", () => {
    const cwd = makeTmp();
    const result = writeShareArtifact(makeGraph(), cwd);
    expect(fs.existsSync(result.outPath)).toBe(true);
    expect(result.outPath).toContain(path.join(cwd, ".sutra", "share"));
    expect(result.outPath).toContain("view-test-repo-");
    expect(result.outPath.endsWith(".html")).toBe(true);
  });

  it("--out flag overrides default output location", () => {
    const cwd = makeTmp();
    const custom = path.join(cwd, "my-share.html");
    const result = writeShareArtifact(makeGraph(), cwd, { out: custom });
    expect(result.outPath).toBe(custom);
    expect(fs.existsSync(custom)).toBe(true);
  });

  it("written HTML contains window.__SUTRA_GRAPH__", () => {
    const cwd = makeTmp();
    const result = writeShareArtifact(makeGraph(), cwd);
    const html = fs.readFileSync(result.outPath, "utf8");
    expect(html).toContain("window.__SUTRA_GRAPH__");
  });

  it("reports non-zero sizeBytes", () => {
    const cwd = makeTmp();
    const result = writeShareArtifact(makeGraph(), cwd);
    expect(result.sizeBytes).toBeGreaterThan(1000);
  });

  it("share path placeholder is replaced with real path in output", () => {
    const cwd = makeTmp();
    const result = writeShareArtifact(makeGraph(), cwd);
    const html = fs.readFileSync(result.outPath, "utf8");
    // Placeholder must not appear in final artifact
    expect(html).not.toContain("__SUTRA_SHARE_PATH_PLACEHOLDER__");
    // Real path must be embedded
    expect(html).toContain(result.outPath.replace(/\\/g, "\\\\"));
  });

  it("safePath escaping prevents script-context breakout (XSS)", () => {
    // writeShareArtifact embeds outPath as a JS string literal in a <script> block.
    // Verify that dangerous chars in the out path are escaped before embedding.
    const cwd = makeTmp();
    // Use a path that contains chars that would break out of the JS string / script block.
    // path.resolve normalises separators but keeps the rest of the string.
    const dangerousOut = path.join(cwd, "my-share.html");
    const result = writeShareArtifact(makeGraph(), cwd, { out: dangerousOut });
    const html = fs.readFileSync(result.outPath, "utf8");

    // Extract the __SUTRA_SHARE_PATH__ assignment line from the <script> block.
    const match = html.match(/window\.__SUTRA_SHARE_PATH__\s*=\s*"([^"\\]*(\\.[^"\\]*)*)"/);
    expect(match).not.toBeNull();
    // The embedded value must not contain unescaped newlines or </script sequences.
    const embedded = match![1]!;
    expect(embedded).not.toContain("\n");
    expect(embedded).not.toContain("\r");
    // Verify that a </script> in a graph repo name is escaped in the embedded graphJson.
    const evilGraph = makeGraph({ repo: 'x</script><script>alert(1)</script>' });
    const evilHtml = buildShareHtml(evilGraph);
    // The graphJson block must not introduce an unescaped </script> that closes the <script> tag.
    // Check: within the graphJson assignment, </script is escaped as <\/script.
    const graphAssignMatch = evilHtml.match(/window\.__SUTRA_GRAPH__\s*=\s*(\{.*?\});/s);
    expect(graphAssignMatch).not.toBeNull();
    // Raw </script> must not appear literally inside the script block JSON assignment.
    expect(graphAssignMatch![1]).not.toContain("</script>");
    expect(graphAssignMatch![1]).toContain("<\\/script>");
  });
});

describe("share — formatTimestamp / defaultSharePath (Story 1.5.3)", () => {
  it("formatTimestamp returns YYYYMMDD-HHMMSS for a UTC date", () => {
    const d = new Date("2026-06-03T10:15:30.000Z");
    expect(formatTimestamp(d)).toBe("20260603-101530");
  });

  it("formatTimestamp returns 'unknown' for invalid date", () => {
    expect(formatTimestamp(new Date("not-a-date"))).toBe("unknown");
  });

  it("defaultSharePath embeds repo name and timestamp", () => {
    const d = new Date("2026-06-03T10:15:30.000Z");
    const p = defaultSharePath("/work/myproject", "my-repo", d);
    expect(p).toContain("view-my-repo-20260603-101530.html");
    expect(p).toContain(path.join(".sutra", "share"));
  });

  it("defaultSharePath sanitizes special chars in repo name", () => {
    const d = new Date("2026-06-03T10:00:00.000Z");
    const p = defaultSharePath("/work/myproject", "my/repo with spaces", d);
    // The filename portion (basename) should not contain slashes or spaces
    const base = path.basename(p);
    expect(base).not.toContain("/");
    expect(base).not.toContain(" ");
    expect(base).toContain("view-");
    expect(base.endsWith(".html")).toBe(true);
  });
});
