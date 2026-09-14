import { resolveCreatureAtLevel, type ResolvedCreature } from './creatureCompiler.js';
import type { CreatureProfile } from './schema/creatureDefinitions.js';
import type { WorldRegionGeometry } from './schema/worldRegions.js';
import type { WorldCreature, WorldRegionBounds } from './worldCompiler.js';
import { ENCOUNTER_ASSET_RADII } from './encounterFootprints.js';
import { tierSilhouetteScale } from '../core/math.js';

/** Identical combat and footprint resolution for runtime, editor transactions and world bakes. */
export function createWorldCreatureResolver(
  creatures: ReadonlyMap<string, ResolvedCreature>, profiles: readonly CreatureProfile[],
): (id: string, level?: number) => WorldCreature | undefined {
  return (id, level) => {
    const creature = creatures.get(id);
    if (!creature?.assetId || creature.scale === undefined || creature.availability !== 'world') return undefined;
    const stats = level === undefined ? creature.enemy : resolveCreatureAtLevel(creature, profiles, level);
    const nativeRadius = ENCOUNTER_ASSET_RADII[creature.assetId];
    if (nativeRadius === undefined) throw new Error(`Creature ${id} has no measured footprint for ${creature.assetId}`);
    return { id, assetId: creature.assetId, scale: creature.scale, stats,
      bodyRadius: nativeRadius * creature.scale * tierSilhouetteScale(stats.tier) };
  };
}
export function worldRegionBounds(regions: readonly WorldRegionGeometry[]): WorldRegionBounds[] {
  return regions.flatMap(region => [region, ...(region.dungeon ? [{ id: region.dungeon.id, bounds: {
    min: [Math.min(...region.dungeon.chambers.map(c => c.centre[0] - c.radius)), Math.min(...region.dungeon.chambers.map(c => c.centre[1] - c.radius))] as const,
    max: [Math.max(...region.dungeon.chambers.map(c => c.centre[0] + c.radius)), Math.max(...region.dungeon.chambers.map(c => c.centre[1] + c.radius))] as const,
  } }] : [])]);
}
