import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import type { CreatureSkin, SaveSkinRequest, SaveSkinResponse } from "../../shared/skinContracts.js";
import {
  decodeReferencePng, IMAGEGEN_MAX_REQUEST_BYTES, ImagegenFailure, isSafeId, materialFileNames, slugId,
} from "../../../game/src/multiplayer/imagegenRunner.js";
import { contentRevision } from "../../../tools/content/format.js";
import { readRepoReferencePools } from "../../../tools/content/referencePools.js";
import { atomicReplaceFile } from "../../../tools/lib/atomic-replace-file.js";
import { repoRoot } from "../../../tools/lib/paths.js";
import { transact, type TransactionOptions } from "./transaction.js";

/**
 * Creature skins in the checkout: albedo maps written under `game/public/assets/skins/<assetId>/<skinId>/`
 * plus the `creatureSkins` record that names them, saved through the same content transaction as every
 * other collection write, so revision checks and the catalog rebuild apply. Repo image jobs save their
 * result here; the editor itself saves skins through `putFiles` and a content transaction.
 */
/** Several 16 MB maps as base64. */
export const SKIN_MAX_REQUEST_BYTES = IMAGEGEN_MAX_REQUEST_BYTES;

export interface SkinsHandlerOptions extends TransactionOptions {
  /** Absolute `game/public` directory holding `assets/manifest.json` and `assets/skins/`. */
  publicRoot?: string;
  now?: () => string;
}

export class SkinError extends ImagegenFailure {}

export const defaultPublicRoot = path.join(repoRoot, "game", "public");
const contentRootOf = (options: TransactionOptions) => path.resolve(options.contentRoot ?? path.join(repoRoot, "game", "content"));

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

const KINDS = new Set<SaveSkinRequest["kind"]>(["recolor", "imagegen", "source", "upload"]);

function parseRequest(body: unknown): SaveSkinRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SkinError(400, "Expected a SaveSkinRequest object");
  const request = body as Partial<SaveSkinRequest>;
  if (typeof request.name !== "string" || !request.name.trim()) throw new SkinError(400, "name is required");
  if (!request.kind || !KINDS.has(request.kind)) throw new SkinError(400, "kind must be recolor, imagegen, source or upload");
  if (request.skinId !== undefined && !isSafeId(request.skinId)) throw new SkinError(400, "skinId must match [a-z0-9_.-]");
  if (!request.maps || typeof request.maps !== "object" || Array.isArray(request.maps)) throw new SkinError(400, "maps must map material names to PNGs");
  if (request.merge !== undefined && typeof request.merge !== "boolean") throw new SkinError(400, "merge must be a boolean");
  if (request.merge && !request.skinId) throw new SkinError(400, "merge needs the skinId of an existing skin");
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
  const decoded = new Map(materials.map(material => [material, decodeReferencePng(request.maps[material], `Map ${JSON.stringify(material)}`)]));

  const current = await readSkins(contentRoot);
  let skinId = request.skinId;
  const existing = skinId ? current.records.find(row => row.id === skinId) : undefined;
  if (existing && existing.assetId !== request.assetId) throw new SkinError(409, `Skin ${skinId} belongs to ${existing.assetId}`);
  if (request.merge && !existing) throw new SkinError(404, `No skin ${skinId} to merge into`);
  // A merge replaces only the maps sent; everything else about the skin stays as it was.
  const kept = request.merge && existing ? existing : undefined;
  if (!skinId) {
    const base = slugId(request.name);
    skinId = base;
    for (let n = 2; current.records.some(row => row.id === skinId); n++) skinId = `${base}-${n}`;
  }

  const skinsRoot = path.join(publicRoot, "assets", "skins");
  const directory = contained(skinsRoot, request.assetId, skinId);
  const files = materialFileNames(materials);
  const maps: Record<string, string> = { ...kept?.maps }, sha256: Record<string, string> = { ...kept?.sha256 };
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
    const uploaded = [...new Set([...kept?.uploaded ?? [], ...(kept && request.kind === "upload" && kept.kind !== "upload" ? materials : [])])].sort();
    const record: CreatureSkin = kept ? {
      ...kept, name: request.name.trim() || kept.name, maps, sha256, ...(uploaded.length ? { uploaded } : {}),
    } : {
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
