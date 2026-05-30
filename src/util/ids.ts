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

/** Synthetic id for an HTTP target, e.g. "http:POST /api/capture". Stable for edges/issues. */
export function httpTargetId(method: string, urlPath: string): string {
  return `http:${method.toUpperCase()} ${urlPath}`;
}
