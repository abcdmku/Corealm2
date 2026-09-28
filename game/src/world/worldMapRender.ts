/**
 * The world map pipeline, shared by the repository tool and a live server's devdocs.
 *
 * A map is the real game scene captured north-up in orthographic tiles, stitched into one canonical
 * image, then cut into the renditions the game and devdocs draw: the minimap, the flat detail
 * pyramid and the native-scale serving tiles, with `world-map.json` describing all of them.
 *
 * Nothing here touches a file system, a GPU or an image library. The caller supplies the capture
 * (`__gameDebug.captureWorldMapTile` on a page that booted the world) and a `WorldMapCodec`: Sharp in
 * `tools/generate-world-map.ts`, canvas and the browser's WebP encoder in devdocs' Render map action.
 * Both run exactly this sequence, so a map a server renders has the repository map's frame, grid,
 * file names and metadata shape.
 */

export const METRES_PER_PIXEL = 0.25;
// Bounds stay on the established 50 m grid so the 250 m coast pad and canonical image bounds do
// not change when capture batching changes.
export const BOUNDS_GRID_METRES = 50;
export const CAPTURE_TILE_METRES = 150;
export const CAPTURE_TILE_PIXELS = CAPTURE_TILE_METRES / METRES_PER_PIXEL;
// Thirty-two metres of guard keeps tree crowns and the lower daytime sun's longer shadows away
// from tile edges. Every tile is cropped back to its 150 m, 600 px core.
export const TILE_BLEED_PIXELS = 128;
export const SOURCE_IMAGE_FILE = "world-map.png";
export const METADATA_FILE = "world-map.json";
const MINIMAP_MAX_BYTES = 150_000;
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
 * tiles stream in. The top tiled level follows the native capture. This keeps quality 72 detail
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
export const TILE_FILE_PATTERN = /^world-map-tile-[0-9]+-c[0-9]+-r[0-9]+\.webp$/;
export const DETAIL_FILE_PATTERN = /^world-map-detail-[0-9]+\.webp$/;

/**
 * How a rendition is encoded. `photo` keeps full chroma (no smart subsampling) with the photo
 * preset, for the native foliage capture and its tiles; `default` is the encoder's default preset
 * with smart subsampling, for the downscaled levels.
 */
export type MapEncoding = "photo" | "default";

export interface TiledLevelSpec {
  id: string;
  width: number;
  height: number;
  quality: number;
}

/** Largest first, like DETAIL_RENDITIONS. Only the native capture scale is tiled today. */
const TILED_LEVELS: readonly TiledLevelSpec[] = [
  { id: "tiled-6600", width: 6600, height: 0, quality: 68 },
];

export interface RenditionSpec {
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
  // existing 150 KB boot budget at 800 x 800.
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
    // Reviewed against the mountain capture: retain the flat fallback's byte budget.
    // Native zoom tiles retain full resolution and the source PNG stays lossless.
    quality: 46,
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

export interface MapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MapRenditionMetadata {
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
export interface MapTileMetadata {
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

export interface MapTiledLevelMetadata {
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

export interface MapLayout {
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
  /**
   * The lossless canonical capture. The repository keeps it; a server's map has none, since the
   * players only ever load the renditions, and its identity is then the hash of the stitched pixels.
   */
  sourceImage?: {
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
  /** A server's map only: the world geometry revision it shows (`WorldDescriptor.worldRevision`). */
  worldRevision?: string;
}

/** The bits of the world terrain spec the frame is derived from. */
export interface MapTerrainFrame {
  bounds: MapBounds;
  coast?: { collar: number } | null;
}

/**
 * The canonical capture frame for a terrain: the playable island plus its coast collar, padded
 * out to whole capture and serving tiles.
 */
export function mapLayoutFor(spec: MapTerrainFrame, seed: number): MapLayout {
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
    seed,
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
 * The frame an existing map was rendered in, read back from its `world-map.json`. A server renders
 * its map in the build's frame, so every consumer's bounds, pyramid and tile grid stay valid and
 * only the pixels (and their hashes) change.
 */
export function mapLayoutOf(metadata: Pick<MapMetadata, keyof MapLayout>): MapLayout {
  const { width, height, playableBounds, imageBounds, imagePaddingMetres, seed, tiles } = metadata;
  return {
    width, height, playableBounds: { ...playableBounds }, imageBounds: { ...imageBounds },
    imagePaddingMetres, seed, tiles: { ...tiles },
  };
}

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

function exactMetresPerPixel(layout: MapLayout, width: number, height: number): number {
  const horizontal = (layout.imageBounds.maxX - layout.imageBounds.minX) / width;
  const vertical = (layout.imageBounds.maxZ - layout.imageBounds.minZ) / height;
  if (Math.abs(horizontal - vertical) > 1e-9) {
    throw new Error(`Map rendition ${width}x${height} distorts the canonical image bounds.`);
  }
  return horizontal;
}

function tileFileName(spec: TiledLevelSpec, column: number, row: number): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `world-map-tile-${spec.width}-c${pad(column)}-r${pad(row)}.webp`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Joins the capture tiles into the canonical image, one tile at a time. */
export interface WorldMapStitcher<Source> {
  /**
   * One capture as the renderer returned it: PNG bytes, `pixels` square including the bleed, +Z at
   * the bottom. The stitcher flips it north-up, crops the bleed and places its core.
   */
  add(capture: Uint8Array, column: number, row: number): Promise<void>;
  finish(): Promise<Source>;
}

/** The image operations the pipeline needs, over whatever holds the canonical image. */
export interface WorldMapCodec<Source> {
  stitcher(layout: MapLayout): WorldMapStitcher<Source>;
  size(source: Source): Promise<{ width: number; height: number }>;
  /** The lossless PNG when this codec keeps one, and the canonical image's identity. */
  identity(source: Source): Promise<{ sha256: string; png?: Uint8Array }>;
  /** The whole image resized (lanczos) to `width` x `height` and encoded as WebP. */
  encode(source: Source, target: { width: number; height: number; quality: number; encoding: MapEncoding }): Promise<Uint8Array>;
  /**
   * The image at `width` x `height` cut into `tilePixels` squares, each encoded as `photo` WebP.
   * Calls `tile` row by row, left to right.
   */
  tiles(
    source: Source,
    level: { width: number; height: number; quality: number; tilePixels: number },
    tile: (column: number, row: number, bytes: Uint8Array) => Promise<void>,
  ): Promise<void>;
}

/** What `captureTopDownTile` is asked for. */
export interface MapCaptureRequest {
  centreX: number;
  centreZ: number;
  spanMetres: number;
  pixels: number;
}

/**
 * Captures the frame tile by tile through `capture` and stitches the canonical image. `capture`
 * renders one tile of the booted scene (the repository tool asks Playwright, devdocs asks the
 * capture page it framed) and returns its PNG bytes.
 */
export async function captureWorldMap<Source>(
  layout: MapLayout,
  codec: WorldMapCodec<Source>,
  capture: (request: MapCaptureRequest) => Promise<Uint8Array>,
  progress?: (done: number, total: number) => void,
): Promise<Source> {
  const { imageBounds } = layout;
  const { columns, rows } = layout.tiles;
  const bleedMetres = TILE_BLEED_PIXELS * METRES_PER_PIXEL;
  const capturePixels = CAPTURE_TILE_PIXELS + TILE_BLEED_PIXELS * 2;
  const captureSpan = CAPTURE_TILE_METRES + bleedMetres * 2;
  const stitcher = codec.stitcher(layout);
  for (let row = 0; row < rows; row += 1) {
    const centreZ = imageBounds.maxZ - CAPTURE_TILE_METRES * (row + 0.5);
    for (let column = 0; column < columns; column += 1) {
      const centreX = imageBounds.minX + CAPTURE_TILE_METRES * (column + 0.5);
      const tile = await capture({ centreX, centreZ, spanMetres: captureSpan, pixels: capturePixels });
      await stitcher.add(tile, column, row);
      progress?.(row * columns + column + 1, rows * columns);
    }
  }
  return stitcher.finish();
}

/** A data URL's bytes. `captureTopDownTile` answers with a PNG data URL. */
export function dataUrlBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("A map tile capture did not return a data URL.");
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export interface WorldMapFiles {
  /** File name under `generated/` and its bytes, the renditions in generation order, `world-map.json` last. */
  files: { name: string; bytes: Uint8Array }[];
  metadata: MapMetadata;
}

export interface RenderWorldMapOptions {
  /**
   * Throw when a rendition passes its byte budget. The repository tool keeps these tripwires so a
   * capture regression is reviewed; a server's map is never committed, and its browser encoder
   * sizes files differently from Sharp, so it only reports them.
   */
  enforceBudgets: boolean;
  /** Names the world geometry a server's map shows. */
  worldRevision?: string;
  /** Called per written file, for a progress line. */
  progress?: (done: number, total: number) => void;
}

/**
 * Every rendition of the canonical image, and `world-map.json` describing them. Deterministic for a
 * given codec: each level is encoded directly from the canonical image, never from another level.
 */
export async function renderWorldMapFiles<Source>(
  layout: MapLayout,
  source: Source,
  codec: WorldMapCodec<Source>,
  options: RenderWorldMapOptions,
): Promise<WorldMapFiles> {
  const size = await codec.size(source);
  if (size.width !== layout.width || size.height !== layout.height) {
    throw new Error(
      `Canonical world map is ${size.width}x${size.height}; `
        + `expected ${layout.width}x${layout.height} from the authored bounds.`,
    );
  }
  // Ocean depth and opacity come from the rendered coast. Preserve the raw capture here so a
  // broken shoreline or finite-floor boundary remains visible in the map acceptance evidence.
  const files: { name: string; bytes: Uint8Array }[] = [];
  const identity = await codec.identity(source);
  const levels = TILED_LEVELS.map((level) => sizedTiledLevel(layout, level));
  const total = 1 + DETAIL_RENDITIONS.length
    + levels.reduce((sum, level) => {
      const edge = chooseServingTileEdge(level.width, level.height);
      return sum + (level.width / edge) * (level.height / edge);
    }, 0) + 1;
  const written = (name: string, bytes: Uint8Array): void => {
    files.push({ name, bytes });
    options.progress?.(files.length, total);
  };

  const renderRendition = async (spec: RenditionSpec): Promise<MapRenditionMetadata> => {
    // Keep the photo encoder's full chroma sampling for the native foliage capture. Smaller
    // renditions retain their existing encoding settings.
    const encoding: MapEncoding = spec.id === "detail-6600" ? "photo" : "default";
    const image = await codec.encode(source, { width: spec.width, height: spec.height, quality: spec.quality, encoding });
    if (options.enforceBudgets && image.byteLength > spec.maxBytes) {
      throw new Error(
        `${spec.file} is ${image.byteLength} bytes; its budget is ${spec.maxBytes} bytes. `
          + "Review the capture before lowering rendition quality.",
      );
    }
    written(spec.file, image);
    return {
      id: spec.id,
      role: spec.role,
      path: `generated/${spec.file}`,
      format: "webp",
      width: spec.width,
      height: spec.height,
      metresPerPixel: exactMetresPerPixel(layout, spec.width, spec.height),
      bytes: image.byteLength,
      sha256: await sha256Hex(image),
      quality: spec.quality,
    };
  };

  /** Cuts one pyramid level into serving tiles. */
  const renderTiledLevel = async (spec: TiledLevelSpec): Promise<MapTiledLevelMetadata> => {
    const metresPerPixel = exactMetresPerPixel(layout, spec.width, spec.height);
    const tilePixels = chooseServingTileEdge(spec.width, spec.height);
    const columns = spec.width / tilePixels;
    const rows = spec.height / tilePixels;
    const tiles: MapTileMetadata[] = [];
    let bytes = 0;
    let maxTileBytes = 0;
    await codec.tiles(source, { width: spec.width, height: spec.height, quality: spec.quality, tilePixels }, async (column, row, tile) => {
      if (options.enforceBudgets && tile.byteLength > SERVING_TILE_MAX_BYTES) {
        throw new Error(
          `Map tile ${spec.id} c${column} r${row} is ${tile.byteLength} bytes; the per-tile budget `
            + `is ${SERVING_TILE_MAX_BYTES} bytes. Review the capture before lowering tile quality.`,
        );
      }
      const file = tileFileName(spec, column, row);
      written(file, tile);
      bytes += tile.byteLength;
      maxTileBytes = Math.max(maxTileBytes, tile.byteLength);
      const left = column * tilePixels;
      const top = row * tilePixels;
      tiles.push({
        column,
        row,
        path: `generated/${file}`,
        bytes: tile.byteLength,
        sha256: await sha256Hex(tile),
        pixelBounds: { left, top, width: tilePixels, height: tilePixels },
        imageBounds: {
          minX: layout.imageBounds.minX + left * metresPerPixel,
          maxX: layout.imageBounds.minX + (left + tilePixels) * metresPerPixel,
          minZ: layout.imageBounds.maxZ - (top + tilePixels) * metresPerPixel,
          maxZ: layout.imageBounds.maxZ - top * metresPerPixel,
        },
      });
    });
    if (options.enforceBudgets && bytes > TILED_LEVEL_MAX_BYTES) {
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
  };

  const minimap = await renderRendition(sizedRendition(layout, MINIMAP_RENDITION));
  const detail: MapRenditionMetadata[] = [];
  for (const rendition of DETAIL_RENDITIONS) detail.push(await renderRendition(sizedRendition(layout, rendition)));
  const tiled: MapTiledLevelMetadata[] = [];
  for (const level of levels) tiled.push(await renderTiledLevel(level));

  const sourceSha256 = identity.sha256;
  const renderFingerprint = await sha256Hex(new TextEncoder().encode(JSON.stringify({
    schemaVersion: 4,
    sourceSha256,
    playableBounds: layout.playableBounds,
    imageBounds: layout.imageBounds,
    renditions: { minimap, detail, tiled },
  })));
  const metadata: MapMetadata = {
    ...layout,
    version: 4,
    source: "actual-game-scene",
    metresPerPixel: exactMetresPerPixel(layout, layout.width, layout.height),
    north: "+z",
    ...(identity.png ? {
      sourceImage: {
        path: `generated/${SOURCE_IMAGE_FILE}`,
        format: "png" as const,
        width: layout.width,
        height: layout.height,
        bytes: identity.png.byteLength,
        sha256: sourceSha256,
      },
    } : {}),
    // Kept for consumers of the v3 metadata. The source capture is still the canonical map image.
    sha256: sourceSha256,
    renderFingerprint,
    renditions: { minimap, detail, tiled },
    layers: ["terrain", "stamped-ground", "water", "buildings", "props", "trees", "grass", "entities"],
    overlays: "none",
    ...(options.worldRevision ? { worldRevision: options.worldRevision } : {}),
  };
  written(METADATA_FILE, new TextEncoder().encode(`${JSON.stringify(metadata, null, 2)}\n`));
  return { files, metadata };
}
