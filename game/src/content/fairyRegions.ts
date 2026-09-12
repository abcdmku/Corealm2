import type { EnemyGroupDef, LocationDef, RegionDef, Spot } from './regions.js';
import type { RegionId } from '../contracts.js';
import { FAIRY_CROWN_SPECIES } from './fairyCrownCreatures.js';

/** Shared placements for the production resource clusters and their mine/grove layouts. */
export const FAIRY_RESOURCE_INTENTS = [
  { id: 'dewglass_workings', regionId: 'gloamgarden', kind: 'mine', position: [2175, -135], resourceId: 'dewglass_ore', count: 7 },
  { id: 'lantern_seam', regionId: 'gloamgarden', kind: 'mine', position: [2505, 60], resourceId: 'dewglass_ore', count: 7 },
  { id: 'moonpetal_grove', regionId: 'gloamgarden', kind: 'grove', position: [2250, -55], resourceId: 'tree_gloam_willow', count: 9 },
  { id: 'lantern_willows', regionId: 'gloamgarden', kind: 'grove', position: [2470, -110], resourceId: 'tree_gloam_willow', count: 9 },
  { id: 'dewsong_copse', regionId: 'gloamgarden', kind: 'grove', position: [2115, 40], resourceId: 'tree_gloam_willow', count: 9 },
  { id: 'star_amethyst_cut', regionId: 'faeholme', kind: 'mine', position: [2170, 240], resourceId: 'star_amethyst_ore', count: 7 },
  { id: 'sovereign_lode', regionId: 'faeholme', kind: 'mine', position: [2500, 370], resourceId: 'star_amethyst_ore', count: 7 },
  { id: 'orchid_yew_grove', regionId: 'faeholme', kind: 'grove', position: [2420, 210], resourceId: 'tree_fae_yew', count: 9 },
  { id: 'starroot_garden', regionId: 'faeholme', kind: 'grove', position: [2300, 365], resourceId: 'tree_fae_yew', count: 9 },
  { id: 'twilight_copse', regionId: 'faeholme', kind: 'grove', position: [2075, 350], resourceId: 'tree_fae_yew', count: 9 },
] as const;

const NAMES: Record<string, string> = {
  dewglass_workings: 'Dewglass Workings', lantern_seam: 'Lantern Seam', moonpetal_grove: 'Moonpetal Grove',
  lantern_willows: 'Lantern Willows', dewsong_copse: 'Dewsong Copse', star_amethyst_cut: 'Star Amethyst Cut',
  sovereign_lode: 'Sovereign Lode', orchid_yew_grove: 'Orchid Yew Grove', starroot_garden: 'Starroot Garden',
  twilight_copse: 'Twilight Copse',
};

function resourceLocations(regionId: RegionId): LocationDef[] {
  return FAIRY_RESOURCE_INTENTS.filter(intent => intent.regionId === regionId).map(intent => ({
    id: intent.id, name: NAMES[intent.id]!, position: intent.position,
    kind: intent.kind === 'mine' ? 'seam' : 'grove', routeNode: true,
    blurb: intent.kind === 'mine' ? 'Luminous mineral seams follow a worked face above a dry mining aisle.'
      : 'Strange, luminous trees bend around an open gathering path.',
  }));
}

function resourceClusters(regionId: RegionId): RegionDef['clusters'] {
  return FAIRY_RESOURCE_INTENTS.filter(intent => intent.regionId === regionId).map(intent => ({
    id: `${intent.id}_resources`, resourceId: intent.resourceId, count: intent.count,
    centre: intent.position, radius: intent.kind === 'mine' ? 13 : 18, locationId: intent.id,
  }));
}

function pack(id: string, speciesId: string, centre: Spot, count: number, radius: number, boss = false): EnemyGroupDef {
  const species = FAIRY_CROWN_SPECIES.find(entry => entry.id === speciesId);
  if (!species) throw new Error(`Missing fairy species ${speciesId}`);
  return { id, family: species.stats.family, name: species.stats.name, tier: species.stats.tier,
    assetId: species.assetId, scale: species.scale / (boss ? 1.6 : 1), centre, count, radius,
    ...(boss ? { boss: true } : {}) };
}

export const GLOAMGARDEN: RegionDef = {
  id: 'gloamgarden', name: 'Gloamgarden', tier: 30,
  lore: 'A wide fairy garden beneath the world, open under a distant vault of violet cloud and glowing teal dust. Moonpetal willows and glassy mineral seams follow winding paths. The Bloomheart Matriarch waits beyond the lantern meadows.',
  bounds: { min: [2000, -200], max: [2600, 130] }, terrainSeed: 0xfae030,
  terrainAmplitude: 8, baseHeight: -120,
  groundPalette: ['#285e65', '#398a89', '#31504f', '#7676a0', '#473c72', '#51a397', '#a1c5bd', '#646997'],
  fogStart: 95, spawnPoint: [2068, -120], spawnFacingRad: Math.PI / 2, respawnPointId: 'lantern_rest',
  locations: [
    { id: 'gloamgarden_arrival', name: 'Gloamgarden Arrival', position: [2068, -120], kind: 'junction', routeNode: true,
      blurb: 'A clear landing beside the return portal and Lantern Rest.' },
    { id: 'gloamgarden_crownward_gate', name: 'Return to Crownward', position: [2068, -128], kind: 'gate', routeNode: true },
    { id: 'lantern_rest_square', name: 'Lantern Rest', position: [2080, -105], kind: 'settlement', routeNode: true,
      blurb: 'A sheltered bank and resting place near the surface portal.' },
    { id: 'lantern_rest_bank_approach', name: 'Lantern Rest Bank', position: [2089, -115], kind: 'bank', routeNode: true },
    { id: 'gloamgarden_moonpath', name: 'Moonpath Cross', position: [2290, 10], kind: 'junction', routeNode: true },
    { id: 'gloamgarden_bloomheart', name: 'Bloomheart Court', position: [2390, 65], kind: 'landmark', routeNode: true,
      blurb: 'A broad flowering court claimed by the Bloomheart Matriarch.' },
    { id: 'gloamgarden_north_path', name: 'Faeholme Threshold', position: [2300, 120], kind: 'junction', routeNode: true,
      blurb: 'The teal meadows give way to the T60 violet gardens of Faeholme.' },
    ...resourceLocations('gloamgarden'),
  ],
  roads: [
    { from: 'gloamgarden_crownward_gate', to: 'gloamgarden_arrival' },
    { from: 'gloamgarden_arrival', to: 'lantern_rest_square' },
    { from: 'lantern_rest_square', to: 'lantern_rest_bank_approach' },
    { from: 'lantern_rest_square', to: 'dewglass_workings' },
    { from: 'lantern_rest_square', to: 'dewsong_copse' },
    { from: 'dewglass_workings', to: 'moonpetal_grove' },
    { from: 'moonpetal_grove', to: 'gloamgarden_moonpath' },
    { from: 'dewsong_copse', to: 'gloamgarden_moonpath' },
    { from: 'moonpetal_grove', to: 'lantern_willows' },
    { from: 'lantern_willows', to: 'lantern_seam' },
    { from: 'gloamgarden_moonpath', to: 'gloamgarden_bloomheart' },
    { from: 'gloamgarden_bloomheart', to: 'lantern_seam' },
    { from: 'gloamgarden_moonpath', to: 'gloamgarden_north_path' },
  ],
  clusters: resourceClusters('gloamgarden'), stations: [], obstacles: [],
  settlement: {
    id: 'lantern_rest', name: 'Lantern Rest', kit: 'timber', centre: [2080, -105], respawnPointId: 'lantern_rest',
    buildings: [
      { id: 'lantern_rest_shelter', name: 'Lantern Shelter', prefab: 'arcade', position: [2080, -93], rotationY: Math.PI, footprint: [8, 3] },
      { id: 'lantern_rest_bank_porch', name: 'Lantern Bank Shelter', prefab: 'porch', position: [2086, -114], rotationY: Math.PI / 2, footprint: [6, 3] },
    ],
    bank: { id: 'lantern_rest_bank', name: 'Lantern Rest Bank', position: [2085.25, -115.4], rotationY: Math.PI / 2,
      assetId: 'chest_wood', attachedTo: 'lantern_rest_bank_porch' },
    stations: [], shops: [], npcs: [],
  },
  enemyGroups: [
    pack('gloamgarden_dewglass_sprites', 'lantern_sprite', [2215, -160], 4, 15),
    pack('gloamgarden_west_weavers', 'dewglass_weaver', [2050, 25], 3, 15),
    pack('gloamgarden_moonpetal_stalkers', 'moonpetal_stalker', [2210, 25], 3, 14),
    pack('gloamgarden_south_stalkers', 'moonpetal_stalker', [2350, -140], 4, 16),
    pack('gloamgarden_lantern_sprites', 'lantern_sprite', [2540, -110], 4, 16),
    pack('gloamgarden_east_weavers', 'dewglass_weaver', [2550, -5], 3, 15),
    pack('gloamgarden_mid_sprites', 'lantern_sprite', [2380, -25], 4, 16),
    pack('gloamgarden_north_weavers', 'dewglass_weaver', [2180, 96], 3, 13),
    pack('gloamgarden_threshold_stalkers', 'moonpetal_stalker', [2460, 107], 3, 12),
    pack('bloomheart_matriarch_court', 'bloomheart_matriarch', [2390, 65], 1, 0, true),
  ],
  landmarks: [
    { id: 'gloamgarden_bloomheart_stones', name: 'Bloomheart Threshold', position: [2360, 65], assetId: 'rock_medium_2',
      composition: 'standing_stones', compositionOnly: true, solid: false,
      blurb: 'Low stones mark the approach to the Matriarch court beneath the purple vault.' },
    { id: 'gloamgarden_moonpath_marker', name: 'Moonpath Stone', position: [2298, 10], assetId: 'corner_brick',
      composition: 'path_waypoint', scale: .8, blurb: 'A pale marker at the crossing between the two fairy regions.' },
  ],
  gates: [{ id: 'gloamgarden_crownward_gate', name: 'Return to Crownward', position: [2068, -128],
    assetId: 'wall_brick_door', rotationY: 0, toRegionId: 'crownward', toLocationId: 'crownward_fairy_arrival' }],
  adjacency: [{ toRegionId: 'faeholme', fromLocationId: 'gloamgarden_north_path', toLocationId: 'faeholme_south_path', meters: 20 }],
};

export const FAEHOLME: RegionDef = {
  id: 'faeholme', name: 'Faeholme', tier: 60,
  lore: 'The deeper fairy realm spreads beneath a violet, mineral-lit sky. Purple yews, luminous roots and amethyst faces surround the old sovereign court. Its creatures share the shapes of the gardens below, grown larger and stranger in the deep light.',
  bounds: { min: [2000, 130], max: [2600, 460] }, terrainSeed: 0xfae060,
  terrainAmplitude: 11, baseHeight: -120,
  groundPalette: ['#51416f', '#795591', '#303d67', '#5f8d96', '#503968', '#9873ad', '#c0a5cf', '#627faa'],
  fogStart: 100, spawnPoint: [2300, 140], spawnFacingRad: 0, respawnPointId: 'lantern_rest',
  locations: [
    { id: 'faeholme_south_path', name: 'Deep Garden Threshold', position: [2300, 140], kind: 'junction', routeNode: true },
    { id: 'faeholme_prism_cross', name: 'Prism Cross', position: [2320, 285], kind: 'junction', routeNode: true },
    { id: 'faeholme_sovereign_court', name: 'Amethyst Sovereign Court', position: [2450, 420], kind: 'landmark', routeNode: true,
      blurb: 'The Amethyst Sovereign holds an open court beneath the deepest part of the fairy vault.' },
    { id: 'faeholme_twilight_path', name: 'Twilight Walk', position: [2140, 395], kind: 'junction', routeNode: true },
    ...resourceLocations('faeholme'),
  ],
  roads: [
    { from: 'faeholme_south_path', to: 'star_amethyst_cut' },
    { from: 'faeholme_south_path', to: 'orchid_yew_grove' },
    { from: 'star_amethyst_cut', to: 'faeholme_prism_cross' },
    { from: 'orchid_yew_grove', to: 'faeholme_prism_cross' },
    { from: 'faeholme_prism_cross', to: 'starroot_garden' },
    { from: 'star_amethyst_cut', to: 'twilight_copse' },
    { from: 'twilight_copse', to: 'faeholme_twilight_path' },
    { from: 'faeholme_twilight_path', to: 'starroot_garden' },
    { from: 'starroot_garden', to: 'faeholme_sovereign_court' },
    { from: 'faeholme_prism_cross', to: 'sovereign_lode' },
    { from: 'sovereign_lode', to: 'faeholme_sovereign_court' },
  ],
  clusters: resourceClusters('faeholme'), stations: [], obstacles: [], gates: [],
  enemyGroups: [
    pack('faeholme_threshold_sprites', 'prismatic_sprite', [2220, 182], 4, 15),
    pack('faeholme_orchid_reapers', 'orchid_reaper', [2490, 180], 3, 15),
    pack('faeholme_west_guardians', 'starroot_guardian', [2060, 225], 3, 15),
    pack('faeholme_prism_sprites', 'prismatic_sprite', [2280, 245], 4, 15),
    pack('faeholme_east_reapers', 'orchid_reaper', [2530, 275], 3, 16),
    pack('faeholme_copse_guardians', 'starroot_guardian', [2155, 325], 3, 15),
    pack('faeholme_starroot_sprites', 'prismatic_sprite', [2240, 414], 4, 15),
    pack('faeholme_lode_reapers', 'orchid_reaper', [2420, 332], 3, 15),
    pack('faeholme_north_guardians', 'starroot_guardian', [2540, 419], 3, 15),
    pack('amethyst_sovereign_court', 'amethyst_sovereign', [2450, 420], 1, 0, true),
  ],
  landmarks: [
    { id: 'faeholme_sovereign_ring', name: 'Sovereign Court Stones', position: [2420, 420], assetId: 'rock_medium_2',
      composition: 'standing_stones', compositionOnly: true, solid: false,
      blurb: 'Ancient stones mark the entrance to an open arena under the violet sky.' },
    { id: 'faeholme_prism_marker', name: 'Prism Waystone', position: [2328, 285], assetId: 'corner_brick',
      composition: 'path_waypoint', scale: 1, blurb: 'Paths branch toward the deep mines, yew gardens and sovereign court.' },
  ],
  adjacency: [{ toRegionId: 'gloamgarden', fromLocationId: 'faeholme_south_path', toLocationId: 'gloamgarden_north_path', meters: 20 }],
};

export const FAIRY_REGIONS: readonly RegionDef[] = [GLOAMGARDEN, FAEHOLME];
