import path from "node:path";
import fs from "node:fs";
import { Project, SyntaxKind, Node } from "ts-morph";
import {
  EXCLUDED_DIRS,
  SCAN_EXTENSIONS,
  isExcludedFile,
  type SutraNode,
  type SutraEdge,
  type NodeType,
  type Provenance,
} from "../types.js";
import { makeNodeId, relPosix, httpTargetId } from "../util/ids.js";
import { loadExternalHosts } from "../external-hosts.js";
import type { Extractor, ExtractorInput, ExtractorResult } from "../extractor.js";
import {
  CACHE_VERSION,
  hashContent,
  isCacheHit,
  loadCache,
  saveCache,
  sortEdges,
  sortNodes,
  type CacheEntry,
  type CacheStats,
} from "../cache.js";
import { GRAPH_VERSION } from "../types.js";

const TS_LANGUAGE = "ts" as const;

function tsNode(
  base: Omit<SutraNode, "language">,
): SutraNode {
  return { ...base, language: TS_LANGUAGE };
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function collectFiles(root: string): string[] {
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
        if (!EXCLUDED_DIRS.has(e.name)) walk(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name);
        if (SCAN_EXTENSIONS.has(ext) && !isExcludedFile(e.name)) {
          results.push(full);
        }
      }
    }
  }
  walk(root);
  return results;
}

function isTestFile(rel: string): boolean {
  return (
    rel.includes(".test.") ||
    rel.includes(".spec.") ||
    rel.includes("__tests__/")
  );
}

function isJsxFile(absPath: string): boolean {
  const ext = path.extname(absPath);
  return ext === ".tsx" || ext === ".jsx";
}

function featureFor(rel: string): string {
  const parts = rel.split("/");
  if (parts.length <= 1) return "root";
  // For Next.js: strip app/ or pages/ prefix, use first meaningful segment
  const first = parts[0];
  if ((first === "app" || first === "pages") && parts.length > 1) {
    const seg = parts[1];
    // strip route groups like (group)
    const stripped = seg.replace(/^\(.+\)$/, "");
    if (stripped && stripped !== "api") return stripped || "root";
    if (parts.length > 2) return parts[2] || first;
    return first;
  }
  return first;
}

// Derive Next.js App Router URL path from a file like app/(group)/chat/[id]/route.ts
function nextAppRouterPath(rel: string): string {
  // rel = "app/..." or "src/app/..."
  const parts = rel.split("/");
  // Find the "app" segment
  const appIdx = parts.indexOf("app");
  if (appIdx === -1) return "/";
  const routeParts = parts.slice(appIdx + 1, -1); // drop "app" and filename
  const segments = routeParts
    .filter((s) => !s.match(/^\(.+\)$/)) // strip route groups
    .map((s) => s.replace(/^\[(.+)\]$/, ":$1")); // [param] -> :param
  const joined = segments.join("/");
  return joined ? `/${joined}` : "/";
}

// Derive Next.js pages/api URL path
function nextPagesApiPath(rel: string): string {
  // rel = "pages/api/foo/bar.ts" or "src/pages/api/foo/bar.ts"
  const parts = rel.split("/");
  const pagesIdx = parts.indexOf("pages");
  if (pagesIdx === -1) return "/api/unknown";
  const apiParts = parts.slice(pagesIdx + 2); // skip pages + api
  if (apiParts.length === 0) return "/api";
  const last = apiParts[apiParts.length - 1];
  // strip extension
  const withoutExt = last.replace(/\.(ts|tsx|js|jsx)$/, "");
  // index -> ""
  apiParts[apiParts.length - 1] = withoutExt === "index" ? "" : withoutExt;
  const joined = apiParts
    .filter((s) => s !== "")
    .map((s) => s.replace(/^\[(.+)\]$/, ":$1"))
    .join("/");
  return `/api/${joined}`;
}

function isApiLookingFile(rel: string): boolean {
  return (
    rel.includes("/api/") ||
    rel.includes("route.ts") ||
    rel.includes("route.js") ||
    rel.includes("handler") ||
    rel.includes("controller") ||
    rel.includes("server") ||
    rel.includes("middleware")
  );
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const EXPRESS_LIKE = new Set(["get", "post", "put", "patch", "delete", "use", "all"]);

// ── TsExtractor ───────────────────────────────────────────────────────────────

export class TsExtractor implements Extractor {
  readonly language = TS_LANGUAGE;

  matches(filePath: string): boolean {
    const ext = path.extname(filePath);
    return SCAN_EXTENSIONS.has(ext) && !isExcludedFile(path.basename(filePath));
  }

  extract(input: ExtractorInput): ExtractorResult & { cacheStats?: CacheStats } {
    return extractTs(input.repoRoot, input.cacheRoot);
  }
}

function extractTs(
  repoRoot: string,
  cacheRoot?: string,
): ExtractorResult & { cacheStats?: CacheStats } {
  if (!cacheRoot) {
    return extractTsFull(repoRoot);
  }
  return extractTsWithCache(repoRoot, cacheRoot);
}

function extractTsFull(repoRoot: string): ExtractorResult {
  const absRoot = path.resolve(repoRoot);
  const allFiles = collectFiles(absRoot);

  const project = new Project({
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: true,
      jsx: 2, // Preserve
    },
  });

  for (const f of allFiles) {
    try {
      project.addSourceFileAtPath(f);
    } catch {
      // skip unreadable
    }
  }

  const nodes: SutraNode[] = [];
  const edges: SutraEdge[] = [];

  // Map from absolute path -> module node id (for edge building)
  const fileToModuleId = new Map<string, string>();
  // Map from symbol name -> node id (for calls/renders edge resolution)
  const symbolToNodeId = new Map<string, string>();

  let parseErrors = 0;

  // ── Pass 1: build nodes ───────────────────────────────────────────────────
  for (const sf of project.getSourceFiles()) {
    try {
      emitPass1ForFile(sf, absRoot, nodes, fileToModuleId, symbolToNodeId);
    } catch {
      parseErrors++;
    }
  }

  // ── Pass 2: build edges ───────────────────────────────────────────────────
  for (const sf of project.getSourceFiles()) {
    const absPath = sf.getFilePath();
    const moduleId = fileToModuleId.get(absPath);
    if (!moduleId) continue;

    try {
      emitPass2ForFile(sf, absRoot, edges, fileToModuleId, symbolToNodeId);
    } catch {
      parseErrors++;
    }
  }

  // ── Pass 3: detect proxy/rewrite config and emit PROXY nodes ─────────────
  return finalizeTsGraph(absRoot, nodes, edges);
}

// ── Proxy detection ───────────────────────────────────────────────────────────

/**
 * Convert a Next.js rewrite `source` pattern into a path prefix by cutting at
 * the first dynamic segment (`:param*` or `*`).
 * Examples:
 *   '/api/:path*'         -> '/api'
 *   '/auth/:path*'        -> '/auth'
 *   '/webhook/whatsapp'   -> '/webhook/whatsapp'  (exact, no dynamic)
 *   '/:path*'             -> '/'
 */
function rewriteSourceToPrefix(source: string): string {
  // Find first segment containing ':' or '*'
  const parts = source.split("/");
  const prefixParts: string[] = [];
  for (const part of parts) {
    if (part.includes(":") || part.includes("*")) break;
    prefixParts.push(part);
  }
  const joined = prefixParts.join("/");
  // Normalise: must start with '/', empty after stripping means catch-all
  if (!joined || joined === "") return "/";
  return joined.startsWith("/") ? joined : `/${joined}`;
}

/**
 * Walk ts-morph AST of a next.config file and collect `source:` string values
 * from the rewrites() return array.
 */
function extractNextRewrites(configPath: string): string[] {
  const prefixes: string[] = [];
  try {
    const src = fs.readFileSync(configPath, "utf8");
    // Simple regex approach — ts-morph full parse on arbitrary next.config can
    // fail due to module syntax or missing deps. Regex is safer here.
    // Match source: 'value' or source: "value" anywhere in the file.
    const re = /source\s*:\s*['"`]([^'"`]+)['"`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (m[1]) {
        const prefix = rewriteSourceToPrefix(m[1]);
        if (!prefixes.includes(prefix)) prefixes.push(prefix);
      }
    }
  } catch {
    // Unreadable — skip
  }
  return prefixes;
}

/**
 * Emit PROXY nodes for proxy prefixes discovered in next.config.* or
 * package.json "proxy" (CRA).
 */
function detectProxyNodes(absRoot: string, nodes: SutraNode[]): void {
  const prefixes: string[] = [];

  // Next.js: try common config filenames
  const nextConfigNames = [
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "next.config.cjs",
  ];
  for (const name of nextConfigNames) {
    const configPath = path.join(absRoot, name);
    if (fs.existsSync(configPath)) {
      const found = extractNextRewrites(configPath);
      for (const p of found) {
        if (!prefixes.includes(p)) prefixes.push(p);
      }
      break; // only one next.config exists
    }
  }

  // CRA: package.json "proxy" field -> catch-all
  const pkgPath = path.join(absRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
      if (typeof pkg["proxy"] === "string" && pkg["proxy"]) {
        // CRA proxy proxies everything — treat as '/'
        if (!prefixes.includes("/")) prefixes.push("/");
      }
    } catch {
      // Ignore
    }
  }

  // Emit a PROXY node for each prefix
  for (const prefix of prefixes) {
    const label = `PROXY ${prefix}`;
    const relPath = "next.config"; // synthetic relpath, no real file needed
    const nodeId = makeNodeId(relPath, label);
    // Avoid duplicates if called twice somehow
    if (nodes.find((n) => n.id === nodeId)) continue;
    nodes.push(tsNode({
      id: nodeId,
      type: "route",
      name: label,
      file: relPath,
      line: 1,
      data_shape: label,
      feature: "proxy",
    }));
  }
}

/**
 * Emit EXTERNAL nodes for known external API hosts (defaults + optional repo config).
 */
function detectExternalHostNodes(absRoot: string, nodes: SutraNode[]): void {
  for (const host of loadExternalHosts(absRoot)) {
    const label = `EXTERNAL ${host}`;
    const nodeId = makeNodeId("external-hosts", label);
    if (nodes.find((n) => n.id === nodeId)) continue;
    nodes.push(tsNode({
      id: nodeId,
      type: "route",
      name: label,
      file: "external-hosts",
      line: 1,
      data_shape: label,
      feature: "external",
    }));
  }
}

// ── URL literal extractor ─────────────────────────────────────────────────────
// Returns path + optional host for absolute URLs. Local paths have host null.
interface UrlExtract {
  path: string;
  host: string | null;
  provenance: Provenance;
}

function pushHttpEdge(
  edges: SutraEdge[],
  from: string,
  method: string,
  urlParts: UrlExtract,
): void {
  edges.push({
    from,
    to: httpTargetId(method, urlParts.path, urlParts.host),
    kind: "http",
    provenance: urlParts.provenance,
  });
}

function extractUrlParts(node: Node): UrlExtract | null {
  if (Node.isStringLiteral(node)) {
    const val = node.getLiteralValue();
    if (val.startsWith("http://") || val.startsWith("https://")) {
      try {
        const u = new URL(val);
        return { path: u.pathname || "/", host: u.hostname.toLowerCase(), provenance: "ast-exact" };
      } catch {
        return null;
      }
    }
    if (val.startsWith("/")) return { path: val, host: null, provenance: "ast-exact" };
    return null;
  }
  // Template literal: static head + :dynamic per ${...} span + trailing literals
  if (Node.isTemplateExpression(node)) {
    const head = node.getHead().getLiteralText();
    if (head && head.startsWith("http")) {
      try {
        const u = new URL(head);
        return { path: u.pathname || "/", host: u.hostname.toLowerCase(), provenance: "template-prefix" };
      } catch {
        return null;
      }
    }
    if (head && head.startsWith("/")) {
      let pathPattern = head;
      for (const span of node.getTemplateSpans()) {
        pathPattern += ":dynamic";
        pathPattern += span.getLiteral().getLiteralText();
      }
      return {
        path: pathPattern.replace(/\/+$/, "") || "/",
        host: null,
        provenance: "template-prefix",
      };
    }
    return null;
  }
  // No-sub template literal
  if (node.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
    const text = node.getText().slice(1, -1); // strip backticks
    if (text.startsWith("/")) return { path: text, host: null, provenance: "ast-exact" };
    if (text.startsWith("http://") || text.startsWith("https://")) {
      try {
        const u = new URL(text);
        return { path: u.pathname || "/", host: u.hostname.toLowerCase(), provenance: "ast-exact" };
      } catch {
        return null;
      }
    }
    return null;
  }
  return null;
}

// ── Per-file emit (shared by full + cached scan) ─────────────────────────────

function emitPass1ForFile(
  sf: import("ts-morph").SourceFile,
  absRoot: string,
  nodes: SutraNode[],
  fileToModuleId: Map<string, string>,
  symbolToNodeId: Map<string, string>,
): void {
  const absPath = sf.getFilePath();
  const rel = relPosix(absRoot, absPath);
  const feature = featureFor(rel);
  const isTest = isTestFile(rel);
  const isJsx = isJsxFile(absPath);

  const moduleId = makeNodeId(rel);
  fileToModuleId.set(absPath, moduleId);
  const moduleType: NodeType = isTest ? "test" : "module";
  nodes.push(tsNode({
    id: moduleId,
    type: moduleType,
    name: rel,
    file: rel,
    line: 1,
    data_shape: null,
    feature,
  }));

  const fileName = path.basename(absPath);
  const isNextAppRoute =
    (fileName === "route.ts" || fileName === "route.js") &&
    absPath.includes(`${path.sep}app${path.sep}`);

  if (isNextAppRoute) {
    const urlPath = nextAppRouterPath(rel);
    const exportedFns = sf.getFunctions().filter((f) => f.isExported());
    const exportedVars = sf.getVariableStatements().filter((v) => v.isExported());
    const httpExports: string[] = [];

    for (const fn of exportedFns) {
      const name = fn.getName();
      if (name && HTTP_METHODS.has(name)) httpExports.push(name);
    }
    for (const vs of exportedVars) {
      for (const decl of vs.getDeclarations()) {
        const name = decl.getName();
        if (HTTP_METHODS.has(name)) httpExports.push(name);
      }
    }

    for (const method of httpExports) {
      const endpointName = `${method} ${urlPath}`;
      const endpointId = makeNodeId(rel, endpointName);
      nodes.push(tsNode({
        id: endpointId,
        type: "endpoint",
        name: endpointName,
        file: rel,
        line: 1,
        data_shape: endpointName,
        feature,
      }));
    }
  }

  const isPagesApi =
    absPath.includes(`${path.sep}pages${path.sep}api${path.sep}`) ||
    absPath.includes(`/pages/api/`);

  if (isPagesApi && !isNextAppRoute) {
    const urlPath = nextPagesApiPath(rel);
    const endpointName = `ANY ${urlPath}`;
    const endpointId = makeNodeId(rel, endpointName);
    nodes.push(tsNode({
      id: endpointId,
      type: "endpoint",
      name: endpointName,
      file: rel,
      line: 1,
      data_shape: endpointName,
      feature,
    }));
  }

  for (const fn of sf.getFunctions()) {
    const name = fn.getName();
    if (!name) continue;
    const line = fn.getStartLineNumber();
    const isExported = fn.isExported();
    const params = fn.getParameters();
    let data_shape: string | null = null;
    if (params.length > 0) {
      const typeNode = params[0].getTypeNode();
      data_shape = typeNode ? typeNode.getText() : null;
    }

    let nodeType: NodeType = "function";
    if (isExported && isJsx) {
      const bodyText = fn.getBody()?.getText() ?? "";
      if (bodyText.includes("<") && (bodyText.includes("/>") || bodyText.includes("</"))) {
        nodeType = "component";
      }
    }
    if (isApiLookingFile(rel) && isExported) nodeType = "handler";

    const nodeId = makeNodeId(rel, name);
    symbolToNodeId.set(name, nodeId);
    nodes.push(tsNode({
      id: nodeId,
      type: nodeType,
      name,
      file: rel,
      line,
      data_shape,
      feature,
    }));
  }

  for (const vs of sf.getVariableStatements()) {
    if (!vs.isExported()) continue;
    for (const decl of vs.getDeclarations()) {
      const name = decl.getName();
      const init = decl.getInitializer();
      if (!init) continue;
      const isArrowOrFn =
        init.getKind() === SyntaxKind.ArrowFunction ||
        init.getKind() === SyntaxKind.FunctionExpression;
      if (!isArrowOrFn) continue;

      const line = decl.getStartLineNumber();
      let data_shape: string | null = null;
      if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
        const params = init.getParameters();
        if (params.length > 0) {
          const typeNode = params[0].getTypeNode();
          data_shape = typeNode ? typeNode.getText() : null;
        }
      }

      let nodeType: NodeType = "function";
      const initText = init.getText();
      if (isJsx && initText.includes("<") && (initText.includes("/>") || initText.includes("</"))) {
        nodeType = "component";
      }
      if (isApiLookingFile(rel)) nodeType = "handler";

      const nodeId = makeNodeId(rel, name);
      symbolToNodeId.set(name, nodeId);
      nodes.push(tsNode({
        id: nodeId,
        type: nodeType,
        name,
        file: rel,
        line,
        data_shape,
        feature,
      }));
    }
  }

  sf.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (Node.isPropertyAccessExpression(expr)) {
      const methodName = expr.getName();
      if (!EXPRESS_LIKE.has(methodName)) return;
      const args = node.getArguments();
      if (args.length < 1) return;
      const firstArg = args[0];
      if (!Node.isStringLiteral(firstArg)) return;
      const urlPath = firstArg.getLiteralValue();
      const method =
        methodName === "use" || methodName === "all" ? "ANY" : methodName.toUpperCase();
      const endpointName = `${method} ${urlPath}`;
      const endpointId = makeNodeId(rel, endpointName);
      if (!nodes.find((n) => n.id === endpointId)) {
        nodes.push(tsNode({
          id: endpointId,
          type: "endpoint",
          name: endpointName,
          file: rel,
          line: node.getStartLineNumber(),
          data_shape: endpointName,
          feature,
        }));
      }
    }
  });
}

function emitPass2ForFile(
  sf: import("ts-morph").SourceFile,
  absRoot: string,
  edges: SutraEdge[],
  fileToModuleId: Map<string, string>,
  symbolToNodeId: Map<string, string>,
): void {
  const absPath = sf.getFilePath();
  const rel = relPosix(absRoot, absPath);
  const moduleId = fileToModuleId.get(absPath);
  if (!moduleId) return;
  const isTest = isTestFile(rel);

  for (const imp of sf.getImportDeclarations()) {
    const specifier = imp.getModuleSpecifierValue();
    let toId: string;

    if (specifier.startsWith(".")) {
      const resolved = imp.getModuleSpecifierSourceFile();
      if (resolved) {
        const resolvedRel = relPosix(absRoot, resolved.getFilePath());
        toId = makeNodeId(resolvedRel);
      } else {
        const approx = path.posix.normalize(
          path.posix.join(path.posix.dirname(rel), specifier),
        );
        toId = makeNodeId(approx);
      }
    } else {
      toId = `ext:${specifier}`;
    }

    edges.push({ from: moduleId, to: toId, kind: "imports" });
    if (isTest && !toId.startsWith("ext:")) {
      edges.push({ from: moduleId, to: toId, kind: "tests" });
    }
  }

  sf.forEachDescendant((node) => {
    if (node.getKind() === SyntaxKind.CallExpression && Node.isCallExpression(node)) {
      const expr = node.getExpression();
      const args = node.getArguments();

      const enclosingId = (() => {
        let cur: Node | undefined = node.getParent();
        while (cur) {
          if (
            Node.isFunctionDeclaration(cur) ||
            Node.isArrowFunction(cur) ||
            Node.isFunctionExpression(cur)
          ) {
            if (Node.isFunctionDeclaration(cur) && cur.getName()) {
              const id = symbolToNodeId.get(cur.getName()!);
              if (id) return id;
            }
            return moduleId;
          }
          cur = cur.getParent();
        }
        return moduleId;
      })();

      if (Node.isIdentifier(expr) && expr.getText() === "fetch" && args.length >= 1) {
        const urlParts = extractUrlParts(args[0]);
        if (urlParts !== null) {
          let method = "GET";
          if (args.length >= 2 && Node.isObjectLiteralExpression(args[1])) {
            const methodProp = args[1]
              .getProperties()
              .find((p) => Node.isPropertyAssignment(p) && p.getName() === "method");
            if (methodProp && Node.isPropertyAssignment(methodProp)) {
              const val = methodProp.getInitializer();
              if (val && Node.isStringLiteral(val)) {
                method = val.getLiteralValue().toUpperCase();
              }
            }
          }
          pushHttpEdge(edges, enclosingId, method, urlParts);
        }
      }

      if (Node.isPropertyAccessExpression(expr)) {
        const obj = expr.getExpression();
        const meth = expr.getName();
        if (
          Node.isIdentifier(obj) &&
          obj.getText() === "axios" &&
          ["get", "post", "put", "patch", "delete", "request"].includes(meth)
        ) {
          const urlParts = args[0] ? extractUrlParts(args[0]) : null;
          if (urlParts !== null) {
            const method = meth === "request" ? "GET" : meth.toUpperCase();
            pushHttpEdge(edges, enclosingId, method, urlParts);
          }
        }
      }

      if (
        Node.isIdentifier(expr) &&
        expr.getText() === "axios" &&
        args.length >= 1 &&
        Node.isObjectLiteralExpression(args[0])
      ) {
        const obj = args[0];
        let urlParts: UrlExtract | null = null;
        let method = "GET";
        for (const prop of obj.getProperties()) {
          if (!Node.isPropertyAssignment(prop)) continue;
          const pname = prop.getName();
          const val = prop.getInitializer();
          if (!val) continue;
          if (pname === "url") urlParts = extractUrlParts(val);
          if (pname === "method" && Node.isStringLiteral(val)) {
            method = val.getLiteralValue().toUpperCase();
          }
        }
        if (urlParts !== null) pushHttpEdge(edges, enclosingId, method, urlParts);
      }

      if (Node.isIdentifier(expr)) {
        const name = expr.getText();
        const targetId = symbolToNodeId.get(name);
        if (targetId && targetId !== moduleId) {
          edges.push({ from: moduleId, to: targetId, kind: "calls" });
        }
      }
    }

    if (
      node.getKind() === SyntaxKind.JsxOpeningElement ||
      node.getKind() === SyntaxKind.JsxSelfClosingElement
    ) {
      let tagName: string | undefined;
      if (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) {
        tagName = node.getTagNameNode().getText();
      }
      if (tagName) {
        const targetId = symbolToNodeId.get(tagName);
        if (targetId) edges.push({ from: moduleId, to: targetId, kind: "renders" });
      }
    }
  });
}

function seedMapsFromCachedNodes(
  cachedNodes: SutraNode[],
  absRoot: string,
  fileToModuleId: Map<string, string>,
  symbolToNodeId: Map<string, string>,
): void {
  for (const n of cachedNodes) {
    if (n.type === "module" || n.type === "test") {
      fileToModuleId.set(path.join(absRoot, n.file), n.id);
    }
    if (["function", "component", "handler"].includes(n.type) && n.name) {
      symbolToNodeId.set(n.name, n.id);
    }
  }
}

function findAbsForImportRel(
  allFiles: string[],
  absRoot: string,
  fromRel: string,
  specifier: string,
): string | undefined {
  const approx = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), specifier));
  for (const f of allFiles) {
    const rel = relPosix(absRoot, f);
    if (rel === approx || rel.replace(/\.(tsx?|jsx?)$/, "") === approx) return f;
  }
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const target = approx + ext;
    for (const f of allFiles) {
      if (relPosix(absRoot, f) === target) return f;
    }
  }
  return undefined;
}

function addResolutionOnlyFiles(
  project: Project,
  absRoot: string,
  allFiles: string[],
  missFiles: Set<string>,
  hitFiles: Set<string>,
): void {
  const inProject = new Set(
    project.getSourceFiles().map((sf) => sf.getFilePath() as string),
  );

  for (const sf of project.getSourceFiles()) {
    const absPath = sf.getFilePath() as string;
    if (!missFiles.has(absPath)) continue;
    const rel = relPosix(absRoot, absPath);

    for (const imp of sf.getImportDeclarations()) {
      const spec = imp.getModuleSpecifierValue();
      if (!spec.startsWith(".")) continue;
      if (imp.getModuleSpecifierSourceFile()) continue;

      const targetAbs = findAbsForImportRel(allFiles, absRoot, rel, spec);
      if (targetAbs && hitFiles.has(targetAbs) && !inProject.has(targetAbs)) {
        try {
          project.addSourceFileAtPath(targetAbs as `${string}`);
          inProject.add(targetAbs);
        } catch {
          // skip
        }
      }
    }
  }
}

function annotateProvenance(nodes: SutraNode[]): void {
  for (const n of nodes) {
    if (n.name.startsWith("PROXY ") || n.name.startsWith("EXTERNAL ")) {
      n.provenance = "heuristic";
    } else {
      n.provenance = "ast-exact";
    }
  }
}

function finalizeTsGraph(absRoot: string, nodes: SutraNode[], edges: SutraEdge[]): ExtractorResult {
  detectProxyNodes(absRoot, nodes);
  detectExternalHostNodes(absRoot, nodes);
  annotateProvenance(nodes);
  return { nodes: sortNodes(nodes), edges: sortEdges(edges) };
}

function buildCacheEntriesFromGraph(
  allFiles: string[],
  absRoot: string,
  nodes: SutraNode[],
  edges: SutraEdge[],
  hashes: Map<string, string>,
): Record<string, CacheEntry> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const entries: Record<string, CacheEntry> = {};

  for (const f of allFiles) {
    const rel = relPosix(absRoot, f);
    const fileNodes = nodes.filter((n) => n.file === rel);
    const moduleId = makeNodeId(rel);
    const fileEdges = edges.filter((e) => {
      if (e.from === moduleId) return true;
      const fromNode = nodeById.get(e.from);
      return fromNode?.file === rel;
    });
    entries[rel] = {
      contentHash: hashes.get(f) ?? hashContent(fs.readFileSync(f)),
      graphVersion: GRAPH_VERSION,
      cacheVersion: CACHE_VERSION,
      nodes: fileNodes,
      edges: fileEdges,
    };
  }
  return entries;
}

function extractTsWithCache(
  repoRoot: string,
  cacheRoot: string,
): ExtractorResult & { cacheStats: CacheStats } {
  const absRoot = path.resolve(repoRoot);
  const allFiles = collectFiles(absRoot);
  const loaded = loadCache(cacheRoot);

  const missFiles = new Set<string>();
  const hitEntries = new Map<string, CacheEntry>();
  const hashes = new Map<string, string>();
  let hits = 0;
  let misses = 0;

  for (const f of allFiles) {
    const rel = relPosix(absRoot, f);
    let content: Buffer;
    try {
      content = fs.readFileSync(f);
    } catch {
      missFiles.add(f);
      misses++;
      continue;
    }
    const hash = hashContent(content);
    hashes.set(f, hash);
    const prev = loaded.entries[rel];
    if (isCacheHit(prev, hash)) {
      hitEntries.set(f, prev!);
      hits++;
    } else {
      missFiles.add(f);
      misses++;
    }
  }

  if (misses === allFiles.length) {
    const full = extractTsFull(repoRoot);
    const entries = buildCacheEntriesFromGraph(allFiles, absRoot, full.nodes, full.edges, hashes);
    saveCache(cacheRoot, { cacheVersion: CACHE_VERSION, entries });
    return { ...full, cacheStats: { hits: 0, misses: allFiles.length } };
  }

  if (misses === 0) {
    const nodes: SutraNode[] = [];
    const edges: SutraEdge[] = [];
    for (const f of allFiles) {
      const entry = hitEntries.get(f)!;
      nodes.push(...entry.nodes);
      edges.push(...entry.edges);
    }
    const result = finalizeTsGraph(absRoot, nodes, edges);
    const entries: Record<string, CacheEntry> = {};
    for (const f of allFiles) {
      const rel = relPosix(absRoot, f);
      entries[rel] = hitEntries.get(f)!;
    }
    saveCache(cacheRoot, { cacheVersion: CACHE_VERSION, entries });
    return { ...result, cacheStats: { hits, misses: 0 } };
  }

  const project = new Project({
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true, jsx: 2 },
  });

  for (const f of missFiles) {
    try {
      project.addSourceFileAtPath(f);
    } catch {
      // skip
    }
  }

  const hitFiles = new Set(hitEntries.keys());
  addResolutionOnlyFiles(project, absRoot, allFiles, missFiles, hitFiles);

  const nodes: SutraNode[] = [];
  const edges: SutraEdge[] = [];
  const fileToModuleId = new Map<string, string>();
  const symbolToNodeId = new Map<string, string>();

  for (const entry of hitEntries.values()) {
    seedMapsFromCachedNodes(entry.nodes, absRoot, fileToModuleId, symbolToNodeId);
  }

  for (const sf of project.getSourceFiles()) {
    const absPath = sf.getFilePath();
    if (!missFiles.has(absPath)) continue;
    emitPass1ForFile(sf, absRoot, nodes, fileToModuleId, symbolToNodeId);
  }

  for (const sf of project.getSourceFiles()) {
    const absPath = sf.getFilePath();
    if (!missFiles.has(absPath)) continue;
    emitPass2ForFile(sf, absRoot, edges, fileToModuleId, symbolToNodeId);
  }

  for (const f of allFiles) {
    if (!hitEntries.has(f)) continue;
    const entry = hitEntries.get(f)!;
    nodes.push(...entry.nodes);
    edges.push(...entry.edges);
  }

  const result = finalizeTsGraph(absRoot, nodes, edges);

  const newEntries: Record<string, CacheEntry> = {};
  for (const f of allFiles) {
    const rel = relPosix(absRoot, f);
    if (hitEntries.has(f) && !missFiles.has(f)) {
      newEntries[rel] = hitEntries.get(f)!;
      continue;
    }
    const fileNodes = result.nodes.filter((n) => n.file === rel);
    const moduleId = makeNodeId(rel);
    const fileEdges = result.edges.filter((e) => {
      if (e.from === moduleId) return true;
      const fromNode = result.nodes.find((n) => n.id === e.from);
      return fromNode?.file === rel;
    });
    newEntries[rel] = {
      contentHash: hashes.get(f) ?? hashContent(fs.readFileSync(f)),
      graphVersion: GRAPH_VERSION,
      cacheVersion: CACHE_VERSION,
      nodes: fileNodes,
      edges: fileEdges,
    };
  }
  saveCache(cacheRoot, { cacheVersion: CACHE_VERSION, entries: newEntries });

  return { ...result, cacheStats: { hits, misses } };
}
