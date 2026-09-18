import type { SemanticEntity, SolidVolume } from "../contracts.js";
import type { Vec3 } from "../contracts.js";
import type { HabitatDef } from "../content/worldHabitats.js";
import type { WorldScene } from "../render/scene.js";
import { chamberFloorAt, dungeonFloorHeight, type DungeonSpec } from "../render/dungeon.js";
import type { Navigation } from "../systems/navigation.js";
import { Solids } from "../systems/solids.js";
import { spreadMobSpawns } from "../world/mobSpawnSpacing.js";
import type { authoredThresholds } from "../world/dungeonDoors.js";
import type { BootProfile } from "./bootProfile.js";

import { refineCreaturePopulation } from "../world/creaturePopulation.js";
import type { MobSpawnSpacingPorts } from "../world/mobSpawnSpacing.js";

interface SpawnPlacementOptions {
  solids: readonly SolidVolume[]; scene: WorldScene; nav: Navigation;
  dungeonSpec: DungeonSpec | null; doorThresholds: ReturnType<typeof authoredThresholds>; profile: BootProfile;
  terrainAt?: (x: number, z: number) => WorldScene;
  assetSize?: (assetId: string) => { y: number } | null;
}

/** Shared body placement rules; browser boot may cache the resulting placements. */
export function mobSpawnPlacementPorts(worldHabitats: readonly HabitatDef[],
  {solids, scene, nav, dungeonSpec, doorThresholds, profile, terrainAt = () => scene}: SpawnPlacementOptions): MobSpawnSpacingPorts {
    const placementSolids = new Solids(solids);
    const habitatSources = new Map(worldHabitats.map(habitat => [habitat.groupId, habitat]));
    return {
      underground: regionId => regionId === dungeonSpec?.regionId,
      place: (entity, x, z, radius) => {
        const underground = entity.regionId === dungeonSpec?.regionId;
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
          const coast = habitatSources.get(String(entity.meta?.groupId))?.boundary === 'playable-coast';
          return sample && (coast || sample.semanticRegion === entity.regionId) && !sample.waterBodyId
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
  return spreadMobSpawns(actors, worldHabitats, mobSpawnPlacementPorts(worldHabitats, options));
}
