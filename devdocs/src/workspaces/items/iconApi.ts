import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { backend, can } from "../../api/backend.js";
import { readSession } from "../../api/session.js";
import { metaQueryKey, readMeta, writeMeta } from "../../model/meta.js";
import { gameUrl } from "../../model/gameUrl.js";
import { gameFileUrl, setContentFiles } from "../../model/serverFiles.js";
import { deriveItemIconArt, itemIconOriginalProblem, itemIconPublicPaths, sha256Hex, type RgbaImage } from "../../../../game/src/content/itemIconArt.js";
import type { IconStatus } from "../../../../game/src/content/metaOps.js";
import { itemIconUrl } from "../../../../game/src/ui/itemIcons.js";
import type { ContentAssetIndex } from "../../../../game/src/multiplayer/contentAssetsContract.js";
import type { ImagegenJob } from "../../../shared/skinContracts.js";
import type { MetaRecord } from "../../../shared/metaContracts.js";
import type { ItemIconArtEntry } from "../../../../tools/lib/item-icon-art.js";

/*
  An item's icon through whichever backend is installed (docs/item-icons.md).

  Repo mode keeps the checkout's icon routes (`/__devdocs/icons/<id>`): an upload or a finished image
  job writes the original under `art/item-icons/generated/`, its registry entry, the 256 master and
  the 48 icon, derived with the same sharp pipeline `npm run icons` runs. A live server stores the two
  sizes in its own file store, derived here in the page (`game/src/content/itemIconArt.ts`), and the
  provenance in the item's metadata `icon` block. Either way the new icon waits for review.
*/

/** The checkout's own icon routes (registry, masters) are there. */
export const repoIcons = (): boolean => can("assets");

/** Why an icon action cannot run here, or undefined. */
export function iconBlock(action: "generate" | "upload" | "review"): string | undefined {
  if (!can("write")) return "This editor is read only.";
  if (action === "generate" && !can("imagegen")) return "Image generation does not run here.";
  if (repoIcons()) return undefined;
  if (action === "upload" && !can("files")) return "This server has no file store yet, so icons cannot be stored here.";
  if (!can("meta")) return "Icon review needs an authoring metadata store; this server has none yet.";
  return undefined;
}

/** The id whose artwork the game draws for an item (an upgrade and a few crafted sets borrow another's). */
export function iconArtworkId(itemId: string): string {
  const url = itemIconUrl({ id: itemId } as NonNullable<Parameters<typeof itemIconUrl>[0]>);
  return decodeURIComponent(url?.split("?", 1)[0]!.split("/").at(-1)?.replace(/\.png$/, "") ?? itemId);
}

/** The facts a prompt is written from, per docs/item-icons.md: name, description, material, tier, shape and purpose. */
export interface IconFacts { name: string; description?: string; tier?: number; kind?: string; material?: string; purpose?: string }

/** A first prompt for an item, in the registry's established style. The author edits it before generating. */
export function itemIconPrompt(facts: IconFacts): string {
  const shape = [facts.material, facts.kind].filter(Boolean).join(" ");
  return [
    `Use case: stylized-concept. Asset type: fantasy RPG inventory icon for ${facts.name}.`,
    facts.description?.trim() ? `Authored description: ${facts.description.trim()}` : "",
    `Subject: ${facts.name}${shape ? `, a single ${shape}` : ""}${facts.tier !== undefined ? `, tier ${facts.tier}` : ""}${facts.purpose ? `, ${facts.purpose}` : ""}. Its materials, shape and wear match its name and description.`,
    "Render as a polished realistic 3D fantasy collectible with convincing tactile material, soft studio key light from upper left, restrained highlights, clean silhouette.",
    "Near-front three-quarter view reveals thickness and dimensionality. Single centered object occupies 80 percent of a square 1024px canvas with safe margins, extremely clear at 48px.",
    "Genuine transparent alpha background with no environment, no floor, no cast shadow outside the object, no labels, no text, no border, no tile, no watermark. Do not make a flat vector, generic icon, or diagram.",
  ].filter(Boolean).join(" ");
}

/* ---------- Where the two sizes load from ---------- */

/**
 * The 256 master and 48 icon URLs. `version` changes after a store so the page reloads them: the
 * checkout rewrites the same paths, and a server's index pins each file to its hash.
 */
export function iconUrls(artworkId: string, version: number): { master: string; game: string } {
  const paths = itemIconPublicPaths(artworkId);
  if (repoIcons()) return { master: `/__devdocs/icons/${encodeURIComponent(artworkId)}.png?v=${version}`, game: `${gameUrl(paths.game)}?v=${version}` };
  return { master: gameFileUrl(paths.master), game: gameFileUrl(paths.game) };
}

/** A live server stored files on its own (a finished job): read its index again so the page loads them. */
async function refreshServerFiles(): Promise<void> {
  const session = readSession();
  if (repoIcons() || !session || !can("files")) return;
  const index = await backend().admin<ContentAssetIndex>("/admin/files");
  setContentFiles(`${session.server}/content-assets/`, index.files);
}

/* ---------- Upload: derive both sizes in the page ---------- */

async function decodeImage(file: Blob): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none" }).catch(() => { throw new Error("Could not read that file as an image."); });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: image.width, height: image.height, data: image.data };
  } finally { bitmap.close(); }
}

async function encodePng(image: RgbaImage): Promise<Blob> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(text);
}

/** An uploaded original with both sizes derived, ready to preview and store. Object URLs are the caller's to revoke. */
export interface IconUpload { name: string; original: Blob; sha256: string; width: number; height: number; master: Blob; game: Blob; masterUrl: string; gameUrl: string }

export async function deriveUpload(file: File): Promise<IconUpload> {
  if (file.type && file.type !== "image/png") throw new Error("Upload the generated original as a PNG with its transparency.");
  const image = await decodeImage(file);
  const problem = itemIconOriginalProblem(image);
  if (problem) throw new Error(`${problem}: this image has no transparent background to trim.`);
  const { master, game } = deriveItemIconArt(image);
  const [masterPng, gamePng, sha256] = await Promise.all([encodePng(master), encodePng(game), sha256Hex(new Uint8Array(await file.arrayBuffer()))]);
  return { name: file.name, original: file, sha256, width: image.width, height: image.height, master: masterPng, game: gamePng, masterUrl: URL.createObjectURL(masterPng), gameUrl: URL.createObjectURL(gamePng) };
}

async function repoPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/__devdocs/icons/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Icon request failed (${response.status})`);
  return data;
}

async function patchIcon(itemId: string, operation: { status: IconStatus; sha256?: string; prompt?: string; generatedAt?: string }): Promise<void> {
  const current = await readMeta("items", itemId);
  await writeMeta("items", itemId, { revision: current.revision, operation: { kind: "icon", ...operation } });
}

/**
 * Stores an upload. The checkout keeps the original and registers it (the server side derives the two
 * sizes with sharp, byte for byte what `npm run icons` makes); a live server stores the two sizes
 * derived here, then records the provenance.
 */
export async function storeUpload(artworkId: string, upload: IconUpload, prompt: string): Promise<void> {
  if (repoIcons()) {
    await repoPost(encodeURIComponent(artworkId), { original: await blobToBase64(upload.original), prompt });
    return;
  }
  const paths = itemIconPublicPaths(artworkId);
  await backend().putFiles({ [paths.master]: await blobToBase64(upload.master), [paths.game]: await blobToBase64(upload.game) });
  await patchIcon(artworkId, { status: "candidate", sha256: upload.sha256, prompt, generatedAt: new Date().toISOString() });
}

export async function reviewIcon(artworkId: string, status: Exclude<IconStatus, "candidate">): Promise<void> {
  if (repoIcons()) await repoPost(`${encodeURIComponent(artworkId)}/review`, { status });
  else await patchIcon(artworkId, { status });
}

export async function startIconJob(artworkId: string, name: string, prompt: string, reference?: Blob): Promise<ImagegenJob> {
  return backend().imagegen.start({ kind: "icon", itemId: artworkId, assetId: "", name, prompt, references: reference ? { current: await blobToBase64(reference) } : {} });
}

/* ---------- What the panel reads ---------- */

const ACTIVE = new Set<ImagegenJob["status"]>(["queued", "running"]);

export interface IconState {
  /** The item metadata's `icon` block, when the backend keeps metadata. */
  meta?: MetaRecord["icon"];
  /** The checkout's registry entry (repo mode). */
  entry?: ItemIconArtEntry | null;
  /** This item's icon jobs, newest first. */
  jobs: ImagegenJob[];
  /** Bumps whenever the stored icon may have changed. */
  version: number;
  error?: string;
  /** Read everything again after a store or review. */
  refresh(): Promise<void>;
}

export function useIconState(artworkId: string): IconState {
  const client = useQueryClient();
  const hasMeta = can("meta");
  const meta = useQuery({ queryKey: metaQueryKey("items", artworkId), queryFn: () => readMeta("items", artworkId), enabled: hasMeta, retry: false, refetchOnWindowFocus: false });
  const entry = useQuery({
    queryKey: ["item-icon-provenance", artworkId],
    queryFn: async () => (await (await fetch(`/__devdocs/icons/${encodeURIComponent(artworkId)}/provenance`)).json() as { entry: ItemIconArtEntry | null }).entry,
    enabled: repoIcons(), retry: false, refetchOnWindowFocus: false,
  });
  const version = useQuery({ queryKey: ["item-icon-version", artworkId], queryFn: () => Date.now(), staleTime: Infinity, refetchOnWindowFocus: false });
  const offered = can("imagegen");
  // The same list the skin jobs read; polled while any job runs.
  const jobs = useQuery({
    queryKey: ["imagegen-jobs"], queryFn: () => backend().imagegen.list(), enabled: offered, retry: false, refetchOnWindowFocus: false,
    refetchInterval: current => offered && current.state.data?.some(job => ACTIVE.has(job.status)) ? 3000 : false,
  });
  const mine = useMemo(() => (jobs.data ?? []).filter(job => job.kind === "icon" && job.itemId === artworkId), [jobs.data, artworkId]);

  const refresh = async () => {
    await refreshServerFiles().catch(() => undefined);
    await Promise.all([
      client.invalidateQueries({ queryKey: metaQueryKey("items", artworkId) }),
      client.invalidateQueries({ queryKey: ["item-icon-provenance", artworkId] }),
      client.invalidateQueries({ queryKey: ["item-icon-version", artworkId] }),
      client.invalidateQueries({ queryKey: ["imagegen-jobs"] }),
    ]);
  };
  // A job that finishes while the page is open stored new files: show them.
  const done = useRef<Set<string> | null>(null);
  useEffect(() => {
    const finished = new Set(mine.filter(job => job.status === "done").map(job => job.id));
    const previous = done.current;
    done.current = finished;
    if (previous && [...finished].some(id => !previous.has(id))) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine]);

  const error = [meta, entry, jobs].map(query => query.error).find(Boolean);
  return {
    ...(meta.data ? { meta: meta.data.data.icon } : {}),
    ...(entry.data !== undefined ? { entry: entry.data } : {}),
    jobs: mine, version: version.data ?? 0,
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    refresh,
  };
}
