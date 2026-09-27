import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import type { CreatureSkin, SaveSkinRequest, SaveSkinResponse } from "../../shared/skinContracts.js";
import { contentRevision } from "../../../tools/content/format.js";
import { readRepoReferencePools } from "../../../tools/content/referencePools.js";
import { atomicReplaceFile } from "../../../tools/lib/atomic-replace-file.js";
import { repoRoot } from "../../../tools/lib/paths.js";
import { isLoopbackDevdocsRequest, type DevdocsJsonResponse, type DevdocsRequest } from "./collections.js";
import { transact, type TransactionOptions } from "./transaction.js";

/**
 * Creature skins: albedo maps written under `game/public/assets/skins/<assetId>/<skinId>/` plus the
 * `creatureSkins` record that names them, saved through the same content transaction as every other
 * collection write so revision checks and the catalog rebuild apply.
 */
export const SKINS_PATH = "/__devdocs/skins";
export const SKIN_MAX_MAP_BYTES = 16 * 1024 * 1024;
export const SKIN_MAX_DIMENSION = 4096;
/** Several 16 MB maps as base64. */
export const SKIN_MAX_REQUEST_BYTES = 96 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SAFE_ID = /^[a-z0-9_.-]+$/;
const BASE64 = /^(?:data:image\/png;base64,)?([A-Za-z0-9+/]+={0,2})$/;

export interface SkinsHandlerOptions extends TransactionOptions {
  /** Absolute `game/public` directory holding `assets/manifest.json` and `assets/skins/`. */
  publicRoot?: string;
  now?: () => string;
}
export type SkinsHandlerRequest = DevdocsRequest & { body?: unknown };
export type SkinsHandler = (request: SkinsHandlerRequest) => Promise<DevdocsJsonResponse | undefined>;

export class SkinError extends Error {
  constructor(readonly status: number, message: string, readonly detail?: unknown) { super(message); }
}

export const defaultPublicRoot = path.join(repoRoot, "game", "public");
const contentRootOf = (options: TransactionOptions) => path.resolve(options.contentRoot ?? path.join(repoRoot, "game", "content"));

export function isSkinsPath(url?: string): boolean {
  const raw = url?.split(/[?#]/, 1)[0];
  return raw === SKINS_PATH || raw?.startsWith(`${SKINS_PATH}/`) === true;
}

function json(status: number, data: unknown): DevdocsJsonResponse {
  return { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(data) };
}

export function isSafeId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value) && value !== "." && value !== ".." && value.length <= 120;
}

/** A lowercase id from free text: `Mossy Frog!` -> `mossy-frog`. */
export function slugId(text: string): string {
  return text.normalize("NFKD").toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80) || "skin";
}

/**
 * File names for material names. Material names are free text (`Wild horse · source coat`); the
 * schema's map path allows `[A-Za-z0-9_.-]`, so each gets a slug, deduplicated within the skin.
 */
export function materialFileNames(materials: readonly string[]): Map<string, string> {
  const used = new Set<string>(), names = new Map<string, string>();
  for (const material of materials) {
    const base = material.normalize("NFKD").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/_+/g, "_").replace(/^[_.]+|[_.]+$/g, "").slice(0, 80) || "material";
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}`;
    used.add(name.toLowerCase());
    names.set(material, name);
  }
  return names;
}

/** Reads width and height from the IHDR chunk. */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString("latin1", 12, 16) !== "IHDR") return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Decodes one map (base64, with or without a PNG data URL prefix) and checks it is a sane PNG. */
export function decodeSkinPng(value: unknown, label: string): Buffer {
  if (typeof value !== "string" || value.length > Math.ceil(SKIN_MAX_MAP_BYTES / 3) * 4 + 64) throw new SkinError(400, `${label}: expected a base64 PNG up to 16 MB`);
  const match = BASE64.exec(value);
  if (!match) throw new SkinError(400, `${label}: not base64 PNG data`);
  const bytes = Buffer.from(match[1]!, "base64");
  const size = pngDimensions(bytes);
  if (!size) throw new SkinError(400, `${label}: not a PNG`);
  if (bytes.length > SKIN_MAX_MAP_BYTES) throw new SkinError(400, `${label}: larger than 16 MB`);
  if (size.width < 1 || size.height < 1 || size.width > SKIN_MAX_DIMENSION || size.height > SKIN_MAX_DIMENSION)
    throw new SkinError(400, `${label}: ${size.width}x${size.height} is outside 1..${SKIN_MAX_DIMENSION}`);
  return bytes;
}

interface ManifestAsset { id: string; materials?: string[] }

/** Checks the asset is in the manifest and every material is one of its materials. */
export async function checkAssetMaterials(publicRoot: string, assetId: unknown, materials: readonly string[]): Promise<ManifestAsset> {
  if (!isSafeId(assetId)) throw new SkinError(400, "assetId must match [a-z0-9_.-]");
  const manifest = JSON.parse(await readFile(path.join(publicRoot, "assets", "manifest.json"), "utf8")) as { assets?: ManifestAsset[] };
  const asset = manifest.assets?.find(row => row.id === assetId);
  if (!asset) throw new SkinError(404, `Unknown asset ${assetId}`);
  if (!materials.length) throw new SkinError(400, "At least one material map is required");
  if (Array.isArray(asset.materials)) {
    const unknown = materials.filter(material => !asset.materials!.includes(material));
    if (unknown.length) throw new SkinError(400, `Asset ${assetId} has no material ${unknown.map(name => JSON.stringify(name)).join(", ")}`, { materials: asset.materials });
  }
  return asset;
}

function contained(root: string, ...segments: string[]): string {
  const file = path.resolve(root, ...segments), relative = path.relative(root, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new SkinError(400, "Path leaves the skins directory");
  return file;
}

async function readSkins(contentRoot: string): Promise<{ records: CreatureSkin[]; revision: string }> {
  const text = await readFile(path.join(contentRoot, "data", "creatureSkins.json"), "utf8");
  return { records: JSON.parse(text) as CreatureSkin[], revision: contentRevision(text) };
}

const KINDS = new Set<SaveSkinRequest["kind"]>(["recolor", "imagegen", "source"]);

function parseRequest(body: unknown): SaveSkinRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SkinError(400, "Expected a SaveSkinRequest object");
  const request = body as Partial<SaveSkinRequest>;
  if (typeof request.name !== "string" || !request.name.trim()) throw new SkinError(400, "name is required");
  if (!request.kind || !KINDS.has(request.kind)) throw new SkinError(400, "kind must be recolor, imagegen or source");
  if (request.skinId !== undefined && !isSafeId(request.skinId)) throw new SkinError(400, "skinId must match [a-z0-9_.-]");
  if (!request.maps || typeof request.maps !== "object" || Array.isArray(request.maps)) throw new SkinError(400, "maps must map material names to PNGs");
  for (const key of ["prompt", "generator"] as const) if (request[key] !== undefined && typeof request[key] !== "string") throw new SkinError(400, `${key} must be a string`);
  return request as SaveSkinRequest;
}

// One save at a time in this process: the id choice and the file writes happen before the
// transaction takes its lock.
let saving: Promise<unknown> = Promise.resolve();

/** Writes the maps and upserts the record. Throws `SkinError` for a request that cannot apply. */
export function saveSkin(body: unknown, options: SkinsHandlerOptions = {}): Promise<SaveSkinResponse> {
  const run = saving.then(() => saveSkinNow(body, options));
  saving = run.catch(() => undefined);
  return run;
}

async function saveSkinNow(body: unknown, options: SkinsHandlerOptions): Promise<SaveSkinResponse> {
  const request = parseRequest(body);
  const publicRoot = path.resolve(options.publicRoot ?? defaultPublicRoot);
  const contentRoot = contentRootOf(options);
  const materials = Object.keys(request.maps);
  await checkAssetMaterials(publicRoot, request.assetId, materials);
  const decoded = new Map(materials.map(material => [material, decodeSkinPng(request.maps[material], `Map ${JSON.stringify(material)}`)]));

  const current = await readSkins(contentRoot);
  let skinId = request.skinId;
  if (skinId) {
    const existing = current.records.find(row => row.id === skinId);
    if (existing && existing.assetId !== request.assetId) throw new SkinError(409, `Skin ${skinId} belongs to ${existing.assetId}`);
  } else {
    const base = slugId(request.name);
    skinId = base;
    for (let n = 2; current.records.some(row => row.id === skinId); n++) skinId = `${base}-${n}`;
  }

  const skinsRoot = path.join(publicRoot, "assets", "skins");
  const directory = contained(skinsRoot, request.assetId, skinId);
  const files = materialFileNames(materials);
  const maps: Record<string, string> = {}, sha256: Record<string, string> = {};
  const previous = new Map<string, Buffer | undefined>();
  await mkdir(directory, { recursive: true });
  const restore = async () => {
    for (const [file, bytes] of previous) {
      if (bytes) await atomicReplaceFile(file, bytes).catch(() => undefined);
      else await unlink(file).catch(() => undefined);
    }
    if ((await readdir(directory).catch(() => ["?"])).length === 0) await rm(directory, { recursive: true, force: true });
    if ((await readdir(path.dirname(directory)).catch(() => ["?"])).length === 0) await rm(path.dirname(directory), { recursive: true, force: true });
  };
  try {
    for (const material of materials) {
      const name = `${files.get(material)!}.png`, file = contained(directory, name);
      // Browser canvases barely compress PNG (a 2048² map comes in at 7 to 10 MB). Pixels are unchanged.
      const bytes = await sharp(decoded.get(material)!).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
      previous.set(file, await readFile(file).catch(() => undefined));
      await atomicReplaceFile(file, bytes);
      maps[material] = `skins/${request.assetId}/${skinId}/${name}`;
      sha256[material] = createHash("sha256").update(bytes).digest("hex");
    }
    const record: CreatureSkin = {
      id: skinId, assetId: request.assetId, name: request.name.trim(), kind: request.kind, maps,
      ...(request.recolor ? { recolor: request.recolor } : {}),
      ...(request.prompt ? { prompt: request.prompt } : {}),
      ...(request.generator ? { generator: request.generator } : {}),
      sha256, createdAt: (options.now ?? (() => new Date().toISOString()))(),
    };
    const result = await transact({ operation: "save", revisions: { creatureSkins: current.revision },
      changes: [{ kind: "put", collection: "creatureSkins", id: skinId, record }] }, { referencePools: readRepoReferencePools, ...options });
    const payload = JSON.parse(result.body) as { error?: string; diagnostics?: unknown; revisions?: Record<string, string> };
    if (result.status !== 200) throw new SkinError(result.status, payload.error ?? "Unable to save skin", payload.diagnostics);
    // A re-save with fewer materials leaves no orphaned maps behind.
    const keep = new Set(Object.values(maps).map(map => path.basename(map)));
    for (const entry of await readdir(directory)) if (!keep.has(entry) && entry.endsWith(".png")) await unlink(path.join(directory, entry)).catch(() => undefined);
    return { skin: record, revision: payload.revisions?.creatureSkins ?? (await readSkins(contentRoot)).revision };
  } catch (error) {
    await restore();
    throw error;
  }
}

export function createSkinsHandler(options: SkinsHandlerOptions = {}): SkinsHandler {
  return async request => {
    if (!isSkinsPath(request.url)) return undefined;
    if (!isLoopbackDevdocsRequest(request)) return json(403, { error: "Dev docs API accepts loopback requests only" });
    if (request.url?.split(/[?#]/, 1)[0] !== SKINS_PATH) return json(404, { error: "Unknown skins route" });
    if (request.method !== "POST") return json(405, { error: "POST required" });
    try {
      return json(200, await saveSkin(request.body, options));
    } catch (error) {
      if (error instanceof SkinError) return json(error.status, { error: error.message, ...(error.detail === undefined ? {} : { diagnostics: error.detail }) });
      throw error;
    }
  };
}
