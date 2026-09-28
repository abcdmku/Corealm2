import "./lib/repoContent.js";
import path from "node:path";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";
import { DEFAULT_WORLD_SEED } from "../game/src/app/worldSurface.js";
import {
  DETAIL_FILE_PATTERN, SOURCE_IMAGE_FILE, TILE_FILE_PATTERN, captureWorldMap, dataUrlBytes, mapLayoutFor, renderWorldMapFiles,
  type MapLayout, type MapMetadata, type MapTiledLevelMetadata,
} from "../game/src/world/worldMapRender.js";
import type {} from "./lib/debug-api.js";
import { gameRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";
import { sharpWorldMapCodec } from "./lib/worldMapSharp.js";


// A canonical building in every settlement must have real resident, drawable parts before capture.
// Source catalogue counts alone missed the settings callback unloading the three distant towns.
const SETTLEMENT_CAPTURE_REPRESENTATIVES = [
  { settlement: "Coldbrace", regionId: "fallowmarch", buildingId: "coldbrace_hall" },
  { settlement: "Rootfall", regionId: "vellenwood", buildingId: "rootfall_house_1" },
  { settlement: "Highcairn", regionId: "karrowmoor", buildingId: "highcairn_hut_1" },
  { settlement: "Emberfast", regionId: "kilnhalt", buildingId: "emberfast_hut_1" },
  { settlement: "Crownward", regionId: "crownward", buildingId: "crownward_white_castle" },
] as const;

const GPU_ARGS = [
  "--enable-unsafe-webgpu",
  "--use-angle=d3d11",
  "--enable-gpu",
  "--ignore-gpu-blocklist",
  "--disable-frame-rate-limit",
  "--disable-gpu-vsync",
  "--mute-audio",
];
const MAP_BOOT_TIMEOUT_MS = 300_000;

function buildMapLayout(): MapLayout {
  return mapLayoutFor(buildWorldTerrainSpec(), DEFAULT_WORLD_SEED);
}

/** A regrid or resized pyramid leaves unreferenced map files behind unless the bake removes them. */
async function removeStaleMapFiles(outputDir: string, keep: ReadonlySet<string>): Promise<void> {
  const existing = await readdir(outputDir).catch(() => [] as string[]);
  for (const file of existing) {
    if ((!TILE_FILE_PATTERN.test(file) && !DETAIL_FILE_PATTERN.test(file)) || keep.has(file)) continue;
    await rm(path.join(outputDir, file), { force: true });
  }
}

/**
 * Runtime projection of the tile ledger. `world-map.json` keeps the full record, including every
 * tile's pixel and world bounds; the browser only needs the grid plus per-tile identity and
 * re-derives the bounds from the grid, so the bundle does not carry 88 redundant rectangles.
 * The per-tile sha256 stays: it is the cache-busting query, and it is what makes a partially
 * rewritten bake detectable instead of silently mixed.
 */
function tiledLevelSource(levels: readonly MapTiledLevelMetadata[]): string {
  const newline = String.fromCharCode(10);
  const body = levels.map((level) => {
    const head: [string, string | number][] = [
      ["id", level.id],
      ["format", level.format],
      ["width", level.width],
      ["height", level.height],
      ["metresPerPixel", level.metresPerPixel],
      ["tilePixels", level.tilePixels],
      ["tileMetres", level.tileMetres],
      ["columns", level.columns],
      ["rows", level.rows],
      ["bytes", level.bytes],
    ];
    const fields = head
      .map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)},`)
      .join(newline);
    const tiles = level.tiles
      .map((tile) => `      ${JSON.stringify({
        column: tile.column,
        row: tile.row,
        path: tile.path,
        bytes: tile.bytes,
        sha256: tile.sha256,
      })},`)
      .join(newline);
    return [`  {`, fields, `    "tiles": [`, tiles, `    ],`, `  },`].join(newline);
  }).join(newline);
  return [`export const WORLD_MAP_TILED_LEVELS = [`, body, `] as const;`].join(newline);
}


/**
 * Writes the renditions, the lossless source and `world-map.json` under `outputDir`, and the
 * runtime fingerprint module under `generatedSourceDir`. The renditions come from the shared
 * pipeline (`game/src/world/worldMapRender.ts`) with the Sharp codec.
 */
export async function writeWorldMapArtifacts(
  layout: MapLayout,
  sourceImage: Buffer,
  outputDir = path.join(gameRoot, "public", "generated"),
  generatedSourceDir = path.join(gameRoot, "src", "generated"),
): Promise<MapMetadata> {
  const { files, metadata } = await renderWorldMapFiles(layout, sourceImage, sharpWorldMapCodec, { enforceBudgets: true });
  await Promise.all([
    mkdir(outputDir, { recursive: true }),
    mkdir(generatedSourceDir, { recursive: true }),
  ]);
  await writeFile(path.join(outputDir, SOURCE_IMAGE_FILE), sourceImage);
  for (const file of files) await writeFile(path.join(outputDir, file.name), file.bytes);
  const { minimap, detail, tiled } = metadata.renditions;
  await removeStaleMapFiles(
    outputDir,
    new Set([
      ...detail.map((rendition) => path.posix.basename(rendition.path)),
      ...tiled.flatMap((level) => level.tiles.map((tile) => path.posix.basename(tile.path))),
    ]),
  );
  const fingerprintSource = [
    "/** Generated by tools/generate-world-map.ts. Do not edit. */",
    `export const WORLD_MAP_SOURCE_SHA256 = ${JSON.stringify(metadata.sha256)};`,
    `export const WORLD_MAP_RENDITION_SET_FINGERPRINT = ${JSON.stringify(metadata.renderFingerprint)};`,
    "export const WORLD_MAP_RENDER_FINGERPRINT = WORLD_MAP_RENDITION_SET_FINGERPRINT;",
    `export const WORLD_MAP_IMAGE_BOUNDS = ${JSON.stringify(layout.imageBounds)} as const;`,
    `export const WORLD_MAP_PLAYABLE_BOUNDS = ${JSON.stringify(layout.playableBounds)} as const;`,
    `export const WORLD_MAP_MINIMAP_RENDITION = ${JSON.stringify(minimap, null, 2)} as const;`,
    `export const WORLD_MAP_DETAIL_RENDITIONS = ${JSON.stringify(detail, null, 2)} as const;`,
    tiledLevelSource(tiled),
    "",
  ].join("\n");
  await writeFile(path.join(generatedSourceDir, "worldMapFingerprint.ts"), fingerprintSource, "utf8");
  return metadata;
}

/** Rebuilds browser-ready renditions from the checked-in deterministic full-island capture. */
export async function postprocessExistingWorldMap(): Promise<MapMetadata> {
  const sourcePath = path.join(gameRoot, "public", "generated", SOURCE_IMAGE_FILE);
  return writeWorldMapArtifacts(buildMapLayout(), await readFile(sourcePath));
}

/**
 * Captures the actual Three scene in north-up orthographic tiles and stitches them into the map.
 * Nothing is reconstructed in Sharp: it only crops tile bleed, joins pixels, and compresses PNG.
 */
export async function generateWorldMap(): Promise<MapMetadata> {
  const layout = buildMapLayout();
  const { columns, rows } = layout.tiles;

  const server = await startGameServer({ logLevel: "error" });
  let browser: Browser | undefined;
  const errors: string[] = [];
  try {
    // Full Chromium's new headless mode supports the game's WebGPU renderer.
    // The separate headless shell can fall back to WebGL on Windows.
    browser = await chromium.launch({ channel: "chromium", headless: true, args: GPU_ARGS });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 1000)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 1000));
    });
    await page.routeWebSocket("**", () => undefined);
    const captureUrl = `${server.url}?world-map-capture=1`;
    console.log(`World-map boot starting (${MAP_BOOT_TIMEOUT_MS / 1000}s allowance): ${captureUrl}`);
    let startupFailure: unknown;
    try {
      await page.goto(captureUrl, { waitUntil: "load", timeout: MAP_BOOT_TIMEOUT_MS });
      await page.waitForFunction(
        () => window.__gameDebug?.getState().ready === true
          || document.querySelector(".boot-error") !== null,
        undefined,
        { timeout: MAP_BOOT_TIMEOUT_MS },
      );
    } catch (cause) {
      startupFailure = cause;
    }
    const boot = await page.evaluate(() => {
      const api = window.__gameDebug as unknown as {
        getState?: () => { ready?: boolean };
        getErrors?: () => unknown[];
      } | undefined;
      return {
        ready: api?.getState?.().ready === true,
        bootError: document.querySelector(".boot-error")?.textContent?.trim() ?? "",
        bodyText: document.body?.innerText?.trim().slice(0, 4_000) ?? "",
        gameErrors: api?.getErrors?.() ?? [],
      };
    });
    if (boot.gameErrors.length > 0) {
      errors.push(`Game debug errors: ${JSON.stringify(boot.gameErrors).slice(0, 2000)}`);
    }
    if (startupFailure || !boot.ready) {
      const failure = startupFailure instanceof Error ? startupFailure.message : String(startupFailure ?? "not ready");
      throw new Error([
        `World-map boot failed: ${failure}`,
        `Boot error: ${boot.bootError || "none"}`,
        `Browser errors: ${errors.length > 0 ? errors.join(" | ") : "none"}`,
        `Document body: ${boot.bodyText || "empty"}`,
      ].join("\n"));
    }
    console.log("World-map boot ready; full-residency capture can begin.");
    await page.waitForTimeout(250);

    const settlementPresence = await page.evaluate(async (representatives) => {
      const api = window.__gameDebug as unknown as {
        getEntities?: () => { id: string; regionId: string }[];
        getEntityViewStats?: () => {
          residency?: { fullResidency: boolean; residentIds: string[] };
        };
        getDrawnBounds?: (id: string) => {
          min: { x: number; y: number; z: number };
          max: { x: number; y: number; z: number };
          meshes: number;
          width: number;
          height: number;
        } | null;
      } | undefined;
      if (typeof api?.getEntities !== "function"
        || typeof api.getEntityViewStats !== "function"
        || typeof api.getDrawnBounds !== "function") {
        throw new Error("World-map capture needs entity residency and drawn-bounds debug state.");
      }
      const residency = api.getEntityViewStats().residency;
      if (residency?.fullResidency !== true || !Array.isArray(residency.residentIds)) {
        throw new Error("World-map capture requires full entity residency after graphics settings are applied.");
      }
      const residentIds = new Set(residency.residentIds);
      const entities = await api.getEntities();
      return representatives.map(({ settlement, regionId, buildingId }) => {
        // Buildings are emitted as individual #part entities, so their parent ID has no draw.
        const parts = entities.filter((entity) => entity.id.startsWith(`${buildingId}#`));
        if (parts.length === 0) {
          throw new Error(`World-map settlement guard: ${settlement} has no emitted parts for ${buildingId}.`);
        }
        const missing: string[] = [];
        let meshes = 0;
        for (const part of parts) {
          if (part.regionId !== regionId || !residentIds.has(part.id)) {
            missing.push(`${part.id}: not resident in ${regionId}`);
            continue;
          }
          const bounds = api.getDrawnBounds!(part.id);
          const finiteBounds = bounds && [
            bounds.min.x, bounds.min.y, bounds.min.z,
            bounds.max.x, bounds.max.y, bounds.max.z,
          ].every(Number.isFinite);
          const drawable = bounds && [bounds.meshes, bounds.width, bounds.height]
            .every((value) => Number.isFinite(value) && value > 0);
          if (!bounds || !finiteBounds || !drawable) {
            missing.push(`${part.id}: no drawable bounds`);
            continue;
          }
          meshes += bounds.meshes;
        }
        if (missing.length > 0) {
          throw new Error(
            `World-map settlement guard: ${settlement} is missing ${missing.length}/${parts.length} parts of ${buildingId}: `
              + missing.slice(0, 8).join("; "),
          );
        }
        return { settlement, regionId, buildingId, residentParts: parts.length, meshes };
      });
    }, SETTLEMENT_CAPTURE_REPRESENTATIVES);
    console.log(`World-map settlement presence: ${JSON.stringify(settlementPresence)}`);

    const image = await captureWorldMap(layout, sharpWorldMapCodec, async (request) => {
      const dataUrl = await page.evaluate((options) => {
        const api = window.__gameDebug as unknown as {
          captureWorldMapTile?: (value: typeof options) => string;
        } | undefined;
        if (typeof api?.captureWorldMapTile !== "function") {
          throw new Error("window.__gameDebug.captureWorldMapTile is unavailable");
        }
        return api.captureWorldMapTile(options);
      }, request);
      return dataUrlBytes(dataUrl);
    }, (done, total) => {
      if (done % columns === 0) {
        console.log(`World-map capture row ${done / columns}/${rows} complete (${done}/${total} tiles).`);
      }
    });

    if (errors.length > 0) throw new Error(`World-map browser capture failed:\n${errors.join("\n")}`);
    return writeWorldMapArtifacts(layout, image);
  } finally {
    await browser?.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  const postprocessOnly = process.argv.includes("--postprocess-existing");
  const metadata = postprocessOnly
    ? await postprocessExistingWorldMap()
    : await generateWorldMap();
  console.log(
    `${postprocessOnly ? "Postprocessed" : "Captured"} ${metadata.width}x${metadata.height} world map `
      + `(${metadata.tiles.columns}x${metadata.tiles.rows} capture tiles; `
      + `${metadata.renditions.detail.length} flat levels; `
      + metadata.renditions.tiled
        .map((level) => `${level.id} ${level.columns}x${level.rows} @ ${level.tilePixels}px = ${level.bytes} B`)
        .join(", ")
      + ").",
  );
}
