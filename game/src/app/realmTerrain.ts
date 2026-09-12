import type * as THREE from "three";
import { worldMapForRegion, type RegionId, type WorldMapId } from "../contracts.js";
import type { AssetRegistry } from "../render/assets.js";
import { WorldScene, type HeightfieldSamples, type Rect, type WorldTerrainSpec } from "../render/scene.js";
import type { GenerationCachePort } from "../world/generationCache.js";
import { ScatterStreamingController, type ScatterStreamingOptions } from "../world/scatterStreaming.js";

export interface RealmTerrainOptions {
  cache?: GenerationCachePort | null;
  /** Independent maps must not overwrite the surface terrain cache. */
  cacheKey?: string;
  /** Install the same material sources as the main scene before terrain shading. */
  configure?(scene: WorldScene): void;
  /** Stamp this map's own roads, water and paving during the production terrain build. */
  prepareSurface?(scene: WorldScene): void;
  visible?: boolean;
}

export interface RealmTerrain {
  readonly scene: WorldScene;
  readonly mapId: WorldMapId;
  readonly bounds: Readonly<Rect>;
  contains(x: number, z: number): boolean;
  heightAt(x: number, z: number): number;
  regionAt(x: number, z: number): RegionId;
  getWalkableMeshes(): THREE.Mesh[];
  heightfieldSamples(resolution?: number): HeightfieldSamples;
  setVisible(visible: boolean): void;
  updateStreaming(x: number, z: number, radius?: number): void;
  dispose(): void;
}

/**
 * Build another open terrain map through the normal terrain, material and camera-physics paths.
 * Coordinates stay in world space. Combining its meshes with the surface navmesh preserves a
 * disconnected island, which the ordinary portal route edges join without a walkable bridge.
 */
export async function createRealmTerrain(
  parent: THREE.Scene,
  spec: WorldTerrainSpec,
  options: RealmTerrainOptions = {},
): Promise<RealmTerrain> {
  const firstRegion = spec.regions[0];
  if (!firstRegion) throw new Error("Realm terrain needs at least one region.");
  const mapId = worldMapForRegion(firstRegion.regionId);
  if (spec.regions.some(region => worldMapForRegion(region.regionId) !== mapId)) {
    throw new Error("A terrain grid cannot connect regions from separate maps.");
  }

  const scene = new WorldScene(parent);
  scene.root.name = `corealm-${mapId}-world`;
  scene.root.visible = false;
  scene.materials.setFoliageOcclusionEnabled(false);
  try {
    options.configure?.(scene);
    if (options.cache) {
      await scene.buildWorldCached(options.cache, options.cacheKey ?? mapId, spec, options.prepareSurface);
    } else {
      await scene.buildWorldYielding(spec, options.prepareSurface);
    }
  } catch (cause) {
    scene.root.removeFromParent();
    scene.dispose();
    throw cause;
  }

  const bounds = Object.freeze({ ...scene.getScatterBounds(Infinity) });
  scene.root.visible = options.visible ?? false;
  return {
    scene,
    mapId,
    bounds,
    contains: (x, z) => x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ,
    heightAt: (x, z) => scene.meshHeightAt(x, z),
    regionAt: (x, z) => scene.regionAt(x, z),
    getWalkableMeshes: () => scene.getWalkableMeshes(),
    heightfieldSamples: resolution => scene.heightfieldSamples(resolution),
    setVisible: visible => { scene.root.visible = visible; },
    updateStreaming: (x, z, radius) => scene.updateStreaming(x, z, radius),
    dispose: () => {
      scene.root.removeFromParent();
      scene.dispose();
    },
  };
}

/**
 * The forest registry and exclusion zones are wired by boot before loading any tiles. Returning
 * the production controller keeps gathering descriptors, asset residency and cache behavior
 * identical in a compact lab map and the authored fairy world.
 */
export async function createRealmScatter(
  terrain: RealmTerrain,
  assets: AssetRegistry,
  seed: number,
  options: ScatterStreamingOptions = {},
): Promise<ScatterStreamingController> {
  if (!terrain.scene.hasNativeGrass()) {
    await assets.load("corealm_grass_1", { priority: "visible-spawn", primary: true });
    terrain.scene.setGrassSource(assets.instance("corealm_grass_1"));
  }
  return new ScatterStreamingController(terrain.scene, assets, seed, options);
}
