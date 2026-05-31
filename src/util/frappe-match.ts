/**
 * Match Postman/OpenAPI HTTP paths to Frappe @frappe.whitelist() dotted names.
 * Structural candidate matching only — not runtime routing verification.
 */

/** Frappe module paths may include `__init__` segments. */
const DOTTED = /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)+$/i;

/** Normalise scanned module paths (api.__init__ → api) for Postman/OFS aliases. */
export function normaliseFrappeDotted(name: string): string {
  return name.replace(/\.api\.__init__\./gi, ".api.");
}

/** Extract dotted Frappe method candidates embedded in an HTTP path. */
export function extractFrappeCandidatesFromPath(path: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /\/api\/method\/([a-z0-9_.]+)/gi,
    /\/withrun\/([a-z0-9_.]+)/gi,
    /\/liberaByData\/([a-z0-9_.]+)/gi,
    /\/libera\/([a-z0-9_.]+)/gi,
  ];
  for (const re of patterns) {
    for (const m of path.matchAll(re)) {
      const cand = m[1];
      if (cand && DOTTED.test(cand)) out.add(cand);
    }
  }
  return [...out];
}

function lastSegment(dotted: string): string {
  const parts = dotted.split(".");
  return parts[parts.length - 1] ?? dotted;
}

function appPrefix(dotted: string): string {
  return dotted.split(".")[0] ?? "";
}

/** True when node.name is a Frappe whitelist dotted path (not METHOD /url). */
export function isFrappeDottedEndpoint(name: string): boolean {
  if (!name || name.includes(" ")) return false;
  return DOTTED.test(name);
}

/**
 * True if a declared HTTP contract path corresponds to this Frappe endpoint name.
 */
export function frappeEndpointMatchesDeclared(
  declaredPath: string,
  frappeName: string,
): boolean {
  const normName = normaliseFrappeDotted(frappeName);
  for (const raw of extractFrappeCandidatesFromPath(declaredPath)) {
    const cand = normaliseFrappeDotted(raw);
    if (cand === normName) return true;
    if (normName.endsWith(cand) || cand.endsWith(normName)) return true;
    if (
      lastSegment(cand) === lastSegment(normName) &&
      appPrefix(cand) === appPrefix(normName)
    ) {
      return true;
    }
  }
  return false;
}
