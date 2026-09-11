/**
 * Canvas2D view of the build-time rendered world map.
 *
 * Terrain, stamped roads, paving, water and settlement footprints are baked into north-up WebP
 * renditions before Vite builds the game. Runtime work is the selected pyramid level plus the DOM
 * marker layer owned by MapPanel.
 *
 * The pyramid has two shapes. The lower levels are single flat files, small enough to blit whole
 * and cheap enough to keep resident; they are the instant-draw underlay. The deepest level is cut
 * into 600 px serving tiles by tools/generate-world-map.ts, and only the tiles that intersect the
 * viewport are ever requested. That is what keeps a street-zoom pan responsive: the old top level
 * was a single 1 MB 4800x6600 file that had to arrive in full before anything sharpened, and every
 * frame resampled all 31.7 megapixels of it.
 */
import type { Vec3 } from "../contracts.js";
import {
  WORLD_MAP_DETAIL_RENDITIONS,
  WORLD_MAP_IMAGE_BOUNDS,
  WORLD_MAP_TILED_LEVELS,
} from "../generated/worldMapFingerprint.js";
import type { MapTerrainSource } from "./panels.js";

export interface MapScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

export interface WorldMapViewState {
  centreU: number;
  centreV: number;
  zoom: number;
  worldBounds: Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
}

interface ProjectedPoint {
  u: number;
  v: number;
}

interface ProjectedBounds {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

interface TerrainLevel {
  source: CanvasImageSource;
  width: number;
  height: number;
}

interface DetailRendition {
  readonly id: string;
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

interface TerrainLoadState {
  level: TerrainLevel | null;
  loading: HTMLImageElement | null;
  failures: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

interface TileDescriptor {
  readonly column: number;
  readonly row: number;
  readonly path: string;
  readonly sha256: string;
}

interface TiledLevel {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly tilePixels: number;
  readonly columns: number;
  readonly rows: number;
  readonly tiles: readonly TileDescriptor[];
}

interface TileLoadState {
  image: HTMLImageElement | null;
  loading: HTMLImageElement | null;
  failures: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  lastDrawn: number;
}

/** Grid geometry a viewport range needs. Split out so the solver can be tested on its own. */
export interface TileGrid {
  readonly width: number;
  readonly height: number;
  readonly tilePixels: number;
  readonly columns: number;
  readonly rows: number;
}

export interface TileRange {
  readonly minColumn: number;
  readonly maxColumn: number;
  readonly minRow: number;
  readonly maxRow: number;
}

/** Where a whole pyramid level lands on screen, in CSS pixels, before the horizontal mirror. */
interface TilePlacement {
  originX: number;
  originY: number;
  spanW: number;
  spanH: number;
}

function tileKey(level: TiledLevel, column: number, row: number): string {
  return `${level.id}/${column}/${row}`;
}

const VIEW_PADDING_PX = 18;
const LOAD_RETRY_DELAYS_MS = [250, 1_000] as const;
/**
 * A street-zoom viewport covers about a dozen 600 px tiles, so 24 holds the current screen plus
 * the ring a pan just left without letting a tour of the island accumulate the whole level. Each
 * decoded tile is ~1.4 MB of bitmap, which is the number that actually matters here, not the
 * ~17 KB it transferred as.
 */
export const MAP_TILE_CACHE_LIMIT = 24;
const MAX_CACHED_TILES = MAP_TILE_CACHE_LIMIT;
/** Keeps a fast zoom from opening twenty sockets at once; the rest follow as these land. */
const MAX_TILE_REQUESTS_IN_FLIGHT = 6;

/**
 * Tiles whose source rect intersects `view`, in level pixel space (top-left origin, +y south).
 * Returns null when the viewport misses the grid entirely. A boundary-exact right or bottom edge
 * belongs to the tile that ends there, not the next one, which is what `ceil(...) - 1` encodes.
 */
export function viewportTileRange(grid: TileGrid, view: {
  left: number;
  top: number;
  right: number;
  bottom: number;
}): TileRange | null {
  if (grid.tilePixels <= 0 || grid.columns <= 0 || grid.rows <= 0) return null;
  if (!(view.right > view.left) || !(view.bottom > view.top)) return null;
  if (view.right <= 0 || view.bottom <= 0 || view.left >= grid.width || view.top >= grid.height) {
    return null;
  }
  const minColumn = Math.max(0, Math.floor(view.left / grid.tilePixels));
  const maxColumn = Math.min(grid.columns - 1, Math.ceil(view.right / grid.tilePixels) - 1);
  const minRow = Math.max(0, Math.floor(view.top / grid.tilePixels));
  const maxRow = Math.min(grid.rows - 1, Math.ceil(view.bottom / grid.tilePixels) - 1);
  if (minColumn > maxColumn || minRow > maxRow) return null;
  return { minColumn, maxColumn, minRow, maxRow };
}

/**
 * Zoom 1 fits the whole map; MAP_HOME_ZOOM is the "street level" view the window opens at,
 * centred on the player, and it is what the toolbar labels 100%. The ceiling is twice home.
 * Exported so MapPanel's controls and readout stay in the same frame of reference.
 */
export const MAP_MIN_ZOOM = 1;
export const MAP_HOME_ZOOM = 6;
export const MAP_MAX_ZOOM = 12;
const MIN_ZOOM = MAP_MIN_ZOOM;
const MAX_ZOOM = MAP_MAX_ZOOM;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Owns the cached basemap and the pan/zoom transform. It deliberately knows nothing about labels,
 * discovery, destinations, or movement; MapPanel keeps those semantic layers in DOM/SVG.
 */
export class WorldMapCanvas {
  private readonly context: CanvasRenderingContext2D | null;
  private readonly terrainStates = new Map<string, TerrainLoadState>();
  private readonly tileStates = new Map<string, TileLoadState>();
  private readonly tileIndexes = new Map<string, ReadonlyMap<string, TileDescriptor>>();
  private drawStamp = 0;
  private renderFrame: number | null = null;
  private disposed = false;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private centreU = 0;
  private centreV = 0;
  private zoom = MIN_ZOOM;
  private viewReady = false;
  private projectedBounds: ProjectedBounds;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly source: MapTerrainSource,
  ) {
    this.context = canvas.getContext("2d", { alpha: false });
    this.projectedBounds = this.projectBounds(WORLD_MAP_IMAGE_BOUNDS);
  }

  resize(width: number, height: number): boolean {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    // Capped at 1.5, not 2: on a 2x display this canvas is the biggest raster in the app, and
    // the sharpness difference on a painted terrain map does not survive a blind test.
    const ratio = clamp(window.devicePixelRatio || 1, 1, 1.5);
    if (nextWidth === this.width && nextHeight === this.height && ratio === this.pixelRatio) return false;

    this.width = nextWidth;
    this.height = nextHeight;
    this.pixelRatio = ratio;
    this.canvas.width = Math.max(1, Math.round(nextWidth * ratio));
    this.canvas.height = Math.max(1, Math.round(nextHeight * ratio));
    this.canvas.style.width = `${nextWidth}px`;
    this.canvas.style.height = `${nextHeight}px`;
    if (this.viewReady) this.clampCentre();
    return true;
  }

  render(): void {
    if (!this.viewReady) this.resetView();
    const context = this.context;
    if (!context) return;

    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    context.fillStyle = "#121310";
    context.fillRect(0, 0, this.width, this.height);

    this.drawStamp += 1;
    const scale = this.screenScale();
    this.prepare(scale);
    const level = this.pickLoadedLevel(scale);
    const tiled = this.pickTiledLevel(scale);
    let painted = false;
    if (level || tiled) {
      const placement = this.placement(scale);
      context.imageSmoothingEnabled = true;
      // "medium", not "high": at a 2x-DPI megapixel canvas the high-quality resample is the
      // single most expensive part of a pan frame, and the difference is invisible in motion.
      context.imageSmoothingQuality = "medium";
      // Renditions store +x rightward; the display frame is +x leftward (see project()).
      context.save();
      context.scale(-1, 1);
      // The flat level goes down first and always covers the whole map, so a tile that has not
      // arrived shows the coarser image underneath rather than a hole. Tiles only ever sharpen.
      // Once every visible tile has landed the underlay is fully hidden, and the frame drops the
      // whole-map blit entirely: a settled street-zoom pan resamples about a dozen 600 px tiles
      // instead of the 7.9-megapixel 2400 level under them.
      if (level && !(tiled && this.tilesCoverViewport(tiled, placement))) {
        context.drawImage(
          level.source,
          -(placement.originX + placement.spanW),
          placement.originY,
          placement.spanW,
          placement.spanH,
        );
        painted = true;
      }
      if (tiled && this.drawTiles(context, tiled, placement)) painted = true;
      context.restore();
    }
    if (!painted) {
      this.paintFallback(context);
      this.paintLoadStatus(context);
    }

  }

  resetView(): void {
    const bounds = this.projectedBounds;
    this.centreU = (bounds.minU + bounds.maxU) / 2;
    this.centreV = (bounds.minV + bounds.maxV) / 2;
    this.zoom = MIN_ZOOM;
    this.viewReady = true;
    this.clampCentre();
  }

  /** Centre the view on a world position, optionally at a given zoom. Used by "open on player". */
  centreOn(position: Vec3, zoom?: number): void {
    if (!this.viewReady) this.resetView();
    if (zoom !== undefined) this.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const projected = this.project(position[0], position[1], position[2]);
    this.centreU = projected.u;
    this.centreV = projected.v;
    this.clampCentre();
  }

  zoomBy(factor: number, anchorX = this.width / 2, anchorY = this.height / 2): boolean {
    const before = this.mapAt(anchorX, anchorY);
    const next = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(next - this.zoom) < 1e-6) return false;
    this.zoom = next;
    const scale = this.screenScale();
    this.centreU = before.u - (anchorX - this.width / 2) / scale;
    this.centreV = before.v - (anchorY - this.height / 2) / scale;
    this.clampCentre();
    return true;
  }

  panByPixels(deltaX: number, deltaY: number): boolean {
    if (this.zoom <= MIN_ZOOM + 1e-6) return false;
    const previousU = this.centreU;
    const previousV = this.centreV;
    const scale = this.screenScale();
    this.centreU -= deltaX / scale;
    this.centreV -= deltaY / scale;
    this.clampCentre();
    return Math.abs(previousU - this.centreU) > 1e-6 || Math.abs(previousV - this.centreV) > 1e-6;
  }

  screen(position: Vec3): MapScreenPoint {
    const projected = this.project(position[0], position[1], position[2]);
    const point = this.toScreen(projected.u, projected.v);
    return {
      x: point.x,
      y: point.y,
      visible: point.x >= -24 && point.y >= -24 && point.x <= this.width + 24 && point.y <= this.height + 24,
    };
  }

  zoomLevel(): number {
    return this.zoom;
  }

  viewport(): Readonly<{ width: number; height: number }> {
    return { width: this.width, height: this.height };
  }

  /** JSON-safe state for browser acceptance checks. Projected U/V are the pan coordinate frame. */
  viewState(): WorldMapViewState {
    return {
      centreU: Math.round(this.centreU * 1000) / 1000,
      centreV: Math.round(this.centreV * 1000) / 1000,
      zoom: Math.round(this.zoom * 1000) / 1000,
      worldBounds: { ...this.source.bounds },
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.renderFrame !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.renderFrame);
    }
    this.renderFrame = null;
    for (const state of this.terrainStates.values()) {
      if (state.retryTimer !== null) clearTimeout(state.retryTimer);
      state.retryTimer = null;
      if (state.loading) state.loading.src = "";
      state.loading = null;
      state.level = null;
    }
    this.terrainStates.clear();
    for (const state of this.tileStates.values()) {
      if (state.retryTimer !== null) clearTimeout(state.retryTimer);
      state.retryTimer = null;
      if (state.loading) state.loading.src = "";
      state.loading = null;
      state.image = null;
    }
    this.tileStates.clear();
    this.tileIndexes.clear();
    this.canvas.width = 1;
    this.canvas.height = 1;
  }

  /**
   * Image requests begin here, and render() is only called once MapPanel opens. Constructing the
   * closed panel during UI boot therefore does not request any detail rendition.
   */
  private prepare(screenScale: number): void {
    if (this.disposed || !this.context) return;
    // The flat underlay is requested first on purpose: it is the frame that must never go blank,
    // and at the deepest zoom it is a quarter the pixels of the tiles it is standing in for.
    const rendition = this.pickRendition(screenScale);
    if (rendition) this.loadRendition(rendition);
    const tiled = this.pickTiledLevel(screenScale);
    if (tiled) this.requestVisibleTiles(tiled, screenScale);
    this.evictTiles(tiled, screenScale);
  }

  private stateFor(rendition: DetailRendition): TerrainLoadState {
    const existing = this.terrainStates.get(rendition.id);
    if (existing) return existing;
    const state: TerrainLoadState = {
      level: null,
      loading: null,
      failures: 0,
      retryTimer: null,
    };
    this.terrainStates.set(rendition.id, state);
    return state;
  }

  private loadRendition(rendition: DetailRendition): void {
    const state = this.stateFor(rendition);
    if (
      this.disposed
      || state.level
      || state.loading
      || state.retryTimer !== null
      || state.failures > LOAD_RETRY_DELAYS_MS.length
    ) return;
    const image = new Image();
    image.decoding = "async";
    state.loading = image;
    image.onload = () => {
      state.loading = null;
      if (this.disposed) return;
      state.failures = 0;
      state.level = {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      if (!this.viewReady) this.resetView();
      else this.clampCentre();
      this.scheduleRender();
    };
    image.onerror = () => {
      state.loading = null;
      if (this.disposed) return;
      state.failures += 1;
      const retryDelay = LOAD_RETRY_DELAYS_MS[state.failures - 1];
      if (retryDelay !== undefined) {
        state.retryTimer = setTimeout(() => {
          state.retryTimer = null;
          this.loadRendition(rendition);
        }, retryDelay);
      }
      const fallback = this.fallbackRendition(rendition);
      if (fallback) this.loadRendition(fallback);
      this.scheduleRender();
    };
    const imageUrl = new URL(rendition.path, document.baseURI);
    imageUrl.searchParams.set("v", rendition.sha256);
    image.src = imageUrl.href;
  }

  /**
   * Pick the smallest pregenerated flat rendition with at least one source pixel per screen pixel
   * at this zoom. The generator writes largest-first, so walking the list preserves stable ties.
   *
   * When the tiled level is carrying the zoom, flat levels at or above its resolution are removed
   * from the running: downloading the 1 MB flat 4800 as an underlay for tiles cut from the very
   * same pixels is exactly the transfer this change exists to stop. The flat file still exists and
   * is still reachable — `flatStandIn()` falls back to it when tiles cannot be fetched at all.
   */
  private pickRendition(screenScale: number): DetailRendition | null {
    const tiled = this.pickTiledLevel(screenScale);
    const renditions: readonly DetailRendition[] = tiled
      ? WORLD_MAP_DETAIL_RENDITIONS.filter((rendition) => rendition.width < tiled.width)
      : WORLD_MAP_DETAIL_RENDITIONS;
    const first = renditions[0];
    if (!first) return null;
    const spanU = Math.max(1, this.projectedBounds.maxU - this.projectedBounds.minU);
    const needPxPerUnit = screenScale * this.pixelRatio;
    let chosen = first;
    for (const rendition of renditions) {
      if (rendition.width / spanU >= needPxPerUnit) chosen = rendition;
      else break;
    }
    return chosen;
  }

  /**
   * The tiled level takes over exactly where the flat pyramid runs out: when no flat rendition
   * below it can still supply a source pixel per screen pixel. Below that zoom a flat blit is both
   * cheaper and enough, so tiles are never requested for the whole-island view.
   */
  private pickTiledLevel(screenScale: number): TiledLevel | null {
    const levels: readonly TiledLevel[] = WORLD_MAP_TILED_LEVELS;
    if (levels.length === 0) return null;
    const spanU = Math.max(1, this.projectedBounds.maxU - this.projectedBounds.minU);
    const needPxPerUnit = screenScale * this.pixelRatio;
    const widths = [
      ...WORLD_MAP_DETAIL_RENDITIONS.map((rendition) => rendition.width),
      ...levels.map((level) => level.width),
    ];
    const enough = widths.filter((width) => width / spanU >= needPxPerUnit);
    // Smallest level that is sharp enough, or the sharpest one there is. A flat and a tiled level
    // of the same width tie; the tiled one wins, because it delivers those pixels a screen at a time.
    const chosenWidth = enough.length > 0 ? Math.min(...enough) : Math.max(...widths);
    return levels.find((level) => level.width === chosenWidth) ?? null;
  }

  private pickLoadedLevel(screenScale: number): TerrainLevel | null {
    const spanU = Math.max(1, this.projectedBounds.maxU - this.projectedBounds.minU);
    const needPxPerUnit = screenScale * this.pixelRatio;
    let chosen: TerrainLevel | null = null;
    for (const rendition of WORLD_MAP_DETAIL_RENDITIONS) {
      const level = this.terrainStates.get(rendition.id)?.level ?? null;
      if (!level) continue;
      if (!chosen) chosen = level;
      if (level.width / spanU >= needPxPerUnit) chosen = level;
    }
    return chosen;
  }

  /** Screen box the whole pyramid level projects into, before the horizontal mirror. */
  private placement(scale: number): TilePlacement {
    const bounds = this.projectedBounds;
    const topLeft = this.toScreen(bounds.minU, bounds.minV);
    return {
      originX: topLeft.x,
      originY: topLeft.y,
      spanW: (bounds.maxU - bounds.minU) * scale,
      spanH: (bounds.maxV - bounds.minV) * scale,
    };
  }

  /**
   * Viewport in the level's own pixel space.
   *
   * The map is drawn mirrored (see project()), so level pixel 0 lands on the RIGHT edge of the
   * projected box and screen x runs the source backwards: `x = originX + spanW - sourceX * scale`.
   * Inverting that is the whole reason this is a named method — solving it the obvious way gives a
   * column range reflected about the map's centre, which looks plausible until the coast is on the
   * wrong side. Rows are not mirrored: row 0 is north, at the top.
   */
  private visibleRange(level: TiledLevel, placement: TilePlacement): TileRange | null {
    const pixelScale = placement.spanW / level.width;
    if (!(pixelScale > 0)) return null;
    const rightEdge = placement.originX + placement.spanW;
    return viewportTileRange(level, {
      left: (rightEdge - this.width) / pixelScale,
      right: rightEdge / pixelScale,
      top: -placement.originY / pixelScale,
      bottom: (this.height - placement.originY) / pixelScale,
    });
  }

  /**
   * Tiles the current viewport needs from the deepest level, row-major. Empty when a flat level
   * covers this zoom. Exposed for acceptance checks of the streaming window.
   */
  visibleTiles(): readonly { column: number; row: number; path: string }[] {
    if (!this.viewReady) this.resetView();
    const scale = this.screenScale();
    const level = this.pickTiledLevel(scale);
    if (!level) return [];
    const range = this.visibleRange(level, this.placement(scale));
    if (!range) return [];
    const tiles: { column: number; row: number; path: string }[] = [];
    for (let row = range.minRow; row <= range.maxRow; row += 1) {
      for (let column = range.minColumn; column <= range.maxColumn; column += 1) {
        const tile = this.tileFor(level, column, row);
        if (tile) tiles.push({ column, row, path: tile.path });
      }
    }
    return tiles;
  }

  /** True when every tile the viewport shows is decoded and ready to draw. */
  private tilesCoverViewport(level: TiledLevel, placement: TilePlacement): boolean {
    const range = this.visibleRange(level, placement);
    if (!range) return false;
    for (let row = range.minRow; row <= range.maxRow; row += 1) {
      for (let column = range.minColumn; column <= range.maxColumn; column += 1) {
        if (!this.tileStates.get(tileKey(level, column, row))?.image) return false;
      }
    }
    return true;
  }

  /** Composites the loaded part of the tiled level over the flat underlay. */
  private drawTiles(
    context: CanvasRenderingContext2D,
    level: TiledLevel,
    placement: TilePlacement,
  ): boolean {
    const range = this.visibleRange(level, placement);
    if (!range) return false;
    const step = level.tilePixels * (placement.spanW / level.width);
    // Mirrored frame: this is where level pixel 0 sits once context.scale(-1, 1) is applied.
    const originX = -(placement.originX + placement.spanW);
    let drew = false;
    for (let row = range.minRow; row <= range.maxRow; row += 1) {
      for (let column = range.minColumn; column <= range.maxColumn; column += 1) {
        const state = this.tileStates.get(tileKey(level, column, row));
        if (!state?.image) continue;
        state.lastDrawn = this.drawStamp;
        // Half a pixel of overdraw: tile edges land on fractional device pixels at most zooms,
        // and a smoothed blit otherwise leaves a hairline of the underlay showing between them.
        context.drawImage(
          state.image,
          originX + column * step,
          placement.originY + row * step,
          step + 0.5,
          step + 0.5,
        );
        drew = true;
      }
    }
    return drew;
  }

  /**
   * Requests the missing visible tiles, nearest the viewport centre first, under a small
   * in-flight cap. Whatever the cap defers is picked up by the render each landing tile triggers.
   */
  private requestVisibleTiles(level: TiledLevel, scale: number): void {
    const range = this.visibleRange(level, this.placement(scale));
    if (!range) return;
    const centreColumn = (range.minColumn + range.maxColumn) / 2;
    const centreRow = (range.minRow + range.maxRow) / 2;
    const wanted: { tile: TileDescriptor; distance: number }[] = [];
    let exhausted = false;
    let inFlight = 0;
    for (const state of this.tileStates.values()) if (state.loading) inFlight += 1;
    for (let row = range.minRow; row <= range.maxRow; row += 1) {
      for (let column = range.minColumn; column <= range.maxColumn; column += 1) {
        const tile = this.tileFor(level, column, row);
        if (!tile) continue;
        const state = this.tileStates.get(tileKey(level, column, row));
        if (state?.image || state?.loading || state?.retryTimer != null) continue;
        if (state && state.failures > LOAD_RETRY_DELAYS_MS.length) {
          exhausted = true;
          continue;
        }
        wanted.push({
          tile,
          distance: Math.abs(column - centreColumn) + Math.abs(row - centreRow),
        });
      }
    }
    // Tiles that have used up their retries mean the tile set is not being served at all. The
    // flat level of the same resolution is still on disk, so fall the whole level back to it.
    if (exhausted) {
      const standIn = this.flatStandIn(level);
      if (standIn) this.loadRendition(standIn);
    }
    wanted.sort((left, right) => left.distance - right.distance);
    for (const { tile } of wanted) {
      if (inFlight >= MAX_TILE_REQUESTS_IN_FLIGHT) break;
      this.loadTile(level, tile);
      inFlight += 1;
    }
  }

  private loadTile(level: TiledLevel, tile: TileDescriptor): void {
    const key = tileKey(level, tile.column, tile.row);
    let state = this.tileStates.get(key);
    if (!state) {
      state = { image: null, loading: null, failures: 0, retryTimer: null, lastDrawn: this.drawStamp };
      this.tileStates.set(key, state);
    }
    const entry = state;
    if (
      this.disposed
      || entry.image
      || entry.loading
      || entry.retryTimer !== null
      || entry.failures > LOAD_RETRY_DELAYS_MS.length
    ) return;
    const image = new Image();
    image.decoding = "async";
    entry.loading = image;
    image.onload = () => {
      entry.loading = null;
      if (this.disposed) return;
      entry.failures = 0;
      entry.image = image;
      entry.lastDrawn = this.drawStamp;
      this.scheduleRender();
    };
    image.onerror = () => {
      entry.loading = null;
      if (this.disposed) return;
      entry.failures += 1;
      const retryDelay = LOAD_RETRY_DELAYS_MS[entry.failures - 1];
      if (retryDelay !== undefined) {
        entry.retryTimer = setTimeout(() => {
          entry.retryTimer = null;
          this.loadTile(level, tile);
        }, retryDelay);
      }
      this.scheduleRender();
    };
    const imageUrl = new URL(tile.path, document.baseURI);
    imageUrl.searchParams.set("v", tile.sha256);
    image.src = imageUrl.href;
  }

  /**
   * Bounded tile cache. Panning the length of the island touches all 88 tiles; holding them would
   * be ~125 MB of decoded bitmap. Anything outside the current viewport is dropped once the cache
   * is over budget, least-recently-drawn first, and in-flight tiles are never dropped.
   */
  private evictTiles(level: TiledLevel | null, scale: number): void {
    if (this.tileStates.size <= MAX_CACHED_TILES) return;
    const keep = new Set<string>();
    if (level) {
      const range = this.visibleRange(level, this.placement(scale));
      if (range) {
        for (let row = range.minRow; row <= range.maxRow; row += 1) {
          for (let column = range.minColumn; column <= range.maxColumn; column += 1) {
            keep.add(tileKey(level, column, row));
          }
        }
      }
    }
    const candidates = [...this.tileStates.entries()]
      .filter(([key, state]) => !keep.has(key) && !state.loading)
      .sort(([, left], [, right]) => left.lastDrawn - right.lastDrawn);
    for (const [key, state] of candidates) {
      if (this.tileStates.size <= MAX_CACHED_TILES) break;
      if (state.retryTimer !== null) clearTimeout(state.retryTimer);
      state.image = null;
      this.tileStates.delete(key);
    }
  }

  private tileFor(level: TiledLevel, column: number, row: number): TileDescriptor | null {
    let index = this.tileIndexes.get(level.id);
    if (!index) {
      const built = new Map<string, TileDescriptor>();
      for (const tile of level.tiles) built.set(`${tile.column}/${tile.row}`, tile);
      index = built;
      this.tileIndexes.set(level.id, built);
    }
    return index.get(`${column}/${row}`) ?? null;
  }

  /** The flat rendition of the same resolution, kept as the last resort when tiles will not load. */
  private flatStandIn(level: TiledLevel): DetailRendition | null {
    const renditions: readonly DetailRendition[] = WORLD_MAP_DETAIL_RENDITIONS;
    return renditions.find((rendition) => rendition.width === level.width) ?? renditions[0] ?? null;
  }

  /**
   * A viewport can land a dozen tiles within a few milliseconds of each other. Coalesce their
   * repaints into one frame instead of resampling the canvas once per arrival. Without an
   * animation frame clock (tests, workers) the repaint stays synchronous.
   */
  private scheduleRender(): void {
    if (this.disposed) return;
    if (typeof requestAnimationFrame !== "function") {
      this.render();
      return;
    }
    if (this.renderFrame !== null) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      if (!this.disposed) this.render();
    });
  }

  /** Use another pregenerated level while the preferred file retries. */
  private fallbackRendition(failed: DetailRendition): DetailRendition | null {
    const renditions: readonly DetailRendition[] = WORLD_MAP_DETAIL_RENDITIONS;
    const index = renditions.findIndex((rendition) => rendition.id === failed.id);
    if (index < 0) return null;
    return renditions[index + 1] ?? renditions[index - 1] ?? null;
  }

  /**
   * North (+z) up and — deliberately — world +x to the LEFT. The world is right-handed and Y-up:
   * standing in it facing +z, +x is on your left, so a map that drew +x rightward was mirrored
   * against everything the player sees. The baked PNG is stored +x-rightward, so render() flips
   * it horizontally to match this frame; markers, the pip and clicks all come through here.
   */
  private project(x: number, _height: number, z: number): ProjectedPoint {
    return { u: -x, v: -z };
  }

  private projectBounds(bounds: Readonly<{
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  }>): ProjectedBounds {
    const corners = [
      this.project(bounds.minX, 0, bounds.minZ),
      this.project(bounds.maxX, 0, bounds.minZ),
      this.project(bounds.minX, 0, bounds.maxZ),
      this.project(bounds.maxX, 0, bounds.maxZ),
    ];
    return {
      minU: Math.min(...corners.map((point) => point.u)),
      maxU: Math.max(...corners.map((point) => point.u)),
      minV: Math.min(...corners.map((point) => point.v)),
      maxV: Math.max(...corners.map((point) => point.v)),
    };
  }

  private fitScale(): number {
    const bounds = this.projectedBounds;
    const availableWidth = Math.max(1, this.width - VIEW_PADDING_PX * 2);
    const availableHeight = Math.max(1, this.height - VIEW_PADDING_PX * 2);
    return Math.min(
      availableWidth / Math.max(1, bounds.maxU - bounds.minU),
      availableHeight / Math.max(1, bounds.maxV - bounds.minV),
    );
  }

  private screenScale(): number {
    return this.fitScale() * this.zoom;
  }

  private toScreen(u: number, v: number): { x: number; y: number } {
    const scale = this.screenScale();
    return {
      x: this.width / 2 + (u - this.centreU) * scale,
      y: this.height / 2 + (v - this.centreV) * scale,
    };
  }

  private mapAt(x: number, y: number): ProjectedPoint {
    const scale = this.screenScale();
    return {
      u: this.centreU + (x - this.width / 2) / scale,
      v: this.centreV + (y - this.height / 2) / scale,
    };
  }

  private clampCentre(): void {
    const bounds = this.projectedBounds;
    const scale = this.screenScale();
    const halfU = this.width / (2 * scale);
    const halfV = this.height / (2 * scale);
    this.centreU = halfU * 2 >= bounds.maxU - bounds.minU
      ? (bounds.minU + bounds.maxU) / 2
      : clamp(this.centreU, bounds.minU + halfU, bounds.maxU - halfU);
    this.centreV = halfV * 2 >= bounds.maxV - bounds.minV
      ? (bounds.minV + bounds.maxV) / 2
      : clamp(this.centreV, bounds.minV + halfV, bounds.maxV - halfV);
  }

  private paintFallback(context: CanvasRenderingContext2D): void {
    const bounds = this.projectedBounds;
    const topLeft = this.toScreen(bounds.minU, bounds.minV);
    const bottomRight = this.toScreen(bounds.maxU, bounds.maxV);
    context.fillStyle = "#33372b";
    context.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  }

  private paintLoadStatus(context: CanvasRenderingContext2D): void {
    const states = [...this.terrainStates.values()];
    const exhausted = states.length > 0 && states.every((state) =>
      !state.level
      && !state.loading
      && state.retryTimer === null
      && state.failures > LOAD_RETRY_DELAYS_MS.length
    );
    context.save();
    context.fillStyle = "rgba(8, 10, 8, 0.82)";
    context.fillRect(0, 0, this.width, this.height);
    context.fillStyle = exhausted ? "#f2b8a8" : "#e8ddbf";
    context.font = "600 15px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(exhausted ? "Detailed map unavailable" : "Loading detailed map…", this.width / 2, this.height / 2);
    context.restore();
  }
}
