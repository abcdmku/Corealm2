import type { AdminRoute, AdminRouteContext } from "./adminApi.js";
import type { ServerAdminStorage, StoredMeta } from "./adminStorage.js";
import type { CatalogStorage } from "./catalogStorage.js";
import { formatContentJson } from "../content/compiler/canonical.js";
import { contentRevision } from "../content/compiler/revision.js";
import { parseValue } from "../content/schema/core.js";
import {
  applyMetaOperation, canonicalMetaFile, emptyMetaRecord, META_CONFLICT_MESSAGE, metaCollection, metaDigest, MetaActionError, MetaFileSchema,
  parseMetaPatch, requestsReport, type MetaDigestResponse, type MetaFile, type MetaResponse,
} from "../content/metaOps.js";

/**
 * Authoring metadata on a live server: the notes, review requests, statuses and art verdicts the
 * repository keeps beside its content files, kept here in the server's own database.
 *
 *   GET   /admin/meta/<collection>/<entityId>   content:read     MetaResponse
 *   GET   /admin/meta/<collection>/$all         content:read     MetaDigestResponse
 *   PATCH /admin/meta/<collection>/<entityId>   content:publish  MetaPatch -> MetaResponse, 409 on a stale revision
 *   GET   /admin/meta/requests                  content:read     RequestsReport: open and claimed requests
 *
 * A balance collection is two segments: `/admin/meta/balance/sets/<entityId>`. Operations are the
 * repository's own (`content/metaOps.ts`), so a record means the same thing in either store. History
 * names the admin account, or the API token when no account stands behind it.
 */

/** The content record a metadata record belongs to; `{}` when it exists but is not at hand; null when it does not exist. */
export type MetaEntityLookup = (collection: string, entityId: string) => Promise<Record<string, unknown> | null>;

export interface MetaRouteOptions {
  storage: Pick<ServerAdminStorage, "authoringMeta" | "authoringMetaAll" | "replaceAuthoringMeta">;
  /** Refuses unknown records. Without one, every id takes metadata. */
  entity?: MetaEntityLookup;
}

const MAX_META_BODY_BYTES = 64 * 1024;
const EMPTY_REVISION = contentRevision(formatContentJson({}));

interface Snapshot { records: MetaFile; revision: string; stored: boolean }
function snapshot(stored: StoredMeta | null, collection: string): Snapshot {
  return stored
    ? { records: parseValue(MetaFileSchema, JSON.parse(stored.records), `${collection}.meta`), revision: stored.revision, stored: true }
    : { records: {}, revision: EMPTY_REVISION, stored: false };
}

function target(path: readonly string[]): { collection: string; entityId: string } | null {
  if (path.some(segment => !segment || /[\\/\0]/.test(segment) || segment === "." || segment === "..")) return null;
  const collection = path.length === 3 && path[0] === "balance" ? `balance/${path[1]}` : path.length === 2 ? path[0]! : null;
  if (!collection || !/^(?:balance\/)?[a-z][a-z0-9-]*$/i.test(collection)) return null;
  return { collection, entityId: path.at(-1)! };
}

export function createMetaRoute(options: MetaRouteOptions): AdminRoute {
  const { storage } = options;
  const entity: MetaEntityLookup = options.entity ?? (async () => ({}));

  async function requests(context: AdminRouteContext): Promise<void> {
    await context.scoped("content:read");
    const stored = await storage.authoringMetaAll();
    context.json(200, requestsReport(stored.map(row => ({ collection: row.collection, ...snapshot(row, row.collection) }))));
  }

  return async (context: AdminRouteContext) => {
    if (context.rest[0] !== "meta") return false;
    const method = context.method.toUpperCase();
    const path = context.rest.slice(1);
    if (path.length === 1 && path[0] === "requests") {
      if (method !== "GET") context.fail(405, "method_not_allowed", "The request queue is read with GET");
      await requests(context);
      return true;
    }
    if (method !== "GET" && method !== "PATCH") context.fail(405, "method_not_allowed", "Metadata is read with GET and changed with PATCH");
    const { actor } = await context.scoped(method === "GET" ? "content:read" : "content:publish");
    const place = target(path);
    if (!place) context.fail(404, "not_found", "No such admin endpoint");
    const spec = metaCollection(place.collection);
    if (!spec) context.fail(404, "not_found", "Unknown collection");
    const { entityId } = place;

    if (method === "GET") {
      const current = snapshot(await storage.authoringMeta(spec.name), spec.name);
      if (entityId === "$all") {
        context.json(200, { collection: spec.name, revision: current.revision, records: metaDigest(current.records) } satisfies MetaDigestResponse);
        return true;
      }
      if (!await entity(spec.name, entityId)) context.fail(404, "not_found", "Unknown entity");
      context.json(200, { collection: spec.name, entityId, revision: current.revision,
        data: Object.hasOwn(current.records, entityId) ? current.records[entityId]! : emptyMetaRecord() } satisfies MetaResponse);
      return true;
    }

    const parsed = parseMetaPatch(await context.body(MAX_META_BODY_BYTES));
    if ("issues" in parsed) {
      context.json(400, { error: { code: "invalid_request", message: "Invalid metadata patch", diagnostics: parsed.issues } });
      return true;
    }
    const { patch } = parsed;
    const stale = (revision: string): true => {
      context.json(409, { error: { code: "stale_meta", message: META_CONFLICT_MESSAGE, revision } });
      return true;
    };
    const authored = entityId === "$all" ? null : await entity(spec.name, entityId);
    if (!authored) context.fail(404, "not_found", "Unknown entity");
    const current = snapshot(await storage.authoringMeta(spec.name), spec.name);
    if (current.revision !== patch.revision) return stale(current.revision);

    const by = actor.accountId ?? actor.credential;
    let updated: MetaFile;
    try { updated = applyMetaOperation(current.records, spec.name, entityId, authored, patch.operation, by, new Date(actor.at).toISOString()); }
    catch (error) {
      if (error instanceof MetaActionError) context.fail(error.status, error.status === 404 ? "not_found" : "invalid_request", error.message);
      throw error;
    }
    const records = canonicalMetaFile(updated, spec.name);
    const text = formatContentJson(records);
    const revision = contentRevision(text);
    const stored = await storage.replaceAuthoringMeta(spec.name, current.stored ? current.revision : null, { records: text, revision }, actor,
      { action: `meta.${patch.operation.kind}`, target: `${spec.name}/${entityId}`, after: patch.operation });
    if (!stored) return stale((await storage.authoringMeta(spec.name))?.revision ?? EMPTY_REVISION);
    context.json(200, { collection: spec.name, entityId, revision, data: records[entityId]! } satisfies MetaResponse);
    return true;
  };
}

/** Collections whose records are generated from others: an id missing from the sources may still be a real record. */
const GENERATED = new Set(["items", "recipes"]);

/**
 * Looks records up in the active catalog's source collections, parsed once per revision. A collection
 * the sources do not carry (`assets`) and a generated item or recipe id are never refused: a note on a
 * record the server cannot see is harmless, a refused note is lost work.
 */
export function catalogEntities(catalog: Pick<CatalogStorage, "activeRevision" | "sources">): MetaEntityLookup {
  let held: { revision: string; sources: Record<string, unknown> } | null = null;
  return async (collection, entityId) => {
    const revision = await catalog.activeRevision();
    if (revision === null) return {};
    if (held?.revision !== revision) {
      const found = await catalog.sources(revision);
      held = { revision, sources: found ? JSON.parse(found.sources) as Record<string, unknown> : {} };
    }
    const spec = metaCollection(collection);
    const table = held.sources[collection];
    if (!spec || table === undefined) return {};
    if (spec.shape === "object") return entityId === "$collection" && table && typeof table === "object" ? table as Record<string, unknown> : null;
    const row = Array.isArray(table) ? (table as Record<string, unknown>[]).find(entry => String(entry[spec.idKey]) === entityId) : undefined;
    return row ?? (GENERATED.has(collection) ? {} : null);
  };
}
