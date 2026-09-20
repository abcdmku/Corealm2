import { RESOLVED_TABLES } from './resolvedCatalog.js';
import type { EncounterDefinition, WorldPlacement, ResourcePlacement } from './schema/encounters.js';
import type { WorldRegionGeometry } from './schema/worldRegions.js';
import type { EnemyGroupDef } from './regions.js';
import type { HabitatDef } from './worldHabitats.js';
import type { WorldCreature } from './worldCompiler.js';

interface CompiledWorld {
  regions: WorldRegionGeometry[]; encounters: EncounterDefinition[]; placements: WorldPlacement[];
  resources: ResourcePlacement[]; groupsByRegion: Record<string, EnemyGroupDef[]>;
  habitats: HabitatDef[]; creatureByGroup: Record<string, WorldCreature>;
}
/** Player builds read only the last catalog accepted by the source compiler. */
export type { CompiledWorld };
const world = RESOLVED_TABLES.world as CompiledWorld;
export const ENCOUNTER_DEFINITIONS = world.encounters;
export const WORLD_PLACEMENTS = world.placements;
export const RESOURCE_PLACEMENTS = world.resources;
export const WORLD_REGION_GEOMETRY = world.regions;
export const WORLD_CONTENT = {
  groupsByRegion: new Map(Object.entries(world.groupsByRegion)),
  habitats: world.habitats,
  creatureByGroup: new Map(Object.entries(world.creatureByGroup)),
};
/** After a live publish: spawn groups, habitats and group creatures from the new world table. The source collections above keep their import-time rows. */
export function reindexWorldContent(): void {
  const next = RESOLVED_TABLES.world as CompiledWorld;
  const fill = <V>(map: Map<string, V>, rows: Record<string, V>) => { map.clear(); for (const [id, row] of Object.entries(rows)) map.set(id, row); };
  fill(WORLD_CONTENT.groupsByRegion, next.groupsByRegion); fill(WORLD_CONTENT.creatureByGroup, next.creatureByGroup);
  WORLD_CONTENT.habitats = next.habitats;
}
