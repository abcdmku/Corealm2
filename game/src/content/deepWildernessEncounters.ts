import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { EnemyGroupDef, Spot } from './regions.js';
import type { HabitatDef } from './worldHabitats.js';
import { createEncounterFormation, type EncounterFormation } from './encounterPopulation.js';
import { WILDERNESS_EXPANSION_SITES, WILDERNESS_RUNE_KEEPERS, wildernessTierAt } from './wildernessDepth.js';
import { DEEP_WILDERNESS_STRUCTURES } from '../render/compositions/deepWildernessStructures.js';

export interface DeepWildernessPackPlan {
  readonly id: string;
  readonly speciesId: string;
  readonly centre: Spot;
  readonly count: number;
  readonly radius: number;
  /** Animated envelope; enlarged if an accepted creature's measured bounds require it. */
  readonly bodyRadius: number;
  readonly siteId?: string;
  readonly court?: 'west' | 'east';
  readonly rotationY?: number;
}

function courtPack(siteIndex: number, side: 'west' | 'east'): DeepWildernessPackPlan {
  const site = WILDERNESS_EXPANSION_SITES[siteIndex]!;
  const court = DEEP_WILDERNESS_STRUCTURES[site.id].courts[side === 'west' ? 0 : 1]!;
  const [x, z] = court.centre;
  const cos = Math.cos(site.rotationY), sin = Math.sin(site.rotationY);
  return { id: `${site.id}_${side}_conclave`, speciesId: 'gloam_wraith',
    centre: [site.position[0] + x * cos + z * sin, site.position[1] - x * sin + z * cos],
    count: 7, radius: court.radius, bodyRadius: 1.5,
    siteId: site.id, court: side, rotationY: -site.rotationY };
}

/** Placement proposal only. The root registers accepted actors after production lab proof. */
export const DEEP_WILDERNESS_PACKS: readonly DeepWildernessPackPlan[] = [
  { id: 'wilderness_red_hatchling_nest', speciesId: 'baby_red_dragon', centre: [-178, 484], count: 7, radius: 28, bodyRadius: 2.4 },
  { id: 'wilderness_black_hatchling_nest', speciesId: 'baby_black_dragon', centre: [-325, 612], count: 7, radius: 28, bodyRadius: 2.4 },
  { id: 'wilderness_lava_hatchling_nest', speciesId: 'baby_lava_dragon', centre: [325, 620], count: 7, radius: 28, bodyRadius: 2.4 },
  { id: 'wilderness_cinderback_scree', speciesId: 'cinderback_crag', centre: [-181, 630], count: 7, radius: 28, bodyRadius: 2.5 },
  { id: 'wilderness_furnace_grazers', speciesId: 'furnace_grazer', centre: [190, 484], count: 7, radius: 28, bodyRadius: 2.6 },
  { id: 'wilderness_basalt_maw_hollow', speciesId: 'basalt_maw', centre: [-8, 680], count: 7, radius: 28, bodyRadius: 3 },
  { id: 'wilderness_foundry_west_carapaces', speciesId: 'rift_carapace', centre: [-292, 732], count: 7, radius: 28, bodyRadius: 2.5 },
  { id: 'wilderness_foundry_north_carapaces', speciesId: 'rift_carapace', centre: [-200, 791], count: 7, radius: 28, bodyRadius: 2.5 },
  { id: 'wilderness_rift_mouth_conclave', speciesId: 'gloam_wraith', centre: [-31, 738], count: 7, radius: 28, bodyRadius: 1.5 },
  { id: 'wilderness_midnight_carapaces', speciesId: 'rift_carapace', centre: [163, 724], count: 7, radius: 28, bodyRadius: 2.5 },
  { id: 'wilderness_nightforge_east_colossi', speciesId: 'voidstone_colossus', centre: [254, 812], count: 7, radius: 28, bodyRadius: 3.3 },
  { id: 'wilderness_northwest_black_dragons', speciesId: 'black_wilderness_dragon', centre: [-319, 910], count: 7, radius: 34, bodyRadius: 5.7 },
  { id: 'wilderness_northwest_red_dragons', speciesId: 'red_wilderness_dragon', centre: [-265, 903], count: 7, radius: 34, bodyRadius: 5.5 },
  { id: 'wilderness_central_purple_dragons', speciesId: 'purple_wilderness_dragon', centre: [17, 803], count: 7, radius: 34, bodyRadius: 5.7 },
  { id: 'wilderness_eastern_red_dragons', speciesId: 'amethyst_dragon', centre: [233, 866], count: 7, radius: 34, bodyRadius: 5.5 },
  { id: 'wilderness_eastern_gloam_conclave', speciesId: 'gloam_wraith', centre: [317, 802], count: 7, radius: 28, bodyRadius: 1.5 },
  { id: 'wilderness_sanctum_east_carapaces', speciesId: 'rift_carapace', centre: [146, 885], count: 7, radius: 28, bodyRadius: 2.5 },
  { id: 'wilderness_sanctum_west_colossi', speciesId: 'voidstone_colossus', centre: [-101, 860], count: 7, radius: 28, bodyRadius: 3.3 },
  courtPack(0, 'west'), courtPack(0, 'east'),
  courtPack(1, 'west'), courtPack(1, 'east'),
  courtPack(2, 'west'), courtPack(2, 'east'),
];

function keeperCentre(index: number): Spot {
  if (index === 0) return [-171, 573];
  if (index === 1) return [155, 694];
  const site = WILDERNESS_EXPANSION_SITES[index - 2]!;
  const [x, z] = DEEP_WILDERNESS_STRUCTURES[site.id].keeper.centre;
  return [site.position[0] + Math.cos(site.rotationY) * x + Math.sin(site.rotationY) * z,
    site.position[1] - Math.sin(site.rotationY) * x + Math.cos(site.rotationY) * z];
}

export const DEEP_WILDERNESS_KEEPERS = WILDERNESS_RUNE_KEEPERS.map((keeper, index) => ({
  ...keeper, centre: keeperCentre(index), count: 1 as const, radius: 5,
  siteId: index >= 2 ? WILDERNESS_EXPANSION_SITES[index - 2]!.id : undefined,
}));

/** No species fallback: missing accepted art stops registration. */
export function resolveDeepWildernessPacks(species: readonly CreatureSpeciesDef[]): EnemyGroupDef[] {
  const byId = new Map(species.map(row => [row.id, row]));
  return DEEP_WILDERNESS_PACKS.map(pack => {
    const body = byId.get(pack.speciesId);
    if (!body) throw new Error(`Missing accepted Wilderness species ${pack.speciesId} for ${pack.id}`);
    return { id: pack.id, family: body.stats.family, name: body.stats.name, tier: wildernessTierAt(pack.centre[1]),
      assetId: body.assetId, scale: body.scale, centre: pack.centre, count: pack.count, radius: pack.radius };
  });
}

export function deepWildernessPackFormation(pack: DeepWildernessPackPlan): EncounterFormation {
  const group: EnemyGroupDef = { id: pack.id, family: pack.speciesId, name: pack.speciesId,
    tier: wildernessTierAt(pack.centre[1]), assetId: `creature_${pack.speciesId}`, scale: 1,
    centre: pack.centre, count: pack.count, radius: pack.radius };
  return createEncounterFormation(group, { bodyRadius: pack.bodyRadius, count: pack.count,
    maxRadius: pack.radius, rotationY: pack.rotationY, bodyGap: pack.speciesId.endsWith('_wilderness_dragon') || pack.speciesId === 'amethyst_dragon'
      ? Math.max(.5, 24 - pack.bodyRadius * 2) : pack.siteId ? 3 : Math.max(4, 14 - pack.bodyRadius * 2) });
}

export const DEEP_WILDERNESS_PACK_HABITATS: readonly HabitatDef[] = DEEP_WILDERNESS_PACKS.map(pack => ({
  id: `${pack.id}_habitat`, groupId: pack.id, regionId: 'wilderness', centre: pack.centre,
  radius: pack.radius, activity: 'patrol', dressing: [], anchors: deepWildernessPackFormation(pack).anchors,
}));
