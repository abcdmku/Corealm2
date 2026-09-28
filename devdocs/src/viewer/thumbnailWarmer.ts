/**
 * Keeps a live server's creature thumbnails current without anyone scrolling to them.
 *
 * A server cannot render (no GPU, no browser), so an author's admin page does it: shortly after it
 * opens and again after every catalog it adopts (a publish from devdocs or the API, a base update, a
 * rollback), it renders each creature whose thumbnail is neither shipped with the build nor in the
 * server's store yet, and the renderer keeps it there. Renders take turns, wait for idle time and
 * pause while the tab is hidden, so the page stays responsive; a second trigger during a pass runs
 * one more pass after it instead of overlapping.
 */
import { creatureThumbnailKey } from "./thumbnailKeys.js";
import type { ThumbnailProvider } from "../ui/assetThumbnails.js";

export interface ThumbnailWarmerPorts {
  provide: ThumbnailProvider;
  /** Creature definition ids in the catalog the page runs now. */
  creatureIds(): readonly string[];
  cacheKey(assetId: string): Promise<string | undefined>;
  missing(key: string): Promise<boolean>;
  /** Resolves when the page is visible (a hidden tab should not spend GPU time). */
  visible?(): Promise<void>;
  log?(message: string): void;
}

export interface ThumbnailWarmer {
  /** Run a pass soon; coalesces with a pass already waiting or running. */
  schedule(delayMs?: number): void;
  /** Resolves when no pass is running or waiting. */
  idle(): Promise<void>;
  /** What the last pass did, for diagnostics. */
  readonly status: { passes: number; rendered: number; checked: number; running: boolean };
}

export function createThumbnailWarmer(ports: ThumbnailWarmerPorts): ThumbnailWarmer {
  const status = { passes: 0, rendered: 0, checked: 0, running: false };
  let again = false, timer: ReturnType<typeof setTimeout> | undefined, current: Promise<void> = Promise.resolve();

  async function pass(): Promise<void> {
    status.running = true; status.passes++; status.rendered = 0; status.checked = 0;
    try {
      for (const creatureId of ports.creatureIds()) {
        await ports.visible?.();
        const assetId = creatureThumbnailKey(creatureId);
        const key = await ports.cacheKey(assetId).catch(() => undefined);
        status.checked++;
        if (!key || !(await ports.missing(key).catch(() => false))) continue;
        if (await ports.provide(assetId).catch(() => undefined)) status.rendered++;
      }
      if (status.rendered) ports.log?.(`Prepared ${status.rendered} creature thumbnail${status.rendered === 1 ? "" : "s"} for this server.`);
    } finally { status.running = false; }
  }

  function run(): void {
    timer = undefined;
    if (status.running) { again = true; return; }
    current = pass().then(() => { if (again) { again = false; run(); return current; } });
  }

  return {
    schedule(delayMs = 2000) {
      if (status.running) { again = true; return; }
      if (timer === undefined) timer = setTimeout(run, delayMs);
    },
    async idle() {
      for (;;) {
        const waiting = current;
        await waiting;
        if (timer === undefined && !status.running && waiting === current) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    },
    status,
  };
}

/** Resolves once the document is visible. */
export function documentVisible(): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState !== "hidden") return Promise.resolve();
  return new Promise(resolve => {
    const onChange = () => { if (document.visibilityState !== "hidden") { document.removeEventListener("visibilitychange", onChange); resolve(); } };
    document.addEventListener("visibilitychange", onChange);
  });
}

/**
 * Starts the warmer for a live server's admin: a first pass a few seconds after the page opens, and
 * one after every catalog the page adopts. Only where renders can be kept on the server (`files`).
 */
export async function startServerThumbnailWarmer(provide: ThumbnailProvider): Promise<ThumbnailWarmer> {
  const [{ thumbnailCacheKey, thumbnailMissing }, { onGameCatalog }, { RESOLVED_TABLES }] = await Promise.all([
    import("./thumbnailRenderer.js"), import("../model/liveCatalog.js"), import("../../../game/src/content/resolvedCatalog.js"),
  ]);
  const warmer = createThumbnailWarmer({
    provide, cacheKey: thumbnailCacheKey, missing: thumbnailMissing, visible: documentVisible,
    creatureIds: () => ((RESOLVED_TABLES.creatureDefinitions ?? []) as { id: string; retired?: boolean }[]).filter(row => !row.retired).map(row => row.id),
    log: message => console.info(`[devdocs] ${message}`),
  });
  onGameCatalog(() => warmer.schedule());
  warmer.schedule(5000);
  (globalThis as { __corealmThumbnailWarmer?: ThumbnailWarmer }).__corealmThumbnailWarmer = warmer;
  return warmer;
}
