/*
  The creature skin surfaces the Art view talks to: the `creatureSkins` collection (read through the
  normal collection query), the devdocs skin and imagegen routes (`shared/skinContracts.ts`), and the
  canvas work that turns albedo maps into a recolored PNG. A route that is not there yet (404, 501 or
  the SPA's HTML fallback) throws `SkinApiUnavailable`, so the page can say so inline.
*/
import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collectionQuery } from "../../../api/client.js";
import { gameUrl } from "../../../model/gameUrl.js";
import { contentRows } from "../../../model/rows.js";
import { albedoMaps, type AlbedoMap } from "../../../viewer/albedo.js";
import type { CreatureSkin, ImagegenJob, ImagegenRequest, PngBase64, SaveSkinRequest, SaveSkinResponse } from "../../../../shared/skinContracts.js";
import { recolorPixels, type RecolorParams } from "./recolor.js";
import { refreshGameCatalog } from "../../../model/liveCatalog.js";

export type { CreatureSkin, ImagegenJob };

export class SkinApiUnavailable extends Error {
  constructor(what: string) { super(`${what} is not available on this devdocs server yet.`); this.name = "SkinApiUnavailable"; }
}

async function devdocsJson<T>(path: string, what: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/__devdocs/${path}`, { ...init, headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
  const json = (response.headers.get("content-type") ?? "").includes("json");
  if (response.status === 404 || response.status === 501 || (response.ok && !json)) throw new SkinApiUnavailable(what);
  const body = json ? await response.json().catch(() => ({})) as T & { error?: string } : {} as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `${what} failed (${response.status})`);
  return body;
}

/** Save a skin, then adopt the recompiled catalog so the stage can wear it at once. */
export async function saveSkin(request: SaveSkinRequest): Promise<SaveSkinResponse> {
  const saved = await devdocsJson<SaveSkinResponse>("skins", "Saving skins", { method: "POST", body: JSON.stringify(request) });
  await refreshGameCatalog();
  return saved;
}
export const startImagegen = (request: ImagegenRequest) => devdocsJson<{ job: ImagegenJob }>("imagegen", "Image generation", { method: "POST", body: JSON.stringify(request) });
/** Retry a failed job; maps it already painted are reused. */
export const retryImagegen = (jobId: string) => devdocsJson<{ job: ImagegenJob }>(`imagegen/${encodeURIComponent(jobId)}`, "Retrying image generation", { method: "POST" });

/** Where a skin map is served: skins live under `game/public/assets/`. */
export const skinMapUrl = (path: string): string => gameUrl(`assets/${path}`);

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
 * when a job finishes the skins list is refetched so its skin shows up.
 */
export function useImagegenJobs(assetId: string): { jobs: ImagegenJob[]; allJobs: ImagegenJob[]; unavailable: boolean; error?: string; refresh: () => void } {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["imagegen-jobs"],
    queryFn: () => devdocsJson<{ jobs: ImagegenJob[] }>("imagegen", "Image generation"),
    retry: false, refetchOnWindowFocus: false,
    refetchInterval: current => current.state.data?.jobs.some(isActiveJob) ? 3000 : false,
  });
  const allJobs = useMemo(() => query.data?.jobs ?? [], [query.data]);
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
  const unavailable = query.error instanceof SkinApiUnavailable;
  return { jobs, allJobs, unavailable, error: query.isError && !unavailable ? query.error.message : undefined, refresh: () => void query.refetch() };
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
