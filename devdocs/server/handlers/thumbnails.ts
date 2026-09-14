import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { atomicReplaceFile } from "../../../tools/lib/atomic-replace-file.js";
import { repoRoot } from "../../../tools/lib/paths.js";
import { isLoopbackDevdocsRequest, type DevdocsJsonResponse, type DevdocsRequest } from "./collections.js";

/**
 * Rendered GLB thumbnails. The browser renders a manifest asset once, PUTs the PNG here, and every
 * later session reads the cached file instead of loading the model again. Files live under
 * `devdocs/generated/thumbnails/`, which `.gitignore` already excludes with the rest of `generated/`.
 */
export const THUMBNAILS_PATH = "/__devdocs/thumbnails";
/** JSON body ceiling for a PUT: a 192 px PNG is a few tens of KB; 2 MB leaves ample base64 headroom. */
export const THUMBNAIL_MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ROUTE = /^\/__devdocs\/thumbnails\/([A-Za-z0-9_-]+)\.png(?:\?[^#]*)?(?:#.*)?$/;
const DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

export interface ThumbnailsHandlerOptions {
  /** Absolute directory holding `<assetId>.png`. Defaults to `devdocs/generated/thumbnails` in this repository. */
  thumbnailRoot?: string;
  maxBytes?: number;
}

export type ThumbnailsHandlerRequest = DevdocsRequest & { body?: unknown };
export type ThumbnailsHandlerResponse = Omit<DevdocsJsonResponse, "body"> & { body: string | Uint8Array };
export type ThumbnailsHandler = (request: ThumbnailsHandlerRequest) => Promise<ThumbnailsHandlerResponse | undefined>;

export interface ThumbnailWriteResponse { ok: true; url: string }

export const defaultThumbnailRoot = path.join(repoRoot, "devdocs", "generated", "thumbnails");

export function isThumbnailsPath(url?: string): boolean {
  return Boolean(url?.startsWith(`${THUMBNAILS_PATH}/`));
}

export function thumbnailUrl(assetId: string): string {
  return `${THUMBNAILS_PATH}/${assetId}.png`;
}

function json(status: number, payload: unknown, extra: Record<string, string> = {}): ThumbnailsHandlerResponse {
  return { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }, body: JSON.stringify(payload) };
}

/** Decodes and validates a PNG data URL. Returns undefined for anything that is not a PNG payload. */
export function decodePngDataUrl(value: unknown, maxBytes: number): Buffer | undefined {
  if (typeof value !== "string" || value.length > maxBytes) return undefined;
  const match = DATA_URL.exec(value);
  if (!match) return undefined;
  const bytes = Buffer.from(match[1]!, "base64");
  if (bytes.length <= PNG_SIGNATURE.length || bytes.length > maxBytes) return undefined;
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return undefined;
  return bytes;
}

export function createThumbnailsHandler(options: ThumbnailsHandlerOptions = {}): ThumbnailsHandler {
  const root = path.resolve(options.thumbnailRoot ?? defaultThumbnailRoot);
  const maxBytes = options.maxBytes ?? THUMBNAIL_MAX_REQUEST_BYTES;
  return async (request) => {
    if (!isThumbnailsPath(request.url)) return undefined;
    if (!isLoopbackDevdocsRequest(request)) return json(403, { error: "Dev docs API accepts loopback requests only" });
    const match = ROUTE.exec(request.url ?? "");
    if (!match) return json(400, { error: "Invalid thumbnail id" });
    const assetId = match[1]!;
    const file = path.join(root, `${assetId}.png`);
    const method = request.method ?? "GET";

    if (method === "GET" || method === "HEAD") {
      try {
        const bytes = await readFile(file);
        return { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "no-cache", "Content-Length": String(bytes.length) }, body: method === "HEAD" ? "" : bytes };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return json(404, { error: "No thumbnail rendered yet", assetId });
        return json(500, { error: "Thumbnail unavailable" });
      }
    }

    if (method === "PUT") {
      const body = request.body;
      const dataUrl = body && typeof body === "object" && !Array.isArray(body) ? (body as { dataUrl?: unknown }).dataUrl : undefined;
      const bytes = decodePngDataUrl(dataUrl, maxBytes);
      if (!bytes) return json(400, { error: "Expected { dataUrl } holding a PNG data URL" });
      try {
        await mkdir(root, { recursive: true });
        await atomicReplaceFile(file, bytes);
      } catch {
        return json(500, { error: "Unable to store thumbnail" });
      }
      const result: ThumbnailWriteResponse = { ok: true, url: thumbnailUrl(assetId) };
      return json(200, result);
    }

    return json(405, { error: "Method not allowed" }, { Allow: "GET, HEAD, PUT" });
  };
}
