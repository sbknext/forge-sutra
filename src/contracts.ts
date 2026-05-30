/**
 * Parse author-declared feature.sutra.md contracts.
 * Candidate intent only — not runtime verification.
 */

import fs from "node:fs";
import path from "node:path";
import type { SutraContract, SutraContractEndpoint, SutraIssue } from "./types.js";

const CONTRACT_FILE = "feature.sutra.md";
const ENDPOINT_LINE = /^-\s*([A-Z]+)\s+(\/\S+)\s*$/;

export function loadContracts(repoRoot: string): {
  contracts: SutraContract[];
  issues: SutraIssue[];
} {
  const contractPath = path.join(repoRoot, CONTRACT_FILE);
  if (!fs.existsSync(contractPath)) {
    return { contracts: [], issues: [] };
  }

  const issues: SutraIssue[] = [];
  let text: string;
  try {
    text = fs.readFileSync(contractPath, "utf8");
  } catch {
    issues.push({
      severity: "warn",
      kind: "contract_parse_error",
      node: CONTRACT_FILE,
      feature: "contract",
      message: `Could not read ${CONTRACT_FILE}.`,
    });
    return { contracts: [], issues };
  }

  const featureMatch = text.match(/^#\s*Feature:\s*(.+)$/m);
  const feature = featureMatch?.[1]?.trim() ?? "default";

  const endpoints: SutraContractEndpoint[] = [];
  let inEndpoints = false;
  let sawEndpointsSection = false;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (/^##\s+endpoints\s*$/i.test(trimmed)) {
      inEndpoints = true;
      sawEndpointsSection = true;
      continue;
    }
    if (inEndpoints && /^##\s+/.test(trimmed)) break;

    if (!inEndpoints || !trimmed) continue;

    const m = trimmed.match(ENDPOINT_LINE);
    if (m) {
      endpoints.push({
        method: m[1]!.toUpperCase(),
        path: m[2]!,
      });
      continue;
    }

    if (trimmed.startsWith("-")) {
      issues.push({
        severity: "warn",
        kind: "contract_parse_error",
        node: CONTRACT_FILE,
        feature: "contract",
        message: `Unparseable endpoint line in ${CONTRACT_FILE}: ${trimmed}`,
      });
    }
  }

  if (sawEndpointsSection && endpoints.length === 0 && issues.length === 0) {
    issues.push({
      severity: "warn",
      kind: "contract_parse_error",
      node: CONTRACT_FILE,
      feature: "contract",
      message: `No valid endpoint lines under ## endpoints in ${CONTRACT_FILE}.`,
    });
  }

  if (endpoints.length === 0 && issues.length > 0) {
    return { contracts: [], issues };
  }

  return {
    contracts: [
      {
        feature,
        file: CONTRACT_FILE,
        endpoints,
      },
    ],
    issues,
  };
}
