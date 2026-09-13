import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parseValue } from "../../../game/src/content/schema/core.js";
import {
  MetaFileSchema,
  metaCollectionName,
  metaFileName,
  type MetaFile,
} from "../../../tools/content/meta.js";
import {
  formatRequests,
  listRequests,
  type CollectionRequestEntry,
  type RequestsReport,
} from "../../../tools/content/requests.js";
import { contentRevision } from "../../../tools/content/format.js";
import { repoRoot } from "../../../tools/lib/paths.js";
import {
  isLoopbackDevdocsRequest,
  type DevdocsJsonResponse,
  type DevdocsRequest,
} from "./collections.js";

export interface RequestsHandlerOptions {
  /** Absolute or relative `game/content` root. Defaults to this repository's content root. */
  contentRoot?: string;
}

export type RequestsHandler = (request: DevdocsRequest) => Promise<DevdocsJsonResponse | undefined>;

const REQUESTS_PATH = "/__devdocs/requests";
const MARKDOWN_PATH = `${REQUESTS_PATH}.md`;
const META_SUFFIX = ".meta.json";

function requestPath(url: string | undefined): { pathname: string; origin?: string } | { malformed: true } {
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

function markdown(status: number, value: string): DevdocsJsonResponse {
  return {
    status,
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" },
    body: value,
  };
}

function routeName(pathname: string): "json" | "markdown" | "malformed" | undefined {
  if (pathname === REQUESTS_PATH) return "json";
  if (pathname === MARKDOWN_PATH) return "markdown";
  if (pathname.startsWith(`${REQUESTS_PATH}/`) || pathname.startsWith(`${MARKDOWN_PATH}/`)) return "malformed";
  return undefined;
}

/** Whether a URL belongs to either read-only requests route. */
export function isRequestsPath(url: string | undefined): boolean {
  const parsed = requestPath(url);
  if (!("pathname" in parsed)) return false;
  return routeName(parsed.pathname) !== undefined;
}

function metadataDirectory(contentRoot: string): string {
  return path.join(path.resolve(contentRoot), "meta");
}

function collectionFromMetadataFile(fileName: string): string | undefined {
  // Keep metadata reads bounded to the names accepted by metaFileName. The filename came from
  // readdir rather than the request, and this check also prevents a nested path or hidden file
  // from becoming a read target.
  return metaCollectionName(fileName);
}

async function metadataFiles(contentRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(metadataDirectory(contentRoot), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => collectionFromMetadataFile(entry.name))
      .filter((collection): collection is string => collection !== undefined)
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readMetadata(contentRoot: string, collection: string): Promise<{ records: MetaFile; revision: string }> {
  // `collection` is derived from a strictly validated directory entry. Keep the final containment
  // check beside the read so a future caller cannot accidentally turn this helper into a path API.
  const root = path.resolve(contentRoot);
  const file = path.resolve(root, metaFileName(collection));
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Metadata path leaves content root");

  const text = await readFile(file, "utf8");
  const records = parseValue(MetaFileSchema, JSON.parse(text), `${collection}.meta`);
  return { records, revision: contentRevision(text) };
}

async function readReport(contentRoot: string): Promise<RequestsReport> {
  const collections = await metadataFiles(contentRoot);
  const loaded = await Promise.all(collections.map(async (collection) => ({
    collection,
    snapshot: await readMetadata(contentRoot, collection),
  })));
  const report: RequestsReport = { revisions: {}, requests: [] };
  for (const { collection, snapshot } of loaded) {
    report.revisions[collection] = snapshot.revision;
    const entries = listRequests(snapshot.records).map((entry): CollectionRequestEntry => ({ collection, ...entry }));
    report.requests.push(...entries);
  }
  return report;
}

/** Creates the GET-only requests listing handler, with metadata rooted under `contentRoot`. */
export function createRequestsHandler(options: RequestsHandlerOptions = {}): RequestsHandler {
  const contentRoot = path.resolve(options.contentRoot ?? path.join(repoRoot, "game", "content"));

  return async (request) => {
    if (!isRequestsPath(request.url)) return undefined;
    if (!isLoopbackDevdocsRequest(request)) return errorResponse(403, "Dev docs API accepts loopback requests only");

    const parsed = requestPath(request.url);
    if ("malformed" in parsed) return errorResponse(400, "Malformed requests URL");
    const route = routeName(parsed.pathname);
    if (!route) return undefined;
    if (route === "malformed") return errorResponse(400, "Malformed requests URL");

    const method = (request.method ?? "GET").toUpperCase();
    if (method !== "GET") return errorResponse(405, "Method not allowed", { Allow: "GET" });

    try {
      const report = await readReport(contentRoot);
      return route === "json"
        ? {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
          body: formatRequests(report, "json"),
        }
        : markdown(200, formatRequests(report, "markdown"));
    } catch {
      return errorResponse(500, "Unable to read requests");
    }
  };
}

/** Convenience entry point for callers that do not need to retain a handler instance. */
export function requestsHandler(request: DevdocsRequest, options: RequestsHandlerOptions = {}): Promise<DevdocsJsonResponse | undefined> {
  return createRequestsHandler(options)(request);
}
