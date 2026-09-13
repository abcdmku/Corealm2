import { readFile } from "node:fs/promises";
import path from "node:path";
import { obj, str, unknown, type ParseContext } from "../../../game/src/content/schema/core.js";
import { CONTENT_COLLECTIONS } from "../../../tools/content/collections.js";
import { contentRevision, formatContentJson } from "../../../tools/content/format.js";
import { withFileLock } from "../../../tools/content/locks.js";
import type { ReferencePools } from "../../../tools/content/references.js";
import { atomicReplaceFile } from "../../../tools/lib/atomic-replace-file.js";
import { repoRoot } from "../../../tools/lib/paths.js";
import type { ApiDiagnostic, CollectionResponse } from "../../shared/contracts.js";
import { collectionFile, loadCollectionSnapshots, validateCollectionOverlay } from "../lib/validateCollections.js";
import { isLoopbackDevdocsRequest, type DevdocsJsonResponse, type DevdocsRequest } from "./collections.js";

export interface CollectionWriteHandlerOptions {
  contentRoot?: string;
  /** Supplies world/asset IDs absent from JSON. Mutable JSON pools always override these. */
  referencePools?: () => Promise<ReferencePools>;
}
export type CollectionWriteRequest = DevdocsRequest & { body?: unknown };
export type CollectionWriteHandler = (request: CollectionWriteRequest) => Promise<DevdocsJsonResponse | undefined>;
export type CollectionWriteResponse = CollectionResponse & { diagnostics?: ApiDiagnostic[] };
const PREFIX = "/__devdocs/collections";
const revisionSchema = str({ pattern: /^[a-f0-9]{64}$/ });
const putSchema = obj({ revision: revisionSchema, record: unknown() });
const deleteSchema = obj({ revision: revisionSchema });

function json(status: number, data: unknown, headers: Readonly<Record<string, string>> = {}): DevdocsJsonResponse {
  return { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }, body: JSON.stringify(data) };
}
function failure(status: number, error: string): DevdocsJsonResponse { return json(status, { error }); }
function rawPath(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let raw = url.split(/[?#]/, 1)[0]!;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    const start = raw.indexOf("/", raw.indexOf("://") + 3);
    raw = start < 0 ? "/" : raw.slice(start);
  }
  return raw.startsWith("/") ? raw : undefined;
}
/** Middleware should dispatch collection PUT/DELETE here before its GET-only handler. */
export function isCollectionWritePath(url: string | undefined): boolean {
  const pathname = rawPath(url);
  return pathname === PREFIX || pathname?.startsWith(`${PREFIX}/`) === true;
}
function target(url: string | undefined): { collection: string; recordId: string } | undefined {
  const pathname = rawPath(url);
  if (!pathname?.startsWith(`${PREFIX}/`)) return undefined;
  let segments: string[];
  try { segments = pathname.slice(PREFIX.length + 1).split("/").map(segment => decodeURIComponent(segment)); }
  catch { return undefined; }
  if (segments.some(segment => !segment || /[\\\0]/.test(segment) || segment === "." || segment === "..")) return undefined;
  const collection = segments.length === 3 && segments[0] === "balance" ? `balance/${segments[1]}` : segments.length === 2 ? segments[0] : undefined;
  const recordId = segments.at(-1)!;
  if (!collection || !/^(?:balance\/)?[a-z][a-z0-9-]*$/i.test(collection) || recordId.includes("/")) return undefined;
  return { collection, recordId };
}

/** Replaces an existing authored row. Deletion remains forbidden while IDs are saved identities. */
export function createCollectionWriteHandler(options: CollectionWriteHandlerOptions = {}): CollectionWriteHandler {
  const root = path.resolve(options.contentRoot ?? path.join(repoRoot, "game", "content"));
  return async request => {
    if (!isCollectionWritePath(request.url)) return undefined;
    if (!isLoopbackDevdocsRequest(request)) return failure(403, "Dev docs API accepts loopback requests only");
    const method = (request.method ?? "GET").toUpperCase();
    if (method !== "PUT" && method !== "DELETE") return json(405, { error: "Method not allowed" }, { Allow: "PUT" });
    const route = target(request.url);
    if (!route) return failure(400, "Malformed collection record URL");
    const spec = CONTENT_COLLECTIONS.find(collection => collection.name === route.collection);
    if (!spec) return failure(404, "Unknown collection");
    const context: ParseContext = { issues: [] };
    const body: { revision: string; record?: unknown } = method === "PUT" ? putSchema.parse(request.body, "body", context) : deleteSchema.parse(request.body, "body", context);
    if (context.issues.length) return json(422, { error: "Invalid collection write", diagnostics: context.issues });
    try {
      const file = collectionFile(root, spec);
      // The root lock serializes cross-collection validation, including separate handler instances.
      // The file lock also coordinates with CLI writers using the shared content lock convention.
      return await withFileLock(path.join(root, ".collection-write"), () => withFileLock(file, async () => {
        const currentText = await readFile(file, "utf8");
        const revision = contentRevision(currentText);
        if (revision !== body.revision) return json(409, { error: "Collection changed since it was read. Reload before saving.", revision });
        const current: unknown = JSON.parse(currentText);
        const rows = spec.shape === "array" ? current as Record<string, unknown>[] : undefined;
        const index = rows?.findIndex(row => String(row[spec.idKey]) === route.recordId);
        if (spec.shape === "array" ? index === -1 : route.recordId !== "$collection") return failure(404, "Unknown record");
        if (method === "DELETE") return json(422, { error: "Deleting existing save identities is not supported", diagnostics: [{
          path: `${spec.name}.${route.recordId}`, message: "Cannot remove an existing save identity", severity: "error",
        }] });
        const record = body.record;
        const proposed = rows ? rows.map((row, rowIndex) => rowIndex === index ? record : row) : record;
        const snapshots = await loadCollectionSnapshots(root);
        // Reuse the exact bytes whose revision was checked while holding the target file lock.
        snapshots.set(spec.name, { data: current, text: currentText });
        const external = await options.referencePools?.() ?? {};
        const result = validateCollectionOverlay(snapshots, spec, proposed, route.recordId, external);
        if (result.diagnostics.some(issue => issue.severity === "error")) return json(422, {
          error: "Collection failed validation", diagnostics: result.diagnostics,
        });
        const nextText = formatContentJson(result.data);
        await atomicReplaceFile(file, nextText);
        return json(200, {
          collection: { name: spec.name, count: Array.isArray(result.data) ? result.data.length : Object.keys(result.data as object).length,
            editable: true, idKey: spec.idKey, shape: spec.shape },
          revision: contentRevision(nextText), data: result.data,
          ...(result.diagnostics.length ? { diagnostics: result.diagnostics } : {}),
        } satisfies CollectionWriteResponse);
      }));
    } catch {
      return failure(500, "Unable to update collection");
    }
  };
}
