import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { MENTIONS_SURFACE, calleeName, cannotAwait, child, children, embeddedScripts, enclosingFunction, findAsyncDebugCalls, functionName, hasOptionalLink, isAsync, isAwaited, isIgnored, lineOf, outermost, pageRole, parse, promiseChainTop, receivingCall, unwrap, walk, type Node } from "../lib/debug-calls.js";
import { repoRoot } from "../lib/paths.js";

/**
 * Awaits every call to an asynchronous `window.__gameDebug` or lab surface method (`window.__featureLab`
 * and the others in `game/src/featureLab/asyncMethods.ts`) under `tools/` and `tests/`.
 *
 *   tsx tools/codemods/await-debug-mutators.ts            rewrite the files
 *   tsx tools/codemods/await-debug-mutators.ts --dry      report only
 *   tsx tools/codemods/await-debug-mutators.ts <files>    only these
 *
 * For each call that is not awaited it adds `await` (with parentheses where the result is used
 * further: `(await d.getEntity(id)).position`), makes the enclosing function `async`, and follows
 * what that breaks: a helper that became async has its own calls awaited, an `xs.map(async ...)`
 * is wrapped in `await Promise.all(...)`, and a `waitForFunction` predicate, which Playwright never
 * awaits, becomes `waitForDebug` from `tools/lib/wait-for-debug.ts`. Page scripts kept as strings get
 * the same treatment: their immediately invoked function becomes async, and a bare expression that
 * needs an await is wrapped in one.
 *
 * It edits text by position and leaves everything else as it was, including each file's line
 * endings. Running it again changes nothing. What it cannot decide is printed, by file and line, for
 * a person: an async callback given to `filter` or `find`, a wait whose handle is used, a getter.
 * A call the lint is told to skip (`debug-await-lint: ignore`) is left as it is.
 */
interface Edit { pos: number; text: string; closing: boolean; extent: number; replaceTo?: number }
interface FileResult { file: string; awaits: number; asyncFunctions: number; waits: number; promiseAlls: number; notes: string[]; changed: boolean }

const SYNC_ARRAY_CALLBACKS = new Set(["filter", "find", "findLast", "findIndex", "some", "every", "sort", "reduce", "flatMap", "forEach", "toSorted"]);
const PROMISE_CALLBACKS = new Set(["then", "catch", "finally"]);

function transform(file: string, text: string): { output: string; result: FileResult } {
  const program = parse(file, text);
  const result: FileResult = { file, awaits: 0, asyncFunctions: 0, waits: 0, promiseAlls: 0, notes: [], changed: false };
  const edits: Edit[] = [], madeAsync = new Set<Node>(), handled = new Set<Node>(), convertedWaits = new Set<Node>();
  const note = (node: Node, message: string): void => { result.notes.push(`${file}:${lineOf(text, node.start)} ${message}`); };
  /** The file's own program, or the page script in a string that `node` belongs to. Names are looked up in that. */
  const programOf = (node: Node): Node => { let top = node; while (top.parent) top = top.parent; return top; };
  const open = (node: Node, before: string): void => { edits.push({ pos: node.start, text: before, closing: false, extent: node.end }); };
  const close = (node: Node, after: string): void => { edits.push({ pos: node.end, text: after, closing: true, extent: node.start }); };

  /** `site` now yields a promise. Await it where it stands, and make that legal. */
  function awaitSite(called: Node, wrapAll = false): void {
    // `x.f().catch(...)` is awaited at the end of the chain, not in the middle of it.
    const site = wrapAll ? called : promiseChainTop(called);
    if (handled.has(site) || (!wrapAll && isAwaited(site))) return;
    handled.add(site);
    const fn = enclosingFunction(site);
    if (fn && cannotAwait(fn)) { note(site, "is inside a getter, setter or constructor, which cannot await: move the call out"); return; }
    if (!fn && !scriptCanAwait(site)) return;
    // `x()!.y` and `x()?.y` read the promise, not its value, unless the await is parenthesised.
    let top = site;
    while (top.parent?.type === "TSNonNullExpression" && child(top.parent, "expression") === top) top = top.parent;
    const user = top.parent;
    const accessed = !!user && ((user.type === "MemberExpression" && child(user, "object") === top) || (user.type === "CallExpression" && child(user, "callee") === top)
      || (user.type === "TaggedTemplateExpression" && child(user, "tag") === top) || (user.type === "BinaryExpression" && user.operator === "**" && child(user, "left") === top));
    const already = wrapAll && isAwaited(site);
    // `a?.f().g` is undefined when `a` is. Parenthesised, the short circuit ends at the parenthesis, so the next link has to be optional itself,
    // and `Promise.all` has to be given a list.
    const optional = hasOptionalLink(site);
    open(site, `${accessed ? "(" : ""}${already ? "" : "await "}${wrapAll ? "Promise.all(" : ""}`);
    if (wrapAll || accessed) close(site, `${wrapAll ? `${optional ? " ?? []" : ""})` : ""}${accessed ? ")" : ""}`);
    if (accessed && optional && !wrapAll && user!.optional !== true) {
      const next = top.end + (/^\s*/.exec(text.slice(top.end))?.[0].length ?? 0);
      edits.push(text[next] === "." ? { pos: next, text: "?", closing: true, extent: -1 } : { pos: top.end, text: "?.", closing: true, extent: -1 });
    }
    if (wrapAll) result.promiseAlls++; else result.awaits++;
    if (fn) makeAsync(fn);
  }

  /**
   * A page script kept in a string has no top-level await. One that is a single expression is wrapped in an async function, which
   * Playwright awaits like any other result. A snippet is a function body already, and its wrapper is somebody else's to make async.
   */
  const wrappedScripts = new Set<Node>();
  function scriptCanAwait(site: Node): boolean {
    let top = site; while (top.parent) top = top.parent;
    if (top.embedded !== true) return true;
    if (top.snippet === true) { note(site, "is awaited at the top of a page script that is a function body: make the function that wraps it async"); return true; }
    const body = children(top, "body"), only = body.length === 1 && body[0]!.type === "ExpressionStatement" ? child(body[0]!, "expression")! : null;
    if (!only) { note(site, "needs an await at the top level of a page script kept in a string: wrap the script in (async () => { ... })()"); return false; }
    if (top.polled === true) { note(site, "is in a waitForFunction string, which Playwright never awaits: use waitForDebug with a function"); return false; }
    if (!wrappedScripts.has(top)) { wrappedScripts.add(top); edits.push({ pos: only.start, text: "(async () => (", closing: false, extent: only.end + 3 }); edits.push({ pos: only.end, text: "))()", closing: true, extent: only.start - 3 }); }
    return true;
  }

  function makeAsync(fn: Node): void {
    if (madeAsync.has(fn)) return;
    madeAsync.add(fn);
    const role = pageRole(fn, programOf(fn)), wasAsync = isAsync(fn), known = functionName(fn);
    if (!wasAsync) {
      if (fn.generator === true) { note(fn, "is a generator: await inside it by hand"); return; }
      // A method's function node starts at its parameter list, so `async` goes before the member's name.
      const at = known?.member && fn.type === "FunctionExpression" && fn.parent!.type !== "VariableDeclarator" && (fn.parent!.method === true || fn.parent!.type === "MethodDefinition") ? child(fn.parent!, "key")! : fn;
      edits.push({ pos: at.start, text: "async ", closing: false, extent: fn.end + 1 });
      const returns = child(fn, "returnType") ? child(child(fn, "returnType")!, "typeAnnotation") : null;
      if (returns && !/^Promise\s*</.test(text.slice(returns.start, returns.end))) { open(returns, "Promise<"); close(returns, ">"); }
      result.asyncFunctions++;
    }
    if (role === "awaiting") return;
    if (role === "polling") { convertWait(fn); return; }
    // An already-async function was somebody's to await before this run. Only a newly async one has callers to follow.
    if (wasAsync) return;
    const parent = fn.parent!;
    if (parent.type === "CallExpression" && children(parent, "arguments").includes(fn)) {
      const name = calleeName(parent) ?? "";
      if (name === "map") { awaitSite(parent, true); return; }
      if (PROMISE_CALLBACKS.has(name)) return;
      if (SYNC_ARRAY_CALLBACKS.has(name)) { note(fn, `callback of .${name}() became async, and .${name}() does not await: rewrite as a for...of loop`); return; }
      note(fn, `callback of ${name || "a call"}() became async: check that nothing reads its result synchronously`);
      return;
    }
    // An immediately invoked function: its call is the promise now.
    const outer = outermost(fn);
    if (outer.parent?.type === "CallExpression" && child(outer.parent, "callee") === outer) { awaitSite(outer.parent); return; }
    if (!known) { note(fn, "became async and is not called by name: check its callers"); return; }
    let calls = 0;
    walk(programOf(fn), node => {
      if (node.type === "CallExpression") {
        const callee = unwrap(child(node, "callee")!);
        const match = known.member ? callee.type === "MemberExpression" && !callee.computed && child(callee, "property")!.name === known.name : callee.type === "Identifier" && callee.name === known.name;
        if (match) { calls++; awaitSite(node); }
      } else if (!known.member && node.type === "Identifier" && node.name === known.name && node.parent?.type === "CallExpression" && children(node.parent, "arguments").includes(node) && !receivingCall(fn, programOf(fn)))
        note(node, `passes ${known.name}, which became async, as a callback: check the receiver awaits it`);
    });
    if (known.member && calls) note(fn, `member ${known.name}() became async and its ${calls} call(s) by that name were awaited: check they are this member`);
  }

  /** `X.waitForFunction(fn, arg, options)` to `waitForDebug(X, fn, arg, options)`. */
  function convertWait(fn: Node): void {
    if (programOf(fn) !== program) { note(fn, "is in a waitForFunction string, which Playwright never awaits: use waitForDebug with a function"); return; }
    const call = receivingCall(fn, program);
    if (!call || convertedWaits.has(call)) return;
    convertedWaits.add(call);
    const callee = unwrap(child(call, "callee")!);
    if (callee.type !== "MemberExpression") { note(call, "waitForFunction has an async predicate and is not a method call: use waitForDebug by hand"); return; }
    if (/\.(mjs|cjs|js)$/.test(file)) { note(call, "waitForFunction has an async predicate, which Playwright never awaits: poll with page.evaluate by hand"); return; }
    const receiver = child(callee, "object")!, paren = text.indexOf("(", child(call, "typeArguments")?.end ?? child(call, "callee")!.end);
    edits.push({ pos: call.start, text: `waitForDebug(${text.slice(receiver.start, receiver.end)}, `, closing: false, extent: call.end + 2, replaceTo: paren + 1 });
    const user = outermost(call).parent, awaited = user?.type === "AwaitExpression" ? user.parent : user;
    if (awaited && !["ExpressionStatement", "ArrayExpression", "ReturnStatement", "ArrowFunctionExpression"].includes(awaited.type))
      note(call, "the result of this wait is used: waitForDebug resolves with the JSON value, not a JSHandle");
    result.waits++;
  }

  for (const script of embeddedScripts(program, text)) if (script.problem) note(script.host, script.problem);
  for (const found of findAsyncDebugCalls(program, text)) if (!found.awaited && !found.returnedToPlaywright && !isIgnored(text, found.call.start)) awaitSite(found.call);
  if (!edits.length) return { output: text, result };

  // Left to right. At one position closers go first, the closer of the smaller node before the larger, and the opener of the larger node before the smaller.
  edits.sort((a, b) => a.pos - b.pos || Number(b.closing) - Number(a.closing) || b.extent - a.extent);
  let output = "", cursor = 0;
  for (const edit of edits) {
    output += text.slice(cursor, Math.max(cursor, edit.pos)) + edit.text;
    cursor = Math.max(cursor, edit.replaceTo ?? edit.pos);
  }
  output += text.slice(cursor);
  if (result.waits && !/import\s*\{[^}]*\bwaitForDebug\b[^}]*\}\s*from/.test(text)) {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lib = path.relative(path.dirname(path.join(repoRoot, file)), path.join(repoRoot, "tools/lib/wait-for-debug.js")).replaceAll("\\", "/");
    const statement = `import { waitForDebug } from "${lib.startsWith(".") ? lib : `./${lib}`}";${eol}`;
    const last = children(parse(file, output), "body").filter(node => node.type === "ImportDeclaration").at(-1);
    const lineEnd = last ? output.indexOf("\n", last.end) : -1, insertAt = last ? (lineEnd < 0 ? output.length : lineEnd + 1) : 0;
    output = output.slice(0, insertAt) + statement + output.slice(insertAt);
  }
  result.changed = output !== text;
  return { output, result };
}

const args = process.argv.slice(2), dry = args.includes("--dry");
const named = args.filter(arg => !arg.startsWith("--"));
const files = named.length ? named.map(file => path.relative(repoRoot, path.resolve(file)).replaceAll("\\", "/"))
  : execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "tools", "tests"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split(/\r?\n/).filter(file => /\.(ts|mts|tsx|mjs|js)$/.test(file) && !file.startsWith("tools/codemods/") && file !== "tools/lib/debug-calls.ts" && file !== "tools/lib/wait-for-debug.ts" && file !== "tests/debug-await-lint.test.ts");

const results: FileResult[] = [];
for (const file of files) {
  const absolute = path.join(repoRoot, file);
  let text = await readFile(absolute, "utf8"), pass: FileResult | null = null;
  if (!MENTIONS_SURFACE.test(text) && !/waitForDebug/.test(text)) continue;
  // Awaiting a helper can expose another un-awaited call one level up, so run to a fixed point.
  for (let round = 0; round < 6; round++) {
    let step: ReturnType<typeof transform>;
    try { step = transform(file, text); }
    catch (error) { pass ??= { file, awaits: 0, asyncFunctions: 0, waits: 0, promiseAlls: 0, notes: [], changed: false }; pass.notes.push(`${file}:1 could not be parsed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`); break; }
    const { output, result } = step;
    if (!pass) pass = result; else { pass.awaits += result.awaits; pass.asyncFunctions += result.asyncFunctions; pass.waits += result.waits; pass.promiseAlls += result.promiseAlls; pass.notes.push(...result.notes); pass.changed ||= result.changed; }
    if (!result.changed) break;
    text = output;
  }
  if (pass!.changed && !dry) await writeFile(absolute, text);
  if (pass!.changed || pass!.notes.length) results.push(pass!);
}
const total = (key: "awaits" | "asyncFunctions" | "waits" | "promiseAlls"): number => results.reduce((sum, result) => sum + result[key], 0);
const notes = [...new Set(results.flatMap(result => result.notes))];
for (const line of notes) console.log(`REVIEW ${line}`);
console.log(JSON.stringify({ dry, filesScanned: files.length, filesChanged: results.filter(result => result.changed).length, awaitsAdded: total("awaits"), functionsMadeAsync: total("asyncFunctions"),
  waitForFunctionConverted: total("waits"), promiseAllWrapped: total("promiseAlls"), needReview: notes.length }, null, 2));
