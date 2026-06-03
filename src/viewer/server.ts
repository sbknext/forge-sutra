/**
 * Local viewer HTTP server — leaf renderer, reads graph.json only.
 * Binds 127.0.0.1 only; no auth; no scanner imports.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderFilteredView } from "./export-view.js";
import { slugifyViewState, decodeViewState } from "./viewState.js";
import {
  GRAPH_VERSION,
  LINK_VERSION,
  SUTRA_DIR,
  GRAPH_FILE,
  LINK_FILE,
  type LinkResult,
  type SutraGraph,
} from "../types.js";
import { emptyLinkResult } from "../link.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, "../..");
const VIEWER_DIR = path.join(PACKAGE_ROOT, "viewer");

export const DEFAULT_VIEWER_PORT = 4577;

const ALLOWED_ASSETS = new Set([
  "index.html",
  "app.js",
  "styles.css",
  "ecosystem.js",
  "drilldown.js",
]);

export interface ViewerServer {
  url: string;
  port: number;
  /** Push a graph to all SSE clients (Story 3.5). */
  broadcastGraph?(graph: unknown): void;
  /** Push scan error to SSE clients. */
  broadcastScanError?(message: string): void;
  close(): Promise<void>;
}

export interface ViewerServerOptions {
  port?: number;
  /** Enable SSE /events endpoint (Story 3.5). */
  sse?: boolean;
}

function readLinkFresh(cwd: string): { status: number; body: string; headers: Record<string, string> } {
  const linkPath = path.join(cwd, SUTRA_DIR, LINK_FILE);
  if (!fs.existsSync(linkPath)) {
    const stub = emptyLinkResult("local", cwd);
    return {
      status: 200,
      body: JSON.stringify(stub),
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    };
  }
  try {
    const raw = fs.readFileSync(linkPath, "utf8");
    JSON.parse(raw);
    return {
      status: 200,
      body: raw,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    };
  } catch {
    return {
      status: 500,
      body: JSON.stringify({ error: "link.json is unparseable" }),
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    };
  }
}

function readRepoGraph(cwd: string, repoPathEnc: string): { status: number; body: string; headers: Record<string, string> } {
  const linkPath = path.join(cwd, SUTRA_DIR, LINK_FILE);
  if (!fs.existsSync(linkPath)) {
    return {
      status: 404,
      body: JSON.stringify({ error: "link.json not found" }),
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    };
  }

  let link: LinkResult;
  try {
    link = JSON.parse(fs.readFileSync(linkPath, "utf8")) as LinkResult;
  } catch {
    return {
      status: 500,
      body: JSON.stringify({ error: "link.json is unparseable" }),
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    };
  }

  const requested = decodeURIComponent(repoPathEnc);
  if (requested.includes("..")) {
    return {
      status: 400,
      body: JSON.stringify({ error: "invalid path" }),
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    };
  }

  const allowed = new Set(link.repos.map((r) => path.resolve(r.path)));
  const resolved = path.resolve(requested);
  if (!allowed.has(resolved)) {
    return {
      status: 404,
      body: JSON.stringify({ error: "repo not in link.json allowlist" }),
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    };
  }

  const graphPath = path.join(resolved, SUTRA_DIR, GRAPH_FILE);
  if (!fs.existsSync(graphPath)) {
    return {
      status: 404,
      body: JSON.stringify({ error: "graph.json not found for repo" }),
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    };
  }

  return {
    status: 200,
    body: fs.readFileSync(graphPath, "utf8"),
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  };
}

function readGraphFresh(cwd: string): { status: number; body: string; headers: Record<string, string> } {
  const graphPath = path.join(cwd, SUTRA_DIR, GRAPH_FILE);
  if (!fs.existsSync(graphPath)) {
    return {
      status: 404,
      body: JSON.stringify({ error: "graph.json not found — run `sutra scan` first" }),
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    };
  }
  try {
    const raw = fs.readFileSync(graphPath, "utf8");
    JSON.parse(raw);
    return {
      status: 200,
      body: raw,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    };
  } catch {
    return {
      status: 500,
      body: JSON.stringify({ error: "graph.json is unparseable" }),
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    };
  }
}

function safeAssetPath(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.replace(/^\//, ""));
  if (!decoded || decoded.includes("..") || decoded.includes("\\")) return null;

  // Vendored libs (cytoscape) — only under viewer/vendor/
  const vendorPrefix = "vendor/";
  if (decoded.startsWith(vendorPrefix)) {
    const rel = decoded.slice(vendorPrefix.length);
    if (!rel || rel.includes("/") || !/^[a-zA-Z0-9._-]+\.js$/.test(rel)) return null;
    const full = path.join(VIEWER_DIR, "vendor", rel);
    if (!full.startsWith(path.join(VIEWER_DIR, "vendor"))) return null;
    return full;
  }

  const base = path.basename(decoded);
  if (!ALLOWED_ASSETS.has(base)) return null;
  return path.join(VIEWER_DIR, base);
}

export function startViewerServer(
  cwd: string,
  opts?: ViewerServerOptions,
): Promise<ViewerServer> {
  return new Promise((resolve, reject) => {
    const sseClients = new Set<http.ServerResponse>();
    let boundPort = opts?.port ?? DEFAULT_VIEWER_PORT;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/graph.json") {
        const result = readGraphFresh(cwd);
        res.writeHead(result.status, result.headers);
        res.end(result.body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/link.json") {
        const result = readLinkFresh(cwd);
        res.writeHead(result.status, result.headers);
        res.end(result.body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/repo-graph") {
        const repoPath = url.searchParams.get("path");
        if (!repoPath) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "path query required" }));
          return;
        }
        const result = readRepoGraph(cwd, repoPath);
        res.writeHead(result.status, result.headers);
        res.end(result.body);
        return;
      }

      if (req.method === "GET" && url.pathname === "/meta") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ graphVersion: GRAPH_VERSION, linkVersion: LINK_VERSION }));
        return;
      }

      if (opts?.sse && req.method === "GET" && url.pathname === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        });
        // SSE preamble: retry interval so browsers know reconnect cadence
        res.write(": connected\nretry: 3000\n\n");
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const indexPath = path.join(VIEWER_DIR, "index.html");
        if (!fs.existsSync(indexPath)) {
          res.writeHead(404);
          res.end("viewer shell not found");
          return;
        }
        let html = fs.readFileSync(indexPath, "utf8");
        html = html
          .replace("__GRAPH_VERSION__", String(GRAPH_VERSION))
          .replace("__LINK_VERSION__", String(LINK_VERSION));
        res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
        res.end(html);
        return;
      }

      if (req.method === "POST" && url.pathname === "/export-view") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const parsed = JSON.parse(body) as { state?: string };
            const state = decodeViewState(parsed.state ?? "");
            const graphRaw = fs.readFileSync(path.join(cwd, SUTRA_DIR, GRAPH_FILE), "utf8");
            const graph = JSON.parse(graphRaw) as SutraGraph;
            const html = renderFilteredView(graph, state);
            const slug = slugifyViewState(state);
            const outName = `view.${slug}.html`;
            const outPath = path.join(cwd, SUTRA_DIR, outName);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, html, "utf8");
            res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
            res.end(JSON.stringify({ path: outPath, slug: outName }));
          } catch (err) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
        return;
      }

      if (req.method === "GET") {
        const assetPath = safeAssetPath(url.pathname);
        if (assetPath && fs.existsSync(assetPath)) {
          const ext = path.extname(assetPath);
          const ct =
            ext === ".js"
              ? "application/javascript"
              : ext === ".css"
                ? "text/css"
                : "text/html";
          res.writeHead(200, { "Content-Type": ct, "Cache-Control": "no-store" });
          res.end(fs.readFileSync(assetPath));
          return;
        }
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });

    const broadcastGraph = (graph: unknown): void => {
      const payload = `event: graph\ndata: ${JSON.stringify(graph)}\n\n`;
      for (const client of sseClients) {
        client.write(payload);
      }
    };

    const broadcastScanError = (message: string): void => {
      const payload = `event: scan-error\ndata: ${JSON.stringify({ message })}\n\n`;
      for (const client of sseClients) {
        client.write(payload);
      }
    };

    server.on("error", reject);

    server.listen(boundPort, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") boundPort = addr.port;
      resolve({
        url: `http://127.0.0.1:${boundPort}/`,
        port: boundPort,
        broadcastGraph: opts?.sse ? broadcastGraph : undefined,
        broadcastScanError: opts?.sse ? broadcastScanError : undefined,
        close: () =>
          new Promise((res, rej) => {
            for (const client of sseClients) {
              try {
                client.end();
              } catch {
                /* ignore */
              }
            }
            sseClients.clear();
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
