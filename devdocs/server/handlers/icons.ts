import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ICON_STATUSES, applyMetaOperation, canonicalMetaFile, MetaFileSchema, type IconStatus, type MetaFile, type MetaOperation } from "../../../game/src/content/metaOps.js";
import { itemIconPublicPaths } from "../../../game/src/content/itemIconArt.js";
import { formatContentJson } from "../../../game/src/content/compiler/canonical.js";
import { parseValue } from "../../../game/src/content/schema/core.js";
import { createIconKind, type IconOriginal } from "../../../game/src/multiplayer/itemIconJobs.js";
import type { IconJobFinisher } from "../../../game/src/multiplayer/imagegenRunner.js";
import { withFileLock } from "../../../tools/content/locks.js";
import { atomicReplaceFile } from "../../../tools/lib/atomic-replace-file.js";
import { sharpItemIconGame, sharpItemIconMaster, updateItemIconArtEntry, readItemIconArtRegistry, type ItemIconArtEntry, type ItemIconGenerator } from "../../../tools/lib/item-icon-art.js";
import { repoRoot } from "../../../tools/lib/paths.js";
import { BodyError, readJsonBody } from "../lib/body.js";
import { isLoopbackDevdocsRequest, type DevdocsRequest } from "./collections.js";

/**
 * Item icons in the checkout (docs/item-icons.md):
 *
 *   GET  /__devdocs/icons/<id>.png          the 256 master from `art/item-icons/256/`
 *   GET  /__devdocs/icons/<id>/provenance   { entry: ItemIconArtEntry | null }  the registry entry
 *   POST /__devdocs/icons/<id>              { original, prompt, sourceLookup? } -> StoredItemIcon
 *        an uploaded generated original: kept under `art/item-icons/generated/`, registered as
 *        pending, its 256 master and 48 icon written where `npm run icons` writes them
 *   POST /__devdocs/icons/<id>/review       { status: "approved" | "rejected" } -> { entry }
 *        registry status (`accepted` / `pending`) and the item metadata's `icon.status`
 *
 * An image job's icon (`repoIconKind`) is stored the same way, so the registry always names the
 * original, its sha256 and prompt, and `npm run icons -- --all` rebuilds the same bytes.
 */

export interface RepoIconOptions {
  /** The checkout. Tests point this at a copy. */
  root?: string;
  /** Recorded in metadata history. */
  actor?: string;
}

export interface StoredItemIcon { itemId: string; entry: ItemIconArtEntry; outputs: string[] }

const ICON_URL = /^\/__devdocs\/icons\/(?:([a-z0-9_-]+\.png)|([a-z0-9_]+)(?:\/(provenance|review))?)$/i;
const ORIGINAL_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_LOOKUP = "Authored in devdocs from the item's name, description, material, tier and purpose (docs/item-icons.md).";

function places(root: string) {
  return {
    art: path.join(root, "art", "item-icons", "generated"),
    masters: path.join(root, "art", "item-icons", "256"),
    game: path.join(root, "game", "public", "assets", "icons", "items", "48"),
    content: path.join(root, "game", "content"),
  };
}

/** Whether the accepted catalog has the item. Metadata and art never trigger a content build. */
async function repoHasItem(root: string, itemId: string): Promise<boolean> {
  try {
    const catalog = JSON.parse(await readFile(path.join(places(root).content, "compiled", "catalog.json"), "utf8")) as { tables?: { items?: { id?: unknown }[] } };
    return Boolean(catalog.tables?.items?.some(row => row.id === itemId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Applies one icon operation to `items.meta.json` under its lock. */
async function recordIconMeta(root: string, itemId: string, operation: Extract<MetaOperation, { kind: "icon" }>, actor: string, at: string): Promise<void> {
  const file = path.join(places(root).content, "meta", "items.meta.json");
  await mkdir(path.dirname(file), { recursive: true });
  await withFileLock(file, async () => {
    let text = "{}\n";
    try { text = await readFile(file, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const records: MetaFile = parseValue(MetaFileSchema, JSON.parse(text), "items.meta");
    await atomicReplaceFile(file, formatContentJson(canonicalMetaFile(applyMetaOperation(records, "items", itemId, {}, operation, actor, at), "items")));
  });
}

/**
 * Keeps a generated original in the checkout and publishes its two sizes there: the original under
 * `art/item-icons/generated/` (replacing the item's own previous original, as regeneration does),
 * its registry entry `pending`, the 256 master and the 48 icon, and `candidate` item metadata.
 */
export async function storeRepoItemIcon(icon: IconOriginal & { generatorKind: ItemIconGenerator; sourceLookup?: string }, options: RepoIconOptions = {}): Promise<StoredItemIcon> {
  const root = options.root ?? repoRoot;
  const where = places(root);
  // Derive before writing anything: an original without real transparency is refused whole.
  const master = await sharpItemIconMaster(icon.original, undefined, `${icon.itemId} original`);
  const game = await sharpItemIconGame(master);
  const sha256 = createHash("sha256").update(icon.original).digest("hex");
  const items = await readItemIconArtRegistry(where.art);
  const current = items[icon.itemId];
  const shared = current && Object.entries(items).some(([id, row]) => id !== icon.itemId && row.source === current.source);
  const source = current && !shared ? current.source : `devdocs/${icon.itemId}.png`;
  const masterFile = path.join(where.masters, `${icon.itemId}.png`);
  const gameFile = path.join(where.game, `${icon.itemId}.png`);
  // The original first, so the registry never names bytes that are not there.
  for (const [file, bytes] of [[path.join(where.art, ...source.split("/")), icon.original], [masterFile, master], [gameFile, game]] as const) {
    await mkdir(path.dirname(file), { recursive: true });
    await atomicReplaceFile(file, bytes);
  }
  const entry = await updateItemIconArtEntry(icon.itemId, previous => ({
    status: "pending", source, sha256, prompt: icon.prompt.trim(), generator: icon.generatorKind,
    sourceLookup: icon.sourceLookup?.trim() || previous?.sourceLookup || DEFAULT_LOOKUP,
    review: `Awaiting review in devdocs of the 256 master and 48 icon (${icon.generator}, ${icon.generatedAt}).`,
  }), where.art);
  await recordIconMeta(root, icon.itemId, { kind: "icon", status: "candidate", sha256, prompt: icon.prompt.trim(), generatedAt: icon.generatedAt }, options.actor ?? "user", icon.generatedAt);
  return { itemId: icon.itemId, entry, outputs: [path.relative(root, masterFile).split(path.sep).join("/"), itemIconPublicPaths(icon.itemId).game] };
}

/** Approve (registry `accepted`) or reject (back to `pending`) an item's icon, with its metadata. */
export async function reviewRepoItemIcon(itemId: string, status: Exclude<IconStatus, "candidate">, options: RepoIconOptions = {}): Promise<ItemIconArtEntry> {
  const root = options.root ?? repoRoot;
  const actor = options.actor ?? "user";
  const at = new Date().toISOString();
  const entry = await updateItemIconArtEntry(itemId, current => {
    if (!current) throw new IconRequestError(404, `${itemId} has no registered original to review`);
    return { ...current, status: status === "approved" ? "accepted" : "pending",
      review: status === "approved" ? `Approved in devdocs by ${actor} at ${at} after review of the 256 master and 48 icon.` : `Rejected in devdocs by ${actor} at ${at}; replace the original.` };
  }, places(root).art);
  await recordIconMeta(root, itemId, { kind: "icon", status }, actor, at);
  return entry;
}

/** The checkout's icon job kind, for the repo editor's image job service (`kinds: { icon: repoIconKind() }`). */
export function repoIconKind(options: RepoIconOptions = {}): IconJobFinisher<undefined> {
  const root = options.root ?? repoRoot;
  return createIconKind<undefined>({
    hasItem: itemId => repoHasItem(root, itemId),
    store: async (icon, { log }) => {
      const stored = await storeRepoItemIcon({ ...icon, generatorKind: "built-in image_gen" }, options);
      log(`\n== registered ${stored.entry.source} (pending review); wrote ${stored.outputs.join(", ")}\n`);
      return stored.outputs;
    },
  });
}

class IconRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type IconResponse = { status: number; headers: Record<string, string>; body: Uint8Array | string };
const json = (status: number, data: unknown): IconResponse => ({ status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(data) });

function uploadBody(body: unknown): { original: Buffer; prompt: string; sourceLookup?: string } {
  const value = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  if (typeof value.original !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.original)) throw new IconRequestError(400, "original must be a base64 PNG");
  const original = Buffer.from(value.original, "base64");
  if (original.length > ORIGINAL_MAX_BYTES || original.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new IconRequestError(400, "original must be a PNG up to 16 MB");
  // docs/item-icons.md: every icon is prompted image generation, and the registry records the exact prompt.
  if (typeof value.prompt !== "string" || !value.prompt.trim()) throw new IconRequestError(400, "prompt is required: the exact prompt that generated this original");
  if (value.sourceLookup !== undefined && typeof value.sourceLookup !== "string") throw new IconRequestError(400, "sourceLookup must be text");
  return { original, prompt: value.prompt, ...(typeof value.sourceLookup === "string" ? { sourceLookup: value.sourceLookup } : {}) };
}

export function isIconMasterPath(url?: string): boolean { return Boolean(url?.startsWith("/__devdocs/icons/")); }

/** The icon routes above. `request` is the incoming message itself, so a POST reads its own body. */
export async function readIconMaster(request: DevdocsRequest, options: RepoIconOptions = {}): Promise<IconResponse> {
  if (!isLoopbackDevdocsRequest(request)) return json(403, { error: "Dev docs API accepts loopback requests only" });
  const match = ICON_URL.exec((request.url ?? "").split(/[?#]/, 1)[0]!);
  if (!match) return json(400, { error: "Invalid icon name" });
  const [, file, itemId, action] = match;
  const root = options.root ?? repoRoot;
  const method = request.method ?? "GET";
  try {
    if (file) {
      if (method !== "GET") return json(405, { error: "Method not allowed" });
      try { return { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "no-cache" }, body: await readFile(path.join(places(root).masters, file)) }; }
      catch (error) { return json((error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500, { error: "Icon master unavailable" }); }
    }
    if (action === "provenance") {
      if (method !== "GET") return json(405, { error: "Method not allowed" });
      return json(200, { entry: (await readItemIconArtRegistry(places(root).art))[itemId!] ?? null });
    }
    if (method !== "POST") return json(405, { error: "POST required" });
    const body = "body" in request ? (request as { body?: unknown }).body : await readJsonBody(request as IncomingMessage, ORIGINAL_MAX_BYTES * 2);
    if (!await repoHasItem(root, itemId!)) return json(404, { error: `No item ${itemId}` });
    if (action === "review") {
      const status = (body as { status?: unknown } | undefined)?.status;
      if (status !== "approved" && status !== "rejected") return json(400, { error: `status must be one of ${ICON_STATUSES.filter(value => value !== "candidate").join(", ")}` });
      return json(200, { entry: await reviewRepoItemIcon(itemId!, status, options) });
    }
    const upload = uploadBody(body);
    return json(200, await storeRepoItemIcon({ itemId: itemId!, original: upload.original, prompt: upload.prompt, generator: "devdocs upload",
      generatedAt: new Date().toISOString(), generatorKind: "uploaded original", ...(upload.sourceLookup ? { sourceLookup: upload.sourceLookup } : {}) }, options) satisfies StoredItemIcon);
  } catch (error) {
    if (error instanceof IconRequestError || error instanceof BodyError) return json(error.status, { error: error.message });
    if (error instanceof Error && /transparency|alpha|Input buffer|unsupported image/i.test(error.message)) return json(400, { error: error.message });
    throw error;
  }
}
