import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseValue } from "../../../game/src/content/schema/core.js";
import { CONTENT_COLLECTIONS, parseContentCollection, type ContentCollection } from "../../../game/src/content/compiler/collections.js";
import {
  applyMetaOperation, canonicalMetaFile, emptyMetaRecord, META_CONFLICT_MESSAGE, metaCollection, metaDigest, MetaActionError, MetaFileSchema, parseMetaPatch,
  type MetaDigestResponse, type MetaPatch, type MetaResponse,
} from "../../../game/src/content/metaOps.js";
import { formatContentJson } from "../../../game/src/content/compiler/canonical.js";
import { contentRevision } from "../../../tools/content/format.js";
import { withFileLock } from "../../../tools/content/locks.js";
import type { MetaSnapshot } from "../../../tools/content/meta.js";
import { atomicReplaceFile } from "../../../tools/lib/atomic-replace-file.js";
import { repoRoot } from "../../../tools/lib/paths.js";
import { readRuntimeCatalogs } from '../catalogs.js';
import { isLoopbackDevdocsRequest, type DevdocsJsonResponse, type DevdocsRequest } from "./collections.js";

export type { MetaDigestEntry, MetaDigestResponse, MetaPatch, MetaResponse } from "../../../game/src/content/metaOps.js";

export interface MetaHandlerOptions {
  contentRoot?: string;
  /** Server-owned identity; clients cannot supply history authors or timestamps. */
  actor?: string;
  now?: () => string;
}
export type MetaHandlerRequest = DevdocsRequest & { body?: unknown };
export type MetaHandler = (request: MetaHandlerRequest) => Promise<DevdocsJsonResponse | undefined>;

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
  if(spec.name==='assets'){const catalog=(await readRuntimeCatalogs()).find(row=>row.collection.name==='assets');return (catalog?.data as Record<string,unknown>[]|undefined)?.find(row=>row.id===entityId);}
  const text = await readFile(containedFile(root, spec.file), "utf8");
  const data = parseContentCollection(spec, JSON.parse(text));
  if (spec.shape === "object") return entityId === "$collection" ? data as Record<string, unknown> : undefined;
  const authored = (data as Record<string, unknown>[]).find(row => String(row[spec.idKey]) === entityId);
  if (authored) return authored;
  // Generated items retain their own review identity even though progression owns their values.
  // Resolve against the accepted catalog only; metadata must never trigger a content rebuild.
  try {
    const build = JSON.parse(await readFile(containedFile(root, 'compiled/catalog.json'), 'utf8')) as { tables: Record<string, unknown> };
    const resolved = build.tables[spec.name];
    const record = Array.isArray(resolved) ? (resolved as Record<string, unknown>[]).find(row => String(row[spec.idKey]) === entityId) : undefined;
    if(record)return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  // A new workspace may not have a build yet. Membership IDs are explicit authored identities,
  // so notes can attach to them without calculating or publishing a generated record.
  const members = spec.name === 'items' ? 'equipment' : spec.name === 'recipes' ? 'production' : undefined;
  const progression = CONTENT_COLLECTIONS.find(row => row.name === 'progression');
  if(members && progression){
    const tiers=parseContentCollection(progression,JSON.parse(await readFile(containedFile(root,progression.file),'utf8'))) as Record<string,unknown>[];
    for(const tier of tiers){const record=(tier[members] as Record<string,unknown>[]).find(row=>row.id===entityId);if(record)return record;}
  }
  return undefined;
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
    // Both the authored and resolved inspection pages share one metadata record.
    const spec = metaCollection(target.collection);
    if (!spec) return failure(404, "Unknown collection");
    let patch: MetaPatch | undefined;
    if (method === "PATCH") {
      const parsed = parseMetaPatch(request.body);
      if ("issues" in parsed) return json(400, { error: "Invalid metadata patch", diagnostics: parsed.issues });
      patch = parsed.patch;
    }
    try {
      const file = metadataFile(root, spec.name);
      const response = (current: MetaSnapshot): DevdocsJsonResponse => json(200, {
        collection: spec.name, entityId: target.entityId, revision: current.revision,
        data: Object.hasOwn(current.records, target.entityId) ? current.records[target.entityId]! : emptyMetaRecord(),
      } satisfies MetaResponse);
      if (method === "GET" && target.entityId === "$all") {
        // A per-collection digest so browsers can badge status and open requests without one
        // request per record. Notes and history stay on the per-entity route.
        const current = await snapshot(file, spec.name);
        return json(200, { collection: spec.name, revision: current.revision, records: metaDigest(current.records) } satisfies MetaDigestResponse);
      }
      if (method === "GET") {
        if (!await entity(root, spec, target.entityId)) return failure(404, "Unknown entity");
        return response(await snapshot(file, spec.name));
      }
      return await withFileLock(file, async () => {
        const authored = await entity(root, spec, target.entityId);
        if (!authored) return failure(404, "Unknown entity");
        const current = await snapshot(file, spec.name);
        if (current.revision !== patch!.revision) return json(409, { error: META_CONFLICT_MESSAGE, revision: current.revision });
        const at = now();
        const updated = applyMetaOperation(current.records, spec.name, target.entityId, authored, patch!.operation, actor, at);
        const records = canonicalMetaFile(updated, spec.name);
        const text = formatContentJson(records);
        await mkdir(path.dirname(file), {recursive:true});
        await atomicReplaceFile(file, text);
        return response({ records, revision: contentRevision(text) });
      });
    } catch (error) {
      if (error instanceof MetaActionError) return failure(error.status, error.message);
      return failure(500, "Unable to access metadata");
    }
  };
}

export function metaHandler(request: MetaHandlerRequest, options: MetaHandlerOptions = {}): Promise<DevdocsJsonResponse | undefined> {
  return createMetaHandler(options)(request);
}

export { metadataFile, snapshot as readMetadataSnapshot, applyMetaOperation };
