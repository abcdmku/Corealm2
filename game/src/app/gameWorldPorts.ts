import type { RegionId } from "../contracts.js";
import type { HabitatDef } from "../content/worldHabitats.js";
import { WORLD_SITES, type WorldSite } from "../content/worldSites.js";
import type { WorldScene } from "../render/scene.js";
import { fishingSiteAnchors } from "./fishingAccess.js";
import { miningAccessPositions } from "./miningAccess.js";

/**
 * What `buildSemanticWorld` and site dressing read from the built terrain. `app/boot.ts` and the
 * Node world bake (`world/bake/nodeWorldBake.ts`) both call these, so the two bakes place the
 * world through one definition.
 */

/** The authored world sites, then every habitat as a setting of its own dressing. */
export function worldSettings(habitats: readonly HabitatDef[]): WorldSite[] {
  return [...WORLD_SITES, ...habitats.map((habitat): WorldSite => ({
    id: habitat.id, locationId: habitat.groupId, regionId: habitat.regionId, centre: [0, 0], rotationY: 0, kind: "habitat",
    workRadius: 0, extent: [0, 0], terrain: { floorRadius: 0, backRise: 0, backDistance: 0, bermWidth: 0, approachAngle: 0 },
    resourceSlots: [], dressing: habitat.dressing,
  }))];
}

export interface WorldPortAssets {
  baseY(id: string): number;
  assetSize(id: string): { x: number; y: number; z: number } | null;
  assetCenterXZ(id: string): { x: number; z: number } | null;
}

/**
 * The world ports. `baseY` is the measured bbox minimum of each GLB, so an entity is placed by its
 * feet rather than its origin; `assetSize` sizes the collision volumes. Fishing and mining access
 * positions exist only in the authored game (`authoredAccess`).
 */
export function gameWorldPorts(options: {
  scene: WorldScene; fairyScene: WorldScene | null; terrainAt: (x: number, z: number) => WorldScene;
  heightAt: (regionId: RegionId, x: number, z: number) => number;
  assets: WorldPortAssets; dungeonGates: boolean; authoredAccess: boolean;
}) {
  const { scene, terrainAt, assets, authoredAccess } = options;
  const meshHeightAt = (x: number, z: number) => terrainAt(x, z).meshHeightAt(x, z);
  const roadPolylines = [...scene.getRoadPolylines(), ...(options.fairyScene?.getRoadPolylines() ?? [])];
  const roadDistance = (x: number, z: number): number => {
    let best = Infinity;
    for (const line of roadPolylines) {
      for (let index = 0; index < line.length - 1; index += 1) {
        const a = line[index]!, b = line[index + 1]!;
        const dx = b[0] - a[0], dz = b[2] - a[2];
        const lengthSq = dx * dx + dz * dz;
        const t = lengthSq <= 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / lengthSq));
        best = Math.min(best, Math.hypot(x - (a[0] + dx * t), z - (a[2] + dz * t)));
      }
    }
    return best;
  };
  // One pass over the solved water bodies yields both halves of a fishery: the dry stance and the
  // school it faces. They have to come from the same solved contour or they drift apart.
  let fishingAnchors: ReturnType<typeof fishingSiteAnchors> | undefined;
  const getFishingAnchors = () => fishingAnchors ??= fishingSiteAnchors(WORLD_SITES, scene.getWaterBodies(), meshHeightAt);
  return {
    heightAt: options.heightAt,
    dungeonGates: options.dungeonGates,
    get accessPositions() {
      return authoredAccess ? new Map([...getFishingAnchors().banks, ...miningAccessPositions(WORLD_SITES, meshHeightAt, {
        assetSize: id => assets.assetSize(id), assetCenterXZ: id => assets.assetCenterXZ(id) })]) : undefined;
    },
    get fishingSchools() { return authoredAccess ? getFishingAnchors().schools : undefined; },
    baseY: (assetId: string): number => assets.baseY(assetId),
    assetSize: (assetId: string) => assets.assetSize(assetId),
    assetCenterXZ: (assetId: string) => assets.assetCenterXZ(assetId),
    roadDistance,
    minibossCanStand: (regionId: RegionId, x: number, z: number) => {
      const sample = terrainAt(x, z).sampleWorld(x, z);
      return sample.playable && sample.semanticRegion === regionId && sample.waterBodyId === null && sample.slope !== null && sample.slope <= .5;
    },
  };
}
