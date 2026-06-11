/**
 * Thin Python AST helpers via tree-sitter (no CPython shell-out).
 */

import Parser from "tree-sitter";
import Python from "tree-sitter-python";

export interface PyFunction {
  name: string;
  line: number;
  decorators: string[];
  firstParamType: string | null;
  isMethod: boolean;
  className?: string;
}

export interface PyClass {
  name: string;
  line: number;
  bases: string[];
  methods: PyFunction[];
}

export interface PyModuleAst {
  functions: PyFunction[];
  classes: PyClass[];
}

let parser: Parser | null = null;

function getParser(): Parser {
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(Python as unknown as Parser.Language);
  }
  return parser;
}

function decoratorText(node: Parser.SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex).replace(/\s+/g, " ").trim();
}

function firstParamType(paramsNode: Parser.SyntaxNode | null, source: string): string | null {
  if (!paramsNode) return null;
  for (const child of paramsNode.namedChildren) {
    if (child.type === "identifier") {
      return null;
    }
    if (child.type === "typed_parameter") {
      const nameNode = child.childForFieldName("name");
      const typeNode = child.childForFieldName("type");
      if (nameNode?.text === "self") continue;
      if (typeNode) return source.slice(typeNode.startIndex, typeNode.endIndex);
      if (nameNode) return null;
    }
    if (child.type === "typed_default_parameter") {
      const nameNode = child.childForFieldName("name");
      const typeNode = child.childForFieldName("type");
      if (nameNode?.text === "self") continue;
      if (typeNode) return source.slice(typeNode.startIndex, typeNode.endIndex);
      return null;
    }
    if (child.type === "default_parameter") {
      const nameNode = child.childForFieldName("name");
      if (nameNode?.text !== "self") return null;
    }
  }
  return null;
}

function parseFunctionNode(
  node: Parser.SyntaxNode,
  source: string,
  className?: string,
): PyFunction | null {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const decorators = node.children
    .filter((c) => c.type === "decorator")
    .map((c) => decoratorText(c, source));
  const paramsNode = node.childForFieldName("parameters");
  return {
    name: nameNode.text,
    line: node.startPosition.row + 1,
    decorators,
    firstParamType: firstParamType(paramsNode, source),
    isMethod: className !== undefined,
    className,
  };
}

function parseClassNode(node: Parser.SyntaxNode, source: string): PyClass | null {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const bases: string[] = [];
  const argList = node.childForFieldName("superclasses");
  if (argList) {
    for (const child of argList.namedChildren) {
      bases.push(child.text);
    }
  }
  const methods: PyFunction[] = [];
  const body = node.childForFieldName("body");
  if (body) {
    for (const child of body.namedChildren) {
      if (child.type === "function_definition") {
        const fn = parseFunctionNode(child, source, nameNode.text);
        if (fn) methods.push(fn);
      }
    }
  }
  return { name: nameNode.text, line: node.startPosition.row + 1, bases, methods };
}

function parseDecoratedDefinition(node: Parser.SyntaxNode, source: string): PyFunction | null {
  const inner = node.namedChildren.find((c) => c.type === "function_definition");
  if (!inner) return null;
  const fn = parseFunctionNode(inner, source);
  if (!fn) return null;
  const outerDecorators = node.children
    .filter((c) => c.type === "decorator")
    .map((c) => decoratorText(c, source));
  fn.decorators = [...outerDecorators, ...fn.decorators];
  return fn;
}

/** Parse a Python module source string into functions and classes. */
export function parsePythonModule(source: string): PyModuleAst {
  const tree = getParser().parse(source);
  const functions: PyFunction[] = [];
  const classes: PyClass[] = [];
  for (const child of tree.rootNode.namedChildren) {
    if (child.type === "function_definition") {
      const fn = parseFunctionNode(child, source);
      if (fn) functions.push(fn);
    } else if (child.type === "decorated_definition") {
      const fn = parseDecoratedDefinition(child, source);
      if (fn) functions.push(fn);
    } else if (child.type === "class_definition") {
      const cls = parseClassNode(child, source);
      if (cls) classes.push(cls);
    }
  }
  return { functions, classes };
}

/** True when any decorator mentions frappe.whitelist. */
export function hasWhitelistDecorator(decorators: string[]): boolean {
  return decorators.some((d) => /frappe\.whitelist\s*\(/.test(d));
}

/** True when class extends Document (Frappe controller). */
export function isDocumentController(bases: string[]): boolean {
  return bases.some((b) => b === "Document" || b.endsWith(".Document"));
}

const DOC_HOOK_METHODS = new Set([
  "validate",
  "before_save",
  "after_insert",
  "on_update",
  "on_submit",
  "before_submit",
  "after_submit",
  "on_cancel",
  "before_cancel",
  "after_cancel",
]);

/** Controller hook methods we emit as handler nodes. */
export function isControllerHook(name: string): boolean {
  return DOC_HOOK_METHODS.has(name);
}

export interface PyCallSite {
  line: number;
  /** Simple name call: `foo()` */
  simpleName?: string;
  /** Attribute call: `obj.method()` */
  receiver?: string;
  method?: string;
  /** `frappe.call` first-arg dotted method (string literal only). */
  frappeMethod?: string;
  /** `requests.get` / `post` / … */
  requestsHttpMethod?: string;
  requestsUrl?: string;
  requestsHost?: string | null;
}

export interface PyImportMap {
  /** local alias → dotted module path (e.g. helpers → myapp.utils.helpers) */
  modules: Map<string, string>;
}

/**
 * Resolve a relative import module specifier (`.sibling`, `..base.sub`) against
 * the current module's dotted path.
 *
 * e.g. currentModPath=`inv.handler.order`, rel=`.sibling`
 *   → dots=1 → package=`inv.handler` → `inv.handler.sibling`
 *
 * e.g. currentModPath=`inv.handler.order`, rel=`..utils`
 *   → dots=2 → package=`inv` → `inv.utils`
 */
export function resolveRelativeImport(
  relSpecifier: string,
  currentModPath: string,
): string {
  const dotsMatch = relSpecifier.match(/^(\.+)/);
  if (!dotsMatch) return relSpecifier;
  const dots = dotsMatch[1]!.length;
  const rest = relSpecifier.slice(dots); // may be "" for `from . import x`

  const parts = currentModPath.split(".");
  // drop `dots` levels: 1 dot = same package (drop current module name),
  // 2 dots = parent package, etc.
  const parentParts = parts.slice(0, Math.max(0, parts.length - dots));
  if (rest) {
    return [...parentParts, rest].join(".");
  }
  return parentParts.join(".") || currentModPath;
}

/** Top-level import aliases for call resolution (static only).
 *
 * @param source Python source text
 * @param currentModPath Optional dotted path of the current module (e.g. `inv.handler.order`).
 *   Required for relative import resolution (`from .sibling import fn`).
 */
export function parseModuleImports(source: string, currentModPath?: string): PyImportMap {
  const modules = new Map<string, string>();
  const tree = getParser().parse(source);
  for (const child of tree.rootNode.namedChildren) {
    if (child.type === "import_statement") {
      for (const nameNode of child.namedChildren) {
        if (nameNode.type === "dotted_name" || nameNode.type === "aliased_import") {
          const dotted = nameNode.type === "aliased_import"
            ? nameNode.childForFieldName("name")?.text
            : nameNode.text;
          const alias =
            nameNode.type === "aliased_import"
              ? nameNode.childForFieldName("alias")?.text
              : dotted?.split(".").pop();
          if (dotted && alias) modules.set(alias, dotted);
        }
      }
    }
    if (child.type === "import_from_statement") {
      const moduleNode = child.childForFieldName("module_name");
      const rawModuleName = moduleNode?.text;
      if (!rawModuleName) continue;

      // Resolve relative imports when currentModPath is available
      let moduleName = rawModuleName;
      if (
        currentModPath &&
        moduleNode?.type === "relative_import"
      ) {
        moduleName = resolveRelativeImport(rawModuleName, currentModPath);
      }

      for (const nameNode of child.namedChildren) {
        if (nameNode === moduleNode) continue;
        if (nameNode.type === "dotted_name" || nameNode.type === "aliased_import") {
          const imported =
            nameNode.type === "aliased_import"
              ? nameNode.childForFieldName("name")?.text
              : nameNode.text;
          const alias =
            nameNode.type === "aliased_import"
              ? nameNode.childForFieldName("alias")?.text
              : imported;
          if (imported && alias) {
            modules.set(alias, `${moduleName}.${imported}`);
          }
        }
      }
    }
  }
  return { modules };
}

function stringLiteralValue(node: Parser.SyntaxNode | null): string | null {
  if (!node) return null;
  if (node.type === "string") {
    const content = node.namedChildren.find((c) => c.type === "string_content");
    if (content) return content.text;
  }
  return null;
}

function extractFrappCallMethod(argsNode: Parser.SyntaxNode | null): string | null {
  if (!argsNode) return null;
  for (const arg of argsNode.namedChildren) {
    if (arg.type === "string" || arg.type === "concatenated_string") {
      const lit = stringLiteralValue(arg.type === "string" ? arg : arg.namedChildren[0] ?? null);
      if (lit) return lit;
    }
    if (arg.type === "keyword_argument") {
      const name = arg.childForFieldName("name")?.text;
      if (name === "method") {
        const val = arg.childForFieldName("value");
        return stringLiteralValue(val);
      }
    }
  }
  return null;
}

function extractRequestsUrl(argsNode: Parser.SyntaxNode | null): {
  path: string;
  host: string | null;
} | null {
  if (!argsNode) return null;
  for (const arg of argsNode.namedChildren) {
    if (arg.type !== "string") continue;
    const lit = stringLiteralValue(arg);
    if (!lit) continue;
    if (lit.startsWith("http://") || lit.startsWith("https://")) {
      try {
        const u = new URL(lit);
        return { path: u.pathname || "/", host: u.hostname.toLowerCase() };
      } catch {
        return null;
      }
    }
    if (lit.startsWith("/")) return { path: lit, host: null };
    return null;
  }
  return null;
}

const REQUESTS_HTTP = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

function visitCallSites(
  node: Parser.SyntaxNode,
  source: string,
  out: PyCallSite[],
): void {
  if (node.type === "call") {
    const fn = node.childForFieldName("function");
    const args = node.childForFieldName("arguments");
    const line = node.startPosition.row + 1;
    if (fn?.type === "identifier") {
      const name = fn.text;
      if (name !== "getattr" && name !== "eval") {
        out.push({ line, simpleName: name });
      }
    } else if (fn?.type === "attribute") {
      const recvNode = fn.childForFieldName("object");
      const attrNode = fn.childForFieldName("attribute");
      const meth =
        attrNode?.text ??
        fn.namedChildren.find((c) => c.type === "identifier" && c !== recvNode)?.text ??
        "";
      const recv = recvNode?.text ?? "";
      if (recv === "frappe" && meth === "call") {
        const frappeMethod = extractFrappCallMethod(args);
        if (frappeMethod) out.push({ line, frappeMethod });
      } else if (recv === "requests" && REQUESTS_HTTP.has(meth)) {
        const url = extractRequestsUrl(args);
        if (url) {
          out.push({
            line,
            requestsHttpMethod: meth.toUpperCase(),
            requestsUrl: url.path,
            requestsHost: url.host,
          });
        }
      } else if (meth !== "getattr") {
        out.push({ line, receiver: recv, method: meth });
      }
    }
  }
  for (const child of node.namedChildren) {
    visitCallSites(child, source, out);
  }
}

/** Extract call sites inside one function/method body (skips nested defs). */
export function extractCallsInBody(
  bodyNode: Parser.SyntaxNode | null,
  source: string,
): PyCallSite[] {
  if (!bodyNode) return [];
  const out: PyCallSite[] = [];
  for (const child of bodyNode.namedChildren) {
    if (child.type === "function_definition") continue;
    visitCallSites(child, source, out);
  }
  return out;
}

/** Parse doc_events / scheduler_events handler paths from hooks.py content. */
export function parseHooksAssignments(source: string): {
  docEvents: Array<{ doctype: string; event: string; handler: string }>;
  schedulerJobs: Array<{ schedule: string; handler: string }>;
} {
  const docEvents: Array<{ doctype: string; event: string; handler: string }> = [];
  const schedulerJobs: Array<{ schedule: string; handler: string }> = [];

  const docBlock = source.match(/doc_events\s*=\s*\{([\s\S]*?)\n\}/);
  if (docBlock) {
    const inner = docBlock[1] ?? "";
    const doctypeRe = /["']([^"']+)["']\s*:\s*\{([^}]*)\}/g;
    let dm: RegExpExecArray | null;
    while ((dm = doctypeRe.exec(inner)) !== null) {
      const doctype = dm[1] ?? "";
      const eventsBlock = dm[2] ?? "";
      const eventRe = /["']([^"']+)["']\s*:\s*["']([^"']+)["']/g;
      let em: RegExpExecArray | null;
      while ((em = eventRe.exec(eventsBlock)) !== null) {
        docEvents.push({ doctype, event: em[1] ?? "", handler: em[2] ?? "" });
      }
    }
  }

  const schedBlock = source.match(/scheduler_events\s*=\s*\{([\s\S]*?)\n\}/);
  if (schedBlock) {
    const inner = schedBlock[1] ?? "";
    const schedRe = /["']([^"']+)["']\s*:\s*\[([\s\S]*?)\]/g;
    let sm: RegExpExecArray | null;
    while ((sm = schedRe.exec(inner)) !== null) {
      const schedule = sm[1] ?? "";
      const listBody = sm[2] ?? "";
      const pathRe = /["']([^"']+)["']/g;
      let pm: RegExpExecArray | null;
      while ((pm = pathRe.exec(listBody)) !== null) {
        schedulerJobs.push({ schedule, handler: pm[1] ?? "" });
      }
    }
  }

  return { docEvents, schedulerJobs };
}
