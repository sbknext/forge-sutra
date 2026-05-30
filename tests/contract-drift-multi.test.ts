/**
 * SUTRA-10.2 — multi-contract drift aggregation tests.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "../src/scanner.js";
import { loadContracts } from "../src/contracts.js";
import { checkContractDrift } from "../src/checks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_MULTI = path.resolve(__dirname, "fixtures/contract-multi");

describe("checkContractDrift — multi-contract (SUTRA-10.2)", () => {
  it("flags contract_missing_route per contract file with feature tag", () => {
    const { nodes } = scan(CONTRACT_MULTI);
    const { contracts } = loadContracts(CONTRACT_MULTI);
    const drift = checkContractDrift(contracts, nodes);
    const missing = drift.filter((i) => i.kind === "contract_missing_route");

    expect(missing.length).toBeGreaterThanOrEqual(2);

    const authMissing = missing.find(
      (i) => i.feature === "auth" && i.node.includes("/api/auth/login"),
    );
    expect(authMissing).toBeDefined();
    expect(authMissing!.message).toContain("features/auth.sutra.md");
    expect(authMissing!.feature).toBe("auth");

    const todosMissing = missing.find(
      (i) => i.feature === "todos" && i.node.includes("POST") && i.node.includes("/api/todos"),
    );
    expect(todosMissing).toBeDefined();
    expect(todosMissing!.message).toContain("features/todos.sutra.md");
    expect(todosMissing!.feature).toBe("todos");
  });

  it("does not use generic 'contract' feature tag on drift issues", () => {
    const { nodes } = scan(CONTRACT_MULTI);
    const { contracts } = loadContracts(CONTRACT_MULTI);
    const drift = checkContractDrift(contracts, nodes);
    const driftKinds = drift.filter(
      (i) => i.kind === "contract_missing_route" || i.kind === "contract_undeclared_route",
    );
    for (const iss of driftKinds) {
      expect(iss.feature).not.toBe("contract");
    }
  });
});
