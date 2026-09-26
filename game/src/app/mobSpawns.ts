import type { SemanticEntity, SolidVolume } from "../contracts.js";
import type { Vec3 } from "../contracts.js";
import type { HabitatDef } from "../content/worldHabitats.js";
import type { PlacementTerrain } from "../world/terrainSampler.js";
import { chamberFloorAt, dungeonFloorHeight, type DungeonSpec } from "../world/dungeonLayout.js";
import type { Navigation } from "../systems/navigation.js";
import { Solids } from "../systems/solids.js";
import { spreadMobSpawns } from "../world/mobSpawnSpacing.js";
import type { authoredThresholds } from "../world/dungeonDoors.js";
import type { BootProfile } from "./bootProfile.js";

import { refineCreaturePopulation } from "../world/creaturePopulation.js";
import type { MobSpawnSpacingPorts } from "../world/mobSpawnSpacing.js";
import { REGIONS } from "../content/regions.js";
import { LEASH_METRES } from "../world/habitatMovement.js";

interface SpawnPlacementOptions {
  /** `scene` is the drawn terrain on the client and a baked terrain sampler on the server. */
  solids: readonly SolidVolume[]; scene: PlacementTerrain; nav: Pick<Navigation, "nearestWalkable">;
  dungeonSpec: DungeonSpec | null; doorThresholds: ReturnType<typeof authoredThresholds>; profile: Pick<BootProfile, "kind" | "spawn">;
  terrainAt?: (x: number, z: number) => PlacementTerrain;
  assetSize?: (assetId: string) => { y: number } | null;
}

/** Shared body placement rules; browser boot may cache the resulting placements. */
export function mobSpawnPlacementPorts({solids, scene, nav, dungeonSpec, doorThresholds, profile, terrainAt = () => scene}: SpawnPlacementOptions): MobSpawnSpacingPorts {
    const placementSolids = new Solids(solids);
    // Cover the whole town, including gates and services, rather than just its map marker.
    const towns = REGIONS.flatMap(region => region.settlements.map(town => {
      const reach = (point: readonly number[], margin = 0): number =>
        Math.hypot(point[0]! - town.centre[0], point[1]! - town.centre[1]) + margin;
      const radius = Math.max(24,
        ...town.buildings.map(building => reach(building.position, Math.hypot(...building.footprint) / 2)),
        ...[town.bank, ...town.stations, ...town.shops, ...town.npcs].map(service => reach(service.position)),
        ...(town.walls ?? []).flatMap(wall => [reach(wall.from), reach(wall.to)]));
      return { centre: town.centre, radius: radius + 5 };
    }));
    return {
      underground: regionId => regionId === dungeonSpec?.regionId,
      place: (entity, x, z, radius) => {
        const underground = entity.regionId === dungeonSpec?.regionId;
        if (!underground && profile.kind === 'game' && entity.meta?.behaviour !== 'passive') {
          // Even a pursued creature reaching its full leash stays outside the inhabited edge.
          // The extra aggro margin keeps an idle predator from spotting someone at the gate.
          const threat = entity.meta?.behaviour === 'aggressive'
            ? 8 + Math.min(10, (entity.combat?.level ?? 1) * .12) : 0;
          const safety = LEASH_METRES + Math.max(6, entity.combat?.aggroRadius ?? 0) + radius + threat;
          if (towns.some(town => Math.hypot(x - town.centre[0], z - town.centre[1]) < town.radius + safety)) return null;
        }
        if (underground) {
          for (const threshold of doorThresholds) {
            const side = (px: number, pz: number) => (px - threshold.origin[0]) * Math.sin(threshold.rotationY)
              + (pz - threshold.origin[2]) * Math.cos(threshold.rotationY);
            const originalSide = side(entity.position[0], entity.position[2]);
            if (side(x, z) * Math.sign(originalSide) < radius + .4) return null;
          }
        } else if (profile.kind === 'game' && Math.hypot(x - profile.spawn.x, z - profile.spawn.z) < radius + 25) {
          // The owner placed these passive worms on the south-wall verge inside
          // the starter buffer. Keep the exception within that authored patch;
          // normal body clearance, dry ground and navigation checks still apply.
          const southWallWorm = entity.meta?.groupId === 'coldbrace_red_worms'
            && entity.meta?.behaviour === 'passive' && x > -154 && x < -132 && z > -129 && z < -112;
          if (!southWallWorm) return null;
        }
        const floor = (px: number, pz: number): number | null => {
          if (underground) return chamberFloorAt(dungeonSpec!, [px, entity.position[1], pz]);
          if (profile.kind === 'feature-lab') return Math.abs(px) < 120 && Math.abs(pz) < 120 ? scene.meshHeightAt(px, pz) : null;
          const sample = terrainAt(px, pz).placementSurfaceAt(px, pz);
          return sample && sample.semanticRegion === entity.regionId && !sample.waterBodyId
            && sample.slope < .65 ? sample.height : null;
        };
        const y = floor(x, z);
        if (y === null) return null;
        const point: Vec3 = [x, y, z];
        const resolved = placementSolids.resolve(point, point, radius + .4);
        if (Math.hypot(resolved[0] - x, resolved[2] - z) > .001) return null;
        for (let index = 0; index < 16; index++) {
          const angle = index * Math.PI / 8;
          const edge = floor(x + Math.cos(angle) * (radius + .4), z + Math.sin(angle) * (radius + .4));
          if (edge === null || Math.abs(edge - y) > Math.max(1, radius * .65)) return null;
        }
        const snapped = nav.nearestWalkable(point, .3);
        if (!snapped || Math.hypot(snapped[0] - x, snapped[2] - z) > .3 || Math.abs(snapped[1] - y) > .6) return null;
        const originalFloor = underground ? dungeonFloorHeight(dungeonSpec!, entity.position[0], entity.position[2])
          : terrainAt(entity.position[0], entity.position[2]).meshHeightAt(entity.position[0], entity.position[2]);
        return [x, y + entity.position[1] - originalFloor, z];
      },
    };
}

export function prepareMobSpawns(actors: SemanticEntity[], worldHabitats: readonly HabitatDef[], options: SpawnPlacementOptions): HabitatDef[] {
  if (options.profile.kind === "game") {
    const residents = refineCreaturePopulation(actors, undefined, options.assetSize);
    actors.splice(0, actors.length, ...residents);
  }
  return spreadMobSpawns(actors, worldHabitats, mobSpawnPlacementPorts(options));
}
