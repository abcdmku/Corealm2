import { createHash } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { CONTENT_ASSET_PATH } from "../../../game/src/multiplayer/contentAssetsContract.js";
import { atomicReplaceFile } from "../../../tools/lib/atomic-replace-file.js";
import { isLoopbackDevdocsRequest, type DevdocsJsonResponse, type DevdocsRequest } from "./collections.js";
import { defaultPublicRoot } from "./skins.js";

/**
 * Repo mode's `putFiles`: `POST /__devdocs/files { files: { <path>: <base64> } }` writes each file
 * into the checkout's `game/public/<path>`, the same relative paths a live server's asset store keeps
 * (`CONTENT_ASSET_PATH`). All or nothing: every file is decoded and checked before the first write,
 * and a failed write puts back what was there. PNGs are recompressed losslessly, as skin saves always
 * were: browser canvases barely compress. Answers `{ files: { <path>: { sha256, bytes } } }` for the
 * bytes written.
 */
export const FILES_PATH = "/__devdocs/files";
/** One file at most, decoded. */
export const FILE_MAX_BYTES = 32 * 1024 * 1024;
/** Several maps as base64 in one request. */
export const FILES_MAX_REQUEST_BYTES = 128 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface FilesHandlerOptions {
  /** Absolute `game/public` directory. */
  publicRoot?: string;
}
export type FilesHandlerRequest = DevdocsRequest & { body?: unknown };
export type FilesHandler = (request: FilesHandlerRequest) => Promise<DevdocsJsonResponse | undefined>;
export type StoredFiles = { files: Record<string, { sha256: string; bytes: number }> };

export class FilesError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function isFilesPath(url?: string): boolean { return url?.split(/[?#]/, 1)[0] === FILES_PATH; }

function json(status: number, data: unknown): DevdocsJsonResponse {
  return { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(data) };
}

async function decode(file: string, value: unknown): Promise<Buffer> {
  if (typeof value !== "string" || value.length > Math.ceil(FILE_MAX_BYTES / 3) * 4 + 4 || !BASE64.test(value)) throw new FilesError(400, `${file}: expected base64 contents up to ${FILE_MAX_BYTES / 1024 / 1024} MB`);
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > FILE_MAX_BYTES) throw new FilesError(400, `${file}: empty or larger than ${FILE_MAX_BYTES / 1024 / 1024} MB`);
  if (!file.endsWith(".png")) return bytes;
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new FilesError(400, `${file}: not a PNG`);
  try { return await sharp(bytes).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer(); }
  catch { throw new FilesError(400, `${file}: the PNG could not be decoded`); }
}

// One write at a time in this process, so two saves never interleave their restores.
let writing: Promise<unknown> = Promise.resolve();

export function putFiles(body: unknown, options: FilesHandlerOptions = {}): Promise<StoredFiles> {
  const run = writing.then(() => putFilesNow(body, options));
  writing = run.catch(() => undefined);
  return run;
}

async function putFilesNow(body: unknown, options: FilesHandlerOptions): Promise<StoredFiles> {
  const files = body && typeof body === "object" && !Array.isArray(body) ? (body as { files?: unknown }).files : undefined;
  if (!files || typeof files !== "object" || Array.isArray(files) || !Object.keys(files).length) throw new FilesError(400, "Expected { files: { <path>: <base64> } } with at least one file");
  const root = path.resolve(options.publicRoot ?? defaultPublicRoot);
  const decoded: { file: string; target: string; bytes: Buffer }[] = [];
  for (const [file, value] of Object.entries(files as Record<string, unknown>)) {
    if (!CONTENT_ASSET_PATH.test(file)) throw new FilesError(400, `${file}: not a path a game file may live at`);
    const target = path.resolve(root, ...file.split("/"));
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new FilesError(400, `${file}: leaves the public tree`);
    decoded.push({ file, target, bytes: await decode(file, value) });
  }

  const previous = new Map<string, Buffer | undefined>();
  try {
    for (const { target, bytes } of decoded) {
      previous.set(target, await readFile(target).catch(() => undefined));
      await mkdir(path.dirname(target), { recursive: true });
      await atomicReplaceFile(target, bytes);
    }
  } catch (error) {
    for (const [target, bytes] of previous) {
      if (bytes) await atomicReplaceFile(target, bytes).catch(() => undefined);
      else await unlink(target).catch(() => undefined);
    }
    throw error;
  }
  return { files: Object.fromEntries(decoded.map(({ file, bytes }) => [file, { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length }])) };
}

export function createFilesHandler(options: FilesHandlerOptions = {}): FilesHandler {
  return async request => {
    if (!isFilesPath(request.url)) return undefined;
    if (!isLoopbackDevdocsRequest(request)) return json(403, { error: "Dev docs API accepts loopback requests only" });
    if (request.method !== "POST") return json(405, { error: "POST required" });
    try {
      return json(200, await putFiles(request.body, options));
    } catch (error) {
      if (error instanceof FilesError) return json(error.status, { error: error.message });
      throw error;
    }
  };
}
