import { tables } from '../../content/compiled/catalog.json';
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
const world = (tables as unknown as { world: CompiledWorld }).world;
export const ENCOUNTER_DEFINITIONS = world.encounters;
export const WORLD_PLACEMENTS = world.placements;
export const RESOURCE_PLACEMENTS = world.resources;
export const WORLD_REGION_GEOMETRY = world.regions;
export const WORLD_CONTENT = {
  groupsByRegion: new Map(Object.entries(world.groupsByRegion)),
  habitats: world.habitats,
  creatureByGroup: new Map(Object.entries(world.creatureByGroup)),
};
