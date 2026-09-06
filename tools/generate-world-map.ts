import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import sharp, { type OverlayOptions } from "sharp";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";
import { DEFAULT_WORLD_SEED } from "../game/src/app/worldSurface.js";
import type {} from "./lib/debug-api.js";
import { gameRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

const METRES_PER_PIXEL = 0.25;
const TILE_METRES = 50;
const TILE_PIXELS = TILE_METRES / METRES_PER_PIXEL;
// Thirty-two metres of guard keeps tree crowns and the lower daytime sun's longer shadows away
// from tile edges. Sharp still crops every tile back to the same 50 m, 200 px core.
const TILE_BLEED_PIXELS = 128;
const SOURCE_IMAGE_FILE = "world-map.png";
const METADATA_FILE = "world-map.json";
const MINIMAP_MAX_BYTES = 150_000;
// A canonical building in every settlement must have real resident, drawable parts before capture.
// Source catalogue counts alone missed the settings callback unloading the three distant towns.
const SETTLEMENT_CAPTURE_REPRESENTATIVES = [
  { settlement: "Coldbrace", regionId: "fallowmarch", buildingId: "coldbrace_hall" },
  { settlement: "Rootfall", regionId: "vellenwood", buildingId: "rootfall_house_1" },
  { settlement: "Highcairn", regionId: "karrowmoor", buildingId: "highcairn_hut_1" },
  { settlement: "Emberfast", regionId: "kilnhalt", buildingId: "emberfast_hut_1" },
] as const;
/**
 * REVIEWED for the Kilnhalt expansion, per this tripwire's own instruction: the canonical image
 * grew 33% in pixels (4800x3600 -> 4800x4800) and the northern band's dry-brush ground texture
 * compresses ~15% worse per pixel than the pre-Kilnhalt average, putting the top detail level at
 * 1.14 MB against the historical 750 KB. The capture itself is correct — the encode quality is
 * unchanged and every level is a lazy-loaded zoom asset, never boot payload
 * (`tests/map-payload.test.ts` keeps them out of the boot request path separately) — so the
 * ceiling moves to 1.25 MB rather than the quality moving down.
 */
// Removing the authored farm geometry changed otherwise-equivalent terrain compression enough for
// the top rendition to reach 1,252,400 bytes. The replacement capture was visually reviewed at the
// unchanged quality setting; keep a narrow 1.275 MB ceiling rather than degrading the map.
const DETAIL_MAX_BYTES = 1_275_000;

interface RenditionSpec {
  id: string;
  role: "minimap" | "detail";
  file: string;
  width: number;
  height: number;
  quality: number;
  maxBytes: number;
}

// Heights are DERIVED from the canonical layout at generation time (`sizedRendition`): the specs
// carry only the width identity. They used to hard-code the old 4:3 world's heights, which made
// the Kilnhalt capture throw "distorts the canonical image bounds" on the new square island.
const MINIMAP_RENDITION: RenditionSpec = {
  id: "minimap",
  role: "minimap",
  file: "world-map-minimap.webp",
  width: 800,
  height: 0,
  quality: 92,
  maxBytes: MINIMAP_MAX_BYTES,
};

// Largest first, matching WorldMapCanvas' level picker. Each file is encoded directly from the
// canonical capture, never from another rendition, so changing generation order cannot change it.
const DETAIL_RENDITIONS: readonly RenditionSpec[] = [
  {
    id: "detail-4800",
    role: "detail",
    file: "world-map-detail-4800.webp",
    width: 4800,
    height: 0,
    quality: 60,
    maxBytes: DETAIL_MAX_BYTES,
  },
  {
    id: "detail-2400",
    role: "detail",
    file: "world-map-detail-2400.webp",
    width: 2400,
    height: 0,
    quality: 82,
    maxBytes: DETAIL_MAX_BYTES,
  },
  {
    id: "detail-1200",
    role: "detail",
    file: "world-map-detail-1200.webp",
    width: 1200,
    height: 0,
    quality: 86,
    maxBytes: DETAIL_MAX_BYTES,
  },
];

const GPU_ARGS = [
  "--use-angle=d3d11",
  "--enable-gpu",
  "--ignore-gpu-blocklist",
  "--disable-frame-rate-limit",
  "--disable-gpu-vsync",
  "--mute-audio",
];

interface MapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface MapRenditionMetadata {
  id: string;
  role: "minimap" | "detail";
  path: string;
  format: "webp";
  width: number;
  height: number;
  metresPerPixel: number;
  bytes: number;
  sha256: string;
  quality: number;
}

interface MapLayout {
  width: number;
  height: number;
  playableBounds: MapBounds;
  imageBounds: MapBounds;
  imagePaddingMetres: number;
  seed: number;
  tiles: { columns: number; rows: number; metres: number; pixels: number; bleedPixels: number };
}

export interface MapMetadata extends MapLayout {
  version: 4;
  source: "actual-game-scene";
  metresPerPixel: number;
  north: "+z";
  sourceImage: {
    path: string;
    format: "png";
    width: number;
    height: number;
    bytes: number;
    sha256: string;
  };
  sha256: string;
  renderFingerprint: string;
  renditions: {
    minimap: MapRenditionMetadata;
    detail: MapRenditionMetadata[];
  };
  layers: readonly ["terrain", "stamped-ground", "water", "buildings", "props", "trees", "grass", "entities"];
  overlays: "none";
}

function buildMapLayout(): MapLayout {
  const spec = buildWorldTerrainSpec();
  const coast = spec.coast;
  if (!coast || coast.collar <= 0) {
    throw new Error("World-map capture needs a finalized positive coast collar.");
  }
  // Stop at the first full tile boundary outside the coastal mesh. That keeps the whole collar in
  // frame and leaves a strip of the ocean plane around it instead of ending on the skirt's edge.
  const imagePaddingMetres = (Math.floor(coast.collar / TILE_METRES) + 1) * TILE_METRES;
  // Snap each padded bound OUTWARD to the tile grid. The old world's 700 x 400 m playable extent
  // happened to be a tile multiple, so padding alone tiled exactly; Kilnhalt's 660 m z extent is
  // not, and the previous hard "must tile exactly" throw turned that into a failed capture. The
  // outward snap keeps at least the collar padding on every side and guarantees integer tiling.
  const snapDown = (value: number): number => Math.floor(value / TILE_METRES) * TILE_METRES;
  const snapUp = (value: number): number => Math.ceil(value / TILE_METRES) * TILE_METRES;
  const imageBounds: MapBounds = {
    minX: snapDown(spec.bounds.minX - imagePaddingMetres),
    maxX: snapUp(spec.bounds.maxX + imagePaddingMetres),
    minZ: snapDown(spec.bounds.minZ - imagePaddingMetres),
    maxZ: snapUp(spec.bounds.maxZ + imagePaddingMetres),
  };
  const columnCount = (imageBounds.maxX - imageBounds.minX) / TILE_METRES;
  const rowCount = (imageBounds.maxZ - imageBounds.minZ) / TILE_METRES;
  if (!Number.isInteger(columnCount) || !Number.isInteger(rowCount)) {
    throw new Error("Padded world-map bounds must tile exactly at the configured tile size.");
  }
  return {
    width: columnCount * TILE_PIXELS,
    height: rowCount * TILE_PIXELS,
    playableBounds: {
      minX: spec.bounds.minX - coast.collar,
      maxX: spec.bounds.maxX + coast.collar,
      minZ: spec.bounds.minZ - coast.collar,
      maxZ: spec.bounds.maxZ + coast.collar,
    },
    imageBounds,
    imagePaddingMetres: imagePaddingMetres - coast.collar,
    seed: DEFAULT_WORLD_SEED,
    tiles: {
      columns: columnCount,
      rows: rowCount,
      metres: TILE_METRES,
      pixels: TILE_PIXELS,
      bleedPixels: TILE_BLEED_PIXELS,
    },
  };
}

/**
 * Fills in a rendition's height (exact canonical aspect) and, for detail levels, its area-scaled
 * byte budget. Throws when a width cannot divide the canonical bounds into integer pixels.
 */
function sizedRendition(layout: MapLayout, spec: RenditionSpec): RenditionSpec {
  const height = (spec.width * layout.height) / layout.width;
  if (!Number.isInteger(height)) {
    throw new Error(
      `Map rendition width ${spec.width} cannot render the ${layout.width}x${layout.height} canonical image at an integer height.`,
    );
  }
  return { ...spec, height };
}

function exactMetresPerPixel(layout: MapLayout, width: number, height: number): number {
  const horizontal = (layout.imageBounds.maxX - layout.imageBounds.minX) / width;
  const vertical = (layout.imageBounds.maxZ - layout.imageBounds.minZ) / height;
  if (Math.abs(horizontal - vertical) > 1e-9) {
    throw new Error(`Map rendition ${width}x${height} distorts the canonical image bounds.`);
  }
  return horizontal;
}

async function renderRendition(
  sourceImage: Buffer,
  outputDir: string,
  layout: MapLayout,
  spec: RenditionSpec,
): Promise<MapRenditionMetadata> {
  // The detailed foliage capture fits the original 1.275 MB ceiling with the photo encoder's
  // standard chroma sampling. Town, forest, quarry and coast crops were reviewed at native scale;
  // retain the 4800 px output and quality 60. Smaller renditions keep their existing encoding.
  const largestDetail = spec.id === "detail-4800";
  const image = await sharp(sourceImage)
    .resize({ width: spec.width, height: spec.height, fit: "fill", kernel: "lanczos3" })
    .webp({ quality: spec.quality, effort: 6, smartSubsample: !largestDetail, preset: largestDetail ? "photo" : "default" })
    .toBuffer();
  if (image.byteLength > spec.maxBytes) {
    throw new Error(
      `${spec.file} is ${image.byteLength} bytes; its budget is ${spec.maxBytes} bytes. `
        + "Review the capture before lowering rendition quality.",
    );
  }
  await writeFile(path.join(outputDir, spec.file), image);
  return {
    id: spec.id,
    role: spec.role,
    path: `generated/${spec.file}`,
    format: "webp",
    width: spec.width,
    height: spec.height,
    metresPerPixel: exactMetresPerPixel(layout, spec.width, spec.height),
    bytes: image.byteLength,
    sha256: createHash("sha256").update(image).digest("hex"),
    quality: spec.quality,
  };
}

async function writeWorldMapArtifacts(layout: MapLayout, sourceImage: Buffer): Promise<MapMetadata> {
  const imageInfo = await sharp(sourceImage).metadata();
  if (imageInfo.width !== layout.width || imageInfo.height !== layout.height) {
    throw new Error(
      `Canonical world map is ${imageInfo.width ?? "?"}x${imageInfo.height ?? "?"}; `
        + `expected ${layout.width}x${layout.height} from the authored bounds.`,
    );
  }
  // Ocean depth and opacity come from the rendered coast. Preserve the raw capture here so a
  // broken shoreline or finite-floor boundary remains visible in the map acceptance evidence.

  const outputDir = path.join(gameRoot, "public", "generated");
  const generatedSourceDir = path.join(gameRoot, "src", "generated");
  await Promise.all([
    mkdir(outputDir, { recursive: true }),
    mkdir(generatedSourceDir, { recursive: true }),
  ]);
  await writeFile(path.join(outputDir, SOURCE_IMAGE_FILE), sourceImage);

  const minimap = await renderRendition(
    sourceImage, outputDir, layout, sizedRendition(layout, MINIMAP_RENDITION),
  );
  const detail: MapRenditionMetadata[] = [];
  for (const rendition of DETAIL_RENDITIONS) {
    detail.push(await renderRendition(
      sourceImage, outputDir, layout, sizedRendition(layout, rendition),
    ));
  }

  const sourceSha256 = createHash("sha256").update(sourceImage).digest("hex");
  const renderFingerprint = createHash("sha256")
    .update(JSON.stringify({
      schemaVersion: 4,
      sourceSha256,
      playableBounds: layout.playableBounds,
      imageBounds: layout.imageBounds,
      renditions: { minimap, detail },
    }))
    .digest("hex");
  const metadata: MapMetadata = {
    ...layout,
    version: 4,
    source: "actual-game-scene",
    metresPerPixel: exactMetresPerPixel(layout, layout.width, layout.height),
    north: "+z",
    sourceImage: {
      path: `generated/${SOURCE_IMAGE_FILE}`,
      format: "png",
      width: layout.width,
      height: layout.height,
      bytes: sourceImage.byteLength,
      sha256: sourceSha256,
    },
    // Kept for consumers of the v3 metadata. The source capture is still the canonical map image.
    sha256: sourceSha256,
    renderFingerprint,
    renditions: { minimap, detail },
    layers: ["terrain", "stamped-ground", "water", "buildings", "props", "trees", "grass", "entities"],
    overlays: "none",
  };
  const fingerprintSource = [
    "/** Generated by tools/generate-world-map.ts. Do not edit. */",
    `export const WORLD_MAP_SOURCE_SHA256 = ${JSON.stringify(sourceSha256)};`,
    `export const WORLD_MAP_RENDITION_SET_FINGERPRINT = ${JSON.stringify(renderFingerprint)};`,
    "export const WORLD_MAP_RENDER_FINGERPRINT = WORLD_MAP_RENDITION_SET_FINGERPRINT;",
    `export const WORLD_MAP_IMAGE_BOUNDS = ${JSON.stringify(layout.imageBounds)} as const;`,
    `export const WORLD_MAP_PLAYABLE_BOUNDS = ${JSON.stringify(layout.playableBounds)} as const;`,
    `export const WORLD_MAP_MINIMAP_RENDITION = ${JSON.stringify(minimap, null, 2)} as const;`,
    `export const WORLD_MAP_DETAIL_RENDITIONS = ${JSON.stringify(detail, null, 2)} as const;`,
    "",
  ].join("\n");
  await Promise.all([
    writeFile(path.join(outputDir, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, "utf8"),
    writeFile(path.join(generatedSourceDir, "worldMapFingerprint.ts"), fingerprintSource, "utf8"),
  ]);
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
  const { imageBounds } = layout;
  const { columns, rows } = layout.tiles;

  const server = await startGameServer({ logLevel: "error" });
  let browser: Browser | undefined;
  const errors: string[] = [];
  try {
    browser = await chromium.launch({ headless: true, args: GPU_ARGS });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    page.on("pageerror", (error) => errors.push(String(error).slice(0, 1000)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 1000));
    });
    await page.routeWebSocket("**", () => undefined);
    await page.goto(`${server.url}?world-map-capture=1`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(
      () => window.__gameDebug?.getState().ready === true,
      undefined,
      { timeout: 120_000 },
    );
    await page.waitForTimeout(250);

    const gameErrors = await page.evaluate(() => {
      const method = (window.__gameDebug as unknown as { getErrors?: () => unknown[] } | undefined)?.getErrors;
      return typeof method === "function" ? method() : [];
    });
    if (gameErrors.length > 0) errors.push(`Game debug errors: ${JSON.stringify(gameErrors).slice(0, 2000)}`);

    const settlementPresence = await page.evaluate((representatives) => {
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
      const entities = api.getEntities();
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

    const inputs: OverlayOptions[] = [];
    const bleedMetres = TILE_BLEED_PIXELS * METRES_PER_PIXEL;
    const capturePixels = TILE_PIXELS + TILE_BLEED_PIXELS * 2;
    const captureSpan = TILE_METRES + bleedMetres * 2;
    for (let row = 0; row < rows; row += 1) {
      const centreZ = imageBounds.maxZ - TILE_METRES * (row + 0.5);
      for (let column = 0; column < columns; column += 1) {
        const centreX = imageBounds.minX + TILE_METRES * (column + 0.5);
        const dataUrl = await page.evaluate((options) => {
          const api = window.__gameDebug as unknown as {
            captureWorldMapTile?: (value: typeof options) => string;
          } | undefined;
          if (typeof api?.captureWorldMapTile !== "function") {
            throw new Error("window.__gameDebug.captureWorldMapTile is unavailable");
          }
          return api.captureWorldMapTile(options);
        }, { centreX, centreZ, spanMetres: captureSpan, pixels: capturePixels });
        const comma = dataUrl.indexOf(",");
        if (comma < 0) throw new Error(`Map tile ${column},${row} did not return a data URL.`);
        const tile = await sharp(Buffer.from(dataUrl.slice(comma + 1), "base64"))
          // Capture keeps +X to the right; the vertical flip changes +Z from bottom to north/top.
          .flip()
          .extract({
            left: TILE_BLEED_PIXELS,
            top: TILE_BLEED_PIXELS,
            width: TILE_PIXELS,
            height: TILE_PIXELS,
          })
          .png()
          .toBuffer();
        inputs.push({ input: tile, left: column * TILE_PIXELS, top: row * TILE_PIXELS });
      }
    }

    if (errors.length > 0) throw new Error(`World-map browser capture failed:\n${errors.join("\n")}`);

    const image = await sharp({
      create: {
        width: layout.width,
        height: layout.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .composite(inputs)
      .png({ compressionLevel: 9, quality: 100 })
      .toBuffer();
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
      + `(${metadata.tiles.columns}x${metadata.tiles.rows} tiles; ${metadata.renditions.detail.length} detail levels).`,
  );
}
