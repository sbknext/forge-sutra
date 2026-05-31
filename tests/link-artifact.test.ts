/**
 * Story 1.4 / Fix B — link.json production on scan.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runScanPipeline } from "../src/watch.js";
import {
  emptyLinkResult,
  writeLinkFile,
  linkFilePath,
} from "../src/link.js";
import { LINK_FILE, SUTRA_DIR, LINK_VERSION } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLEAN = path.resolve(__dirname, "fixtures/clean");

describe("link.json artifact (Fix B)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sutra-link-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("emptyLinkResult is valid LinkResult shape", () => {
    const link = emptyLinkResult("myrepo", CLEAN, "abc");
    expect(link.version).toBe(LINK_VERSION);
    expect(link.repos).toHaveLength(1);
    expect(link.edges).toEqual([]);
  });

  it("writeLinkFile creates .sutra/link.json", () => {
    const link = emptyLinkResult("myrepo", CLEAN);
    const out = writeLinkFile(tmp, link);
    expect(out).toBe(linkFilePath(tmp));
    expect(fs.existsSync(out)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(parsed.edges).toEqual([]);
  });

  it("runScanPipeline writes link.json alongside graph.json", () => {
    runScanPipeline(CLEAN, tmp, "test");
    const linkPath = path.join(tmp, SUTRA_DIR, LINK_FILE);
    expect(fs.existsSync(linkPath)).toBe(true);
    const link = JSON.parse(fs.readFileSync(linkPath, "utf8"));
    expect(link.version).toBe(LINK_VERSION);
    expect(link.repos.length).toBeGreaterThanOrEqual(1);
  });
});
