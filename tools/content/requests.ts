/** Agent request operations. Completion and asset approval belong to the human review UI. */
import { pathToFileURL } from "node:url";
import path from "node:path";
import { parseValue } from "../../game/src/content/schema/core.js";
import {
  MetaFileSchema, REQUEST_KINDS, REQUEST_STATES, emptyMetaRecord, listMetaCollections, readMetaSnapshot, withMetaUpdate,
  type MetaFile, type MetaNote, type MetaRequest, type RequestKind, type RequestState,
  type MetaSnapshot,
} from "./meta.js";
import { CONTENT_COLLECTIONS, parseContentCollection } from "./collections.js";
import { readContentJson } from "./format.js";

export interface RequestEntry {
  entityId: string;
  note: Omit<MetaNote, "request">;
  request: MetaRequest;
}

function nonempty(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} must not be blank`);
}

function validateAction(actor: string, at: string): void {
  nonempty(actor, "actor");
  if (!Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) {
    throw new Error("at must be an ISO timestamp, such as 2026-09-13T12:00:00.000Z");
  }
}

function entries(records: MetaFile): RequestEntry[] {
  const result: RequestEntry[] = [];
  const seen = new Set<string>();
  for (const [entityId, record] of Object.entries(records)) {
    for (const { request, ...note } of record.notes) {
      if (!request) continue;
      if (seen.has(request.id)) throw new Error(`Duplicate request id: ${request.id}`);
      seen.add(request.id);
      result.push({ entityId, note, request });
    }
  }
  return result;
}

function copy(records: MetaFile): MetaFile {
  const parsed = parseValue(MetaFileSchema, records, "requests.meta");
  entries(parsed);
  return parsed;
}

export function listRequests(records: MetaFile, options: { states?: readonly RequestState[] } = {}): RequestEntry[] {
  const states = options.states ?? ["open", "claimed"];
  return entries(copy(records)).filter(({ request }) => states.includes(request.state));
}

export interface OpenRequestInput {
  entityId: string;
  requestId: string;
  kind: RequestKind;
  text: string;
  actor: string;
  at: string;
  label?: string;
}

/** The caller must initialize metadata for a valid content entity before opening its first request. */
export function openRequest(records: MetaFile, input: OpenRequestInput): MetaFile {
  validateAction(input.actor, input.at);
  nonempty(input.requestId, "requestId");
  nonempty(input.text, "text");
  const next = copy(records);
  if (!Object.hasOwn(next, input.entityId)) throw new Error(`Unknown entity: ${input.entityId}`);
  if (entries(next).some(({ request }) => request.id === input.requestId)) throw new Error(`Duplicate request id: ${input.requestId}`);
  const record = next[input.entityId]!;
  record.notes.push({
    at: input.at, by: input.actor, text: input.text,
    ...(input.label === undefined ? {} : { label: input.label }),
    request: { id: input.requestId, kind: input.kind, state: "open" },
  });
  record.history.push({ at: input.at, by: input.actor, action: "request.open", detail: input.requestId });
  return copy(next);
}

export interface RequestActionInput { requestId: string; actor: string; at: string }

function target(records: MetaFile, requestId: string): RequestEntry {
  const entry = entries(records).find(({ request }) => request.id === requestId);
  if (!entry) throw new Error(`Unknown request: ${requestId}`);
  return entry;
}

export function claimRequest(records: MetaFile, input: RequestActionInput): MetaFile {
  validateAction(input.actor, input.at);
  const next = copy(records);
  const entry = target(next, input.requestId);
  const request = entry.request;
  if (request.state === "claimed" && request.claimedBy === input.actor) return next;
  if (request.state !== "open") throw new Error(`Request ${request.id} is ${request.state}${request.claimedBy ? ` by ${request.claimedBy}` : ""}`);
  request.state = "claimed";
  request.claimedBy = input.actor;
  request.claimedAt = input.at;
  next[entry.entityId]!.history.push({ at: input.at, by: input.actor, action: "request.claim", detail: input.requestId });
  return next;
}

export function replyToRequest(records: MetaFile, input: RequestActionInput & { text: string }): MetaFile {
  validateAction(input.actor, input.at);
  nonempty(input.text, "text");
  const next = copy(records);
  const entry = target(next, input.requestId);
  const request = entry.request;
  if (request.state !== "claimed" || request.claimedBy !== input.actor) {
    throw new Error(`Only the current claimer may reply to claimed request ${request.id}`);
  }
  request.state = "replied";
  request.reply = input.text;
  request.repliedAt = input.at;
  next[entry.entityId]!.history.push({
    at: input.at, by: input.actor, action: "request.reply", detail: JSON.stringify({ requestId: input.requestId, text: input.text }),
  });
  return next;
}

export interface RequestsCliOptions {
  action: "list" | "open" | "claim" | "reply";
  format: "json" | "markdown";
  collection?: string;
  entity?: string;
  id?: string;
  kind?: RequestKind;
  text?: string;
  actor?: string;
  revision?: string;
  all: boolean;
}

export function parseRequestsArgs(args: readonly string[]): RequestsCliOptions {
  const rest = [...args];
  const first = rest[0];
  const action = first && !first.startsWith("--") ? rest.shift()! : "list";
  if (!["list", "open", "claim", "reply"].includes(action)) throw new Error(`Unknown request action: ${action}`);
  const result: RequestsCliOptions = { action: action as RequestsCliOptions["action"], format: "markdown", all: false };
  const used = new Set<string>();
  while (rest.length) {
    const flag = rest.shift()!;
    if (used.has(flag)) throw new Error(`Repeated option: ${flag}`);
    used.add(flag);
    if (flag === "--json" || flag === "--markdown") {
      if (used.has(flag === "--json" ? "--markdown" : "--json")) throw new Error("Choose either --json or --markdown");
      result.format = flag === "--json" ? "json" : "markdown";
    } else if (flag === "--all") result.all = true;
    else if (["--collection", "--entity", "--id", "--kind", "--text", "--actor", "--revision"].includes(flag)) {
      const value = rest.shift();
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
      nonempty(value, flag);
      Object.assign(result, { [flag.slice(2)]: value });
    } else throw new Error(`Unknown option: ${flag}`);
  }
  if (result.kind && !REQUEST_KINDS.includes(result.kind)) throw new Error(`Invalid request kind: ${result.kind}`);
  if (result.action !== "list") {
    for (const field of ["collection", "id", "actor", "revision"] as const) {
      if (!result[field]) throw new Error(`--${field} is required for ${result.action}`);
    }
    if (result.action === "open" && (!result.entity || !result.kind || !result.text)) throw new Error("open requires --entity, --kind and --text");
    if (result.action === "reply" && !result.text) throw new Error("reply requires --text");
    if (result.all) throw new Error("--all is only valid for list");
  }
  const allowed = new Set(["--json", "--markdown", "--collection",
    ...(result.action === "list" ? ["--all"] : ["--id", "--actor", "--revision"]),
    ...(result.action === "open" ? ["--entity", "--kind", "--text"] : []),
    ...(result.action === "reply" ? ["--text"] : []),
  ]);
  for (const flag of used) if (!allowed.has(flag)) throw new Error(`${flag} is not valid for ${result.action}`);
  return result;
}

export interface CollectionRequestEntry extends RequestEntry { collection: string }
export interface RequestsReport { revisions: Record<string, string>; requests: CollectionRequestEntry[] }

export function formatRequests(report: RequestsReport, format: "json" | "markdown"): string {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  const lines: string[] = [];
  const escape = (value: string) => value.replaceAll("\\", "\\\\").replace(/[\[\]`*_<>|]/g, "\\$&");
  for (const [collection, revision] of Object.entries(report.revisions)) lines.push(`${escape(collection)} revision: ${revision}`, "");
  if (!report.requests.length) lines.push("No matching requests.");
  for (const { collection, entityId, request, note } of report.requests) {
    lines.push(`- ${escape(request.id)} | ${escape(collection)}/${escape(entityId)} | ${request.kind} | ${request.state}`);
    lines.push(`  Opened by ${escape(note.by)} at ${escape(note.at)}${note.label ? ` | ${escape(note.label)}` : ""}.`);
    lines.push(`  ${escape(note.text).replaceAll("\n", "\n  ")}`);
    if (request.claimedBy) lines.push(`  Claimed by ${escape(request.claimedBy)} at ${escape(request.claimedAt ?? "unknown")}.`);
    if (request.reply !== undefined) lines.push(`  Reply: ${escape(request.reply).replaceAll("\n", "\n  ")}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export interface RequestsStore {
  collections(): Promise<string[]>;
  read(collection: string): Promise<MetaSnapshot>;
  update(collection: string, revision: string, change: (records: MetaFile) => MetaFile | Promise<MetaFile>): Promise<MetaSnapshot>;
  hasEntity(collection: string, entityId: string): Promise<boolean>;
}

const fileStore: RequestsStore = {
  collections: listMetaCollections,
  read: readMetaSnapshot,
  update: withMetaUpdate,
  async hasEntity(collection, entityId) {
    const spec = CONTENT_COLLECTIONS.find((entry) => entry.name === collection);
    if (!spec) throw new Error(`Collection is not registered: ${collection}`);
    if (spec.shape === "object") return entityId === "$collection";
    const rows = parseContentCollection(spec, await readContentJson(spec.file)) as Record<string, unknown>[];
    return rows.some((row) => String(row[spec.idKey]) === entityId);
  },
};

/** Shared entry point for the CLI and tests; storage owns revision comparison while holding its lock. */
export async function executeRequests(
  options: RequestsCliOptions,
  store: RequestsStore = fileStore,
  at = new Date().toISOString(),
): Promise<RequestsReport> {
  const report: RequestsReport = { revisions: {}, requests: [] };
  if (options.action === "list") {
    const collections = options.collection ? [options.collection] : await store.collections();
    const snapshots = await Promise.all(collections.map(async (collection) => ({ collection, snapshot: await store.read(collection) })));
    for (const { collection, snapshot } of snapshots) {
      report.revisions[collection] = snapshot.revision;
      report.requests.push(...listRequests(snapshot.records, { states: options.all ? REQUEST_STATES : undefined })
        .map((entry) => ({ collection, ...entry })));
    }
    return report;
  }
  const collection = options.collection;
  if (!collection || !options.revision || !options.id || !options.actor) throw new Error("Mutations require collection, revision, id and actor");
  const input = { requestId: options.id, actor: options.actor, at };
  const snapshot = await store.update(collection, options.revision, async (records) => {
    if (options.action === "open") {
      if (!options.entity || !options.kind || !options.text) throw new Error("open requires entity, kind and text");
      if (!await store.hasEntity(collection, options.entity)) throw new Error(`Unknown entity: ${options.entity}`);
      const initialized = Object.hasOwn(records, options.entity) ? records : { ...records, [options.entity]: emptyMetaRecord() };
      return openRequest(initialized, { ...input, entityId: options.entity, kind: options.kind, text: options.text });
    }
    if (options.action === "claim") return claimRequest(records, input);
    if (options.action === "reply") return replyToRequest(records, { ...input, text: options.text ?? "" });
    throw new Error(`Unknown request action: ${String(options.action)}`);
  });
  report.revisions[collection] = snapshot.revision;
  report.requests = listRequests(snapshot.records, { states: REQUEST_STATES })
    .filter(({ request }) => request.id === options.id).map((entry) => ({ collection, ...entry }));
  return report;
}

export const REQUESTS_USAGE = `Usage:
  tsx tools/content/requests.ts [list] [--collection NAME] [--all] [--json|--markdown]
  tsx tools/content/requests.ts open --collection NAME --entity ID --id REQUEST --kind KIND --text TEXT --actor NAME --revision REV
  tsx tools/content/requests.ts claim --collection NAME --id REQUEST --actor NAME --revision REV
  tsx tools/content/requests.ts reply --collection NAME --id REQUEST --text TEXT --actor NAME --revision REV

List defaults to open and claimed requests. Use the collection revision from list for each mutation.
Agents may open, claim and reply. Closing requests and approving assets are human review actions.
`;

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) process.stdout.write(REQUESTS_USAGE);
    else {
      const options = parseRequestsArgs(args);
      process.stdout.write(formatRequests(await executeRequests(options), options.format));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
