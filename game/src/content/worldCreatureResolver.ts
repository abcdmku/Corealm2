import { resolveCreatureAtLevel, type ResolvedCreature } from './creatureCompiler.js';
import type { CreatureProfile } from './schema/creatureDefinitions.js';
import type { WorldRegionGeometry } from './schema/worldRegions.js';
import type { WorldCreature, WorldRegionBounds } from './worldCompiler.js';
import { ENCOUNTER_ASSET_RADII } from './encounterFootprints.js';
import { tierSilhouetteScale } from '../core/math.js';
import { footprintRadius } from '../render/manifestOverlay.js';

/**
 * Footprints of models a server added (`CONTENT_MANIFEST_OVERLAY`), from each entry's measured size
 * by the formula that generated `ENCOUNTER_ASSET_RADII`. The server sets them from its overlay before
 * it compiles (`multiplayer/assetManifest.ts`); the generated table still wins for a base model.
 */
let measuredFootprints: ReadonlyMap<string, number> = new Map();
export function setMeasuredFootprints(entries: readonly { id: string; size: { x: number; y: number; z: number } }[]): void {
  measuredFootprints = new Map(entries.map(entry => [entry.id, footprintRadius(entry.size)]));
}
/** A model's encounter footprint radius at scale 1, or undefined when it was never measured. */
export function assetFootprintRadius(assetId: string): number | undefined {
  return ENCOUNTER_ASSET_RADII[assetId] ?? measuredFootprints.get(assetId);
}

/** Identical combat and footprint resolution for runtime, editor transactions and world bakes. */
export function createWorldCreatureResolver(
  creatures: ReadonlyMap<string, ResolvedCreature>, profiles: readonly CreatureProfile[],
): (id: string, level?: number) => WorldCreature | undefined {
  return (id, level) => {
    const creature = creatures.get(id);
    if (!creature?.assetId || creature.scale === undefined || creature.availability !== 'world') return undefined;
    const stats = level === undefined ? creature.enemy : resolveCreatureAtLevel(creature, profiles, level);
    const nativeRadius = assetFootprintRadius(creature.assetId);
    if (nativeRadius === undefined) throw new Error(`Creature ${id} has no measured footprint for ${creature.assetId}`);
    const look = creature.presentation;
    return { id, assetId: creature.assetId, scale: creature.scale, stats,
      bodyRadius: nativeRadius * creature.scale * tierSilhouetteScale(stats.tier),
      ...(look?.skinId ? { skinId: look.skinId } : {}), ...(look?.variation ? { variation: look.variation } : {}) };
  };
}
export function worldRegionBounds(regions: readonly WorldRegionGeometry[]): WorldRegionBounds[] {
  return regions.flatMap(region => [region, ...(region.dungeon ? [{ id: region.dungeon.id, underground: true, bounds: {
    min: [Math.min(...region.dungeon.chambers.map(c => c.centre[0] - c.radius)), Math.min(...region.dungeon.chambers.map(c => c.centre[1] - c.radius))] as const,
    max: [Math.max(...region.dungeon.chambers.map(c => c.centre[0] + c.radius)), Math.max(...region.dungeon.chambers.map(c => c.centre[1] + c.radius))] as const,
  } }] : [])]);
}
