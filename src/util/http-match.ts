/**
 * Shared HTTP path matching — used by checks.ts and flows.ts.
 */

import type { SutraNode } from "../types.js";

export function normalisePath(p: string): string {
  const s = p.toLowerCase().replace(/\/+$/, "") || "/";
  return s;
}

export function segments(p: string): string[] {
  return p.split("/").filter(Boolean);
}

export function isDynamic(seg: string): boolean {
  return seg.startsWith(":") || (seg.startsWith("[") && seg.endsWith("]"));
}

export function pathMatches(definedPath: string, clientPath: string): boolean {
  const defSegs = segments(normalisePath(definedPath));
  const cliSegs = segments(normalisePath(clientPath));
  if (defSegs.length !== cliSegs.length) return false;
  for (let i = 0; i < defSegs.length; i++) {
    if (isDynamic(defSegs[i]!) || isDynamic(cliSegs[i]!)) continue;
    if (defSegs[i] !== cliSegs[i]) return false;
  }
  return true;
}

export function parseEndpointDef(
  node: SutraNode,
): { method: string; path: string } | null {
  const sources = [node.name, node.data_shape ?? ""];
  for (const src of sources) {
    const m = src.match(/^([A-Z]+):?\s+(\/[^\s]*)$/i);
    if (m) {
      return { method: m[1]!.toUpperCase(), path: m[2]! };
    }
  }
  return null;
}

export function parseHttpTargetId(
  id: string,
): { method: string; path: string; host: string | null } | null {
  const body = id.slice("http:".length).trim();
  let host: string | null = null;
  let methodPath = body;
  const pipeIdx = body.indexOf("|");
  if (pipeIdx !== -1) {
    methodPath = body.slice(0, pipeIdx).trim();
    host = body.slice(pipeIdx + 1).trim().toLowerCase() || null;
  }
  const m = methodPath.match(/^([A-Z]+)\s+(\/[^\s]*)$/i);
  if (!m) return null;
  return { method: m[1]!.toUpperCase(), path: m[2]!, host };
}

export function collectProxyPrefixes(nodes: SutraNode[]): string[] {
  const prefixes: string[] = [];
  for (const n of nodes) {
    if (n.type === "route" && n.name.startsWith("PROXY ")) {
      prefixes.push(n.name.slice("PROXY ".length));
    }
  }
  return prefixes;
}

export function isCoveredByProxy(
  urlPath: string,
  proxyPrefixes: string[],
): boolean {
  for (const prefix of proxyPrefixes) {
    if (prefix === "/") return true;
    if (urlPath === prefix) return true;
    if (urlPath.startsWith(prefix + "/")) return true;
  }
  return false;
}

export function collectExternalHosts(nodes: SutraNode[]): string[] {
  const hosts: string[] = [];
  for (const n of nodes) {
    if (n.type === "route" && n.name.startsWith("EXTERNAL ")) {
      hosts.push(n.name.slice("EXTERNAL ".length).toLowerCase());
    }
  }
  return hosts;
}

/** True if path matching used a dynamic segment (candidate boundary). */
export function matchUsedDynamicSegment(
  definedPath: string,
  clientPath: string,
): boolean {
  const defSegs = segments(normalisePath(definedPath));
  const cliSegs = segments(normalisePath(clientPath));
  if (defSegs.length !== cliSegs.length) return false;
  for (let i = 0; i < defSegs.length; i++) {
    if (isDynamic(defSegs[i]!) && defSegs[i] !== cliSegs[i]) return true;
  }
  return false;
}
