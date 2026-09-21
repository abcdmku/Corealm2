import { parseAst } from "vite";
import { ASYNC_DEBUG_METHODS } from "../../game/src/debug/asyncMethods.js";
import { ASYNC_LAB_METHODS } from "../../game/src/featureLab/asyncMethods.js";

/**
 * Finds calls to the asynchronous methods of `window.__gameDebug` and of the lab surfaces
 * (`window.__featureLab` and the rest of `ASYNC_SURFACES`) in one source file and says whether each
 * is awaited. The codemod (`tools/codemods/await-debug-mutators.ts`) and the lint
 * (`tools/debug-await-lint.ts`) share it, so what one rewrites is exactly what the other checks.
 *
 * It works on syntax alone, because the debug surface is reached through `any` casts in most tools
 * and no type checker would know it. The parser is the one Vite ships (`parseAst`, which reads
 * TypeScript), so this adds no dependency. A call counts when its method is on the async list and:
 *
 *   - its receiver is provably a surface: `window.__gameDebug`, a cast of it, or a local bound to
 *     one (`const d = (window as any).__gameDebug`, `const debug = () => window.__gameDebug`). The
 *     method is then looked up on that surface alone, because the surfaces share names:
 *     `__featureLab.getState()` is synchronous and `__agilityLab.getState()` is not. A local is
 *     resolved to its nearest declaration, so `lab` may be a different surface in each callback;
 *   - or it is a `__gameDebug` method and sits in page context (a callback given to `evaluate`,
 *     `waitForFunction` and the like), where a typed local or a parameter is the usual receiver and
 *     nothing else has these names. `reset` and `removeItem` are left out of this second rule: forms,
 *     labs and `localStorage` have their own. The lab surfaces have no such rule. Their names
 *     (`show`, `place`, `getState`) are everybody's.
 *
 * A call with a computed name on a proven receiver (`api[method](...)`) counts as well, since the
 * name may be any of them.
 *
 * Page scripts kept as strings are read too, which is how the long playthrough tools are written. A
 * string that mentions a surface and one of its methods is parsed as JavaScript, with each
 * template substitution blanked to a name of the same length so positions still point into the file.
 * All of it is page context. Playwright awaits what such a script evaluates to, so its last
 * expression, or an immediately invoked function that is its last expression, is as good as awaited.
 * A string of statements that only parses as a function body is one that a wrapper completes, and the
 * wrapper has to be async.
 */
export interface Node { type: string; start: number; end: number; parent: Node | null; [key: string]: unknown }
type Expression = Node;

/** Every asynchronous surface on `window`, and its asynchronous methods. `"*"` means every method. */
export const ASYNC_SURFACES: ReadonlyMap<string, ReadonlySet<string> | "*"> = new Map<string, ReadonlySet<string> | "*">([
  ["__gameDebug", new Set<string>(ASYNC_DEBUG_METHODS)],
  ...Object.entries(ASYNC_LAB_METHODS as Record<string, readonly string[] | "*">).map(([surface, methods]): [string, ReadonlySet<string> | "*"] => [surface, methods === "*" ? "*" : new Set(methods)]),
]);
/** A file that matches none of this has nothing to check. */
export const MENTIONS_SURFACE = new RegExp([...ASYNC_SURFACES.keys()].join("|"));
const DEBUG = ASYNC_SURFACES.get("__gameDebug") as ReadonlySet<string>;
const isAsyncOn = (surface: string, method: string): boolean => { const methods = ASYNC_SURFACES.get(surface); return methods === "*" || methods?.has(method) === true; };
/** Callbacks given to these run in the page, and Playwright awaits what they return. `waitForDebug` is this repo's awaiting poll. */
export const AWAITING_PAGE_CALLS = new Set(["evaluate", "evaluateHandle", "$eval", "$$eval", "waitForDebug"]);
/** `waitForFunction` polls its predicate and tests what it returns without awaiting it, so a promise reads as true at once. */
export const POLLING_PAGE_CALLS = new Set(["waitForFunction"]);
const UNPROVEN_EXCLUDED = new Set(["reset", "removeItem"]);
const TRANSPARENT = new Set(["ParenthesizedExpression", "TSAsExpression", "TSNonNullExpression", "TSSatisfiesExpression", "TSTypeAssertion", "ChainExpression"]);
const FUNCTIONS = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"]);

export const isFunctionNode = (node: Node): boolean => FUNCTIONS.has(node.type);
export const child = (node: Node, key: string): Node | null => (node[key] as Node | null | undefined) ?? null;
export const children = (node: Node, key: string): Node[] => (node[key] as Node[] | undefined) ?? [];

export function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const value = node[key];
    if (Array.isArray(value)) { for (const item of value) if (item && typeof item === "object" && typeof (item as Node).type === "string") walk(item as Node, visit); }
    else if (value && typeof value === "object" && typeof (value as Node).type === "string") walk(value as Node, visit);
  }
}

function link(program: Node, shift = 0): Node {
  program.parent = null;
  walk(program, node => {
    if (shift) { node.start += shift; node.end += shift; }
    for (const key of Object.keys(node)) {
      if (key === "parent") continue;
      const value = node[key];
      for (const item of Array.isArray(value) ? value : [value]) if (item && typeof item === "object" && typeof (item as Node).type === "string") (item as Node).parent = node;
    }
  });
  return program;
}
export function parse(file: string, text: string): Node {
  const lang = file.endsWith(".tsx") ? "tsx" : /\.(mjs|cjs|js)$/.test(file) ? "js" : "ts";
  return link(parseAst(text, { lang, preserveParens: true, sourceType: "module" } as never) as unknown as Node);
}

const SNIPPET_PREFIX = "(async()=>{";
const MENTIONS_ASYNC = [...ASYNC_SURFACES].map(([surface, methods]) => ({ surface, call: new RegExp("[.](?:" + (methods === "*" ? "\\w+" : [...methods].join("|")) + ")\\s*(?:[?][.])?[(]") }));
const mentionsAsync = (source: string): boolean => MENTIONS_ASYNC.some(({ surface, call }) => source.includes(surface) && call.test(source));
/**
 * A page script kept in a string. `program` has the file's positions. `snippet` means it only parsed as a
 * function body, so something else wraps it before the page sees it. `polled` means it is a
 * `waitForFunction` predicate. `problem` is set when the string could not be read at all.
 */
export interface EmbeddedScript { host: Node; program: Node | null; snippet: boolean; polled: boolean; problem: string | null }
export function embeddedScripts(program: Node, text: string): EmbeddedScript[] {
  const found: EmbeddedScript[] = [];
  walk(program, host => {
    if (host.type !== "TemplateLiteral" && !(host.type === "Literal" && typeof host.value === "string")) return;
    if (host.parent?.type === "TaggedTemplateExpression" || host.parent?.type === "ImportDeclaration") return;
    const from = host.start + 1, to = host.end - 1;
    let source = text.slice(from, to);
    if (!mentionsAsync(source)) return;
    const quasis = children(host, "quasis");
    for (let index = 0; index + 1 < quasis.length; index++) {
      const start = quasis[index]!.end - 2 - from, end = quasis[index + 1]!.start + 1 - from;
      source = source.slice(0, start) + "_".repeat(end - start) + source.slice(end);
    }
    const call = host.parent?.type === "CallExpression" && children(host.parent, "arguments")[0] === host ? host.parent : null;
    const polled = call !== null && POLLING_PAGE_CALLS.has(calleeName(call) ?? "");
    const attempt = (code: string, shift: number): Node | null => { try { return link(parseAst(code, { lang: "js", preserveParens: true, sourceType: "script" } as never) as unknown as Node, shift); } catch { return null; } };
    let parsed = attempt(source, from), snippet = false;
    if (!parsed) { parsed = attempt(SNIPPET_PREFIX + source + "\n})()", from - SNIPPET_PREFIX.length); snippet = parsed !== null; }
    if (parsed) { parsed.embedded = true; parsed.snippet = snippet; parsed.polled = polled; }
    // A sentence about a surface ("__someLab.prepare() is not exposed") is not a script: code that fails to parse has a `;`, a brace or an `=` in it.
    if (!parsed && !/[;{}=]/.test(source)) return;
    found.push({ host, program: parsed, snippet, polled, problem: parsed ? null : "this page script could not be parsed, so its debug and lab calls are unchecked" });
  });
  return found;
}
const root = (node: Node): Node => { let at = node; while (at.parent) at = at.parent; return at; };
/** The last statement of a page script kept in a string, which is what Playwright awaits. */
export function isScriptResult(expression: Node): boolean {
  const statement = expression.parent, program = statement?.parent;
  return statement?.type === "ExpressionStatement" && program?.type === "Program" && program.embedded === true && program.snippet !== true && children(program, "body").at(-1) === statement;
}

/** Strip what does not change the value: parentheses, casts, `!`, `satisfies`, the optional-chain wrapper. */
export function unwrap(node: Expression): Expression {
  let at = node;
  while (TRANSPARENT.has(at.type)) at = child(at, "expression")!;
  return at;
}
/** The outermost wrapper of `node` that is still the same value. */
export function outermost(node: Expression): Expression {
  let at = node;
  while (at.parent && TRANSPARENT.has(at.parent.type) && child(at.parent, "expression") === at) at = at.parent;
  return at;
}
export function enclosingFunction(node: Node): Node | null {
  for (let at = node.parent; at; at = at.parent) if (isFunctionNode(at)) return at;
  return null;
}
export const isAsync = (fn: Node): boolean => fn.async === true;
/** `get x()`, `set x()`, `constructor()`: bodies that cannot be made async. */
export function cannotAwait(fn: Node): boolean {
  const holder = fn.parent;
  return !!holder && (holder.type === "MethodDefinition" || holder.type === "Property") && child(holder, "value") === fn && ["get", "set", "constructor"].includes(String(holder.kind));
}

export function calleeName(call: Node): string | null {
  const callee = unwrap(child(call, "callee")!);
  if (callee.type === "MemberExpression" && !callee.computed) return String(child(callee, "property")!.name);
  return callee.type === "Identifier" ? String(callee.name) : null;
}
/** The name a function is known by: its declaration, the `const` it initialises, or the object member it is. */
export function functionName(fn: Node): { name: string; member: boolean } | null {
  if (fn.type === "FunctionDeclaration") { const id = child(fn, "id"); return id ? { name: String(id.name), member: false } : null; }
  const holder = fn.parent;
  if (holder?.type === "VariableDeclarator" && child(holder, "init") === fn && child(holder, "id")?.type === "Identifier") return { name: String(child(holder, "id")!.name), member: false };
  if (holder && (holder.type === "Property" || holder.type === "MethodDefinition") && child(holder, "value") === fn && !holder.computed && child(holder, "key")?.type === "Identifier")
    return { name: String(child(holder, "key")!.name), member: true };
  return null;
}
/** The call a function is handed to: directly, or as `page.evaluate(probe)` for a function named `probe`. */
export function receivingCall(fn: Node, program: Node): Node | null {
  const parent = fn.parent;
  if (parent?.type === "CallExpression" && children(parent, "arguments").includes(fn)) return parent;
  const known = functionName(fn);
  if (!known || known.member) return null;
  let found: Node | null = null;
  walk(program, node => {
    if (found || node.type !== "CallExpression") return;
    const name = calleeName(node) ?? "";
    if ((AWAITING_PAGE_CALLS.has(name) || POLLING_PAGE_CALLS.has(name)) && children(node, "arguments").some(argument => argument.type === "Identifier" && argument.name === known.name)) found = node;
  });
  return found;
}
/** "awaiting", "polling", or null when the function does not run in the page. */
export function pageRole(fn: Node, program: Node): "awaiting" | "polling" | null {
  const top = root(fn);
  if (top.embedded === true) {
    // The function a snippet was wrapped in to parse it stands for the caller's own wrapper.
    if (top.snippet === true && enclosingFunction(fn) === null) return top.polled === true ? "polling" : "awaiting";
    const outer = outermost(fn), invoked = outer.parent?.type === "CallExpression" && child(outer.parent, "callee") === outer ? outer.parent : null;
    if (invoked && isScriptResult(outermost(promiseChainTop(invoked)))) return top.polled === true ? "polling" : "awaiting";
  }
  const call = receivingCall(fn, program), name = call ? calleeName(call) : null;
  if (!call || !name) return null;
  const args = children(call, "arguments"), known = functionName(fn);
  const is = (argument: Node | undefined): boolean => argument === fn || (argument?.type === "Identifier" && argument.name === known?.name);
  // `waitForDebug(page, fn)` and `$eval(selector, fn)` take the callback second.
  if (!(is(args[0]) || ((name === "waitForDebug" || name.startsWith("$")) && is(args[1])))) return null;
  return AWAITING_PAGE_CALLS.has(name) ? "awaiting" : POLLING_PAGE_CALLS.has(name) ? "polling" : null;
}
function inPageContext(node: Node, program: Node): boolean {
  if (root(node).embedded === true) return true;
  for (let fn = enclosingFunction(node); fn; fn = enclosingFunction(fn)) if (pageRole(fn, program)) return true;
  return false;
}

/** The surface that `X.__gameDebug`, `X["__featureLab"]` or `Reflect.get(X, "__featureLab")` reads, with or without casts around it. */
function surfaceAccess(node: Expression): string | null {
  const value = unwrap(node);
  let name: unknown = null;
  if (value.type === "MemberExpression") { const property = child(value, "property")!; name = value.computed ? (property.type === "Literal" ? property.value : null) : property.name; }
  else if (value.type === "CallExpression" && calleeName(value) === "get" && unwrap(child(unwrap(child(value, "callee")!), "object") ?? value).name === "Reflect") { const key = children(value, "arguments")[1]; name = key?.type === "Literal" ? key.value : null; }
  return typeof name === "string" && ASYNC_SURFACES.has(name) ? name : null;
}
/** What one declaration of a name holds: a surface, a function that returns one, or neither, which still hides an outer one. */
interface Binding { scope: Node; surface: string | null; returns: string | null }
const SCOPES = new Set(["Program", "BlockStatement", "ForStatement", "ForInStatement", "ForOfStatement", "SwitchStatement", "CatchClause", "StaticBlock"]);
function scopeOf(node: Node, functionWide = false): Node {
  let at = node.parent;
  while (at?.parent && !isFunctionNode(at) && (functionWide || !SCOPES.has(at.type))) at = at.parent;
  return at ?? node;
}
/** The surface a function hands back: `() => window.__gameDebug`, or a body that is one `return` of it. */
function returnedSurface(fn: Node): string | null {
  const body = child(fn, "body");
  if (!body) return null;
  if (body.type !== "BlockStatement") return surfaceAccess(body);
  const only = children(body, "body");
  return only.length === 1 && only[0]!.type === "ReturnStatement" && child(only[0]!, "argument") ? surfaceAccess(child(only[0]!, "argument")!) : null;
}
/** Every simple declaration, by name: locals, parameters and functions. */
function declarations(program: Node): Map<string, Binding[]> {
  const found = new Map<string, Binding[]>();
  const add = (name: unknown, binding: Binding): void => { const list = found.get(String(name)); if (list) list.push(binding); else found.set(String(name), [binding]); };
  walk(program, node => {
    if (node.type === "VariableDeclarator" && child(node, "id")?.type === "Identifier") {
      const initial = child(node, "init") ? unwrap(child(node, "init")!) : null;
      add(child(node, "id")!.name, { scope: scopeOf(node, node.parent?.kind === "var"), surface: initial ? surfaceAccess(initial) : null, returns: initial && isFunctionNode(initial) ? returnedSurface(initial) : null });
    } else if (isFunctionNode(node)) {
      if (node.type === "FunctionDeclaration" && child(node, "id")) add(child(node, "id")!.name, { scope: scopeOf(node), surface: null, returns: returnedSurface(node) });
      for (const parameter of children(node, "params")) {
        const id = parameter.type === "AssignmentPattern" ? child(parameter, "left")! : parameter.type === "TSParameterProperty" ? child(parameter, "parameter")! : parameter;
        if (id.type === "Identifier") add(id.name, { scope: node, surface: null, returns: null });
      }
    }
  });
  return found;
}

export interface DebugCall {
  call: Node;
  /** The method name, or null for a computed one on a proven receiver. */
  method: string | null;
  /** The surface the method is on: `__gameDebug`, `__featureLab` and so on. */
  surface: string;
  /** The receiver is provably that surface, rather than matched by name in page context. */
  proven: boolean;
  awaited: boolean;
  /** Returned as it is from a callback Playwright awaits, which is as good as awaited. */
  returnedToPlaywright: boolean;
  line: number;
}

const PROMISE_METHODS = new Set(["then", "catch", "finally"]);
/** `x.f().catch(...)` is still the promise of `x.f()`: the top of such a chain is what has to be awaited. */
export function promiseChainTop(call: Expression): Expression {
  let at = call;
  for (;;) {
    const outer = outermost(at), member = outer.parent;
    if (member?.type !== "MemberExpression" || child(member, "object") !== outer || member.computed || !PROMISE_METHODS.has(String(child(member, "property")!.name))) return at;
    const chained = outermost(member).parent;
    if (chained?.type !== "CallExpression" || unwrap(child(chained, "callee")!) !== member) return at;
    at = chained;
  }
}
/** True when an optional link (`?.`) sits in the callee chain of `node`, so the whole expression may be undefined. */
export function hasOptionalLink(node: Expression): boolean {
  for (let at: Node | null = unwrap(node); at;) {
    if (at.optional === true) return true;
    at = at.type === "CallExpression" ? unwrap(child(at, "callee")!) : at.type === "MemberExpression" ? unwrap(child(at, "object")!) : null;
  }
  return false;
}
/** Awaited, as far as the value of `call` is concerned. */
export function isAwaited(call: Expression): boolean {
  return outermost(promiseChainTop(call)).parent?.type === "AwaitExpression";
}
function returnedFrom(call: Expression): Node | null {
  const outer = outermost(promiseChainTop(call)), parent = outer.parent;
  if (parent?.type === "ArrowFunctionExpression" && child(parent, "body") === outer) return parent;
  if (parent?.type === "ReturnStatement") return enclosingFunction(parent);
  return null;
}
export const lineOf = (text: string, position: number): number => text.slice(0, position).split("\n").length;
/** The line at `position`, or the one above it, says `debug-await-lint: ignore`. The lint skips it and the codemod leaves it alone. */
export function isIgnored(text: string, position: number): boolean {
  const lines = text.split("\n"), line = lineOf(text, position);
  return /debug-await-lint:\s*ignore/.test(`${lines[line - 2] ?? ""}\n${lines[line - 1] ?? ""}`);
}

export function findAsyncDebugCalls(program: Node, text: string): DebugCall[] {
  const found = findIn(program, text);
  for (const script of embeddedScripts(program, text)) if (script.program) found.push(...findIn(script.program, text));
  return found;
}
function findIn(program: Node, text: string): DebugCall[] {
  const declared = declarations(program), found: DebugCall[] = [];
  /** The nearest declaration of a name, looking outward from where it is used. */
  const resolve = (use: Node): Binding | null => {
    const list = declared.get(String(use.name));
    if (list) for (let at: Node | null = use.parent; at; at = at.parent) { const here = list.filter(binding => binding.scope === at); if (here.length) return here.find(binding => binding.surface || binding.returns) ?? here[0]!; }
    return null;
  };
  const surfaceOf = (node: Expression): string | null => {
    const value = unwrap(node), direct = surfaceAccess(value);
    if (direct) return direct;
    if (value.type === "Identifier") return resolve(value)?.surface ?? null;
    const callee = value.type === "CallExpression" ? unwrap(child(value, "callee")!) : null;
    return callee?.type === "Identifier" ? resolve(callee)?.returns ?? null : null;
  };
  walk(program, node => {
    if (node.type !== "CallExpression") return;
    const callee = unwrap(child(node, "callee")!);
    if (callee.type !== "MemberExpression") return;
    const receiver = child(callee, "object")!, property = child(callee, "property")!;
    let surface = surfaceOf(receiver), method: string | null;
    const proven = surface !== null;
    if (!callee.computed) {
      method = String(property.name);
      if (surface) { if (!isAsyncOn(surface, method)) return; }
      // Node-side wrappers such as `driver.callDebug(...)` are promises already and are not matched here.
      else if (DEBUG.has(method) && !UNPROVEN_EXCLUDED.has(method) && unwrap(receiver).type !== "ThisExpression" && inPageContext(node, program)) surface = "__gameDebug";
      else return;
    } else {
      if (!surface) return;
      const literal = property.type === "Literal" && typeof property.value === "string" ? property.value : null;
      if (literal !== null && !isAsyncOn(surface, literal)) return;
      method = property.type === "Literal" ? String(property.value) : null;
    }
    const from = returnedFrom(node);
    const result = isScriptResult(outermost(promiseChainTop(node))) && program.polled !== true;
    found.push({ call: node, method, surface, proven, awaited: isAwaited(node), returnedToPlaywright: result || (from !== null && pageRole(from, program) === "awaiting"), line: lineOf(text, node.start) });
  });
  return found;
}
