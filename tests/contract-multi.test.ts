/**
 * SUTRA-10.1 — multi-file contract discovery tests.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadContracts } from "../src/contracts.js";
import { scan } from "../src/scanner.js";
import { runChecks } from "../src/checks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_MULTI = path.resolve(__dirname, "fixtures/contract-multi");
const CONTRACT_DECLARED = path.resolve(__dirname, "fixtures/contract-declared");
const CONTRACT_CLEAN = path.resolve(__dirname, "fixtures/contract-clean");
const CLEAN = path.resolve(__dirname, "fixtures/clean");

describe("loadContracts — features/*.sutra.md (SUTRA-10.1)", () => {
  it("discovers and parses multiple feature contract files", () => {
    const { contracts, issues } = loadContracts(CONTRACT_MULTI);
    expect(issues).toHaveLength(0);
    expect(contracts).toHaveLength(2);

    const features = contracts.map((c) => c.feature).sort();
    expect(features).toEqual(["auth", "todos"]);

    const todos = contracts.find((c) => c.feature === "todos");
    expect(todos!.file).toBe("features/todos.sutra.md");
    expect(todos!.endpoints).toHaveLength(2);

    const auth = contracts.find((c) => c.feature === "auth");
    expect(auth!.file).toBe("features/auth.sutra.md");
    expect(auth!.endpoints).toHaveLength(2);
  });

  it("root-only repos unchanged", () => {
    const { contracts } = loadContracts(CONTRACT_DECLARED);
    expect(contracts).toHaveLength(1);
    expect(contracts[0]!.file).toBe("feature.sutra.md");
  });

  it("repo without contract files returns empty", () => {
    const { contracts, issues } = loadContracts(CLEAN);
    expect(contracts).toHaveLength(0);
    expect(issues).toHaveLength(0);
  });

  it("scan + runChecks on contract-multi produces zero structural issues", () => {
    const { nodes, edges } = scan(CONTRACT_MULTI);
    const issues = runChecks(nodes, edges);
    expect(issues).toHaveLength(0);
  });
});
