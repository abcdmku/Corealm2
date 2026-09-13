import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "../lib/paths.js";

const EXPORTERS = [
  "people", "story", "spells", "audio", "items", "recipes", "resources", "sets", "gathering-tiers", "crafting-tiers", "campfire-fuels",
  "loot", "enemies", "creatures",
] as const;

function applyRequested(args: readonly string[]): boolean {
  const unexpected = args.filter((arg) => arg !== "--apply");
  if (unexpected.length > 0) throw new Error(`Unknown arguments: ${unexpected.join(" ")}`);
  if (args.filter((arg) => arg === "--apply").length > 1) throw new Error("Duplicate --apply argument");
  return args.includes("--apply");
}

function runExporter(name: string, args: readonly string[]): void {
  const result = spawnSync(process.execPath, ["--import", "tsx", `tools/content/export-${name}.ts`, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Export ${name} failed (${result.status ?? "signal"})`);
}

/**
 * Validates every exporter before applying any of them. The second pass is intentionally not a
 * cross-file transaction: a later writer can still fail after earlier files have been replaced.
 */
export function runJsonExport(args: readonly string[] = process.argv.slice(2)): void {
  const apply = applyRequested(args);
  console.log(`Preflight: validating ${EXPORTERS.length} baseline exporters.`);
  for (const name of EXPORTERS) runExporter(name, []);
  console.log(`Preflight passed for all ${EXPORTERS.length} exporters.`);
  if (!apply) {
    console.log("Dry run: no files written. Pass --apply to validate again and then apply the exports.");
    return;
  }

  console.log("Applying exports in registry order after successful preflight.");
  for (const name of EXPORTERS) runExporter(name, ["--apply"]);
  console.log("Applied all exporters. This pass is not transactional across collections.");
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  runJsonExport();
}
