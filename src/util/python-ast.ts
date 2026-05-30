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
