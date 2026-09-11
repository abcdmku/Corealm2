import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { EnemyGroupDef, LandmarkDef, LocationDef, RoadDef } from './regions.js';
import { DEEP_WILDERNESS_KEEPERS, resolveDeepWildernessPacks } from './deepWildernessEncounters.js';
import { WILDERNESS_EXPANSION_SITES } from './wildernessDepth.js';
import { DEEP_WILDERNESS_STRUCTURES } from '../render/compositions/deepWildernessStructures.js';

/** Root integrates this proposal only after its production lab assets are accepted. */
export function wildernessExpansionGroups(species: readonly CreatureSpeciesDef[]): EnemyGroupDef[] {
  return [...resolveDeepWildernessPacks(species), ...DEEP_WILDERNESS_KEEPERS.map(keeper => {
    const body = species.find(row => row.id === keeper.id);
    if (!body) throw new Error(`Missing accepted keeper ${keeper.id}`);
    return { id: keeper.id, family: body.stats.family, name: body.stats.name,
      tier: keeper.tier, assetId: body.assetId, scale: body.scale / 1.3,
      centre: keeper.centre, count: 1, radius: 5, miniBoss: true };
  })];
}

export const DEEP_WILDERNESS_LANDMARKS: LandmarkDef[] = WILDERNESS_EXPANSION_SITES.map(site => ({
  id: site.id, name: DEEP_WILDERNESS_STRUCTURES[site.id].name, position: site.position,
  assetId: 'kerb_straight', composition: site.id, compositionOnly: true, rotationY: site.rotationY,
  blurb: site.id === 'cinder_chain_foundry'
    ? 'Broken casting yards shelter the Chainbound Archon and two haunted conclaves.'
    : site.id === 'nightforge_bastion'
      ? 'An open fortress of ruined towers and cold forges, held by the Nightforge Marshal.'
      : 'A roofless sanctuary built around the Hollow Star. Violet wards light its occupied courts.',
}));

export const DEEP_WILDERNESS_LOCATIONS: LocationDef[] = [
  ...[
    ['black_keep_east_road', 'The East Rampart Road', 82, 550],
    ['black_keep_north_road', 'The North Rampart Road', 78, 657],
    ['silent_stones_south_road', 'The Grave Road', -45, 675],
    ['foundry_south_road', 'The Cinder Crossing', -65, 690],
    ['foundry_west_road', 'Foundry West Track', -210, 688],
    ['veilburn_east_road', 'Veilburn East Bank', 134, 710],
    ['nightforge_west_road', 'Nightforge Outer Road', 134, 868],
    ['veilburn_north_road', 'Beyond the Cold River', 144, 910],
    ['hollow_star_north_road', 'The Starless Road', 15, 928],
  ].map(([id, name, x, z]) => ({ id: String(id), name: String(name),
    position: [Number(x), Number(z)] as const, kind: 'junction' as const, routeNode: true })),
  { id: 'deep_wilderness_threshold', name: 'The Violet Reach', position: [70, 712], kind: 'junction', routeNode: true,
    blurb: 'The grey waste opens into the T70 Deep Wilderness. Cold fire marks the old north road.' },
  ...WILDERNESS_EXPANSION_SITES.map(site => ({ id: `${site.id}_approach`, name: DEEP_WILDERNESS_STRUCTURES[site.id].name,
    position: [site.position[0] + Math.sin(site.rotationY) * 38,
      site.position[1] + Math.cos(site.rotationY) * 38] as const,
    kind: 'landmark' as const, routeNode: true })),
  ...DEEP_WILDERNESS_KEEPERS.slice(0, 2).map(keeper => ({ id: `${keeper.id}_court`,
    name: keeper.id === 'ashseal_warden' ? 'Ashseal Court' : 'Furnace Throne', position: keeper.centre,
    kind: 'landmark' as const, routeNode: true })),
];

export const DEEP_WILDERNESS_ROADS: RoadDef[] = [
  { from: 'black_keep_approach', to: 'black_keep_east_road' },
  { from: 'black_keep_east_road', to: 'black_keep_north_road' },
  { from: 'black_keep_north_road', to: 'silent_stones_south_road' },
  { from: 'silent_stones_south_road', to: 'wilderness_north_stones' },
  { from: 'wilderness_north_stones', to: 'deep_wilderness_threshold' },
  { from: 'deep_wilderness_threshold', to: 'foundry_south_road' },
  { from: 'foundry_south_road', to: 'foundry_west_road' },
  { from: 'foundry_west_road', to: 'cinder_chain_foundry_approach' },
  { from: 'deep_wilderness_threshold', to: 'veilburn_east_road' },
  { from: 'veilburn_east_road', to: 'nightforge_west_road' },
  { from: 'nightforge_west_road', to: 'nightforge_bastion_approach' },
  { from: 'nightforge_bastion_approach', to: 'veilburn_north_road' },
  { from: 'veilburn_north_road', to: 'hollow_star_north_road' },
  { from: 'hollow_star_north_road', to: 'hollow_star_sanctum_approach' },
];
