import { readFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";

import {
  CONTENT_COLLECTIONS,
  parseContentCollection,
  type ContentCollection,
} from "../../../game/src/content/compiler/collections.js";
import { contentRevision } from "../../../tools/content/format.js";
import { repoRoot } from "../../../tools/lib/paths.js";
import type { CollectionResponse, CollectionSummary } from "../../shared/contracts.js";

/** The one request shape the pure handler needs from Node's IncomingMessage. */
export interface DevdocsRequest {
  method?: string;
  url?: string;
  headers?: IncomingHttpHeaders | Headers | Readonly<Record<string, string | string[] | undefined>>;
  socket?: { remoteAddress?: string | undefined };
}

export interface DevdocsJsonResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: string;
}

export interface CollectionsHandlerOptions {
  /** Absolute or relative `game/content` root. Defaults to this repository's content root. */
  contentRoot?: string;
  /** Read-only production catalogs until their authored JSON migration is complete. */
  extraCollections?: () => Promise<readonly CollectionResponse[]>;
  /** Set only when the companion write handler is mounted. */
  editable?: boolean;
}

export type CollectionsHandler = (request: DevdocsRequest) => Promise<DevdocsJsonResponse | undefined>;

const COLLECTIONS_PATH = "/__devdocs/collections";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * The request URL is intentionally parsed before URL normalisation. URL normalisation resolves
 * literal `..` path segments, which would make a traversal attempt indistinguishable from a
 * normal route. Collection names are looked up in CONTENT_COLLECTIONS and never used as paths.
 */
function rawPath(url: string | undefined): { pathname: string; origin?: string } | { malformed: true } {
  if (!url) return { malformed: true };
  const queryStart = url.search(/[?#]/);
  const raw = queryStart < 0 ? url : url.slice(0, queryStart);
  if (!raw) return { malformed: true };

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      const authorityEnd = url.indexOf("/", url.indexOf("://") + 3);
      const target = authorityEnd < 0 ? "/" : url.slice(authorityEnd, raw.length);
      return { pathname: target || "/", origin: parsed.origin };
    } catch {
      return { malformed: true };
    }
  }

  if (!raw.startsWith("/")) return { malformed: true };
  return { pathname: raw };
}

function headerValue(headers: DevdocsRequest["headers"], name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const direct = headers[name] ?? headers[name.toLowerCase()];
  const value = direct ?? Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return Array.isArray(value) ? value[0] : value;
}

function hostName(host: string): string | undefined {
  const value = host.trim();
  if (!value || /[\s/@]/.test(value)) return undefined;
  try {
    // URL handles bracketed IPv6 and an optional port. A host header is not allowed to carry a
    // path, so reject any normalisation that changes the supplied authority.
    const parsed = new URL(`http://${value}`);
    if (parsed.pathname !== "/" || parsed.username || parsed.password) return undefined;
    return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return undefined;
  }
}

function originHostName(origin: URL): string {
  return origin.hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function loopbackAddress(address: string | undefined): boolean {
  if (!address) return true;
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (normalized.startsWith("::ffff:")) return normalized.slice("::ffff:".length) === "127.0.0.1";
  return normalized === "127.0.0.1";
}

/**
 * Keep the dev endpoint local even when a future write route is added. Tests that call the pure
 * handler directly have no socket/Host metadata, which is treated as an in-process request.
 */
export function isLoopbackDevdocsRequest(request: DevdocsRequest): boolean {
  if (!loopbackAddress(request.socket?.remoteAddress)) return false;

  const host = headerValue(request.headers, "host");
  if (host !== undefined) {
    const parsedHost = hostName(host);
    if (!parsedHost || !LOOPBACK_HOSTS.has(parsedHost)) return false;
  }

  const origin = headerValue(request.headers, "origin");
  if (origin !== undefined) {
    if (origin === "null") return false;
    try {
      const parsed = new URL(origin);
      if (!/^https?:$/.test(parsed.protocol) || parsed.pathname !== "/" || parsed.username || parsed.password || !LOOPBACK_HOSTS.has(originHostName(parsed))) return false;
    } catch {
      return false;
    }
  }

  const parsed = rawPath(request.url);
  if ("origin" in parsed && parsed.origin) {
    try {
      const url = new URL(parsed.origin);
      if (!/^https?:$/.test(url.protocol) || !LOOPBACK_HOSTS.has(originHostName(url))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function json(status: number, value: unknown, extraHeaders: Readonly<Record<string, string>> = {}): DevdocsJsonResponse {
  return {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
    body: JSON.stringify(value),
  };
}

function errorResponse(status: number, message: string, extraHeaders: Readonly<Record<string, string>> = {}): DevdocsJsonResponse {
  return json(status, { error: message }, extraHeaders);
}

function malformedPath(pathname: string): boolean {
  return pathname.includes("\\") || pathname.includes("\0") || pathname.split("/").some((segment) => segment === "." || segment === "..");
}

function decodeSegment(segment: string): string | undefined {
  try {
    const decoded = decodeURIComponent(segment);
    if (!decoded || decoded.includes("\\") || decoded.includes("\0") || decoded === "." || decoded === "..") return undefined;
    return decoded;
  } catch {
    return undefined;
  }
}

function routeName(pathname: string): { kind: "list" } | { kind: "collection"; name: string } | { kind: "malformed" } | undefined {
  if (malformedPath(pathname)) return { kind: "malformed" };
  if (pathname === COLLECTIONS_PATH) return { kind: "list" };
  if (!pathname.startsWith(`${COLLECTIONS_PATH}/`)) return undefined;

  const segments = pathname.slice(COLLECTIONS_PATH.length + 1).split("/");
  if (segments.some((segment) => segment.length === 0)) return { kind: "malformed" };
  const decoded = segments.map(decodeSegment);
  if (decoded.some((segment) => segment === undefined)) return { kind: "malformed" };
  const names = decoded as string[];
  if (names.length === 1) {
    // A slash decoded inside a single segment is supported only for the registry's balance
    // names. Reject every other encoded separator as a malformed route rather than letting it
    // resemble an arbitrary nested filesystem path.
    if (names[0]!.includes("/")) {
      if (names[0]!.startsWith("balance/") && names[0]!.indexOf("/") === names[0]!.lastIndexOf("/")) {
        return { kind: "collection", name: names[0]! };
      }
      return { kind: "malformed" };
    }
    return { kind: "collection", name: names[0]! };
  }
  if (names.length === 2 && names[0] === "balance") return { kind: "collection", name: `${names[0]}/${names[1]}` };
  return { kind: "malformed" };
}

function findCollection(name: string): ContentCollection | undefined {
  return CONTENT_COLLECTIONS.find((spec) => spec.name === name);
}

function safeCollectionFile(contentRoot: string, spec: ContentCollection): string {
  const root = path.resolve(contentRoot);
  const file = path.resolve(root, spec.file);
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Registered content path leaves content root");
  return file;
}

function collectionCount(spec: ContentCollection, data: unknown): number {
  if (spec.shape === "array") return Array.isArray(data) ? data.length : 0;
  return data !== null && typeof data === "object" && !Array.isArray(data) ? Object.keys(data).length : 0;
}

async function readCollection(contentRoot: string, spec: ContentCollection, editable = false): Promise<{ data: unknown; revision: string; summary: CollectionSummary }> {
  const text = await readFile(safeCollectionFile(contentRoot, spec), "utf8");
  const raw: unknown = JSON.parse(text);
  const data = parseContentCollection(spec, raw);
  const summary: CollectionSummary = {
    name: spec.name,
    count: collectionCount(spec, data),
    editable,
    idKey: spec.idKey,
    shape: spec.shape,
  };
  return { data, revision: contentRevision(text), summary };
}

async function readSummaries(contentRoot: string, editable = false): Promise<CollectionSummary[]> {
  const results = await Promise.all(CONTENT_COLLECTIONS.map(async (spec) => (await readCollection(contentRoot, spec, editable)).summary));
  return results;
}

/** Whether a URL belongs to this API. Used by the Vite middleware to call `next()` for app paths. */
export function isCollectionsPath(url: string | undefined): boolean {
  const parsed = rawPath(url);
  return "pathname" in parsed && (parsed.pathname === COLLECTIONS_PATH || parsed.pathname.startsWith(`${COLLECTIONS_PATH}/`));
}

/**
 * Creates the GET-only collections handler. It returns undefined for non-collections paths so it
 * can be mounted ahead of Vite's normal history fallback without changing unrelated requests.
 */
export function createCollectionsHandler(options: CollectionsHandlerOptions = {}): CollectionsHandler {
  const contentRoot = path.resolve(options.contentRoot ?? path.join(repoRoot, "game", "content"));

  return async (request) => {
    if (!isCollectionsPath(request.url)) return undefined;
    if (!isLoopbackDevdocsRequest(request)) return errorResponse(403, "Dev docs API accepts loopback requests only");

    const parsed = rawPath(request.url);
    if ("malformed" in parsed) return errorResponse(400, "Malformed collections URL");
    const route = routeName(parsed.pathname);
    if (!route) return undefined;
    if (route.kind === "malformed") return errorResponse(400, "Malformed collections URL");

    const method = (request.method ?? "GET").toUpperCase();
    if (method !== "GET") return errorResponse(405, "Method not allowed", { Allow: "GET" });

    try {
      if (route.kind === "list") {
        const summaries = await readSummaries(contentRoot, options.editable);
        const names = new Set(summaries.map(row => row.name));
        const extra = await options.extraCollections?.() ?? [];
        return json(200, [...summaries, ...extra.filter(row => !names.has(row.collection.name)).map(row => row.collection)]);
      }

      const spec = findCollection(route.name);
      if (!spec) {
        const extra = (await options.extraCollections?.() ?? []).find(row => row.collection.name === route.name);
        return extra ? json(200, extra) : errorResponse(404, "Unknown collection");
      }
      const result = await readCollection(contentRoot, spec, options.editable);
      const response: CollectionResponse = {
        collection: result.summary,
        revision: result.revision,
        data: result.data,
      };
      return json(200, response);
    } catch (error) {
      // Keep filesystem/schema details out of the response body; they are useful to the dev
      // server log but can contain local paths. A malformed JSON file is a server-side failure,
      // not a client-selected file read.
      return errorResponse(500, "Unable to read collection");
    }
  };
}

/** Convenience entry point for callers that do not need to retain a handler instance. */
export function collectionsHandler(request: DevdocsRequest, options: CollectionsHandlerOptions = {}): Promise<DevdocsJsonResponse | undefined> {
  return createCollectionsHandler(options)(request);
}

/** Adapts Node's IncomingMessage to the small request shape used by pure handlers. */
export function requestFromIncoming(request: IncomingMessage): DevdocsRequest {
  return request;
}
