import { RESOLVED_CATALOG } from "../../../../game/src/content/resolvedCatalog.js";
import type { MapCaptureMessage } from "../../../../game/src/app/worldMapCaptureHost.js";
import {
  captureWorldMap, dataUrlBytes, mapLayoutOf, renderWorldMapFiles, type MapCaptureRequest, type MapMetadata,
} from "../../../../game/src/world/worldMapRender.js";
import { backend } from "../../api/backend.js";
import { readDescriptor, readSession } from "../../api/session.js";
import { gameUrl } from "../../model/gameUrl.js";
import { canvasWorldMapCodec } from "./mapCodec.js";

/*
  Render map: re-render a live server's world map after it baked a new world, in the admin's own
  browser, with the pipeline the repository tool runs (`game/src/world/worldMapRender.ts`).

  A server has no GPU to render with and no browser to boot the game in, and the map is the real
  game scene. The admin's browser has both. So devdocs frames the game from the world's asset host
  as a capture page, hands it the server's compiled catalog and file store (the page boots exactly
  the world a player reloading onto the server boots), asks it for each tile, stitches and encodes
  the renditions here, and stores them in the server's file store under the build's
  `generated/world-map*` paths, `world-map.json` last so no reader ever sees it name a missing file.
*/

export type RenderMapPhase = "loading" | "capturing" | "encoding" | "uploading" | "done";
export interface RenderMapProgress { phase: RenderMapPhase; done: number; total: number }

/** One `putFiles` request's worth of base64. The server takes 64 MiB bodies. */
const UPLOAD_BATCH_CHARS = 12 * 1024 * 1024;
const BOOT_TIMEOUT_MS = 600_000;
const TILE_TIMEOUT_MS = 60_000;

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/** The game page on the world's asset host, asked to capture for its parent. */
export async function capturePageUrl(): Promise<string> {
  const session = readSession();
  if (!session) throw new Error("Sign in to the server first.");
  const { assetBaseUrl } = await readDescriptor(session.server);
  if (!assetBaseUrl) throw new Error("This server names no asset host, so there is no game page to render its world with.");
  const url = new URL("index.html", assetBaseUrl.replace(/\/*$/, "/"));
  url.searchParams.set("world-map-capture", "1");
  url.searchParams.set("map-host", "1");
  return url.href;
}

/** Talks to the framed capture page: hands it the world, then asks it for tiles one at a time. */
function capturePage(frame: HTMLIFrameElement, world: Extract<MapCaptureMessage, { type: "corealm-map:world" }>, signal: AbortSignal) {
  let next = 0;
  const pending = new Map<number, { resolve: (dataUrl: string) => void; reject: (error: Error) => void }>();
  let settleBoot: { resolve: () => void; reject: (error: Error) => void } | undefined;
  const booted = new Promise<void>((resolve, reject) => { settleBoot = { resolve, reject }; });
  const origin = new URL(frame.src).origin;
  const listen = (event: MessageEvent): void => {
    if (event.source !== frame.contentWindow || event.origin !== origin) return;
    const data = event.data as MapCaptureMessage | null;
    if (data?.type === "corealm-map:hello") frame.contentWindow!.postMessage(world, origin);
    else if (data?.type === "corealm-map:ready") settleBoot?.resolve();
    else if (data?.type === "corealm-map:failed") settleBoot?.reject(new Error(`The capture page could not boot the server's world: ${data.message}`));
    else if (data?.type === "corealm-map:tile") {
      const waiting = pending.get(data.id);
      pending.delete(data.id);
      if (data.dataUrl) waiting?.resolve(data.dataUrl);
      else waiting?.reject(new Error(data.error ?? "The capture page returned no tile."));
    }
  };
  window.addEventListener("message", listen);
  const stop = (): void => {
    window.removeEventListener("message", listen);
    const error = new Error("Rendering stopped.");
    settleBoot?.reject(error);
    for (const waiting of pending.values()) waiting.reject(error);
    pending.clear();
  };
  signal.addEventListener("abort", stop, { once: true });
  return {
    ready: () => withTimeout(booted, BOOT_TIMEOUT_MS, "The capture page did not finish loading the world in ten minutes."),
    capture: (request: MapCaptureRequest) => withTimeout(new Promise<string>((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      frame.contentWindow!.postMessage({ type: "corealm-map:capture", id, request } satisfies MapCaptureMessage, origin);
    }), TILE_TIMEOUT_MS, "The capture page stopped answering."),
    stop,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })])
    .finally(() => clearTimeout(timer));
}

/**
 * Renders the running world's map through `frame` (already in the document, not yet loaded) and
 * stores it on the server. `worldRevision` is the geometry the server runs, from its world status.
 */
export async function renderServerWorldMap(options: {
  frame: HTMLIFrameElement;
  worldRevision: string;
  signal: AbortSignal;
  progress: (progress: RenderMapProgress) => void;
}): Promise<MapMetadata> {
  const { frame, worldRevision, signal, progress } = options;
  const session = readSession();
  if (!session) throw new Error("Sign in to the server first.");
  // The frame the build's map was drawn in: every consumer's bounds and tile grid stay valid.
  const buildMap = await fetch(gameUrl("generated/world-map.json"), { credentials: "omit" });
  if (!buildMap.ok) throw new Error(`The build's world map description could not be read (${buildMap.status}).`);
  const layout = mapLayoutOf(await buildMap.json() as MapMetadata);

  progress({ phase: "loading", done: 0, total: 1 });
  frame.src = await capturePageUrl();
  const page = capturePage(frame, {
    type: "corealm-map:world",
    catalog: { version: 1, revision: RESOLVED_CATALOG.revision, formulaRevision: RESOLVED_CATALOG.formulaRevision, tables: RESOLVED_CATALOG.tables as Record<string, unknown> },
    contentAssetUrl: `${session.server}/content-assets/`,
    worldRevision,
  }, signal);
  try {
    await page.ready();
    const source = await captureWorldMap(layout, canvasWorldMapCodec, async request => {
      signal.throwIfAborted();
      return dataUrlBytes(await page.capture(request));
    }, (done, total) => progress({ phase: "capturing", done, total }));
    page.stop();
    frame.removeAttribute("src");

    const { files, metadata } = await renderWorldMapFiles(layout, source, canvasWorldMapCodec, {
      enforceBudgets: false, worldRevision,
      progress: (done, total) => { progress({ phase: "encoding", done, total }); },
    });
    signal.throwIfAborted();

    // Renditions first, in batches; `world-map.json` alone and last.
    const batches: Record<string, string>[] = [];
    let batch: Record<string, string> = {}, size = 0;
    for (const file of files.filter(file => file.name !== "world-map.json")) {
      const encoded = base64(file.bytes);
      if (size && size + encoded.length > UPLOAD_BATCH_CHARS) { batches.push(batch); batch = {}; size = 0; }
      batch[`generated/${file.name}`] = encoded;
      size += encoded.length;
    }
    if (size) batches.push(batch);
    const json = files.find(file => file.name === "world-map.json")!;
    batches.push({ "generated/world-map.json": base64(json.bytes) });
    for (const [index, files] of batches.entries()) {
      signal.throwIfAborted();
      progress({ phase: "uploading", done: index, total: batches.length });
      await backend().putFiles(files);
    }
    progress({ phase: "done", done: batches.length, total: batches.length });
    return metadata;
  } finally {
    page.stop();
  }
}
