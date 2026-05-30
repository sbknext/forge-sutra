import path from "node:path";

/**
 * Deterministic node id: `relative/posix/path#symbol`.
 * relFile must already be repo-relative. Symbol omitted -> file-level node id.
 */
export function makeNodeId(relFile: string, symbol?: string): string {
  const posix = toPosix(relFile);
  return symbol ? `${posix}#${symbol}` : posix;
}

/** Normalize an OS path to forward-slash POSIX form for stable ids across platforms. */
export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/** Repo-relative POSIX path for an absolute file under repoRoot. */
export function relPosix(repoRoot: string, absFile: string): string {
  return toPosix(path.relative(repoRoot, absFile));
}

/**
 * Synthetic id for an HTTP target, e.g. "http:POST /api/capture".
 * When host is set (absolute URL), appends "|hostname" for external-host checks.
 */
export function httpTargetId(
  method: string,
  urlPath: string,
  host?: string | null,
): string {
  const base = `http:${method.toUpperCase()} ${urlPath}`;
  return host ? `${base}|${host.toLowerCase()}` : base;
}

/** Parse optional host suffix from an http target id. */
export function parseHttpTargetHost(id: string): string | null {
  const pipeIdx = id.indexOf("|");
  if (pipeIdx === -1) return null;
  return id.slice(pipeIdx + 1).trim().toLowerCase() || null;
}
