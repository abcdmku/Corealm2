import type { RegionId, Vec3 } from '../contracts.js';
import { REGIONS } from './regions.js';
import { regionForPoint } from './regionOwnership.js';
import { WORLD_CONTENT } from './worldData.js';

export interface HabitatDef {
  /** Spaced residents idle near their own spawn instead of sharing the pack's patrol sockets. */
  readonly roamRadius?: number;
  readonly id: string;
  readonly groupId: string;
  readonly regionId: RegionId;
  readonly centre: readonly [number, number];
  readonly radius: number;
  /** World-space spawn and activity points. The first group.count points preserve actor order. */
  readonly anchors: readonly (readonly [number, number])[];
  readonly activity: "graze" | "forage" | "prowl" | "patrol";
  /** World-space setting pieces. Existing yards already have their own dressing. */
  readonly dressing: readonly {
    readonly id: string;
    readonly assetId: string;
    readonly x: number;
    readonly z: number;
    readonly yaw: number;
    readonly scale: number | [number, number, number];
    readonly sink?: number;
  }[];
}

/** One containment rule for AI destinations, pursuit and the corresponding tree-clearance paths. */
export function habitatContains(habitat: HabitatDef, position: Vec3): boolean {
  const [x, , z] = position;
  if (!Number.isFinite(x) || !Number.isFinite(z)
    || Math.hypot(x - habitat.centre[0], z - habitat.centre[1]) > habitat.radius) return false;
  // The same ownership as terrain regionAt, including land beyond the core rectangles.
  if (REGIONS.some(region => region.dungeon?.id === habitat.regionId)) return true;
  return regionForPoint(REGIONS, x, z)?.id === habitat.regionId;
}


export const WORLD_HABITATS = WORLD_CONTENT.habitats.filter(habitat => REGIONS.some(region => region.id === habitat.regionId));
const HABITAT_BY_GROUP = new Map(WORLD_CONTENT.habitats.map(habitat => [habitat.groupId, habitat]));
export function habitatForGroup(groupId: string): HabitatDef | null { return HABITAT_BY_GROUP.get(groupId) ?? null; }
/** After a live publish, once `reindexWorldContent` ran. Both are refilled in place for the modules that hold them. */
export function reindexHabitats(): void {
  WORLD_HABITATS.splice(0, WORLD_HABITATS.length, ...WORLD_CONTENT.habitats.filter(habitat => REGIONS.some(region => region.id === habitat.regionId)));
  HABITAT_BY_GROUP.clear();
  for (const habitat of WORLD_CONTENT.habitats) HABITAT_BY_GROUP.set(habitat.groupId, habitat);
}
