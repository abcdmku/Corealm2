import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORLD_MAP_DETAIL_RENDITIONS,
  WORLD_MAP_IMAGE_BOUNDS,
  WORLD_MAP_MINIMAP_RENDITION,
  WORLD_MAP_PLAYABLE_BOUNDS,
  WORLD_MAP_RENDER_FINGERPRINT,
  WORLD_MAP_RENDITION_SET_FINGERPRINT,
  WORLD_MAP_SOURCE_SHA256,
  WORLD_MAP_TILED_LEVELS,
} from "../game/src/generated/worldMapFingerprint.js";
import {
  MAP_HOME_ZOOM,
  MAP_TILE_CACHE_LIMIT,
  WorldMapCanvas,
  viewportTileRange,
} from "../game/src/ui/worldMapCanvas.js";

const MINIMAP_BOOT_BUDGET_BYTES = 150_000;
// Mirrors the reviewed tripwire in tools/generate-world-map.ts. Crownward and its image-only
// serving-grid pad grow the canonical capture from 4800x6600 to 6600x6600, so this ceiling grows
// by the same 37.5% at unchanged quality. Detail levels remain lazy-loaded zoom assets; the
// boot-path checks below protect startup transfer.
const DETAIL_RENDITION_BUDGET_BYTES = 1_755_000;
// Mirrors the generator's serving-tile ceilings. The whole native-resolution level is cut into
// 600 px tiles. These are tripwires on the bake, not a transfer budget. The viewport test below
// covers transfer behavior.
const TILE_BUDGET_BYTES = 64_000;
const TILED_LEVEL_BUDGET_BYTES = 3_095_000;

const FLAT_NATIVE = WORLD_MAP_DETAIL_RENDITIONS[0]!.path;
const FLAT_HALF = WORLD_MAP_DETAIL_RENDITIONS[1]!.path;
const FLAT_QUARTER = WORLD_MAP_DETAIL_RENDITIONS[2]!.path;

interface MapRendition {
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

interface MapTile {
  column: number;
  row: number;
  path: string;
  bytes: number;
  sha256: string;
  pixelBounds: { left: number; top: number; width: number; height: number };
  imageBounds: typeof WORLD_MAP_IMAGE_BOUNDS;
}

interface MapTiledLevel {
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
  tiles: MapTile[];
}

interface MapMetadata {
  version: number;
  width: number;
  height: number;
  playableBounds: typeof WORLD_MAP_PLAYABLE_BOUNDS;
  imageBounds: typeof WORLD_MAP_IMAGE_BOUNDS;
  sha256: string;
  renderFingerprint: string;
  sourceImage: {
    path: string;
    format: "png";
    width: number;
    height: number;
    bytes: number;
    sha256: string;
  };
  renditions: {
    minimap: MapRendition;
    detail: MapRendition[];
    tiled: MapTiledLevel[];
  };
}

function publicFile(runtimePath: string): string {
  return path.join("game", "public", ...runtimePath.split("/"));
}

async function mapMetadata(): Promise<MapMetadata> {
  return JSON.parse(
    await readFile("game/public/generated/world-map.json", "utf8"),
  ) as MapMetadata;
}

async function verifyRendition(rendition: MapRendition): Promise<void> {
  expect(rendition.path).toMatch(/^generated\/world-map-(?:minimap|detail-[0-9]+)\.webp$/);
  expect(rendition.path).not.toContain("..");
  expect(rendition.format).toBe("webp");
  expect(rendition.quality).toBeGreaterThan(0);
  expect(rendition.quality).toBeLessThanOrEqual(100);

  const file = publicFile(rendition.path);
  const bytes = await readFile(file);
  const fileStat = await stat(file);
  const image = await sharp(bytes).metadata();
  expect(fileStat.size, rendition.path).toBe(rendition.bytes);
  expect(createHash("sha256").update(bytes).digest("hex"), rendition.path).toBe(rendition.sha256);
  expect(image.format, rendition.path).toBe(rendition.format);
  expect(image.width, rendition.path).toBe(rendition.width);
  expect(image.height, rendition.path).toBe(rendition.height);

  const metresWide = WORLD_MAP_IMAGE_BOUNDS.maxX - WORLD_MAP_IMAGE_BOUNDS.minX;
  const metresHigh = WORLD_MAP_IMAGE_BOUNDS.maxZ - WORLD_MAP_IMAGE_BOUNDS.minZ;
  expect(metresWide / rendition.width, rendition.path).toBeCloseTo(rendition.metresPerPixel, 8);
  expect(metresHigh / rendition.height, rendition.path).toBeCloseTo(rendition.metresPerPixel, 8);
}

interface FakeImage {
  src: string;
  settled: boolean;
  naturalWidth: number;
  naturalHeight: number;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

interface Harness {
  requested: string[];
  images: FakeImage[];
  context: {
    setTransform: ReturnType<typeof vi.fn>;
    clearRect: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
    fillText: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
    scale: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
  };
  map: WorldMapCanvas;
}

/** One offline WorldMapCanvas with recording Image and 2D context stand-ins. */
function harness(): Harness {
  const requested: string[] = [];
  const images: FakeImage[] = [];
  class FakeImageElement {
    decoding = "";
    naturalWidth = 0;
    naturalHeight = 0;
    settled = false;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private value = "";

    constructor() {
      images.push(this as unknown as FakeImage);
    }

    get src(): string {
      return this.value;
    }

    set src(next: string) {
      this.value = next;
      requested.push(next);
    }
  }
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    scale: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "",
  };
  const canvas = {
    width: 1,
    height: 1,
    style: { width: "", height: "" },
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement;
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  vi.stubGlobal("document", { baseURI: "https://example.test/Corealm/" });
  vi.stubGlobal("Image", FakeImageElement);

  const map = new WorldMapCanvas(canvas, {
    bounds: WORLD_MAP_PLAYABLE_BOUNDS,
    sample: () => ({ height: 0, normal: [0, 1, 0], regionId: "fallowmarch" }),
    roadPolylines: () => [],
  });
  return { requested, images, context, map };
}

/** Runtime-relative asset paths of the requests matching `marker`, in request order. */
function assetRequests(requested: readonly string[], marker: string): string[] {
  return requested
    .map((value) => new URL(value).pathname)
    .filter((value) => value.includes(marker))
    .map((value) => value.slice(value.indexOf("generated/")));
}

function flatRequests(requested: readonly string[]): string[] {
  return assetRequests(requested, "world-map-detail-");
}

function tileRequests(requested: readonly string[]): string[] {
  return assetRequests(requested, "world-map-tile-");
}

function load(image: FakeImage): void {
  const rendition = WORLD_MAP_DETAIL_RENDITIONS.find((item) => image.src.includes(item.path));
  const level = WORLD_MAP_TILED_LEVELS[0];
  image.naturalWidth = rendition?.width ?? level?.tilePixels ?? 1;
  image.naturalHeight = rendition?.height ?? level?.tilePixels ?? 1;
  image.settled = true;
  image.onload?.();
}

/** Completes every outstanding request, including the ones each arrival goes on to trigger. */
function settle(view: Harness): void {
  for (let guard = 0; guard < 64; guard += 1) {
    const pending = view.images.filter((image) => !image.settled);
    if (pending.length === 0) return;
    for (const image of pending) load(image);
  }
  throw new Error("World map kept requesting imagery after 64 settle passes.");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("generated world-map payloads", () => {
  it("keeps the boot minimap and every detail level inside their transfer budgets", async () => {
    expect(WORLD_MAP_MINIMAP_RENDITION.bytes).toBeLessThanOrEqual(MINIMAP_BOOT_BUDGET_BYTES);
    for (const rendition of WORLD_MAP_DETAIL_RENDITIONS) {
      expect(rendition.bytes, rendition.path).toBeLessThanOrEqual(DETAIL_RENDITION_BUDGET_BYTES);
    }

    await verifyRendition(WORLD_MAP_MINIMAP_RENDITION);
    for (const rendition of WORLD_MAP_DETAIL_RENDITIONS) await verifyRendition(rendition);
  });

  it("keeps JSON metadata, generated exports, files, and the set fingerprint in sync", async () => {
    const metadata = await mapMetadata();
    expect(metadata.version).toBe(4);
    expect(metadata.playableBounds).toEqual(WORLD_MAP_PLAYABLE_BOUNDS);
    expect(metadata.imageBounds).toEqual(WORLD_MAP_IMAGE_BOUNDS);
    expect(metadata.sha256).toBe(WORLD_MAP_SOURCE_SHA256);
    expect(metadata.sourceImage.sha256).toBe(WORLD_MAP_SOURCE_SHA256);
    expect(metadata.sourceImage.width).toBe(metadata.width);
    expect(metadata.sourceImage.height).toBe(metadata.height);
    expect(metadata.renditions.minimap).toEqual(WORLD_MAP_MINIMAP_RENDITION);
    expect(metadata.renditions.detail).toEqual(WORLD_MAP_DETAIL_RENDITIONS);
    expect(metadata.renderFingerprint).toBe(WORLD_MAP_RENDITION_SET_FINGERPRINT);
    expect(WORLD_MAP_RENDER_FINGERPRINT).toBe(WORLD_MAP_RENDITION_SET_FINGERPRINT);

    // The tile ledger is inside `renditions`, so a re-tiled or partially rewritten level moves
    // the set fingerprint exactly like a changed rendition does.
    const expectedFingerprint = createHash("sha256")
      .update(JSON.stringify({
        schemaVersion: metadata.version,
        sourceSha256: metadata.sha256,
        playableBounds: metadata.playableBounds,
        imageBounds: metadata.imageBounds,
        renditions: metadata.renditions,
      }))
      .digest("hex");
    expect(WORLD_MAP_RENDITION_SET_FINGERPRINT).toBe(expectedFingerprint);

    const sourceBytes = await readFile(publicFile(metadata.sourceImage.path));
    expect(sourceBytes.byteLength).toBe(metadata.sourceImage.bytes);
    expect(createHash("sha256").update(sourceBytes).digest("hex")).toBe(WORLD_MAP_SOURCE_SHA256);
  });

  it("orders pregenerated zoom levels largest-first without duplicate IDs or paths", () => {
    expect(WORLD_MAP_DETAIL_RENDITIONS.length).toBeGreaterThan(1);
    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const [index, rendition] of WORLD_MAP_DETAIL_RENDITIONS.entries()) {
      expect(ids.has(rendition.id), rendition.id).toBe(false);
      expect(paths.has(rendition.path), rendition.path).toBe(false);
      ids.add(rendition.id);
      paths.add(rendition.path);
      const previous = WORLD_MAP_DETAIL_RENDITIONS[index - 1];
      if (!previous) continue;
      expect(previous.width).toBeGreaterThan(rendition.width);
      expect(previous.height).toBeGreaterThan(rendition.height);
      expect(previous.metresPerPixel).toBeLessThan(rendition.metresPerPixel);
    }
  });

  it("does not request detail imagery until the full-map canvas renders", () => {
    const view = harness();
    view.map.resize(1_000, 600);
    view.map.centreOn([0, 0, 0], MAP_HOME_ZOOM);
    expect(view.requested).toEqual([]);

    view.map.render();
    // Street zoom is where the tiled level takes over, so the half-scale flat file is its underlay.
    const underlay = WORLD_MAP_DETAIL_RENDITIONS.find((item) => item.path === FLAT_HALF)!;
    expect(view.requested[0]).toContain(`/Corealm/${FLAT_HALF}`);
    expect(view.requested[0]).toContain(`v=${underlay.sha256}`);
    expect(flatRequests(view.requested)).toEqual([FLAT_HALF]);
    expect(flatRequests(view.requested)).not.toContain(FLAT_NATIVE);
    expect(view.context.fillText).toHaveBeenCalledWith("Loading detailed map…", 500, 300);

    view.map.resetView();
    view.map.render();
    // The whole-island view needs no tiles at all: one flat blit is cheaper and sharp enough.
    expect(view.map.visibleTiles()).toEqual([]);
    expect(flatRequests(view.requested)).toEqual([FLAT_HALF, FLAT_QUARTER]);
  });

  it("retries a failed preferred level and shows a pregenerated fallback meanwhile", async () => {
    vi.useFakeTimers();
    const view = harness();
    view.map.resize(1_000, 600);
    view.map.centreOn([0, 0, 0], MAP_HOME_ZOOM);
    view.map.render();
    expect(flatRequests(view.requested)).toEqual([FLAT_HALF]);

    view.images[0]?.onerror?.();
    expect(flatRequests(view.requested)).toEqual([FLAT_HALF, FLAT_QUARTER]);

    await vi.advanceTimersByTimeAsync(250);
    expect(flatRequests(view.requested)).toEqual([FLAT_HALF, FLAT_QUARTER, FLAT_HALF]);
  });
});

describe("segmented world-map level", () => {
  it("covers the canonical image with an exact tile grid, no gaps and no overlaps", async () => {
    const metadata = await mapMetadata();
    expect(metadata.renditions.tiled.length).toBeGreaterThan(0);
    for (const level of metadata.renditions.tiled) {
      expect(level.role).toBe("tiled");
      expect(level.width % level.tilePixels, level.id).toBe(0);
      expect(level.height % level.tilePixels, level.id).toBe(0);
      expect(level.columns).toBe(level.width / level.tilePixels);
      expect(level.rows).toBe(level.height / level.tilePixels);
      expect(level.tileCount).toBe(level.columns * level.rows);
      expect(level.tiles).toHaveLength(level.tileCount);
      expect(level.tileMetres).toBeCloseTo(level.tilePixels * level.metresPerPixel, 9);
      expect(level.metresPerPixel)
        .toBeCloseTo((WORLD_MAP_IMAGE_BOUNDS.maxX - WORLD_MAP_IMAGE_BOUNDS.minX) / level.width, 9);
      expect(level.metresPerPixel)
        .toBeCloseTo((WORLD_MAP_IMAGE_BOUNDS.maxZ - WORLD_MAP_IMAGE_BOUNDS.minZ) / level.height, 9);

      const seen = new Map<string, MapTile>();
      let coveredPixels = 0;
      for (const tile of level.tiles) {
        const key = `${tile.column}/${tile.row}`;
        expect(seen.has(key), key).toBe(false);
        seen.set(key, tile);
        expect(tile.column).toBeGreaterThanOrEqual(0);
        expect(tile.column).toBeLessThan(level.columns);
        expect(tile.row).toBeGreaterThanOrEqual(0);
        expect(tile.row).toBeLessThan(level.rows);
        // Exact placement makes the union a partition: every pixel of the level belongs to one
        // tile, and no pixel belongs to two.
        expect(tile.pixelBounds, key).toEqual({
          left: tile.column * level.tilePixels,
          top: tile.row * level.tilePixels,
          width: level.tilePixels,
          height: level.tilePixels,
        });
        coveredPixels += tile.pixelBounds.width * tile.pixelBounds.height;
        // Column 0 is minX and row 0 is maxZ: north is up, and the stored image runs +x right.
        expect(tile.imageBounds.minX, key)
          .toBeCloseTo(WORLD_MAP_IMAGE_BOUNDS.minX + tile.column * level.tileMetres, 9);
        expect(tile.imageBounds.maxX, key)
          .toBeCloseTo(WORLD_MAP_IMAGE_BOUNDS.minX + (tile.column + 1) * level.tileMetres, 9);
        expect(tile.imageBounds.maxZ, key)
          .toBeCloseTo(WORLD_MAP_IMAGE_BOUNDS.maxZ - tile.row * level.tileMetres, 9);
        expect(tile.imageBounds.minZ, key)
          .toBeCloseTo(WORLD_MAP_IMAGE_BOUNDS.maxZ - (tile.row + 1) * level.tileMetres, 9);
      }
      expect(coveredPixels).toBe(level.width * level.height);
      expect(seen.size).toBe(level.tileCount);

      // Neighbours share an edge exactly, and the outer edge is the canonical image bounds.
      for (const tile of level.tiles) {
        const east = seen.get(`${tile.column + 1}/${tile.row}`);
        if (east) expect(east.imageBounds.minX).toBe(tile.imageBounds.maxX);
        const south = seen.get(`${tile.column}/${tile.row + 1}`);
        if (south) expect(south.imageBounds.maxZ).toBe(tile.imageBounds.minZ);
      }
      const bounds = level.tiles.reduce((box, tile) => ({
        minX: Math.min(box.minX, tile.imageBounds.minX),
        maxX: Math.max(box.maxX, tile.imageBounds.maxX),
        minZ: Math.min(box.minZ, tile.imageBounds.minZ),
        maxZ: Math.max(box.maxZ, tile.imageBounds.maxZ),
      }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
      expect(bounds).toEqual({ ...WORLD_MAP_IMAGE_BOUNDS });
    }
  });

  it("writes every declared tile at its recorded size and hash, and leaves no orphans", async () => {
    const metadata = await mapMetadata();
    const declared = new Set<string>();
    for (const level of metadata.renditions.tiled) {
      let total = 0;
      for (const tile of level.tiles) {
        expect(tile.path.startsWith("generated/world-map-tile-"), tile.path).toBe(true);
        expect(tile.path.endsWith(".webp"), tile.path).toBe(true);
        expect(tile.path.includes(".."), tile.path).toBe(false);
        declared.add(tile.path.slice("generated/".length));

        const file = publicFile(tile.path);
        const bytes = await readFile(file);
        const fileStat = await stat(file);
        expect(fileStat.size, tile.path).toBe(tile.bytes);
        expect(createHash("sha256").update(bytes).digest("hex"), tile.path).toBe(tile.sha256);
        expect(tile.bytes, tile.path).toBeLessThanOrEqual(TILE_BUDGET_BYTES);

        const image = await sharp(bytes).metadata();
        expect(image.format, tile.path).toBe(level.format);
        expect(image.width, tile.path).toBe(level.tilePixels);
        expect(image.height, tile.path).toBe(level.tilePixels);
        total += tile.bytes;
      }
      expect(total).toBe(level.bytes);
      expect(level.bytes).toBeLessThanOrEqual(TILED_LEVEL_BUDGET_BYTES);
      expect(level.maxTileBytes)
        .toBe(level.tiles.reduce((most, tile) => Math.max(most, tile.bytes), 0));
    }

    // A regrid must not leave the last bake's tiles behind: a stale file still serves 200 OK.
    const present = (await readdir(path.join("game", "public", "generated")))
      .filter((file) => file.startsWith("world-map-tile-"));
    expect([...present].sort()).toEqual([...declared].sort());
  });

  it("exports the runtime tile grid as a faithful projection of the JSON ledger", async () => {
    const metadata = await mapMetadata();
    expect(WORLD_MAP_TILED_LEVELS.length).toBe(metadata.renditions.tiled.length);
    for (const [index, level] of WORLD_MAP_TILED_LEVELS.entries()) {
      const source = metadata.renditions.tiled[index]!;
      expect(level.id).toBe(source.id);
      expect(level.format).toBe(source.format);
      expect(level.width).toBe(source.width);
      expect(level.height).toBe(source.height);
      expect(level.metresPerPixel).toBe(source.metresPerPixel);
      expect(level.tilePixels).toBe(source.tilePixels);
      expect(level.tileMetres).toBe(source.tileMetres);
      expect(level.columns).toBe(source.columns);
      expect(level.rows).toBe(source.rows);
      expect(level.bytes).toBe(source.bytes);
      // Row-major, carrying the identity the runtime cache-busts and verifies with.
      expect(level.tiles.map((tile) => ({ ...tile }))).toEqual(source.tiles.map((tile) => ({
        column: tile.column,
        row: tile.row,
        path: tile.path,
        bytes: tile.bytes,
        sha256: tile.sha256,
      })));
      // A tiled level stands in for a flat one of the same resolution, so that flat file has to
      // survive as the last-resort stand-in when tiles cannot be served at all.
      expect(WORLD_MAP_DETAIL_RENDITIONS.some((rendition) => rendition.width === level.width))
        .toBe(true);
    }
  });

  it("returns the tiles a viewport overlaps, including edges and corners", () => {
    const grid = { width: 4_800, height: 6_600, tilePixels: 600, columns: 8, rows: 11 };
    expect(viewportTileRange(grid, { left: 0, top: 0, right: 4_800, bottom: 6_600 }))
      .toEqual({ minColumn: 0, maxColumn: 7, minRow: 0, maxRow: 10 });
    // Wholly inside one tile.
    expect(viewportTileRange(grid, { left: 610, top: 1_210, right: 690, bottom: 1_290 }))
      .toEqual({ minColumn: 1, maxColumn: 1, minRow: 2, maxRow: 2 });
    // Boundary-exact: a rect that ends on a tile edge stops at that tile.
    expect(viewportTileRange(grid, { left: 600, top: 1_200, right: 1_200, bottom: 1_800 }))
      .toEqual({ minColumn: 1, maxColumn: 1, minRow: 2, maxRow: 2 });
    // One pixel past the edge pulls in the next tile on both axes.
    expect(viewportTileRange(grid, { left: 600, top: 1_200, right: 1_201, bottom: 1_801 }))
      .toEqual({ minColumn: 1, maxColumn: 2, minRow: 2, maxRow: 3 });
    // Corners clamp to the grid instead of running off it.
    expect(viewportTileRange(grid, { left: -900, top: -900, right: 10, bottom: 10 }))
      .toEqual({ minColumn: 0, maxColumn: 0, minRow: 0, maxRow: 0 });
    expect(viewportTileRange(grid, { left: 4_790, top: 6_590, right: 9_000, bottom: 9_000 }))
      .toEqual({ minColumn: 7, maxColumn: 7, minRow: 10, maxRow: 10 });
    // Entirely off the grid, and degenerate rects.
    expect(viewportTileRange(grid, { left: 4_800, top: 0, right: 5_400, bottom: 600 })).toBeNull();
    expect(viewportTileRange(grid, { left: -600, top: -600, right: 0, bottom: 0 })).toBeNull();
    expect(viewportTileRange(grid, { left: 10, top: 10, right: 10, bottom: 600 })).toBeNull();
  });

  it("streams only the tiles under the viewport, centred outward", () => {
    const view = harness();
    view.map.resize(1_000, 600);
    // 1000x600 at zoom 6 is 2.0509 screen px per metre, so the viewport covers 487.6 x 292.5 m.
    // Centred on the origin that is x in [-243.8, 243.8] and z in [-146.3, 146.3]; against 150 m
    // tiles laid from minX -650 and maxZ 1200 that is columns 2-5 and rows 7-8.
    view.map.centreOn([0, 0, 0], MAP_HOME_ZOOM);
    view.map.render();
    expect(view.map.visibleTiles().map((tile) => `${tile.column}/${tile.row}`)).toEqual([
      "2/7", "3/7", "4/7", "5/7",
      "2/8", "3/8", "4/8", "5/8",
    ]);

    const visible = new Set(view.map.visibleTiles().map((tile) => tile.path));
    const firstWave = tileRequests(view.requested);
    // Capped in flight, and every one of them is a tile the viewport is actually showing.
    expect(firstWave).toHaveLength(6);
    for (const request of firstWave) expect(visible.has(request), request).toBe(true);
    settle(view);
    expect(new Set(tileRequests(view.requested))).toEqual(visible);

    // Off-centre and off-axis. The map is drawn mirrored, and a reflected or transposed source
    // rect lands on the wrong side of the island here, where the symmetric case cannot tell.
    // Centre x 300, z 800 puts the viewport over x in [56.2, 543.8] and z in [653.7, 946.3].
    view.map.centreOn([300, 0, 800], MAP_HOME_ZOOM);
    view.map.render();
    expect(view.map.visibleTiles().map((tile) => `${tile.column}/${tile.row}`)).toEqual([
      "4/1", "5/1", "6/1", "7/1",
      "4/2", "5/2", "6/2", "7/2",
      "4/3", "5/3", "6/3", "7/3",
    ]);
  });

  it("keeps a flat level underneath while tiles arrive, so no frame goes blank", () => {
    const view = harness();
    view.map.resize(1_000, 600);
    view.map.centreOn([0, 0, 0], MAP_HOME_ZOOM);
    view.map.render();
    // Nothing has arrived yet: this is the only state that may show the loading plate.
    expect(view.context.drawImage).not.toHaveBeenCalled();
    expect(view.context.fillText).toHaveBeenCalledWith("Loading detailed map…", 500, 300);

    // The flat underlay lands first and covers the whole map in a single blit.
    const underlayImage = view.images.find((image) => image.src.includes(FLAT_HALF));
    load(underlayImage!);
    view.context.drawImage.mockClear();
    view.context.fillText.mockClear();
    view.map.render();
    expect(view.context.drawImage).toHaveBeenCalledTimes(1);
    expect(view.context.fillText).not.toHaveBeenCalled();

    // Half the tiles in: the underlay is still down, with the arrived tiles sharpening over it.
    const tileImages = view.images.filter((image) => image.src.includes("world-map-tile-"));
    for (const image of tileImages.slice(0, 3)) load(image);
    view.context.drawImage.mockClear();
    view.context.fillText.mockClear();
    view.map.render();
    expect(view.context.drawImage).toHaveBeenCalledTimes(1 + 3);
    expect(view.context.fillText).not.toHaveBeenCalled();

    // Once the viewport is fully tiled the underlay is hidden anyway, so the frame stops paying
    // for the whole-map blit and draws only the visible tiles.
    settle(view);
    view.context.drawImage.mockClear();
    view.context.fillText.mockClear();
    view.map.render();
    const visible = view.map.visibleTiles().length;
    expect(visible).toBe(8);
    expect(view.context.drawImage).toHaveBeenCalledTimes(visible);
    expect(view.context.fillText).not.toHaveBeenCalled();
    expect(view.context.scale).toHaveBeenCalledWith(-1, 1);
  });

  it("bounds the tile cache when panning across the island", () => {
    const view = harness();
    view.map.resize(1_000, 600);
    const sweep = [800, 500, 200, -100, -400];
    for (const z of sweep) {
      view.map.centreOn([300, 0, z], MAP_HOME_ZOOM);
      view.map.render();
      settle(view);
    }
    const touched = new Set(tileRequests(view.requested));
    expect(touched.size).toBeGreaterThan(MAP_TILE_CACHE_LIMIT);
    expect(view.map.visibleTiles().length).toBeLessThanOrEqual(MAP_TILE_CACHE_LIMIT);

    view.requested.length = 0;
    view.map.centreOn([300, 0, sweep[0]!], MAP_HOME_ZOOM);
    view.map.render();
    // Coming back re-requests what was dropped. Holding every tile the sweep touched would be
    // tens of megabytes of decoded bitmap; re-fetching a ~17 KB file is the cheaper side of that.
    expect(tileRequests(view.requested).length).toBeGreaterThan(0);
  });
});
