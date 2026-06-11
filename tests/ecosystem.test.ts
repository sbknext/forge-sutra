/**
 * Story 3.4 — ecosystem map tests.
 */

import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { startViewerServer } from "../src/viewer/server.js";
import {
  buildClusters,
  linkViewModel,
  honestyClassesDistinct,
} from "../src/viewer/ecosystem.js";
import { makeCrossRepoId } from "../src/util/ids.js";
import {
  LINK_VERSION,
  LINK_FILE,
  SUTRA_DIR,
  type LinkResult,
  type SutraGraph,
} from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ECO_DIR = path.resolve(__dirname, "fixtures/ecosystem");
const REPO_B = path.join(ECO_DIR, "repo-b");

function writeLink(): void {
  const link: LinkResult = {
    version: LINK_VERSION,
    linked_at: "2026-05-30T12:00:00.000Z",
    repos: [
      { name: "client-app", path: ECO_DIR, commit: "client1" },
      { name: "server-api", path: REPO_B, commit: "server1" },
    ],
    edges: [
      {
        from: makeCrossRepoId("client-app", "lib/client.ts#fetchUsers"),
        to: makeCrossRepoId("server-api", "routes/users.js#GET /api/users"),
        kind: "http",
        resolution: "confirmed",
        method: "GET",
        path: "/api/users",
      },
      {
        from: makeCrossRepoId("client-app", "lib/client.ts#fetchMissing"),
        to: makeCrossRepoId("server-api", "POST /api/missing"),
        kind: "http",
        resolution: "broken",
        method: "POST",
        path: "/api/missing",
      },
      {
        from: makeCrossRepoId("client-app", "lib/client.ts#fetchGhost"),
        to: makeCrossRepoId("server-api", "GET /api/ghost"),
        kind: "http",
        resolution: "unresolved",
        method: "GET",
        path: "/api/ghost",
      },
    ],
  };
  fs.writeFileSync(path.join(ECO_DIR, SUTRA_DIR, LINK_FILE), JSON.stringify(link, null, 2));
}

let server: Awaited<ReturnType<typeof startViewerServer>> | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe("ecosystem — server routes (Story 3.4)", () => {
  it("GET /link.json returns LinkResult with no-store", async () => {
    writeLink();
    server = await startViewerServer(ECO_DIR, { port: 0 });
    const res = await fetch(`${server.url}link.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const link = (await res.json()) as LinkResult;
    expect(link.version).toBe(LINK_VERSION);
    expect(link.edges).toHaveLength(3);
  });

  it("repo-graph serves allowlisted repo only", async () => {
    writeLink();
    server = await startViewerServer(ECO_DIR, { port: 0 });
    const ok = await fetch(
      `${server.url}repo-graph?path=${encodeURIComponent(REPO_B)}`,
    );
    expect(ok.status).toBe(200);
    const graph = (await ok.json()) as SutraGraph;
    expect(graph.repo).toBe("server-api");

    const bad = await fetch(
      `${server.url}repo-graph?path=${encodeURIComponent("/etc/passwd")}`,
    );
    expect(bad.status).toBe(404);
  });
});

describe("ecosystem — Story 8.6 empty / single-repo states", () => {
  it("linkViewModel returns empty array for empty link", () => {
    const emptyLink: LinkResult = {
      version: LINK_VERSION,
      linked_at: new Date().toISOString(),
      repos: [{ name: "my-app", path: ECO_DIR }],
      edges: [],
    };
    expect(linkViewModel(emptyLink, new Map(), false)).toHaveLength(0);
    expect(linkViewModel(emptyLink, new Map(), true)).toHaveLength(0);
  });

  it("buildClusters returns one entry for single-repo empty link", () => {
    const emptyLink: LinkResult = {
      version: LINK_VERSION,
      linked_at: new Date().toISOString(),
      repos: [{ name: "my-app", path: ECO_DIR }],
      edges: [],
    };
    const clusters = buildClusters(emptyLink, new Map());
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.endpointIds).toHaveLength(0);
  });

  it("GET /link.json absent returns 200 with valid stub (AC1)", async () => {
    // ECO_DIR has link.json written by writeLink(); test without it
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-eco-nolink-"));
    fs.mkdirSync(path.join(tmp, SUTRA_DIR), { recursive: true });
    server = await startViewerServer(tmp, { port: 0 });
    const res = await fetch(`${server.url}link.json`);
    expect(res.status).toBe(200);
    const link = await res.json() as LinkResult;
    expect(link.version).toBe(LINK_VERSION);
    expect(link.edges).toHaveLength(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("ecosystem — model (Story 3.4)", () => {
  it("builds two clusters from link repos", () => {
    writeLink();
    const link = JSON.parse(
      fs.readFileSync(path.join(ECO_DIR, SUTRA_DIR, LINK_FILE), "utf8"),
    ) as LinkResult;
    const client = JSON.parse(
      fs.readFileSync(path.join(ECO_DIR, SUTRA_DIR, "graph.json"), "utf8"),
    ) as SutraGraph;
    const serverGraph = JSON.parse(
      fs.readFileSync(path.join(REPO_B, SUTRA_DIR, "graph.json"), "utf8"),
    ) as SutraGraph;
    const graphs = new Map([
      ["client-app", client],
      ["server-api", serverGraph],
    ]);
    const clusters = buildClusters(link, graphs);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.totalNodes).toBeGreaterThan(0);
  });

  it("confirmed vs broken honesty classes distinct", () => {
    writeLink();
    const link = JSON.parse(
      fs.readFileSync(path.join(ECO_DIR, SUTRA_DIR, LINK_FILE), "utf8"),
    ) as LinkResult;
    const views = linkViewModel(link, new Map(), false);
    expect(views.filter((v) => v.edge.resolution === "unresolved")).toHaveLength(0);
    expect(honestyClassesDistinct(views)).toBe(true);
    const confirmed = views.find((v) => v.edge.resolution === "confirmed")!;
    const broken = views.find((v) => v.edge.resolution === "broken")!;
    expect(confirmed.renderClass).not.toBe(broken.renderClass);
  });

  it("unresolved hidden by default, visible when toggled", () => {
    writeLink();
    const link = JSON.parse(
      fs.readFileSync(path.join(ECO_DIR, SUTRA_DIR, LINK_FILE), "utf8"),
    ) as LinkResult;
    expect(linkViewModel(link, new Map(), false)).toHaveLength(2);
    expect(linkViewModel(link, new Map(), true)).toHaveLength(3);
  });
});
