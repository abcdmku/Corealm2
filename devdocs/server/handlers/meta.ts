import { readFile } from "node:fs/promises";
import path from "node:path";
import { discriminated, enumOf, obj, opt, parseValue, refine, str, type Infer, type ParseContext } from "../../../game/src/content/schema/core.js";
import { CONTENT_COLLECTIONS, parseContentCollection, type ContentCollection } from "../../../tools/content/collections.js";
import { contentRevision, formatContentJson } from "../../../tools/content/format.js";
import { withFileLock } from "../../../tools/content/locks.js";
import { emptyMetaRecord, MetaFileSchema, REQUEST_KINDS, type MetaFile, type MetaRecord, type MetaSnapshot } from "../../../tools/content/meta.js";
import { openRequest } from "../../../tools/content/requests.js";
import { atomicReplaceFile } from "../../../tools/lib/atomic-replace-file.js";
import { repoRoot } from "../../../tools/lib/paths.js";
import { isLoopbackDevdocsRequest, type DevdocsJsonResponse, type DevdocsRequest } from "./collections.js";

export interface MetaHandlerOptions {
  contentRoot?: string;
  /** Server-owned identity; clients cannot supply history authors or timestamps. */
  actor?: string;
  now?: () => string;
}
export type MetaHandlerRequest = DevdocsRequest & { body?: unknown };
export interface MetaResponse { collection: string; entityId: string; revision: string; data: MetaRecord }
export type MetaHandler = (request: MetaHandlerRequest) => Promise<DevdocsJsonResponse | undefined>;

const nonblank = refine(str({ nonEmpty: true }), value => value.trim().length > 0, "must not be blank");
const authoringStatus = enumOf(["draft", "candidate", "rejected"] as const);
const operationSchema = discriminated("kind", {
  status: obj({ kind: enumOf(["status"] as const), status: authoringStatus }),
  note: obj({ kind: enumOf(["note"] as const), text: nonblank, label: opt(str()) }),
  "request.open": obj({ kind: enumOf(["request.open"] as const), requestId: nonblank, requestKind: enumOf(REQUEST_KINDS), text: nonblank, label: opt(str()) }),
  "request.close": obj({ kind: enumOf(["request.close"] as const), requestId: nonblank }),
  piece: refine(obj({ kind: enumOf(["piece"] as const), slot: enumOf(["head", "body", "legs", "hands", "feet"] as const), note: opt(str()), status: opt(authoringStatus) }),
    value => value.note !== undefined || value.status !== undefined, "piece requires note or status"),
});
const patchSchema = obj({ revision: str({ pattern: /^[a-f0-9]{64}$/ }), operation: operationSchema });
export type MetaPatch = Infer<typeof patchSchema>;
const META_PATH = "/__devdocs/meta";

function json(status: number, data: unknown, headers: Readonly<Record<string, string>> = {}): DevdocsJsonResponse {
  return { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }, body: JSON.stringify(data) };
}
function failure(status: number, error: string): DevdocsJsonResponse { return json(status, { error }); }

/** Preserve literal dot segments before URL parsing can normalize them away. */
function pathname(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let raw = url.split(/[?#]/, 1)[0]!;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    const start = raw.indexOf("/", raw.indexOf("://") + 3);
    raw = start < 0 ? "/" : raw.slice(start);
  }
  return raw.startsWith("/") ? raw : undefined;
}
export function isMetaPath(url: string | undefined): boolean {
  const raw = pathname(url);
  return raw === META_PATH || raw?.startsWith(`${META_PATH}/`) === true;
}
function route(url: string | undefined): { collection: string; entityId: string } | undefined {
  const raw = pathname(url);
  if (!raw?.startsWith(`${META_PATH}/`)) return undefined;
  let segments: string[];
  try { segments = raw.slice(META_PATH.length + 1).split("/").map(segment => decodeURIComponent(segment)); }
  catch { return undefined; }
  if (segments.some(segment => !segment || /[\\\0]/.test(segment) || segment === "." || segment === "..")) return undefined;
  const collection = segments.length === 3 && segments[0] === "balance" ? `balance/${segments[1]}` : segments.length === 2 ? segments[0] : undefined;
  const entityId = segments.at(-1)!;
  if (!collection || !/^(?:balance\/)?[a-z][a-z0-9-]*$/i.test(collection) || entityId.includes("/")) return undefined;
  return { collection, entityId };
}

function containedFile(root: string, relativeFile: string): string {
  const file = path.resolve(root, relativeFile);
  const relative = path.relative(root, file);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Content path leaves root");
  return file;
}
function metadataFile(root: string, collection: string): string {
  // Only registered names reach this helper. A balance name has one controlled separator.
  return containedFile(root, `meta/${collection.replace("/", "--")}.meta.json`);
}
async function snapshot(file: string, collection: string): Promise<MetaSnapshot> {
  let text = "{}\n";
  try { text = await readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return { records: parseValue(MetaFileSchema, JSON.parse(text), `${collection}.meta`), revision: contentRevision(text) };
}
async function entity(root: string, spec: ContentCollection, entityId: string): Promise<Record<string, unknown> | undefined> {
  const text = await readFile(containedFile(root, spec.file), "utf8");
  const data = parseContentCollection(spec, JSON.parse(text));
  if (spec.shape === "object") return entityId === "$collection" ? data as Record<string, unknown> : undefined;
  return (data as Record<string, unknown>[]).find(row => String(row[spec.idKey]) === entityId);
}
function ownRecord(records: MetaFile, entityId: string): MetaRecord {
  if (!Object.hasOwn(records, entityId)) {
    Object.defineProperty(records, entityId, { value: emptyMetaRecord(), enumerable: true, writable: true, configurable: true });
  }
  return records[entityId]!;
}
class ActionError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function applyOperation(records: MetaFile, collection: string, entityId: string, authored: Record<string, unknown>, operation: MetaPatch["operation"], actor: string, at: string): MetaFile {
  const record = ownRecord(records, entityId);
  if (operation.kind === "request.open") {
    try { return openRequest(records, { entityId, requestId: operation.requestId, kind: operation.requestKind,
      text: operation.text, actor, at, ...(operation.label === undefined ? {} : { label: operation.label }) }); }
    catch (error) { throw new ActionError(400, error instanceof Error ? error.message : "Unable to open request"); }
  }
  if (operation.kind === "note") {
    record.notes.push({ at, by: actor, text: operation.text, ...(operation.label === undefined ? {} : { label: operation.label }) });
    record.history.push({ at, by: actor, action: "note.add" });
  } else if (operation.kind === "status") {
    record.status = operation.status;
    record.history.push({ at, by: actor, action: "status.set", detail: operation.status });
  } else if (operation.kind === "request.close") {
    const requests = record.notes.filter(note => note.request?.id === operation.requestId);
    if (requests.length === 0) throw new ActionError(404, "Unknown request for this entity");
    if (requests.length !== 1) throw new ActionError(400, "Duplicate request id");
    const request = requests[0]!.request!;
    if (request.state !== "closed") {
      request.state = "closed";
      request.closedAt = at;
      record.history.push({ at, by: actor, action: "request.close", detail: operation.requestId });
    }
  } else {
    if (collection !== "equipmentSets") throw new ActionError(400, "Piece notes are available only for equipment sets");
    const members = authored.members as Record<string, unknown>;
    if (!Object.hasOwn(members, operation.slot)) throw new ActionError(400, "Piece is not a member of this set");
    record.pieces ??= {};
    const current = record.pieces[operation.slot] ?? {};
    record.pieces[operation.slot] = { ...current,
      ...(operation.note === undefined ? {} : { note: operation.note }),
      ...(operation.status === undefined ? {} : { status: operation.status }) };
    record.history.push({ at, by: actor, action: "piece.update", detail: operation.slot });
  }
  return records;
}

/** Human metadata operations only. Asset approvals and candidate promotion use their review route. */
export function createMetaHandler(options: MetaHandlerOptions = {}): MetaHandler {
  const root = path.resolve(options.contentRoot ?? path.join(repoRoot, "game", "content"));
  const actor = options.actor ?? "user";
  const now = options.now ?? (() => new Date().toISOString());
  if (!actor.trim()) throw new Error("Metadata actor must not be blank");
  return async request => {
    if (!isMetaPath(request.url)) return undefined;
    if (!isLoopbackDevdocsRequest(request)) return failure(403, "Dev docs API accepts loopback requests only");
    const target = route(request.url);
    if (!target) return failure(400, "Malformed metadata URL");
    const method = (request.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "PATCH") return json(405, { error: "Method not allowed" }, { Allow: "GET, PATCH" });
    const spec = CONTENT_COLLECTIONS.find(row => row.name === target.collection);
    if (!spec) return failure(404, "Unknown collection");
    let patch: MetaPatch | undefined;
    if (method === "PATCH") {
      const ctx: ParseContext = { issues: [] };
      patch = patchSchema.parse(request.body, "patch", ctx);
      if (ctx.issues.length) return json(400, { error: "Invalid metadata patch", diagnostics: ctx.issues });
    }
    try {
      const file = metadataFile(root, spec.name);
      const response = (current: MetaSnapshot): DevdocsJsonResponse => json(200, {
        collection: spec.name, entityId: target.entityId, revision: current.revision,
        data: Object.hasOwn(current.records, target.entityId) ? current.records[target.entityId]! : emptyMetaRecord(),
      } satisfies MetaResponse);
      if (method === "GET") {
        if (!await entity(root, spec, target.entityId)) return failure(404, "Unknown entity");
        return response(await snapshot(file, spec.name));
      }
      return await withFileLock(file, async () => {
        const authored = await entity(root, spec, target.entityId);
        if (!authored) return failure(404, "Unknown entity");
        const current = await snapshot(file, spec.name);
        if (current.revision !== patch!.revision) return json(409, {
          error: "Metadata changed since it was read. Reload before saving.", revision: current.revision,
        });
        const at = now();
        const updated = applyOperation(current.records, spec.name, target.entityId, authored, patch!.operation, actor, at);
        const validated = parseValue(MetaFileSchema, updated, `${spec.name}.meta`);
        const ordered = Object.fromEntries(Object.keys(validated).sort().map(id => [id, validated[id]]));
        const text = formatContentJson(ordered);
        await atomicReplaceFile(file, text);
        return response({ records: validated, revision: contentRevision(text) });
      });
    } catch (error) {
      if (error instanceof ActionError) return failure(error.status, error.message);
      return failure(500, "Unable to access metadata");
    }
  };
}

export function metaHandler(request: MetaHandlerRequest, options: MetaHandlerOptions = {}): Promise<DevdocsJsonResponse | undefined> {
  return createMetaHandler(options)(request);
}

export { metadataFile, snapshot as readMetadataSnapshot, applyOperation as applyMetaOperation };
