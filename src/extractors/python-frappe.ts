/**
 * Python / Frappe extractor — whitelist endpoints, DocType controllers, hooks.
 */

import path from "node:path";
import fs from "node:fs";
import type { Extractor, ExtractorInput, ExtractorResult } from "../extractor.js";
import type { SutraNode, SutraEdge, NodeType } from "../types.js";
import { makeNodeId, relPosix } from "../util/ids.js";
import {
  parsePythonModule,
  hasWhitelistDecorator,
  isDocumentController,
  isControllerHook,
  parseHooksAssignments,
} from "../util/python-ast.js";

const PY_LANGUAGE = "python-frappe" as const;

const PY_EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  "dist",
  "build",
  ".frappe",
  "sites",
  ".sutra",
]);

function pyNode(base: Omit<SutraNode, "language">): SutraNode {
  return { ...base, language: PY_LANGUAGE };
}

function featureFor(rel: string): string {
  const parts = rel.split("/");
  if (parts.length <= 1) return "root";
  const doctypeIdx = parts.indexOf("doctype");
  if (doctypeIdx >= 0 && parts.length > doctypeIdx + 1) {
    return parts[doctypeIdx + 1] ?? "doctype";
  }
  return parts[0] ?? "root";
}

function collectPyFiles(root: string): string[] {
  const results: string[] = [];
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!PY_EXCLUDED_DIRS.has(e.name)) walk(full);
      } else if (e.isFile() && e.name.endsWith(".py")) {
        results.push(full);
      }
    }
  }
  walk(root);
  return results;
}

/** Detect Frappe app layout: hooks.py + doctype tree. */
export function isFrappeRepo(repoRoot: string): boolean {
  const hooksAtRoot = fs.existsSync(path.join(repoRoot, "hooks.py"));
  const hooksInApps = collectPyFiles(repoRoot).some((f) =>
    f.endsWith(`${path.sep}hooks.py`) && f.includes(`${path.sep}apps${path.sep}`),
  );
  if (!hooksAtRoot && !hooksInApps) return false;

  const hasDoctype = collectPyFiles(repoRoot).some((f) =>
    f.includes(`${path.sep}doctype${path.sep}`),
  );
  return hasDoctype;
}

/** `myapp/api/widget.py` → `myapp.api.widget` */
function modulePathFromRel(rel: string): string {
  const noExt = rel.replace(/\.py$/, "");
  return noExt.split("/").join(".");
}

/** `myapp.events.handlers.on_submit` → { rel: myapp/events/handlers.py, fn: on_submit } */
function dottedToFileFn(dotted: string): { rel: string; fn: string } {
  const parts = dotted.split(".");
  const fn = parts.pop() ?? dotted;
  const rel = `${parts.join("/")}.py`;
  return { rel, fn };
}

function qualifiedSymbol(modulePath: string, name: string, className?: string): string {
  if (className) return `${className}.${name}`;
  return name;
}

export class PythonFrappeExtractor implements Extractor {
  readonly language = PY_LANGUAGE;

  matches(filePath: string): boolean {
    return filePath.endsWith(".py");
  }

  appliesTo(repoRoot: string): boolean {
    return isFrappeRepo(repoRoot);
  }

  extract(input: ExtractorInput): ExtractorResult {
    const absRoot = path.resolve(input.repoRoot);
    const pyFiles = collectPyFiles(absRoot);
    const nodes: SutraNode[] = [];
    const edges: SutraEdge[] = [];

    /** dotted module path → node id */
    const fnByDotted = new Map<string, string>();

    for (const absPath of pyFiles) {
      const rel = relPosix(absRoot, absPath);
      if (rel.endsWith("hooks.py")) continue;

      let source: string;
      try {
        source = fs.readFileSync(absPath, "utf8");
      } catch {
        continue;
      }

      const modPath = modulePathFromRel(rel);
      const feat = featureFor(rel);
      const ast = parsePythonModule(source);

      const moduleId = makeNodeId(rel);
      nodes.push(
        pyNode({
          id: moduleId,
          type: "module",
          name: rel,
          file: rel,
          line: 1,
          data_shape: null,
          feature: feat,
        }),
      );

      for (const fn of ast.functions) {
        const sym = qualifiedSymbol(modPath, fn.name);
        const nodeId = makeNodeId(rel, sym);
        const dotted = `${modPath}.${fn.name}`;
        fnByDotted.set(dotted, nodeId);

        if (hasWhitelistDecorator(fn.decorators)) {
          nodes.push(
            pyNode({
              id: nodeId,
              type: "endpoint",
              name: dotted,
              file: rel,
              line: fn.line,
              data_shape: fn.firstParamType,
              feature: feat,
              provenance: "ast-exact",
            }),
          );
        } else {
          nodes.push(
            pyNode({
              id: nodeId,
              type: "function",
              name: fn.name,
              file: rel,
              line: fn.line,
              data_shape: fn.firstParamType,
              feature: feat,
              provenance: "ast-exact",
            }),
          );
        }
      }

      for (const cls of ast.classes) {
        if (!isDocumentController(cls.bases)) continue;
        const classSym = cls.name;
        const classId = makeNodeId(rel, classSym);
        fnByDotted.set(`${modPath}.${cls.name}`, classId);
        nodes.push(
          pyNode({
            id: classId,
            type: "handler",
            name: cls.name,
            file: rel,
            line: cls.line,
            data_shape: null,
            feature: feat,
            provenance: "ast-exact",
          }),
        );

        for (const method of cls.methods) {
          const methodSym = `${cls.name}.${method.name}`;
          const methodId = makeNodeId(rel, methodSym);
          const dotted = `${modPath}.${cls.name}.${method.name}`;
          fnByDotted.set(dotted, methodId);
          const nodeType: NodeType = isControllerHook(method.name) ? "handler" : "function";
          nodes.push(
            pyNode({
              id: methodId,
              type: nodeType,
              name: methodSym,
              file: rel,
              line: method.line,
              data_shape: method.firstParamType,
              feature: feat,
              provenance: "ast-exact",
            }),
          );
        }
      }
    }

    const resolveHandler = (dotted: string): string => {
      const exact = fnByDotted.get(dotted);
      if (exact) return exact;
      const { rel, fn } = dottedToFileFn(dotted);
      const candidate = makeNodeId(rel, fn);
      if (nodes.some((n) => n.id === candidate)) return candidate;
      return candidate;
    };

    const hooksFiles = pyFiles.filter((f) => path.basename(f) === "hooks.py");
    for (const hooksPath of hooksFiles) {
      const rel = relPosix(absRoot, hooksPath);
      let source: string;
      try {
        source = fs.readFileSync(hooksPath, "utf8");
      } catch {
        continue;
      }
      const { docEvents, schedulerJobs } = parseHooksAssignments(source);

      for (const ev of docEvents) {
        const eventId = makeNodeId(rel, `doc_events:${ev.doctype}:${ev.event}`);
        nodes.push(
          pyNode({
            id: eventId,
            type: "handler",
            name: `doc_events:${ev.doctype}:${ev.event}`,
            file: rel,
            line: 1,
            data_shape: null,
            feature: "hooks",
            provenance: "heuristic",
          }),
        );
        const targetId = resolveHandler(ev.handler);
        edges.push({
          from: eventId,
          to: targetId,
          kind: "calls",
          provenance: fnByDotted.has(ev.handler) ? "ast-exact" : "heuristic",
        });
      }

      for (const job of schedulerJobs) {
        const schedId = makeNodeId(rel, `scheduler:${job.schedule}:${job.handler}`);
        nodes.push(
          pyNode({
            id: schedId,
            type: "handler",
            name: `scheduler:${job.schedule}`,
            file: rel,
            line: 1,
            data_shape: null,
            feature: "hooks",
            provenance: "heuristic",
          }),
        );
        const targetId = resolveHandler(job.handler);
        edges.push({
          from: schedId,
          to: targetId,
          kind: "calls",
          provenance: fnByDotted.has(job.handler) ? "ast-exact" : "heuristic",
        });
      }
    }

    return { nodes, edges };
  }
}

/** Exposed for CLI scan summary. */
export { PY_LANGUAGE };
