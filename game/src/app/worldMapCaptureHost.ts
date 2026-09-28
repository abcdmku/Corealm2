import { installCatalog, type InstalledCatalog } from "../content/catalogInstall.js";
import { fetchContentAssetIndex, setContentAssetOverlay, setServerWorld } from "./config.js";
import type { MapCaptureRequest } from "../world/worldMapRender.js";

/**
 * A map capture page another page drives: devdocs' Render map action frames the game at
 * `?world-map-capture=1&map-host=1` and captures a live server's baked world through it.
 *
 * The framing page hands over the world before boot (the server's compiled catalog, its file store
 * and the geometry revision it runs), the entry installs it exactly as it installs a server world a
 * player reloads onto, and once the scene is up each capture request is answered with
 * `__gameDebug.captureWorldMapTile`, the call `tools/generate-world-map.ts` makes through Playwright.
 *
 * The page only renders what it is handed and answers its own parent. A page that frames it learns
 * nothing it did not send; this module evaluates no content, so the entry can import it statically.
 */

export const MAP_CAPTURE_HOST_PARAM = "map-host";

export type MapCaptureMessage =
  /** Page to parent: loaded, waiting for the world. */
  | { type: "corealm-map:hello" }
  /** Parent to page: the world to boot. `contentAssetUrl` ends in a slash. */
  | { type: "corealm-map:world"; catalog: InstalledCatalog; contentAssetUrl: string; worldRevision: string }
  /** Page to parent: the scene is ready to capture, or boot failed. */
  | { type: "corealm-map:ready" }
  | { type: "corealm-map:failed"; message: string }
  /** Parent to page: one tile. The answer carries the same `id`. */
  | { type: "corealm-map:capture"; id: number; request: MapCaptureRequest }
  | { type: "corealm-map:tile"; id: number; dataUrl?: string; error?: string };

/** True on a capture page a parent drives. */
export function mapCaptureHosted(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.get("world-map-capture") === "1" && params.get(MAP_CAPTURE_HOST_PARAM) === "1" && typeof window !== "undefined" && window.parent !== window;
}

function post(message: MapCaptureMessage): void {
  window.parent.postMessage(message, "*");
}

/**
 * Asks the parent for its world, installs it and starts answering captures once the scene is
 * ready. Resolves with the installed catalog's revision.
 */
export async function installHostedCaptureWorld(fetcher: typeof fetch = fetch): Promise<string> {
  const world = await new Promise<Extract<MapCaptureMessage, { type: "corealm-map:world" }>>((resolve) => {
    const listen = (event: MessageEvent): void => {
      const data = event.data as MapCaptureMessage | null;
      if (event.source !== window.parent || data?.type !== "corealm-map:world") return;
      window.removeEventListener("message", listen);
      resolve(data);
    };
    window.addEventListener("message", listen);
    post({ type: "corealm-map:hello" });
  });
  try {
    const files = await fetchContentAssetIndex(world.contentAssetUrl, fetcher);
    installCatalog(world.catalog);
    setContentAssetOverlay({ base: world.contentAssetUrl, files });
    setServerWorld({ revision: world.worldRevision, contentAssetUrl: world.contentAssetUrl });
  } catch (error) {
    post({ type: "corealm-map:failed", message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  answerCaptures();
  return world.catalog.revision;
}

interface CaptureDebug {
  getState?: () => { ready?: boolean };
  captureWorldMapTile?: (request: MapCaptureRequest) => string;
}

function answerCaptures(): void {
  const debug = (): CaptureDebug | undefined => (window as { __gameDebug?: CaptureDebug }).__gameDebug;
  const started = performance.now();
  const wait = (): void => {
    const failed = document.querySelector(".boot-error")?.textContent?.trim();
    if (failed) { post({ type: "corealm-map:failed", message: failed }); return; }
    if (debug()?.getState?.().ready === true) { post({ type: "corealm-map:ready" }); return; }
    if (performance.now() - started > 600_000) { post({ type: "corealm-map:failed", message: "The world did not finish loading in ten minutes." }); return; }
    window.setTimeout(wait, 250);
  };
  wait();
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as MapCaptureMessage | null;
    if (event.source !== window.parent || data?.type !== "corealm-map:capture") return;
    try {
      const capture = debug()?.captureWorldMapTile;
      if (typeof capture !== "function") throw new Error("This page cannot capture map tiles.");
      post({ type: "corealm-map:tile", id: data.id, dataUrl: capture(data.request) });
    } catch (error) {
      post({ type: "corealm-map:tile", id: data.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
