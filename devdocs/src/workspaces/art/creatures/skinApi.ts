/*
  The creature skin surfaces the Art view talks to, all through the installed backend so they work
  the same in the repo editor and on a live server: the `creatureSkins` collection (read through the
  normal collection query), `backend().putFiles` for the maps, a content save for the record, and
  `backend().imagegen` for generation jobs. Plus the canvas work that turns albedo maps into PNGs.
  Callers gate on `gates.ts` first; an action this backend cannot do throws `SkinApiUnavailable`.
*/
import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { backend, BackendUnavailable, can } from "../../../api/backend.js";
import { collectionQuery } from "../../../api/client.js";
import { runTransaction } from "../../../model/draft.js";
import { refreshGameCatalog } from "../../../model/liveCatalog.js";
import { contentRows } from "../../../model/rows.js";
import { albedoMaps, type AlbedoMap } from "../../../viewer/albedo.js";
import { gameFileUrl } from "../../../viewer/registry.js";
import type { CreatureSkin, ImagegenJob, ImagegenRequest, PngBase64, SaveSkinRequest, SaveSkinResponse } from "../../../../shared/skinContracts.js";
import { filesBlock, imagegenBlock } from "../gates.js";
import { recolorPixels, type RecolorParams } from "./recolor.js";
import { materialFileNames, skinMapPath, slugId, storedPathOfSkinMap } from "./skinFiles.js";

export type { CreatureSkin, ImagegenJob };

/** An action this backend cannot do; the message is the reason, fit to show inline. */
export class SkinApiUnavailable extends Error {
  constructor(reason: string) { super(reason); this.name = "SkinApiUnavailable"; }
}

function unavailable(error: unknown): never {
  throw error instanceof BackendUnavailable ? new SkinApiUnavailable(error.message) : error;
}

// One save at a time: the id choice reads the collection before the save moves it.
let saving: Promise<unknown> = Promise.resolve();

/**
 * Save a skin: its maps go to `assets/skins/<asset>/<skin>/<material>.png` through `putFiles`, then
 * the `creatureSkins` record is saved like any content (a publish on a live server). A new id comes
 * from the name when `skinId` is absent. With `merge`, only the maps sent are replaced; the skin's
 * other maps, kind, prompt and createdAt stay, and a hand upload over a generated, recolored or source
 * skin lists the replaced materials in `uploaded`. The save adopts the recompiled catalog, so the
 * stage can wear the skin at once.
 */
export function saveSkin(request: SaveSkinRequest): Promise<SaveSkinResponse> {
  const run = saving.then(() => saveSkinNow(request));
  saving = run.catch(() => undefined);
  return run;
}

async function saveSkinNow(request: SaveSkinRequest): Promise<SaveSkinResponse> {
  const blocked = filesBlock();
  if (blocked) throw new SkinApiUnavailable(blocked);
  const materials = Object.keys(request.maps);
  if (!materials.length) throw new Error("At least one material map is required.");
  if (request.merge && !request.skinId) throw new Error("A merge needs the id of an existing skin.");

  const current = await backend().collection("creatureSkins");
  const records = contentRows(current) as unknown as CreatureSkin[];
  const existing = request.skinId ? records.find(row => row.id === request.skinId) : undefined;
  if (existing && existing.assetId !== request.assetId) throw new Error(`Skin ${request.skinId} belongs to ${existing.assetId}.`);
  if (request.merge && !existing) throw new Error(`No skin ${request.skinId} to merge into.`);
  const kept = request.merge ? existing : undefined;
  let skinId = request.skinId;
  if (!skinId) {
    const base = slugId(request.name);
    skinId = base;
    for (let n = 2; records.some(row => row.id === skinId); n++) skinId = `${base}-${n}`;
  }
  const id = skinId;

  const names = materialFileNames(materials);
  const paths = new Map(materials.map(material => [material, skinMapPath(request.assetId, id, names.get(material)!)]));
  const stored = await backend().putFiles(Object.fromEntries(materials.map(material => [storedPathOfSkinMap(paths.get(material)!), request.maps[material]!]))).catch(unavailable);
  const maps: Record<string, string> = { ...kept?.maps }, sha256: Record<string, string> = { ...kept?.sha256 };
  for (const material of materials) {
    const path = paths.get(material)!;
    maps[material] = path;
    sha256[material] = stored.files[storedPathOfSkinMap(path)]!.sha256;
  }
  const uploaded = [...new Set([...kept?.uploaded ?? [], ...(kept && request.kind === "upload" && kept.kind !== "upload" ? materials : [])])].sort();
  const record: CreatureSkin = kept ? {
    ...kept, name: request.name.trim() || kept.name, maps, sha256, ...(uploaded.length ? { uploaded } : {}),
  } : {
    id, assetId: request.assetId, name: request.name.trim(), kind: request.kind, maps,
    ...(request.recolor ? { recolor: request.recolor } : {}),
    ...(request.prompt ? { prompt: request.prompt } : {}),
    ...(request.generator ? { generator: request.generator } : {}),
    sha256, createdAt: new Date().toISOString(),
  };
  const result = await runTransaction("save", { creatureSkins: current.revision },
    [{ kind: "put", collection: "creatureSkins", id, record, ...(existing ? {} : { create: true }) }]);
  return { skin: record, revision: result.collections.find(row => row.collection.name === "creatureSkins")?.revision ?? current.revision };
}

async function withImagegen<T>(start: () => Promise<T>): Promise<T> {
  const blocked = imagegenBlock();
  if (blocked) throw new SkinApiUnavailable(blocked);
  return start().catch(unavailable);
}
export const startImagegen = (request: ImagegenRequest): Promise<ImagegenJob> => withImagegen(() => backend().imagegen.start(request));
/** Retry a failed job; maps it already painted are reused. */
export const retryImagegen = (jobId: string): Promise<ImagegenJob> => withImagegen(() => backend().imagegen.retry(jobId));

/** Where a skin map is served: under the public tree's `assets/`, from a live server's own store when it holds the file. */
export const skinMapUrl = (path: string): string => gameFileUrl(storedPathOfSkinMap(path));

/** This model's skins, from the `creatureSkins` collection. */
export function useCreatureSkins(assetId: string): { skins: CreatureSkin[]; all: CreatureSkin[]; loading: boolean; error?: string } {
  const query = useQuery(collectionQuery("creatureSkins"));
  const all = useMemo(() => query.data ? contentRows(query.data) as unknown as CreatureSkin[] : [], [query.data]);
  const skins = useMemo(() => all.filter(skin => skin.assetId === assetId), [all, assetId]);
  return { skins, all, loading: query.isPending, error: query.isError ? query.error.message : undefined };
}

const ACTIVE = new Set<ImagegenJob["status"]>(["queued", "running"]);
export const isActiveJob = (job: ImagegenJob): boolean => ACTIVE.has(job.status);

/**
 * This model's image generation jobs, newest first. Polls every 3 s while one is queued or running;
 * when a job finishes the skins list is refetched so its skin shows up. A backend without image
 * generation is never asked.
 */
export function useImagegenJobs(assetId: string): { jobs: ImagegenJob[]; allJobs: ImagegenJob[]; unavailable: boolean; error?: string; refresh: () => void } {
  const client = useQueryClient();
  const offered = can("imagegen");
  const query = useQuery({
    queryKey: ["imagegen-jobs"],
    queryFn: () => backend().imagegen.list().catch(unavailable),
    enabled: offered,
    retry: false, refetchOnWindowFocus: false,
    refetchInterval: current => offered && current.state.data?.some(isActiveJob) ? 3000 : false,
  });
  const allJobs = useMemo(() => query.data ?? [], [query.data]);
  const jobs = useMemo(() => allJobs.filter(job => job.assetId === assetId), [allJobs, assetId]);
  const finished = useRef<Set<string> | null>(null);
  useEffect(() => {
    const done = new Set(allJobs.filter(job => job.status === "done").map(job => job.id));
    const previous = finished.current;
    finished.current = done;
    if (previous && [...done].some(id => !previous.has(id))) {
      void refreshGameCatalog();
      void client.invalidateQueries({ queryKey: collectionQuery("creatureSkins").queryKey });
    }
  }, [allJobs, client]);
  const missing = !offered || query.error instanceof SkinApiUnavailable;
  return { jobs, allJobs, unavailable: missing, error: query.isError && !missing ? query.error.message : undefined, refresh: () => { if (offered) void query.refetch(); } };
}

/** The maps as the game draws them, with a readable error while `albedoMaps` is not implemented. */
export async function loadAlbedo(assetId: string, skinId?: string): Promise<AlbedoMap[]> {
  const maps = await albedoMaps(assetId, skinId);
  if (!maps.length) throw new Error("This model has no colour maps to work from.");
  return maps;
}

export function blobToBase64(blob: Blob): Promise<PngBase64> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the map"));
    reader.readAsDataURL(blob);
  });
}

export async function mapsToBase64(maps: readonly { material: string; png: Blob }[]): Promise<Record<string, PngBase64>> {
  const entries = await Promise.all(maps.map(async map => [map.material, await blobToBase64(map.png)] as const));
  return Object.fromEntries(entries);
}

export interface DecodedMap { material: string; image: ImageData }

export async function decodeMaps(maps: readonly AlbedoMap[]): Promise<DecodedMap[]> {
  return Promise.all(maps.map(async map => {
    const bitmap = await createImageBitmap(map.png);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return { material: map.material, image: context.getImageData(0, 0, canvas.width, canvas.height) };
  }));
}

/** Bake a recolor of every decoded map into PNGs. */
export async function bakeRecolor(maps: readonly DecodedMap[], params: RecolorParams): Promise<{ material: string; png: Blob }[]> {
  return Promise.all(maps.map(async ({ material, image }) => {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const pixels = recolorPixels(image.data, params);
    canvas.getContext("2d")!.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0);
    return { material, png: await canvas.convertToBlob({ type: "image/png" }) };
  }));
}

/** An uploaded image (PNG, JPEG or WebP) decoded with the model loader's options and re-encoded as PNG. */
export async function imageFileToPng(file: Blob): Promise<{ png: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none" }).catch(() => { throw new Error("Could not read that file as an image."); });
  const { width, height } = bitmap;
  try {
    if (file.type === "image/png") return { png: file, width, height };
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    return { png: await canvas.convertToBlob({ type: "image/png" }), width, height };
  } finally { bitmap.close(); }
}

/**
 * A saved skin map's file as served, bypassing the HTTP cache: a merge rewrites the same path, so a
 * cached copy would show the replaced map.
 */
export async function fetchSkinMap(path: string): Promise<Blob> {
  const response = await fetch(skinMapUrl(path), { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.blob();
}
