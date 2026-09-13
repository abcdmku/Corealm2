/**
 * Proves a migrated table equals the one HEAD shipped.
 *
 *   npx tsx tools/content/parity.ts game/src/content/shops.ts SHOPS [MORE_EXPORTS...]
 *   npx tsx tools/content/parity.ts --all-exports game/src/content/npcs.ts
 *
 * `.baseline/` is a `git archive HEAD game/src tools` snapshot taken before the migration started
 * (recreate with `npm run content:baseline`). Both copies are imported under tsx and every named
 * export is compared with `toEqual` semantics: `undefined`-valued keys are ignored, arrays must
 * match in order, functions are compared by name only. Exit 1 with the first differing paths.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { repoRoot } from "../lib/paths.js";

export interface ParityDifference { path: string; expected: string; actual: string }

function show(value: unknown): string {
  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
  if (value === undefined) return "undefined";
  try { const text = JSON.stringify(value); return text.length > 120 ? `${text.slice(0, 117)}...` : text; }
  catch { return String(value); }
}

function definedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => value[key] !== undefined).sort();
}

/** `toEqual`-style structural comparison that records where two values diverge. */
export function collectDifferences(expected: unknown, actual: unknown, at: string, out: ParityDifference[], limit = 25): void {
  if (out.length >= limit) return;
  if (Object.is(expected, actual)) return;
  if (typeof expected === "function" && typeof actual === "function") {
    if (expected.name !== actual.name) out.push({ path: at, expected: show(expected), actual: show(actual) });
    return;
  }
  if (typeof expected !== "object" || typeof actual !== "object" || expected === null || actual === null) {
    if (!(typeof expected === "number" && typeof actual === "number" && Number.isNaN(expected) && Number.isNaN(actual))) {
      out.push({ path: at, expected: show(expected), actual: show(actual) });
    }
    return;
  }
  if (Array.isArray(expected) !== Array.isArray(actual)) { out.push({ path: at, expected: show(expected), actual: show(actual) }); return; }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) out.push({ path: `${at}.length`, expected: String(expected.length), actual: String(actual.length) });
    const shared = Math.min(expected.length, actual.length);
    for (let index = 0; index < shared && out.length < limit; index += 1) collectDifferences(expected[index], actual[index], `${at}[${index}]`, out, limit);
    return;
  }
  if (expected instanceof Map || actual instanceof Map || expected instanceof Set || actual instanceof Set) {
    const toPlain = (value: unknown): unknown => value instanceof Map ? Object.fromEntries(value) : value instanceof Set ? [...value] : value;
    collectDifferences(toPlain(expected), toPlain(actual), at, out, limit);
    return;
  }
  const left = expected as Record<string, unknown>, right = actual as Record<string, unknown>;
  const leftKeys = definedKeys(left), rightKeys = definedKeys(right);
  for (const key of leftKeys) if (!rightKeys.includes(key) && out.length < limit) out.push({ path: `${at}.${key}`, expected: show(left[key]), actual: "missing" });
  for (const key of rightKeys) if (!leftKeys.includes(key) && out.length < limit) out.push({ path: `${at}.${key}`, expected: "missing", actual: show(right[key]) });
  for (const key of leftKeys) if (rightKeys.includes(key) && out.length < limit) collectDifferences(left[key], right[key], `${at}.${key}`, out, limit);
}

export interface ParityReport { module: string; exportName: string; differences: ParityDifference[]; ok: boolean }

export async function compareModuleExports(modulePath: string, exportNames: readonly string[] | "all"): Promise<ParityReport[]> {
  const relative = modulePath.replaceAll("\\", "/").replace(/^\.\//, "");
  const baselineFile = path.join(repoRoot, ".baseline", relative);
  const currentFile = path.join(repoRoot, relative);
  if (!existsSync(baselineFile)) throw new Error(`No baseline copy at ${baselineFile}. Run: npm run content:baseline`);
  const [baseline, current] = await Promise.all([import(pathToFileURL(baselineFile).href), import(pathToFileURL(currentFile).href)]) as [Record<string, unknown>, Record<string, unknown>];
  const names = exportNames === "all" ? [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort() : exportNames;
  return names.map((exportName) => {
    const differences: ParityDifference[] = [];
    if (!(exportName in baseline)) differences.push({ path: exportName, expected: "missing in baseline", actual: show(current[exportName]) });
    else if (!(exportName in current)) differences.push({ path: exportName, expected: show(baseline[exportName]), actual: "missing in current" });
    else collectDifferences(baseline[exportName], current[exportName], exportName, differences);
    return { module: relative, exportName, differences, ok: differences.length === 0 };
  });
}

export function formatParity(reports: readonly ParityReport[]): string {
  return reports.map((report) => report.ok
    ? `ok   ${report.module} ${report.exportName}`
    : `DIFF ${report.module} ${report.exportName}\n${report.differences.map((d) => `     ${d.path}: expected ${d.expected}, got ${d.actual}`).join("\n")}`).join("\n");
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  const args = process.argv.slice(2);
  const all = args.includes("--all-exports");
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const [modulePath, ...exportNames] = positional;
  if (!modulePath || (!all && exportNames.length === 0)) {
    console.error("usage: tsx tools/content/parity.ts <module.ts> <EXPORT...> | --all-exports <module.ts>");
    process.exit(2);
  }
  const reports = await compareModuleExports(modulePath, all ? "all" : exportNames);
  console.log(formatParity(reports));
  process.exit(reports.every((report) => report.ok) ? 0 : 1);
}
