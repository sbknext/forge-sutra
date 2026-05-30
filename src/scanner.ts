import path from "node:path";
import fs from "node:fs";
import { Project, SyntaxKind, Node, SourceFile } from "ts-morph";
import {
  EXCLUDED_DIRS,
  SCAN_EXTENSIONS,
  isExcludedFile,
  type SutraNode,
  type SutraEdge,
  type NodeType,
} from "./types.js";
import { makeNodeId, relPosix, httpTargetId } from "./util/ids.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function collectFiles(root: string): string[] {
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

// ── main scan ─────────────────────────────────────────────────────────────────

export function scan(repoRoot: string): { nodes: SutraNode[]; edges: SutraEdge[] } {
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
    const absPath = sf.getFilePath();
    const rel = relPosix(absRoot, absPath);
    const feature = featureFor(rel);
    const isTest = isTestFile(rel);
    const isJsx = isJsxFile(absPath);

    try {
      // Module node
      const moduleId = makeNodeId(rel);
      fileToModuleId.set(absPath, moduleId);
      const moduleType: NodeType = isTest ? "test" : "module";
      nodes.push({
        id: moduleId,
        type: moduleType,
        name: rel,
        file: rel,
        line: 1,
        data_shape: null,
        feature,
      });

      // ── Next.js App Router endpoints (route.ts / route.js) ────────────────
      const fileName = path.basename(absPath);
      const isNextAppRoute =
        (fileName === "route.ts" || fileName === "route.js") &&
        absPath.includes(`${path.sep}app${path.sep}`);

      if (isNextAppRoute) {
        const urlPath = nextAppRouterPath(rel);
        const exportedFns = sf.getFunctions().filter((f) => f.isExported());
        const exportedVars = sf
          .getVariableStatements()
          .filter((v) => v.isExported());

        const httpExports: string[] = [];

        for (const fn of exportedFns) {
          const name = fn.getName();
          if (name && HTTP_METHODS.has(name)) {
            httpExports.push(name);
          }
        }
        for (const vs of exportedVars) {
          for (const decl of vs.getDeclarations()) {
            const name = decl.getName();
            if (HTTP_METHODS.has(name)) {
              httpExports.push(name);
            }
          }
        }

        for (const method of httpExports) {
          const endpointName = `${method} ${urlPath}`;
          const endpointId = makeNodeId(rel, endpointName);
          nodes.push({
            id: endpointId,
            type: "endpoint",
            name: endpointName,
            file: rel,
            line: 1,
            data_shape: endpointName,
            feature,
          });
        }
      }

      // ── Next.js pages/api endpoints ────────────────────────────────────────
      const isPagesApi =
        absPath.includes(`${path.sep}pages${path.sep}api${path.sep}`) ||
        absPath.includes(`/pages/api/`);

      if (isPagesApi && !isNextAppRoute) {
        const urlPath = nextPagesApiPath(rel);
        const endpointName = `ANY ${urlPath}`;
        const endpointId = makeNodeId(rel, endpointName);
        nodes.push({
          id: endpointId,
          type: "endpoint",
          name: endpointName,
          file: rel,
          line: 1,
          data_shape: endpointName,
          feature,
        });
      }

      // ── Functions / handlers / components ─────────────────────────────────
      // Top-level function declarations
      for (const fn of sf.getFunctions()) {
        const name = fn.getName();
        if (!name) continue;
        const line = fn.getStartLineNumber();
        const isExported = fn.isExported();

        // Get first param type text
        const params = fn.getParameters();
        let data_shape: string | null = null;
        if (params.length > 0) {
          const typeNode = params[0].getTypeNode();
          data_shape = typeNode ? typeNode.getText() : null;
        }

        // Determine type
        let nodeType: NodeType = "function";
        if (isExported && isJsx) {
          // Check if body returns JSX
          const bodyText = fn.getBody()?.getText() ?? "";
          if (bodyText.includes("<") && (bodyText.includes("/>") || bodyText.includes("</"))) {
            nodeType = "component";
          }
        }
        if (isApiLookingFile(rel) && isExported) {
          nodeType = "handler";
        }

        const nodeId = makeNodeId(rel, name);
        symbolToNodeId.set(name, nodeId);
        nodes.push({
          id: nodeId,
          type: nodeType,
          name,
          file: rel,
          line,
          data_shape,
          feature,
        });
      }

      // Top-level exported variable statements (arrow / function expressions)
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
          if (
            Node.isArrowFunction(init) ||
            Node.isFunctionExpression(init)
          ) {
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
          if (isApiLookingFile(rel)) {
            nodeType = "handler";
          }

          const nodeId = makeNodeId(rel, name);
          symbolToNodeId.set(name, nodeId);
          nodes.push({
            id: nodeId,
            type: nodeType,
            name,
            file: rel,
            line,
            data_shape,
            feature,
          });
        }
      }

      // ── Express/Node endpoints from call expressions ───────────────────────
      sf.forEachDescendant((node) => {
        if (node.getKind() !== SyntaxKind.CallExpression) return;
        if (!Node.isCallExpression(node)) return;

        const expr = node.getExpression();
        // app.get('/path', ...) / router.post('/path', ...) etc.
        if (Node.isPropertyAccessExpression(expr)) {
          const methodName = expr.getName();
          if (!EXPRESS_LIKE.has(methodName)) return;

          const args = node.getArguments();
          if (args.length < 1) return;

          const firstArg = args[0];
          if (!Node.isStringLiteral(firstArg)) return;

          const urlPath = firstArg.getLiteralValue();
          const method = methodName === "use" || methodName === "all"
            ? "ANY"
            : methodName.toUpperCase();

          const endpointName = `${method} ${urlPath}`;
          const endpointId = makeNodeId(rel, endpointName);

          // Avoid duplicates
          if (!nodes.find((n) => n.id === endpointId)) {
            nodes.push({
              id: endpointId,
              type: "endpoint",
              name: endpointName,
              file: rel,
              line: node.getStartLineNumber(),
              data_shape: endpointName,
              feature,
            });
          }
        }
      });
    } catch {
      parseErrors++;
    }
  }

  // ── Pass 2: build edges ───────────────────────────────────────────────────
  for (const sf of project.getSourceFiles()) {
    const absPath = sf.getFilePath();
    const rel = relPosix(absRoot, absPath);
    const moduleId = fileToModuleId.get(absPath);
    if (!moduleId) continue;
    const isTest = isTestFile(rel);

    try {
      // Import edges
      for (const imp of sf.getImportDeclarations()) {
        const specifier = imp.getModuleSpecifierValue();
        let toId: string;

        if (specifier.startsWith(".")) {
          // Relative import — resolve to file
          const resolved = imp.getModuleSpecifierSourceFile();
          if (resolved) {
            const resolvedAbs = resolved.getFilePath();
            const resolvedRel = relPosix(absRoot, resolvedAbs);
            toId = makeNodeId(resolvedRel);
          } else {
            // Can't resolve — use specifier as-is
            const approx = path.posix.normalize(
              path.posix.join(path.posix.dirname(rel), specifier)
            );
            toId = makeNodeId(approx);
          }
        } else {
          toId = `ext:${specifier}`;
        }

        edges.push({ from: moduleId, to: toId, kind: "imports" });

        // Test edges: if this is a test file, add "tests" edges for local imports
        if (isTest && !toId.startsWith("ext:")) {
          edges.push({ from: moduleId, to: toId, kind: "tests" });
        }
      }

      // Call edges + http edges + renders edges
      sf.forEachDescendant((node) => {
        if (node.getKind() === SyntaxKind.CallExpression && Node.isCallExpression(node)) {
          const expr = node.getExpression();
          const args = node.getArguments();

          // ── http edges: fetch() and axios.*() ─────────────────────────────
          // Determine enclosing function node id, fall back to module id
          const enclosingId = (() => {
            let cur: Node | undefined = node.getParent();
            while (cur) {
              if (
                Node.isFunctionDeclaration(cur) ||
                Node.isArrowFunction(cur) ||
                Node.isFunctionExpression(cur)
              ) {
                // Try to find matching node
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

          // fetch(url, {method?})
          if (
            Node.isIdentifier(expr) &&
            expr.getText() === "fetch" &&
            args.length >= 1
          ) {
            const urlArg = args[0];
            const urlPath = extractUrlLiteral(urlArg);
            if (urlPath !== null) {
              let method = "GET";
              if (args.length >= 2 && Node.isObjectLiteralExpression(args[1])) {
                const methodProp = args[1]
                  .getProperties()
                  .find(
                    (p) =>
                      Node.isPropertyAssignment(p) &&
                      p.getName() === "method"
                  );
                if (methodProp && Node.isPropertyAssignment(methodProp)) {
                  const val = methodProp.getInitializer();
                  if (val && Node.isStringLiteral(val)) {
                    method = val.getLiteralValue().toUpperCase();
                  }
                }
              }
              edges.push({
                from: enclosingId,
                to: httpTargetId(method, urlPath),
                kind: "http",
              });
            }
          }

          // axios.get/post/...(url) or axios({url, method})
          if (Node.isPropertyAccessExpression(expr)) {
            const obj = expr.getExpression();
            const meth = expr.getName();
            if (
              Node.isIdentifier(obj) &&
              obj.getText() === "axios" &&
              ["get", "post", "put", "patch", "delete", "request"].includes(meth)
            ) {
              const urlArg = args[0];
              const urlPath = urlArg ? extractUrlLiteral(urlArg) : null;
              if (urlPath !== null) {
                const method = meth === "request" ? "GET" : meth.toUpperCase();
                edges.push({
                  from: enclosingId,
                  to: httpTargetId(method, urlPath),
                  kind: "http",
                });
              }
            }
          }

          // axios({url, method}) — identifier call
          if (
            Node.isIdentifier(expr) &&
            expr.getText() === "axios" &&
            args.length >= 1 &&
            Node.isObjectLiteralExpression(args[0])
          ) {
            const obj = args[0];
            let urlPath: string | null = null;
            let method = "GET";

            for (const prop of obj.getProperties()) {
              if (!Node.isPropertyAssignment(prop)) continue;
              const pname = prop.getName();
              const val = prop.getInitializer();
              if (!val) continue;
              if (pname === "url") urlPath = extractUrlLiteral(val);
              if (pname === "method" && Node.isStringLiteral(val)) {
                method = val.getLiteralValue().toUpperCase();
              }
            }
            if (urlPath !== null) {
              edges.push({
                from: enclosingId,
                to: httpTargetId(method, urlPath),
                kind: "http",
              });
            }
          }

          // calls edges: callee is an identifier matching a known symbol
          if (Node.isIdentifier(expr)) {
            const name = expr.getText();
            const targetId = symbolToNodeId.get(name);
            if (targetId && targetId !== moduleId) {
              edges.push({ from: moduleId, to: targetId, kind: "calls" });
            }
          }
        }

        // renders edges: JSX opening elements
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
            if (targetId) {
              edges.push({ from: moduleId, to: targetId, kind: "renders" });
            }
          }
        }
      });
    } catch {
      parseErrors++;
    }
  }

  // ── Pass 3: detect proxy/rewrite config and emit PROXY nodes ─────────────
  detectProxyNodes(absRoot, nodes);

  return { nodes, edges };
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
    nodes.push({
      id: nodeId,
      type: "route",
      name: label,
      file: relPath,
      line: 1,
      data_shape: label,
      feature: "proxy",
    });
  }
}

// ── URL literal extractor ─────────────────────────────────────────────────────
// Returns the literal path portion, or null if fully dynamic / not a literal.
function extractUrlLiteral(node: Node): string | null {
  if (Node.isStringLiteral(node)) {
    return node.getLiteralValue();
  }
  // Template literal: keep only the head (static prefix)
  if (Node.isTemplateExpression(node)) {
    const head = node.getHead().getLiteralText();
    if (head && head.startsWith("/")) return head;
    if (head && head.startsWith("http")) {
      // Extract path portion
      try {
        const u = new URL(head);
        return u.pathname;
      } catch {
        return head;
      }
    }
    return null;
  }
  // No-sub template literal
  if (node.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
    const text = node.getText().slice(1, -1); // strip backticks
    if (text.startsWith("/")) return text;
    return null;
  }
  return null;
}
