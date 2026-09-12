import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import sharp, { type OverlayOptions } from "sharp";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";
import { DEFAULT_WORLD_SEED } from "../game/src/app/worldSurface.js";
import type {} from "./lib/debug-api.js";
import { gameRoot } from "./lib/paths.js";
import { startGameServer } from "./lib/server.js";

const METRES_PER_PIXEL = 0.25;
// Bounds stay on the established 50 m grid so the 250 m coast pad and canonical image bounds do
// not change when capture batching changes.
const BOUNDS_GRID_METRES = 50;
const CAPTURE_TILE_METRES = 150;
const CAPTURE_TILE_PIXELS = CAPTURE_TILE_METRES / METRES_PER_PIXEL;
// Thirty-two metres of guard keeps tree crowns and the lower daytime sun's longer shadows away
// from tile edges. Sharp crops every tile back to its 150 m, 600 px core.
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
  { settlement: "Crownward", regionId: "crownward", buildingId: "crownward_white_castle" },
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
// the pre-Crownward top rendition to reach 1,252,400 bytes. That replacement capture was visually
// reviewed at the unchanged quality setting.
// Crownward and the serving-grid ocean pad add 37.5% to the canonical pixel area
// (4800x6600 -> 6600x6600). Keep the reviewed quality settings and grow the ceiling by the same
// proportion; this is map area, not encoder drift.
const DETAIL_MAX_BYTES = 1_755_000;

/**
 * Serving tiles for the deepest zoom level.
 *
 * The flat renditions are the instant-draw fallback, and the canvas keeps one on screen while
 * tiles stream in. The top tiled level follows the native capture. This keeps quality 75 detail
 * local to the current viewport instead of making every pan download one monolithic image.
 *
 * `chooseServingTileEdge` derives the closest exact square divisor from each level. Crownward's
 * image-only ocean pad makes the native capture 6600x6600, retaining 600 px serving tiles without
 * ragged edge tiles or a changed metres-per-pixel stride.
 *
 * The top level is NOT upscaled past the capture. 6600x6600 is 0.25 m/px, which is the real
 * resolution of the orthographic capture; a 9600 px level would be four times the bytes of
 * lanczos-invented detail. Tiling removed the single-file ceiling, so the honest way to spend
 * that headroom is encode quality at native scale. If genuinely more map detail is wanted, the
 * lever is METRES_PER_PIXEL in the capture itself, and this tiler follows it automatically.
 */
const SERVING_TILE_TARGET_PIXELS = 600;
// Keep the per-tile tripwire unchanged. Crownward's exact square divisor makes tiles smaller, so
// geometry growth does not justify raising the worst-tile ceiling.
const SERVING_TILE_MAX_BYTES = 64_000;
// This ceiling grows in direct proportion to the Crownward capture area (11 / 8).
const TILED_LEVEL_MAX_BYTES = 3_095_000;
const TILE_FILE_PATTERN = /^world-map-tile-[0-9]+-c[0-9]+-r[0-9]+\.webp$/;
const DETAIL_FILE_PATTERN = /^world-map-detail-[0-9]+\.webp$/;

interface TiledLevelSpec {
  id: string;
  width: number;
  height: number;
  quality: number;
}

/** Largest first, like DETAIL_RENDITIONS. Only the native capture scale is tiled today. */
const TILED_LEVELS: readonly TiledLevelSpec[] = [
  { id: "tiled-6600", width: 6600, height: 0, quality: 75 },
];

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
  // The reviewed continuous Crownward coast and added ruins need quality 91 to retain the
  // existing 150 KB boot budget at 800 x 800; native zoom tiles keep their original quality.
  width: 800,
  height: 0,
  quality: 91,
  maxBytes: MINIMAP_MAX_BYTES,
};

// Largest first, matching WorldMapCanvas' level picker. Each file is encoded directly from the
// canonical capture, never from another rendition, so changing generation order cannot change it.
const DETAIL_RENDITIONS: readonly RenditionSpec[] = [
  {
    id: "detail-6600",
    role: "detail",
    file: "world-map-detail-6600.webp",
    width: 6600,
    height: 0,
    quality: 60,
    maxBytes: DETAIL_MAX_BYTES,
  },
  {
    id: "detail-3300",
    role: "detail",
    file: "world-map-detail-3300.webp",
    width: 3300,
    height: 0,
    quality: 82,
    maxBytes: DETAIL_MAX_BYTES,
  },
  {
    id: "detail-1650",
    role: "detail",
    file: "world-map-detail-1650.webp",
    width: 1650,
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
const MAP_BOOT_TIMEOUT_MS = 300_000;

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

/** One serving tile: where it sits in the grid, what it covers, and exactly what was written. */
interface MapTileMetadata {
  column: number;
  row: number;
  path: string;
  bytes: number;
  sha256: string;
  /** Source rect inside the level, in level pixels. Top-left origin, +y south. */
  pixelBounds: { left: number; top: number; width: number; height: number };
  /** World metres this tile covers. Column 0 is minX, row 0 is maxZ (north-up). */
  imageBounds: MapBounds;
}

interface MapTiledLevelMetadata {
  id: string;
  role: "tiled";
  format: "webp";
  width: number;
  height: number;
  metresPerPixel: number;
  tilePixels: number;
  tileMetres: number;
  columns: number;
  rows: number;
  quality: number;
  tileCount: number;
  bytes: number;
  maxTileBytes: number;
  tiles: MapTileMetadata[];
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
    tiled: MapTiledLevelMetadata[];
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
  const imagePaddingMetres = (Math.floor(coast.collar / BOUNDS_GRID_METRES) + 1) * BOUNDS_GRID_METRES;
  // Snap each padded bound OUTWARD to the 50 m bounds grid. The old world's 700 x 400 m playable extent
  // happened to be a tile multiple, so padding alone tiled exactly; Kilnhalt's 660 m z extent is
  // not, and the previous hard "must tile exactly" throw turned that into a failed capture. The
  // outward snap keeps at least the collar padding on every side and guarantees integer tiling.
  const snapDown = (value: number): number => Math.floor(value / BOUNDS_GRID_METRES) * BOUNDS_GRID_METRES;
  const snapUp = (value: number): number => Math.ceil(value / BOUNDS_GRID_METRES) * BOUNDS_GRID_METRES;
  const captureBounds: MapBounds = {
    minX: snapDown(spec.bounds.minX - imagePaddingMetres),
    maxX: snapUp(spec.bounds.maxX + imagePaddingMetres),
    minZ: snapDown(spec.bounds.minZ - imagePaddingMetres),
    maxZ: snapUp(spec.bounds.maxZ + imagePaddingMetres),
  };
  // The runtime tile contract uses one square pixel edge for both axes. Expand only the capture
  // ocean to a whole 150 m serving grid so Crownward's 1550 m padded width does not collapse the
  // exact square divisor from 600 px to 200 px. Authored and playable bounds remain unchanged.
  const servingTileMetres = SERVING_TILE_TARGET_PIXELS * METRES_PER_PIXEL;
  const expandToServingGrid = (min: number, max: number): readonly [number, number] => {
    const extra = Math.ceil((max - min) / servingTileMetres) * servingTileMetres - (max - min);
    if (extra % (BOUNDS_GRID_METRES * 2) !== 0) {
      throw new Error("World-map serving-grid padding must split evenly on the bounds grid.");
    }
    return [min - extra / 2, max + extra / 2];
  };
  const [imageMinX, imageMaxX] = expandToServingGrid(captureBounds.minX, captureBounds.maxX);
  const [imageMinZ, imageMaxZ] = expandToServingGrid(captureBounds.minZ, captureBounds.maxZ);
  const imageBounds: MapBounds = {
    minX: imageMinX,
    maxX: imageMaxX,
    minZ: imageMinZ,
    maxZ: imageMaxZ,
  };
  const columnCount = (imageBounds.maxX - imageBounds.minX) / CAPTURE_TILE_METRES;
  const rowCount = (imageBounds.maxZ - imageBounds.minZ) / CAPTURE_TILE_METRES;
  if (!Number.isInteger(columnCount) || !Number.isInteger(rowCount)) {
    throw new Error("Padded world-map bounds must tile exactly at the configured tile size.");
  }
  return {
    width: columnCount * CAPTURE_TILE_PIXELS,
    height: rowCount * CAPTURE_TILE_PIXELS,
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
      metres: CAPTURE_TILE_METRES,
      pixels: CAPTURE_TILE_PIXELS,
      bleedPixels: TILE_BLEED_PIXELS,
    },
  };
}

/**
 * Fills in a rendition's height (exact canonical aspect) and, for detail levels, its area-scaled
 * byte budget. Throws when a width cannot divide the canonical bounds into integer pixels.
 */
function sizedRendition(layout: MapLayout, spec: RenditionSpec): RenditionSpec {
  return { ...spec, height: derivedHeight(layout, spec.width) };
}

function sizedTiledLevel(layout: MapLayout, spec: TiledLevelSpec): TiledLevelSpec {
  return { ...spec, height: derivedHeight(layout, spec.width) };
}

function derivedHeight(layout: MapLayout, width: number): number {
  const height = (width * layout.height) / layout.width;
  if (!Number.isInteger(height)) {
    throw new Error(
      `Map rendition width ${width} cannot render the ${layout.width}x${layout.height} canonical image at an integer height.`,
    );
  }
  return height;
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/**
 * Largest square edge that divides the level exactly, preferring the one nearest the target.
 * Exact division is not cosmetic: a ragged final column would give those tiles a different
 * metres-per-pixel from the rest of the grid, and the viewport solver assumes a uniform stride.
 */
export function chooseServingTileEdge(
  width: number,
  height: number,
  target = SERVING_TILE_TARGET_PIXELS,
): number {
  const limit = greatestCommonDivisor(width, height);
  let best = 1;
  for (let edge = 1; edge <= limit; edge += 1) {
    if (limit % edge !== 0) continue;
    const better = Math.abs(edge - target) - Math.abs(best - target);
    if (better < 0 || (better === 0 && edge > best)) best = edge;
  }
  return best;
}

/**
 * Cuts one pyramid level into serving tiles. The canonical capture is decoded to raw pixels once
 * and every tile is extracted from that buffer, so an 88-tile grid costs one PNG decode rather
 * than 88, and no tile is ever encoded from another tile's output.
 */
async function renderTiledLevel(
  sourceImage: Buffer,
  outputDir: string,
  layout: MapLayout,
  spec: TiledLevelSpec,
): Promise<MapTiledLevelMetadata> {
  const metresPerPixel = exactMetresPerPixel(layout, spec.width, spec.height);
  const tilePixels = chooseServingTileEdge(spec.width, spec.height);
  const columns = spec.width / tilePixels;
  const rows = spec.height / tilePixels;
  const resized = spec.width === layout.width && spec.height === layout.height
    ? sharp(sourceImage)
    : sharp(sourceImage).resize({
      width: spec.width, height: spec.height, fit: "fill", kernel: "lanczos3",
    });
  const { data, info } = await resized.raw().toBuffer({ resolveWithObject: true });
  const raw = { width: info.width, height: info.height, channels: info.channels };

  const tiles: MapTileMetadata[] = [];
  let bytes = 0;
  let maxTileBytes = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const left = column * tilePixels;
      const top = row * tilePixels;
      const tile = await sharp(data, { raw })
        .extract({ left, top, width: tilePixels, height: tilePixels })
        // Same encoder settings the monolithic top level used, at the higher quality the tile
        // budget affords. "photo" with full chroma keeps coast and roof edges from fringing.
        .webp({ quality: spec.quality, effort: 6, smartSubsample: false, preset: "photo" })
        .toBuffer();
      if (tile.byteLength > SERVING_TILE_MAX_BYTES) {
        throw new Error(
          `Map tile ${spec.id} c${column} r${row} is ${tile.byteLength} bytes; the per-tile budget `
            + `is ${SERVING_TILE_MAX_BYTES} bytes. Review the capture before lowering tile quality.`,
        );
      }
      const file = tileFileName(spec, column, row);
      await writeFile(path.join(outputDir, file), tile);
      bytes += tile.byteLength;
      maxTileBytes = Math.max(maxTileBytes, tile.byteLength);
      tiles.push({
        column,
        row,
        path: `generated/${file}`,
        bytes: tile.byteLength,
        sha256: createHash("sha256").update(tile).digest("hex"),
        pixelBounds: { left, top, width: tilePixels, height: tilePixels },
        imageBounds: {
          minX: layout.imageBounds.minX + left * metresPerPixel,
          maxX: layout.imageBounds.minX + (left + tilePixels) * metresPerPixel,
          minZ: layout.imageBounds.maxZ - (top + tilePixels) * metresPerPixel,
          maxZ: layout.imageBounds.maxZ - top * metresPerPixel,
        },
      });
    }
  }
  if (bytes > TILED_LEVEL_MAX_BYTES) {
    throw new Error(
      `Tiled level ${spec.id} totals ${bytes} bytes across ${tiles.length} tiles; its budget is `
        + `${TILED_LEVEL_MAX_BYTES} bytes. Review the capture before lowering tile quality.`,
    );
  }
  return {
    id: spec.id,
    role: "tiled",
    format: "webp",
    width: spec.width,
    height: spec.height,
    metresPerPixel,
    tilePixels,
    tileMetres: tilePixels * metresPerPixel,
    columns,
    rows,
    quality: spec.quality,
    tileCount: tiles.length,
    bytes,
    maxTileBytes,
    tiles,
  };
}

function tileFileName(spec: TiledLevelSpec, column: number, row: number): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `world-map-tile-${spec.width}-c${pad(column)}-r${pad(row)}.webp`;
}

/** A regrid or resized pyramid leaves unreferenced map files behind unless the bake removes them. */
async function removeStaleMapFiles(outputDir: string, keep: ReadonlySet<string>): Promise<void> {
  const existing = await readdir(outputDir).catch(() => [] as string[]);
  for (const file of existing) {
    if ((!TILE_FILE_PATTERN.test(file) && !DETAIL_FILE_PATTERN.test(file)) || keep.has(file)) continue;
    await rm(path.join(outputDir, file), { force: true });
  }
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
  // Keep the photo encoder's full chroma sampling for the native foliage capture. Smaller
  // renditions retain their existing encoding settings.
  const largestDetail = spec.id === "detail-6600";
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
  const tiled: MapTiledLevelMetadata[] = [];
  for (const level of TILED_LEVELS) {
    tiled.push(await renderTiledLevel(
      sourceImage, outputDir, layout, sizedTiledLevel(layout, level),
    ));
  }
  await removeStaleMapFiles(
    outputDir,
    new Set([
      ...detail.map((rendition) => path.posix.basename(rendition.path)),
      ...tiled.flatMap((level) => level.tiles.map((tile) => path.posix.basename(tile.path))),
    ]),
  );

  const sourceSha256 = createHash("sha256").update(sourceImage).digest("hex");
  const renderFingerprint = createHash("sha256")
    .update(JSON.stringify({
      schemaVersion: 4,
      sourceSha256,
      playableBounds: layout.playableBounds,
      imageBounds: layout.imageBounds,
      renditions: { minimap, detail, tiled },
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
    renditions: { minimap, detail, tiled },
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
    tiledLevelSource(tiled),
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
    const capturePixels = CAPTURE_TILE_PIXELS + TILE_BLEED_PIXELS * 2;
    const captureSpan = CAPTURE_TILE_METRES + bleedMetres * 2;
    for (let row = 0; row < rows; row += 1) {
      const centreZ = imageBounds.maxZ - CAPTURE_TILE_METRES * (row + 0.5);
      for (let column = 0; column < columns; column += 1) {
        const centreX = imageBounds.minX + CAPTURE_TILE_METRES * (column + 0.5);
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
            width: CAPTURE_TILE_PIXELS,
            height: CAPTURE_TILE_PIXELS,
          })
          .png()
          .toBuffer();
        inputs.push({ input: tile, left: column * CAPTURE_TILE_PIXELS, top: row * CAPTURE_TILE_PIXELS });
      }
      console.log(
        `World-map capture row ${row + 1}/${rows} complete `
          + `(${(row + 1) * columns}/${rows * columns} tiles).`,
      );
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
      + `(${metadata.tiles.columns}x${metadata.tiles.rows} capture tiles; `
      + `${metadata.renditions.detail.length} flat levels; `
      + metadata.renditions.tiled
        .map((level) => `${level.id} ${level.columns}x${level.rows} @ ${level.tilePixels}px = ${level.bytes} B`)
        .join(", ")
      + ").",
  );
}
