import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { calleeName, child, children, embeddedScripts, enclosingFunction, findAsyncDebugCalls, lineOf, outermost, pageRole, parse, walk } from "./lib/debug-calls.js";
import { ASYNC_DEBUG_METHODS } from "../game/src/debug/asyncMethods.js";
import { repoRoot } from "./lib/paths.js";

/**
 * Fails on a call to an asynchronous `window.__gameDebug` method that is not awaited, anywhere under
 * `tools/` and `tests/`.
 *
 *   tsx tools/debug-await-lint.ts           every file
 *   tsx tools/debug-await-lint.ts <files>   only these
 *
 * Local play runs in a worker, so these methods (`game/src/debug/asyncMethods.ts`) return promises. A
 * call that forgets `await` still has its effect, a moment later, and its result serialises to `{}`:
 * the tool reads state from before the change and the failure shows up somewhere else. Three shapes:
 *
 *   - the call is not awaited, and is not the value a Playwright-awaited callback returns;
 *   - the call is inside a `waitForFunction` predicate, which Playwright polls without awaiting, so
 *     an async predicate is true on its first poll. Use `waitForDebug` from `tools/lib/wait-for-debug.ts`;
 *   - a Node-side `callDebug("method")` statement whose promise is dropped.
 *
 * Page scripts kept as strings are parsed and held to the same rules.
 *
 * `tools/codemods/await-debug-mutators.ts` fixes the first two. A line, or the line above it, that
 * says `debug-await-lint: ignore` with a reason is skipped. `tests/debug-await-lint.test.ts` runs
 * this in the suite, and `npm run check:fast` runs it directly.
 */
export interface Violation { file: string; line: number; message: string }
const ASYNC = new Set<string>(ASYNC_DEBUG_METHODS);

export function lintText(file: string, text: string): Violation[] {
  if (!/__gameDebug|callDebug|waitForDebug/.test(text)) return [];
  const program = parse(file, text), lines = text.split("\n"), found: Violation[] = [];
  const report = (position: number, message: string): void => {
    const line = lineOf(text, position);
    if (/debug-await-lint:\s*ignore/.test(`${lines[line - 2] ?? ""}\n${lines[line - 1] ?? ""}`)) return;
    found.push({ file, line, message });
  };
  for (const script of embeddedScripts(program, text)) if (script.problem) report(script.host.start, script.problem);
  for (const call of findAsyncDebugCalls(program, text)) {
    const name = call.method ? `__gameDebug.${call.method}()` : "a computed __gameDebug method";
    let top = call.call; while (top.parent) top = top.parent;
    let polled = top.polled === true;
    for (let fn = enclosingFunction(call.call); fn && !polled; fn = enclosingFunction(fn)) polled = pageRole(fn, top) === "polling";
    if (polled) report(call.call.start, `${name} is asynchronous, and waitForFunction never awaits its predicate: use waitForDebug from tools/lib/wait-for-debug.ts`);
    else if (!call.awaited && !call.returnedToPlaywright) report(call.call.start, `${name} is asynchronous and is not awaited`);
  }
  walk(program, node => {
    if (node.type !== "CallExpression" || calleeName(node) !== "callDebug") return;
    const method = children(node, "arguments")[0];
    if (method?.type !== "Literal" || typeof method.value !== "string" || !ASYNC.has(method.value)) return;
    if (outermost(node).parent?.type === "ExpressionStatement" && child(outermost(node).parent!, "expression") === outermost(node)) report(node.start, `callDebug("${method.value}") is a promise that nothing awaits`);
  });
  return found;
}

export async function lintFiles(files?: string[]): Promise<Violation[]> {
  const listed = files ?? execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "tools", "tests"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split(/\r?\n/).filter(file => /\.(ts|mts|tsx|mjs|js)$/.test(file) && file !== "tools/lib/debug-calls.ts" && file !== "tools/debug-await-lint.ts" && file !== "tests/debug-await-lint.test.ts" && !file.startsWith("tools/codemods/"));
  const violations: Violation[] = [];
  for (const file of listed) {
    const text = await readFile(path.join(repoRoot, file), "utf8").catch(() => null);
    if (text === null) continue;
    try { violations.push(...lintText(file, text)); }
    catch (error) { if (/__gameDebug/.test(text)) violations.push({ file, line: 1, message: `could not be parsed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` }); }
  }
  return violations;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const named = process.argv.slice(2).filter(arg => !arg.startsWith("--")).map(file => path.relative(repoRoot, path.resolve(file)).replaceAll("\\", "/"));
  const violations = await lintFiles(named.length ? named : undefined);
  for (const violation of violations) console.error(`${violation.file}:${violation.line} ${violation.message}`);
  console.log(violations.length ? `${violations.length} asynchronous debug call(s) are not awaited. Run: tsx tools/codemods/await-debug-mutators.ts` : "Every asynchronous debug call is awaited.");
  process.exitCode = violations.length ? 1 : 0;
}
