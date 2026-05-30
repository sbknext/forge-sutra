import fs from "node:fs";
import path from "node:path";

/** Known external API hosts — fetches here are not local route orphans. */
export const DEFAULT_EXTERNAL_HOSTS = [
  "api.telegram.org",
  "hooks.stripe.com",
] as const;

export type ExternalHostsConfig = {
  hosts: string[];
};

/**
 * Load external host allowlist: defaults + optional repo `.sutra/external-hosts.json`.
 * Unknown hosts may still produce false-positive orphaned_endpoint findings.
 */
export function loadExternalHosts(repoRoot: string): string[] {
  const merged = new Set<string>(DEFAULT_EXTERNAL_HOSTS);

  const configPath = path.join(repoRoot, ".sutra", "external-hosts.json");
  if (!fs.existsSync(configPath)) return [...merged];

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as ExternalHostsConfig;
    if (Array.isArray(parsed.hosts)) {
      for (const h of parsed.hosts) {
        if (typeof h === "string" && h.trim()) merged.add(h.trim().toLowerCase());
      }
    }
  } catch {
    // Malformed config — defaults only; scan continues (honest partial coverage).
  }

  return [...merged];
}
