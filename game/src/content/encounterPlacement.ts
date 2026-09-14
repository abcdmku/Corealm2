import type { EnemyGroupDef } from './regions.js';
import { tierSilhouetteScale } from '../core/math.js';
import { ENCOUNTER_ASSET_RADII } from './encounterFootprints.js';
import { encounterPopulationCount } from './encounterPopulation.js';
import { LEGACY_ENCOUNTER_PLACEMENT_OVERRIDES } from './legacyEncounterPlacements.js';

/** The same promoted neutral bounds used by production actor collision. */
export function encounterBodyRadius(group: EnemyGroupDef): number {
  const native = ENCOUNTER_ASSET_RADII[group.assetId];
  if (!native) throw new Error(`Missing promoted encounter footprint: ${group.assetId}`);
  return native * group.scale * tierSilhouetteScale(group.tier)
    * (group.boss ? 1.6 : group.miniBoss ? 1.3 : 1);
}

/** Procedural callers share population rules; authored placements carry their final count directly. */
export function populationGroup(group: EnemyGroupDef): EnemyGroupDef {
  const count = encounterPopulationCount(group);
  const bodyRadius = encounterBodyRadius(group);
  return { ...group, legacyCount: group.legacyCount ?? group.count, count, radius: Math.max(group.radius, Math.ceil(Math.sqrt(count) - 1) * (bodyRadius * 2 + .5) + bodyRadius) };
}
