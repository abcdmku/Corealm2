import type { GenerationCachePort } from "./generationCache.js";
import type { RegionId } from "../contracts.js";
import { yieldToMainThread } from "../core/yield.js";
import type { AssetPriority, AssetRegistry } from "../render/assets.js";
import type { WorldScene } from "../render/scene.js";
import {
  DEFAULT_SCATTER,
  mergeScatterResults,
  scatterTileAt,
  scatterTilesForBounds,
  scatterWorldTile,
  type RegionScatterSpec,
  type ScatterResult,
  type ScatterTile,
  type ScatterTileLoadOptions,
} from "./scatter.js";

export interface ScatterResidency {
  /** Canonically ordered generation-tile ids that have meshes in the scene. */
  resident: string[];
  /** Canonically ordered ids that are in flight or have not started. */
  pending: string[];
  total: number;
  complete: boolean;
}

export interface ScatterStreamingOptions {
  cache?: GenerationCachePort;
  specs?: Partial<Record<RegionId, RegionScatterSpec>>;
  /** Spawn tile plus this many rows and columns. Defaults to one near ring. */
  nearRing?: number;
  /** Called between background tiles. Tests may supply a resolved promise. */
  yieldToMain?: () => Promise<void>;
  onTree?: ScatterTileLoadOptions["onTree"];
}

/**
 * Scatter residency owns generation and rendering order. Resource descriptors cross the onTree
 * port after their meshes exist; the forest resource controller owns semantic state and saves.
 */
export class ScatterStreamingController {
  private readonly specs: Partial<Record<RegionId, RegionScatterSpec>>;
  private readonly nearRing: number;
  private readonly yieldToMain: () => Promise<void>;
  private readonly yieldBackground: () => Promise<void>;
  private readonly onTree: ScatterTileLoadOptions["onTree"];
  private readonly tiles: ScatterTile[];
  private readonly tilesById: Map<string, ScatterTile>;
  private readonly resident = new Set<string>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly resultsByTile = new Map<string, ScatterResult[]>();
  private activeX = 0;
  private activeZ = 0;
  private background: Promise<void> | null = null;
  private wantedRadius = Infinity;

  constructor(
    private readonly scene: WorldScene,
    private readonly assets: AssetRegistry,
    private readonly seed: number,
    private readonly options: ScatterStreamingOptions = {},
  ) {
    this.specs = options.specs ?? DEFAULT_SCATTER;
    this.nearRing = Math.max(0, Math.floor(options.nearRing ?? 1));
    this.onTree = options.onTree;
    let sliceStarted = performance.now();
    this.yieldToMain = options.yieldToMain ?? (async () => {
      // Empty phases and tiny clusters should not each spend a whole browser task. Give input
      // and rendering a turn after a bounded amount of real work, independent of recipe count.
      if (performance.now() - sliceStarted < 4) return;
      await yieldToMainThread();
      sliceStarted = performance.now();
    });
    let backgroundStarted = performance.now();
    this.yieldBackground = options.yieldToMain ?? (async () => {
      if (performance.now() - backgroundStarted < 3) return;
      if (typeof requestAnimationFrame === "function" && !document.hidden) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      } else await yieldToMainThread();
      backgroundStarted = performance.now();
    });
    this.tiles = scatterTilesForBounds(scene.getScatterBounds(Infinity));
    this.tilesById = new Map(this.tiles.map((tile) => [tile.id, tile]));
  }

  setActivePosition(x: number, z: number): void {
    this.activeX = x;
    this.activeZ = z;
  }

  /** Loads the spawn tile and its square near ring, nearest first. */
  async loadSpawn(x: number, z: number, ring = this.nearRing): Promise<ScatterResult[]> {
    this.setActivePosition(x, z);
    const centre = scatterTileAt(x, z);
    const reach = Math.max(0, Math.floor(ring));
    const wanted = this.tiles.filter((tile) => (
      Math.abs(tile.col - centre.col) <= reach && Math.abs(tile.row - centre.row) <= reach
    ));
    await this.ensureTilesWithPriority(wanted, "visible-spawn", true);
    return this.getStats();
  }

  /** Finish the visible circle before reveal, including tiles across generation-grid edges. */
  async loadView(x: number, z: number, radius: number): Promise<ScatterResult[]> {
    if (!Number.isFinite(radius) || radius < 0) throw new Error("Scatter radius must be finite and nonnegative");
    this.setActivePosition(x, z);
    const wanted = this.tiles.filter(tile => this.intersectsCircle(tile, x, z, radius));
    return this.ensureTilesWithPriority(wanted, "visible-spawn", true);
  }

  /** Idempotently loads explicit tiles. Duplicate and concurrent requests share one promise. */
  async ensureTiles(
    tiles: readonly (ScatterTile | string)[],
    priority: AssetPriority = "travel-prefetch",
  ): Promise<ScatterResult[]> {
    return this.ensureTilesWithPriority(tiles, priority, false);
  }

  private async ensureTilesWithPriority(
    tiles: readonly (ScatterTile | string)[],
    priority: AssetPriority,
    primary: boolean,
  ): Promise<ScatterResult[]> {
    const wanted = new Map<string, ScatterTile>();
    for (const request of tiles) {
      const tile = typeof request === "string" ? this.tilesById.get(request) : this.tilesById.get(request.id);
      if (tile) wanted.set(tile.id, tile);
    }
    const ordered = this.sortByActiveDistance([...wanted.values()]);
    for (let index = 0; index < ordered.length; index += 1) {
      const tile = ordered[index]!;
      await this.ensureTile(tile, priority, primary);
      if (index + 1 < ordered.length) await this.yieldToMain();
    }
    return this.getStats();
  }

  /**
   * Streams every non-resident tile with a main-thread yield between tiles. Active-position changes
   * reprioritize the next pick without changing any tile's seed or contents.
   */
  streamRemaining(): Promise<void> {
    this.wantedRadius = Infinity;
    return this.startBackground();
  }

  /** Generate only chunks intersecting the view/prefetch circle. Visited chunks remain cached. */
  streamNearby(x: number, z: number, radius: number): Promise<void> {
    if (!Number.isFinite(radius) || radius < 0) throw new Error("Scatter radius must be finite and nonnegative");
    this.setActivePosition(x, z);
    this.wantedRadius = radius;
    return this.startBackground();
  }

  /** Let an in-flight chunk finish, but do not start surface work inside an interior. */
  suspend(): void { this.wantedRadius = -1; }

  private startBackground(): Promise<void> {
    if (this.background) return this.background;
    this.background = this.runBackground().finally(() => {
      this.background = null;
    });
    return this.background;
  }

  /** Map capture bypasses background scheduling and waits for the full island. */
  async forceFullResidency(): Promise<ScatterResult[]> {
    await this.ensureTilesWithPriority(this.tiles, "background", false);
    return this.getStats();
  }

  getStats(): ScatterResult[] {
    return mergeScatterResults([...this.resultsByTile.values()].flat(), this.specs);
  }

  getResidency(): ScatterResidency {
    const resident = this.tiles.filter((tile) => this.resident.has(tile.id)).map((tile) => tile.id);
    const pending = this.tiles.filter((tile) => !this.resident.has(tile.id)).map((tile) => tile.id);
    return {
      resident,
      pending,
      total: this.tiles.length,
      complete: resident.length === this.tiles.length,
    };
  }

  private async runBackground(): Promise<void> {
    while (this.resident.size < this.tiles.length) {
      const next = this.sortByActiveDistance(
        this.tiles.filter((tile) => this.isWanted(tile) && !this.resident.has(tile.id) && !this.inFlight.has(tile.id)),
      )[0];
      if (!next) {
        if (this.inFlight.size === 0) break;
        await Promise.all(this.inFlight.values());
        continue;
      }
      await this.ensureTile(next, "background", false);
      await this.yieldBackground();
    }
  }

  private isWanted(tile: ScatterTile): boolean {
    if (this.wantedRadius < 0) return false;
    return this.intersectsCircle(tile, this.activeX, this.activeZ, this.wantedRadius);
  }

  private intersectsCircle(tile: ScatterTile, x: number, z: number, radius: number): boolean {
    const dx = Math.max(tile.bounds.minX - x, 0, x - tile.bounds.maxX);
    const dz = Math.max(tile.bounds.minZ - z, 0, z - tile.bounds.maxZ);
    return dx * dx + dz * dz <= radius * radius;
  }

  private async ensureTile(tile: ScatterTile, priority: AssetPriority, primary: boolean): Promise<void> {
    if (this.resident.has(tile.id)) return;
    const existing = this.inFlight.get(tile.id);
    if (existing) return existing;

    const request = scatterWorldTile(
      this.scene,
      this.assets,
      this.seed,
      tile,
      this.specs,
      {
        priority,
        primary,
        // Spawn-visible work stays unscoped so an organic biome lobe crossing a semantic border
        // cannot be demoted. Deferred work follows the tile's semantic owner.
        regionId: priority === "visible-spawn" ? undefined : this.semanticRegionForTile(tile),
        yieldToMain: primary ? this.yieldToMain : this.yieldBackground,
        onTree: this.onTree,
        cache: this.options.cache,
      },
    )
      .then((results) => {
        this.resultsByTile.set(tile.id, results);
        this.resident.add(tile.id);
      })
      .finally(() => {
        this.inFlight.delete(tile.id);
      });
    this.inFlight.set(tile.id, request);
    return request;
  }

  private sortByActiveDistance(tiles: ScatterTile[]): ScatterTile[] {
    return tiles.sort((left, right) => {
      const leftX = (left.bounds.minX + left.bounds.maxX) * 0.5 - this.activeX;
      const leftZ = (left.bounds.minZ + left.bounds.maxZ) * 0.5 - this.activeZ;
      const rightX = (right.bounds.minX + right.bounds.maxX) * 0.5 - this.activeX;
      const rightZ = (right.bounds.minZ + right.bounds.maxZ) * 0.5 - this.activeZ;
      const distance = leftX * leftX + leftZ * leftZ - rightX * rightX - rightZ * rightZ;
      return distance || left.row - right.row || left.col - right.col;
    });
  }

  private semanticRegionForTile(tile: ScatterTile): RegionId | undefined {
    const x = (tile.bounds.minX + tile.bounds.maxX) * 0.5;
    const z = (tile.bounds.minZ + tile.bounds.maxZ) * 0.5;
    let nearest: { regionId: RegionId; distance: number } | null = null;
    for (const layout of this.scene.describeRegions()) {
      const rect = this.scene.getRegionRect(layout.regionId);
      if (!rect) continue;
      if (x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ) {
        return layout.regionId;
      }
      const dx = x < rect.minX ? rect.minX - x : x > rect.maxX ? x - rect.maxX : 0;
      const dz = z < rect.minZ ? rect.minZ - z : z > rect.maxZ ? z - rect.maxZ : 0;
      const distance = dx * dx + dz * dz;
      if (!nearest || distance < nearest.distance) nearest = { regionId: layout.regionId, distance };
    }
    return nearest?.regionId;
  }
}
