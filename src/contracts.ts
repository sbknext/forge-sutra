/**
 * Parse author-declared feature.sutra.md contracts.
 * Candidate intent only — not runtime verification.
 */

import fs from "node:fs";
import path from "node:path";
import type { SutraContract, SutraContractEndpoint, SutraIssue } from "./types.js";

const ROOT_CONTRACT = "feature.sutra.md";
const ENDPOINT_LINE = /^-\s*([A-Z]+)\s+(\/\S+)\s*$/;

function discoverContractFiles(repoRoot: string): string[] {
  const files: string[] = [];
  const rootPath = path.join(repoRoot, ROOT_CONTRACT);
  if (fs.existsSync(rootPath)) {
    files.push(rootPath);
  }

  const featuresDir = path.join(repoRoot, "features");
  if (fs.existsSync(featuresDir)) {
    walkFeatures(featuresDir, files);
  }

  return files.sort();
}

function walkFeatures(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFeatures(full, out);
    } else if (ent.isFile() && ent.name.endsWith(".sutra.md")) {
      out.push(full);
    }
  }
}

function parseContractFile(
  repoRoot: string,
  absPath: string,
): { contract: SutraContract | null; issues: SutraIssue[] } {
  const relFile = path.relative(repoRoot, absPath).split(path.sep).join("/");
  const issues: SutraIssue[] = [];

  let text: string;
  try {
    text = fs.readFileSync(absPath, "utf8");
  } catch {
    issues.push({
      severity: "warn",
      kind: "contract_parse_error",
      node: relFile,
      feature: "contract",
      message: `Could not read ${relFile}.`,
    });
    return { contract: null, issues };
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
        node: relFile,
        feature: feature,
        message: `Unparseable endpoint line in ${relFile}: ${trimmed}`,
      });
    }
  }

  if (sawEndpointsSection && endpoints.length === 0 && issues.length === 0) {
    issues.push({
      severity: "warn",
      kind: "contract_parse_error",
      node: relFile,
      feature: feature,
      message: `No valid endpoint lines under ## endpoints in ${relFile}.`,
    });
  }

  if (endpoints.length === 0) {
    return { contract: null, issues };
  }

  return {
    contract: {
      feature,
      file: relFile,
      endpoints,
    },
    issues,
  };
}

export function loadContracts(repoRoot: string): {
  contracts: SutraContract[];
  issues: SutraIssue[];
} {
  const files = discoverContractFiles(repoRoot);
  if (files.length === 0) {
    return { contracts: [], issues: [] };
  }

  const contracts: SutraContract[] = [];
  const issues: SutraIssue[] = [];

  for (const absPath of files) {
    const parsed = parseContractFile(repoRoot, absPath);
    issues.push(...parsed.issues);
    if (parsed.contract) {
      contracts.push(parsed.contract);
    }
  }

  return { contracts, issues };
}
