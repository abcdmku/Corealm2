import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import type { AdminRoute } from "./adminApi.js";
import type { AdminActor, AuditWrite } from "./adminStorage.js";
import { CONTENT_ASSET_PATH, MAX_GENERATED_ASSET_BYTES, type ContentAssetEntry, type ContentAssetIndex, type ContentAssetPath } from "./contentAssetsContract.js";

/**
 * A server's own file store (`contentAssetsContract.ts`): the files under `<dir>/files/<path>`, and
 * `<dir>/index.json` listing each one's hash, size, type and time. Every write replaces a file or
 * the index by rename, so a crash leaves the old or the new one, never half of either. Writes run
 * one at a time. The index is written after the files it names, so it never lists a file that is
 * not there; a file a crash left unlisted is simply not served.
 */
export const MAX_CONTENT_ASSET_BYTES = 16 * 1024 * 1024;
/** The largest file a path may hold: a baked world's records and navmesh (`generated/...`) run larger than any authored file. */
export const maxContentAssetBytes = (path: ContentAssetPath): number => path.startsWith("generated/") ? MAX_GENERATED_ASSET_BYTES : MAX_CONTENT_ASSET_BYTES;
const mibOf = (bytes: number): string => `${bytes / 1_048_576} MiB`;
/** One `POST /admin/files` body, base64 and JSON included. Several skin maps or one large model fit. */
export const MAX_CONTENT_ASSET_BODY_BYTES = 64 * 1024 * 1024;
const MAX_REMOVE_PATHS = 1000;
/** A `?v=<sha>` URL never changes its bytes. */
const IMMUTABLE = "public, max-age=31536000, immutable";
const PUBLIC_PREFIX = "/content-assets/";

const TYPES: Readonly<Record<string, string>> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", glb: "model/gltf-binary",
  ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", json: "application/json",
};
const typeOf = (path: string): string => TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";
/** Linear on megabytes of text: characters here, length and padding below. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const isBase64 = (text: string): boolean => text.length % 4 === 0 && BASE64.test(text);

export class ContentAssetFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "ContentAssetFailure"; }
}

/** The one path check: the contract's pattern, which already refuses `.` and `..` segments and backslashes. */
export function contentAssetPath(value: unknown): ContentAssetPath {
  if (typeof value !== "string" || value.length > 512 || !CONTENT_ASSET_PATH.test(value))
    throw new ContentAssetFailure(400, "invalid_path", `${JSON.stringify(value)} is not a file path this server stores: assets/{skins,icons,models,textures,thumbnails,vfx}/... or audio/..., ending in an image, model, audio or JSON extension`);
  return value;
}

/** Changes whenever a file is added, replaced or removed, and only then. Times are not part of it. */
export function contentAssetRevision(files: Readonly<Record<string, ContentAssetEntry>>): string {
  const rows = Object.keys(files).sort().map(path => [path, files[path]!.sha256]);
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 32);
}

export interface ContentAssetStoreOptions {
  /** The data directory this store owns, such as `<data>/content-assets`. */
  dir: string;
  now?(): number;
  /** Where players reach `/content-assets/`, with a trailing slash. Absent: the server derives it from its public endpoint. */
  publicUrl?: string;
  /** The server's audit helper, `ServerAdminStorage.record`. */
  audit?(by: AdminActor, entry: AuditWrite): Promise<void>;
  log?(event: Record<string, unknown>): void;
}

export interface ContentAssetStore {
  readonly publicUrl: string | null;
  index(): Promise<ContentAssetIndex>;
  /** Base64 contents by path. Checks every file before writing any. */
  put(files: Readonly<Record<string, string>>, actor: AdminActor): Promise<ContentAssetIndex>;
  /** `put` for a caller that already holds the bytes, such as a world bake writing `generated/...`. Same checks, same audit. */
  putBytes(files: Readonly<Record<string, Uint8Array>>, actor: AdminActor): Promise<ContentAssetIndex>;
  remove(paths: readonly string[], actor: AdminActor): Promise<ContentAssetIndex>;
  read(path: string): Promise<{ bytes: Buffer; entry: ContentAssetEntry } | null>;
  /** `GET|POST|DELETE /admin/files`. */
  route: AdminRoute;
  /** `GET|HEAD /content-assets/index.json` and `/content-assets/<path>`. True when it answered. */
  http(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
}

async function atomicWrite(file: string, bytes: Buffer | string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, bytes); await rename(temporary, file); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}

export function createContentAssetStore(options: ContentAssetStoreOptions): ContentAssetStore {
  const now = options.now ?? Date.now, log = options.log ?? (() => {});
  const indexFile = join(options.dir, "index.json"), fileOf = (path: string): string => join(options.dir, "files", ...path.split("/"));
  let loaded: Promise<ContentAssetIndex> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  /** Writes one at a time; a failed one leaves the queue running. */
  const serial = <T>(run: () => Promise<T>): Promise<T> => { const next = queue.then(run, run); queue = next.catch(() => {}); return next; };

  function index(): Promise<ContentAssetIndex> {
    return loaded ??= readFile(indexFile, "utf8").then(text => {
      const files = (JSON.parse(text) as ContentAssetIndex).files ?? {};
      // Only entries whose path this store could have written: a hand-edited index cannot serve outside `files/`.
      const kept = Object.fromEntries(Object.entries(files).filter(([path]) => CONTENT_ASSET_PATH.test(path)));
      return { revision: contentAssetRevision(kept), files: kept };
    }, (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return { revision: contentAssetRevision({}), files: {} };
      throw error;
    });
  }
  async function commit(files: Record<string, ContentAssetEntry>): Promise<ContentAssetIndex> {
    const next: ContentAssetIndex = { revision: contentAssetRevision(files), files };
    await atomicWrite(indexFile, JSON.stringify(next, null, 1));
    loaded = Promise.resolve(next);
    return next;
  }

  async function put(files: Readonly<Record<string, string>>, actor: AdminActor): Promise<ContentAssetIndex> {
    const decoded: [string, Buffer][] = [];
    const paths = Object.keys(files);
    if (!paths.length) throw new ContentAssetFailure(400, "invalid_request", "files names at least one file");
    for (const path of paths) {
      contentAssetPath(path);
      const text = files[path], cap = maxContentAssetBytes(path);
      if (typeof text !== "string") throw new ContentAssetFailure(400, "invalid_request", `files[${JSON.stringify(path)}] must be base64`);
      if (text.length * 3 / 4 > cap + 2) throw new ContentAssetFailure(413, "payload_too_large", `${path} is larger than ${mibOf(cap)}`);
      if (!isBase64(text)) throw new ContentAssetFailure(400, "invalid_request", `files[${JSON.stringify(path)}] must be base64`);
      decoded.push([path, Buffer.from(text, "base64")]);
    }
    return write(decoded, actor);
  }
  async function putBytes(files: Readonly<Record<string, Uint8Array>>, actor: AdminActor): Promise<ContentAssetIndex> {
    const paths = Object.keys(files);
    if (!paths.length) throw new ContentAssetFailure(400, "invalid_request", "files names at least one file");
    return write(paths.map(path => { contentAssetPath(path); const bytes = files[path]!; return [path, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)]; }), actor);
  }
  async function write(decoded: readonly [string, Buffer][], actor: AdminActor): Promise<ContentAssetIndex> {
    for (const [path, bytes] of decoded) {
      if (!bytes.length) throw new ContentAssetFailure(400, "invalid_request", `${path} is empty`);
      if (bytes.length > maxContentAssetBytes(path)) throw new ContentAssetFailure(413, "payload_too_large", `${path} is larger than ${mibOf(maxContentAssetBytes(path))}`);
    }
    return serial(async () => {
      const before = await index(), at = new Date(now()).toISOString();
      const files: Record<string, ContentAssetEntry> = { ...before.files };
      const changed: Record<string, string> = {};
      for (const [path, bytes] of decoded) {
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        if (files[path]?.sha256 === sha256) continue;
        await atomicWrite(fileOf(path), bytes);
        files[path] = { sha256, bytes: bytes.length, type: typeOf(path), at };
        changed[path] = sha256;
      }
      if (!Object.keys(changed).length) return before;
      const next = await commit(files);
      await options.audit?.(actor, { action: "content.files.put", target: null,
        before: { revision: before.revision, files: Object.fromEntries(Object.keys(changed).map(path => [path, before.files[path]?.sha256 ?? null])) },
        after: { revision: next.revision, files: changed } });
      log({ event: "content.files.put", accountId: actor.accountId, paths: Object.keys(changed), revision: next.revision });
      return next;
    });
  }

  async function remove(paths: readonly string[], actor: AdminActor): Promise<ContentAssetIndex> {
    if (!paths.length || paths.length > MAX_REMOVE_PATHS) throw new ContentAssetFailure(400, "invalid_request", `paths names 1 to ${MAX_REMOVE_PATHS} files`);
    for (const path of paths) contentAssetPath(path);
    return serial(async () => {
      const before = await index();
      const missing = paths.filter(path => !before.files[path]);
      if (missing.length) throw new ContentAssetFailure(404, "not_found", `This server stores no ${missing.join(", ")}`);
      const files = { ...before.files };
      for (const path of paths) delete files[path];
      // The index goes first: a file it no longer names is never served, even if the delete below fails.
      const next = await commit(files);
      for (const path of paths) await rm(fileOf(path), { force: true });
      await options.audit?.(actor, { action: "content.files.remove", target: null,
        before: { revision: before.revision, files: Object.fromEntries(paths.map(path => [path, before.files[path]!.sha256])) }, after: { revision: next.revision } });
      log({ event: "content.files.remove", accountId: actor.accountId, paths, revision: next.revision });
      return next;
    });
  }

  async function read(path: string): Promise<{ bytes: Buffer; entry: ContentAssetEntry } | null> {
    if (!CONTENT_ASSET_PATH.test(path)) return null;
    const entry = (await index()).files[path];
    if (!entry) return null;
    try { return { bytes: await readFile(fileOf(path)), entry }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  const route: AdminRoute = async context => {
    if (context.rest[0] !== "files") return false;
    const fail = (error: unknown): never => {
      if (error instanceof ContentAssetFailure) context.fail(error.status, error.code, error.message);
      throw error;
    };
    if (context.rest.length !== 1) context.fail(404, "not_found", "No such admin endpoint");
    if (context.method === "GET") {
      await context.scoped("content:read");
      context.json(200, await index());
    } else if (context.method === "POST") {
      const { actor } = await context.scoped("content:publish");
      const body = await context.body(MAX_CONTENT_ASSET_BODY_BYTES);
      const files = body.files;
      if (Object.keys(body).some(key => key !== "files") || !files || typeof files !== "object" || Array.isArray(files))
        context.fail(400, "invalid_request", "The body is {files: {<path>: <base64>}}");
      context.json(200, await put(files as Record<string, string>, actor).catch(fail));
    } else if (context.method === "DELETE") {
      const { actor } = await context.scoped("content:publish");
      const body = await context.body();
      if (Object.keys(body).some(key => key !== "paths") || !Array.isArray(body.paths)) context.fail(400, "invalid_request", "The body is {paths: string[]}");
      context.json(200, await remove(body.paths as string[], actor).catch(fail));
    } else context.fail(405, "method_not_allowed", "GET, POST or DELETE");
    return true;
  };

  async function http(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? "/", "http://server.invalid");
    if (!url.pathname.startsWith(PUBLIC_PREFIX)) return false;
    const headers = { "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" };
    const answer = (status: number, extra: Record<string, string | number> = {}, bytes?: Buffer | string): true => {
      response.writeHead(status, { ...headers, ...extra });
      response.end(request.method === "HEAD" ? undefined : bytes);
      return true;
    };
    if (request.method === "OPTIONS") return answer(204, { "Access-Control-Allow-Methods": "GET, HEAD", "Access-Control-Max-Age": "600" });
    if (request.method !== "GET" && request.method !== "HEAD") return answer(405, { Allow: "GET, HEAD" });
    let path: string;
    try { path = decodeURIComponent(url.pathname.slice(PUBLIC_PREFIX.length)); } catch { return answer(404); }
    if (path === "index.json") {
      const current = await index(), etag = `"${current.revision}"`;
      if (request.headers["if-none-match"] === etag) return answer(304, { ETag: etag, "Cache-Control": "no-cache" });
      const text = JSON.stringify(current);
      return answer(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), ETag: etag, "Cache-Control": "no-cache" }, text);
    }
    const file = await read(path);
    if (!file) return answer(404, { "Cache-Control": "no-cache" });
    const etag = `"${file.entry.sha256}"`, cache = url.searchParams.get("v") === file.entry.sha256 ? IMMUTABLE : "no-cache";
    if (request.headers["if-none-match"] === etag) return answer(304, { ETag: etag, "Cache-Control": cache });
    return answer(200, { "Content-Type": file.entry.type, "Content-Length": file.bytes.length, ETag: etag, "Cache-Control": cache }, file.bytes);
  }

  return { publicUrl: options.publicUrl ?? null, index, put, putBytes, remove, read, route, http };
}

/** `/content-assets/` beside a world's socket: http for ws, https for wss, like `/catalog/`. */
export function contentAssetUrlFor(endpoint: string): string {
  const url = new URL(endpoint);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return new URL("content-assets/", url).href;
}
