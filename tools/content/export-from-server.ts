/**
 * Pull a live server's content back into this checkout.
 *
 * Once a server is live it is the source of truth for its data, so the repository receives exports
 * rather than dictating. This tool reads the active revision's source collections over the admin
 * API with a `content:read` token, writes them through the canonical JSON writer, and recompiles, so
 * an export of content that did not change is a zero-byte diff and an export that did change is a
 * pull request a human reads.
 *
 * Usage:
 *   COREALM_CONTENT_TOKEN=cat_… tsx tools/content/export-from-server.ts --server https://play.example.com/
 *   ... --dry-run            report what would change and write nothing
 *   ... --summary <file>     write the pull request body as markdown
 *   ... --root <dir>         a content root other than `game/content` (tests use a copy)
 *
 * The token comes from the environment only. It is never a flag, never logged, and `redact` scrubs
 * it from any error on its way out.
 */
import "../lib/repoContent.js";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { atomicReplaceFile } from "../lib/atomic-replace-file.js";
import { argValue } from "../lib/paths.js";
import { CONTENT_COLLECTIONS } from "../../game/src/content/compiler/collections.js";
import { affectedSources, changedCollections } from "../../game/src/content/compiler/changes.js";
import { formatContentJson } from "../../game/src/content/compiler/canonical.js";
import { compileAndPublish, compileContent, readContentSources, type ContentBuild } from "./compile.js";
import { contentRoot } from "./format.js";
import { ContentServer, collectionTarget, COLLECTIONS_BY_NAME, redact, safeId, ServerRefusal, explainRefusal, type RevisionHistoryEntry } from "./serverSync.js";

export interface ExportOptions {
  serverUrl: string;
  token: string;
  /** The content root to write into: the directory that holds `data/` and `compiled/`. */
  root?: string;
  dryRun?: boolean;
  fetch?: typeof fetch;
}
export interface ExportChange { collection: string; ids: string[] }
export interface ExportResult {
  serverUrl: string;
  serverRevision: string;
  published: RevisionHistoryEntry | null;
  changed: ExportChange[];
  changedCollections: string[];
  /** Collections this checkout knows that the server did not send. Their files are left alone. */
  missing: string[];
  written: string[];
  dryRun: boolean;
  /** What this checkout's formulas compile the exported sources to. */
  compiledRevision: string;
  /** True when this checkout compiles the server's sources back to the server's own revision. */
  revisionMatches: boolean;
  summary: string;
}

/** Everything the CLI does apart from reading the environment and printing. */
export async function exportFromServer(options: ExportOptions): Promise<ExportResult> {
  const root = path.resolve(options.root ?? contentRoot);
  const server = new ContentServer({ serverUrl: options.serverUrl, token: options.token, fetch: options.fetch });

  // Ask for a named revision, so the sources cannot come from a different catalog than the one reported.
  const pointer = await server.revision(1);
  const remote = await server.sources(pointer.revision);
  if (remote.revision !== pointer.revision) throw new Error(`The server reported revision ${pointer.revision} and then sent the sources of ${remote.revision}`);

  const before = await readContentSources(root);
  const after = new Map<string, unknown>(CONTENT_COLLECTIONS.map(spec =>
    [spec.name, Object.hasOwn(remote.sources, spec.name) ? remote.sources[spec.name] : before.get(spec.name)]));
  const missing = CONTENT_COLLECTIONS.filter(spec => !Object.hasOwn(remote.sources, spec.name)).map(spec => spec.name);

  const changedSpecs = changedCollections(before, after);
  const affected = affectedSources(changedSpecs, before, after);
  const changed: ExportChange[] = changedSpecs.map(spec => ({ collection: spec.name, ids: affected.filter(entry => entry.collection === spec.name).map(entry => entry.id) }));

  // Compile before writing, so content a server sent that this checkout cannot build never lands.
  let build: ContentBuild = compileContent(after);
  if (!build.ok) {
    const errors = build.diagnostics.filter(problem => problem.severity === "error");
    throw new Error([`The exported content does not compile in this checkout, so nothing was written (${errors.length} error${errors.length === 1 ? "" : "s"}):`,
      ...errors.slice(0, 30).map(problem => `  - ${problem.path}: ${problem.message}`)].join("\n"));
  }

  const written: string[] = [];
  if (!options.dryRun) {
    for (const spec of changedSpecs) {
      const target = collectionTarget(root, COLLECTIONS_BY_NAME.get(spec.name)!);
      await mkdir(path.dirname(target), { recursive: true });
      await atomicReplaceFile(target, formatContentJson(after.get(spec.name)));
      written.push(path.relative(root, target).split(path.sep).join("/"));
    }
    // The repo's own compile, reading the files back, so `compiled/catalog.json` matches what landed.
    build = await compileAndPublish(root);
    if (!build.ok) throw new Error("The exported content compiled in memory and then failed on disk; the checkout is inconsistent.");
  }

  const result: ExportResult = {
    serverUrl: server.url, serverRevision: remote.revision, published: pointer.history[0] ?? null,
    changed, changedCollections: changedSpecs.map(spec => spec.name), missing, written,
    dryRun: options.dryRun === true, compiledRevision: build.revision, revisionMatches: build.revision === remote.revision,
    summary: "",
  };
  result.summary = exportSummary(result);
  return result;
}

/** The pull request body. Every value the server supplied passes through `safeId` first. */
export function exportSummary(result: ExportResult): string {
  const lines = [
    "### Live content export",
    "",
    `Exported from \`${result.serverUrl}\` at catalog revision \`${result.serverRevision.slice(0, 12)}\`.`,
    "",
  ];
  if (result.published) {
    const when = typeof result.published.at === "number" ? new Date(result.published.at).toISOString() : "an unrecorded time";
    lines.push(`That revision was published by \`${safeId(result.published.by ?? "unknown")}\` at ${when}${result.published.note ? `: ${safeId(result.published.note)}` : "."}`, "");
  }
  if (result.changed.length === 0) {
    lines.push("This checkout already holds that content. Nothing changed.", "");
  } else {
    lines.push("| Collection | Records |", "| --- | --- |");
    for (const change of result.changed) {
      const shown = change.ids.slice(0, 40).map(id => `\`${safeId(id)}\``).join(", ");
      lines.push(`| \`${safeId(change.collection)}\` | ${shown}${change.ids.length > 40 ? ` and ${change.ids.length - 40} more` : ""} |`);
    }
    lines.push("");
  }
  lines.push(result.revisionMatches
    ? `This checkout compiles those sources back to the same revision, \`${result.compiledRevision.slice(0, 12)}\`, so its formulas match the server's release.`
    : [`This checkout compiles those sources to \`${result.compiledRevision.slice(0, 12)}\`, not the server's \`${result.serverRevision.slice(0, 12)}\`.`,
       "That is expected when the server runs a release whose balance formulas differ from this branch: formulas are TypeScript that ships with a server release, and only the data is exported.",
       "The source collections in this diff are still exactly what the server holds."].join(" "));
  if (result.missing.length > 0) lines.push("", `The server sent no value for ${result.missing.map(name => `\`${safeId(name)}\``).join(", ")}, so ${result.missing.length === 1 ? "that file was" : "those files were"} left as this branch has ${result.missing.length === 1 ? "it" : "them"}.`);
  lines.push("", "Once a server is live it is the source of truth for its data. Review this the way you would review an edit made in devdocs, because that is what it is.");
  return lines.join("\n");
}

/** Lines for a terminal or an Actions log. */
export function exportReport(result: ExportResult): string {
  const lines = [`server:    ${result.serverUrl}`, `revision:  ${result.serverRevision}`, `compiled:  ${result.compiledRevision}${result.revisionMatches ? " (matches the server)" : " (differs: this checkout's formulas are not the server release's)"}`];
  if (result.changed.length === 0) lines.push("changed:   nothing; this checkout already holds the server's content");
  else {
    lines.push(`changed:   ${result.changed.length} collection${result.changed.length === 1 ? "" : "s"}`);
    for (const change of result.changed) lines.push(`  ${change.collection}: ${change.ids.slice(0, 20).map(safeId).join(", ")}${change.ids.length > 20 ? ` and ${change.ids.length - 20} more` : ""}`);
  }
  if (result.missing.length > 0) lines.push(`missing:   ${result.missing.join(", ")} (left as this branch has them)`);
  lines.push(result.dryRun ? "wrote:     nothing (--dry-run)" : `wrote:     ${result.written.length ? result.written.join(", ") : "nothing"}${result.written.length ? ", compiled/catalog.json" : ""}`);
  return lines.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const token = process.env.COREALM_CONTENT_TOKEN ?? "";
  const serverUrl = argValue(argv, "--server") ?? process.env.COREALM_SERVER_URL ?? "";
  if (!serverUrl) { console.error("Give a server with --server https://… or COREALM_SERVER_URL."); return 2; }
  if (!token) { console.error("Set COREALM_CONTENT_TOKEN to a content:read token. It is never accepted as a flag."); return 2; }
  if (argv.some(argument => argument === "--token" || argument.startsWith("--token="))) { console.error("--token is not a flag here: a command line is visible to every process on the machine. Use COREALM_CONTENT_TOKEN."); return 2; }

  try {
    const result = await exportFromServer({ serverUrl, token, root: argValue(argv, "--root"), dryRun: argv.includes("--dry-run") });
    console.log(exportReport(result));
    const summaryFile = argValue(argv, "--summary");
    if (summaryFile) await atomicReplaceFile(path.resolve(summaryFile), `${result.summary}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${result.summary}\n`);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
      `changed=${result.changed.length > 0}\nrevision=${result.serverRevision}\ncollections=${result.changedCollections.join(",")}\n`);
    return 0;
  } catch (error) {
    console.error(error instanceof ServerRefusal ? explainRefusal(error) : redact(error instanceof Error ? error.message : String(error), token));
    return 1;
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) process.exitCode = await main(process.argv.slice(2));
