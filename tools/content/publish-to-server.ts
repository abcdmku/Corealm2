/**
 * Push this checkout's content to a server you administer: restoring a backup, or loading content
 * you authored offline.
 *
 * A server owns its own content, so this overwrites somebody's live data. Every publish is
 * therefore deliberate, manual, and guarded twice. `--confirm` has to equal the name the server
 * reports at `GET /admin/info`, so a pasted URL cannot quietly land on the wrong host, and every
 * collection is sent with the revision the server itself reported, so a publish that would
 * overwrite an edit made in devdocs is refused rather than forced.
 *
 * Usage:
 *   COREALM_CONTENT_TOKEN=cat_… tsx tools/content/publish-to-server.ts --server https://play.example.com/ --confirm "Raid Night"
 *   ... --validate-only      run every check the server runs and store nothing
 *   ... --note "<text>"      kept with the revision and the audit row
 *   ... --root <dir>         a content root other than `game/content`
 */
import "../lib/repoContent.js";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { argValue } from "../lib/paths.js";
import { changedCollections } from "../../game/src/content/compiler/changes.js";
import { readContentSources } from "./compile.js";
import { contentRoot } from "./format.js";
import { ContentServer, explainRefusal, redact, safeId, ServerRefusal, type PublishReply } from "./serverSync.js";

export interface PublishOptions {
  serverUrl: string;
  token: string;
  /** Must equal the server's own name. The guard against publishing to the wrong server. */
  confirmName: string;
  root?: string;
  validateOnly?: boolean;
  note?: string;
  fetch?: typeof fetch;
}
export interface PublishResult {
  serverUrl: string;
  serverName: string;
  mode: "validate" | "publish";
  base: string;
  /** Collections where this checkout differs from the server. Only these are sent. */
  sent: string[];
  reply: PublishReply | null;
  report: string;
}

/** A refusal an operator has to act on, with the sentence that says how. */
export class PublishRefused extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly detail: Record<string, unknown> = {}) {
    super(message);
    this.name = "PublishRefused";
  }
}

export async function publishToServer(options: PublishOptions): Promise<PublishResult> {
  const root = path.resolve(options.root ?? contentRoot);
  const mode: "validate" | "publish" = options.validateOnly ? "validate" : "publish";
  const server = new ContentServer({ serverUrl: options.serverUrl, token: options.token, fetch: options.fetch });

  // Before anything is read or sent: is this the server the operator meant?
  const info = await server.info();
  if (!options.confirmName) throw new PublishRefused("not_confirmed", 0, `Publishing needs --confirm "<server name>". This server calls itself "${safeId(info.name)}".`);
  if (info.name !== options.confirmName) {
    throw new PublishRefused("wrong_server", 0,
      `Refusing to publish: ${server.url} calls itself "${safeId(info.name)}", and --confirm said "${safeId(options.confirmName)}". Nothing was sent.`);
  }

  const remote = await server.sources();
  const repo = await readContentSources(root);
  const differing = changedCollections(new Map(Object.entries(remote.sources)), repo);

  const collections: Record<string, { revision: string; value: unknown }> = {};
  for (const spec of differing) {
    const revision = remote.revisions[spec.name];
    if (!revision) throw new PublishRefused("unknown_collection", 0, `The server holds no collection "${safeId(spec.name)}", so there is no revision to publish against. Its release is older than this branch; deploy the server first.`);
    collections[spec.name] = { revision, value: repo.get(spec.name) };
  }
  const base: PublishResult = { serverUrl: server.url, serverName: info.name, mode, base: remote.revision, sent: differing.map(spec => spec.name), reply: null, report: "" };
  if (differing.length === 0) {
    base.report = `"${info.name}" already holds this branch's content at revision ${remote.revision.slice(0, 12)}. Nothing to ${mode === "validate" ? "check" : "publish"}.`;
    return base;
  }

  try {
    base.reply = await server.send(mode, { base: remote.revision, collections, ...(options.note ? { note: options.note } : {}) });
  } catch (error) {
    if (error instanceof ServerRefusal) throw new PublishRefused(error.code, error.status, explainRefusal(error), error.detail);
    throw error;
  }
  base.report = publishReport(base);
  return base;
}

export function publishReport(result: PublishResult): string {
  const reply = result.reply;
  if (!reply) return result.report;
  const lines = [
    `server:    ${result.serverName} at ${result.serverUrl}`,
    `mode:      ${result.mode === "validate" ? "validate only, nothing stored" : "published"}`,
    `base:      ${result.base}`,
    `revision:  ${reply.revision}${reply.unchanged ? " (unchanged: this content is already active)" : ""}`,
    `stored:    ${reply.stored}`,
    `sent:      ${result.sent.join(", ")}`,
  ];
  if (reply.live.length > 0) lines.push(`live now:  ${reply.live.join(", ")}`);
  lines.push(`on restart: ${reply.onRestart.length ? reply.onRestart.join(", ") : "nothing"}`);
  for (const [name, ids] of Object.entries(reply.affected)) {
    if (ids.length > 0) lines.push(`  ${name}: ${ids.slice(0, 20).map(safeId).join(", ")}${ids.length > 20 ? ` and ${ids.length - 20} more` : ""}`);
  }
  if (reply.spawns?.length) for (const spawn of reply.spawns) lines.push(`  spawns in ${safeId(spawn.world)}: +${spawn.added} added, ${spawn.pending} waiting for a respawn, ${spawn.retiring} retiring, ${spawn.removed} removed`);
  if (typeof reply.notified === "number") lines.push(`notified:  ${reply.notified} connected client${reply.notified === 1 ? "" : "s"}`);
  if (reply.assetValidation) lines.push(`assets:    checked against the ${reply.assetValidation} manifest`);
  for (const problem of reply.problems) lines.push(`  ${problem.severity}: ${safeId(problem.path)}: ${redact(problem.message)}`);
  return lines.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const token = process.env.COREALM_CONTENT_TOKEN ?? "";
  const serverUrl = argValue(argv, "--server") ?? "";
  if (!serverUrl) { console.error("Publishing needs an explicit --server https://…. It is never taken from the environment, so a stray variable cannot redirect it."); return 2; }
  if (!token) { console.error("Set COREALM_CONTENT_TOKEN to a token with both content:read and content:publish scopes. It is never accepted as a flag."); return 2; }
  if (argv.some(argument => argument === "--token" || argument.startsWith("--token="))) { console.error("--token is not a flag here: a command line is visible to every process on the machine. Use COREALM_CONTENT_TOKEN."); return 2; }

  try {
    const result = await publishToServer({ serverUrl, token, confirmName: argValue(argv, "--confirm") ?? "",
      root: argValue(argv, "--root"), validateOnly: argv.includes("--validate-only"), note: argValue(argv, "--note") });
    console.log(result.report);
    return 0;
  } catch (error) {
    console.error(error instanceof PublishRefused || error instanceof ServerRefusal ? redact(error.message, token) : redact(error instanceof Error ? error.message : String(error), token));
    return 1;
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) process.exitCode = await main(process.argv.slice(2));
