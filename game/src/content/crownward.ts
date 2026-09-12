import { resolveCrownwardDragonEncounters } from './crownwardDragons.js';
import { CROWNWARD_RIVER_BRIDGES, CROWNWARD_RIVER_CHANNELS } from './crownwardRiver.js';
import { crownwardFisheries } from './crownwardFishing.js';
import type { EnemyGroupDef, LocationDef, RegionDef, Spot } from './regions.js';
import { FAIRY_CROWN_SPECIES } from './fairyCrownCreatures.js';

export const CROWNWARD_FISHERIES = crownwardFisheries(CROWNWARD_RIVER_CHANNELS);

/** Positive world X is the left side of the player's north-up map. */
export const CROWNWARD_RESOURCE_INTENTS = [
  { id: 'crown_silver_quarry', regionId: 'crownward', kind: 'mine', position: [625, -135], resourceId: 'crown_silver_ore', count: 7 },
  { id: 'argent_high_cut', regionId: 'crownward', kind: 'mine', position: [640, 220], resourceId: 'crown_silver_ore', count: 7 },
  { id: 'royal_maple_grove', regionId: 'crownward', kind: 'grove', position: [445, -115], resourceId: 'tree_maple', count: 9 },
  { id: 'silverthorn_park', regionId: 'crownward', kind: 'grove', position: [630, 105], resourceId: 'tree_maple', count: 9 },
  { id: 'whitebough_copse', regionId: 'crownward', kind: 'grove', position: [445, 310], resourceId: 'tree_maple', count: 9 },
] as const;

const RESOURCE_NAMES: Record<string, string> = {
  crown_silver_quarry: 'Crown Silver Quarry', argent_high_cut: 'Argent High Cut',
  royal_maple_grove: 'Royal Maple Grove', silverthorn_park: 'Silverthorn Park', whitebough_copse: 'Whitebough Copse',
};

const resourceLocations: LocationDef[] = CROWNWARD_RESOURCE_INTENTS.map(intent => ({
  id: intent.id, name: RESOURCE_NAMES[intent.id]!, position: intent.position,
  kind: intent.kind === 'mine' ? 'seam' : 'grove', routeNode: true,
  blurb: intent.kind === 'mine'
    ? 'A worked, silvery mineral face above a dry haul lane. The royal masons maintain the approach.'
    : 'Mature maples stand in broad rows, with clear lanes for the timber carts.',
}));

function pack(id: string, speciesId: string, centre: Spot, count: number, radius: number, boss = false): EnemyGroupDef {
  const species = FAIRY_CROWN_SPECIES.find(entry => entry.id === speciesId);
  if (!species) throw new Error(`Missing Crownward species ${speciesId}`);
  return { id, family: species.stats.family, name: species.stats.name, tier: species.stats.tier,
    assetId: species.assetId, scale: species.scale / (boss ? 1.6 : 1), centre, count, radius,
    ...(boss ? { boss: true } : {}) };
}

/** World-authoring exception covers these final positions, roads and region extent. */
export const CROWNWARD: RegionDef = {
  id: 'crownward', name: 'Crownward', tier: 40,
  lore: 'The old kingdom continues beyond the frontier, with pale mineral mines, tended maple woods and castles built to last. White-armoured knights patrol the royal road. In a sheltered garden, a violet portal opens into the fairy lands beneath the world.',
  bounds: { min: [350, -200], max: [700, 460] },
  terrainSeed: 0xc2040, terrainAmplitude: 18, baseHeight: 3,
  groundPalette: ['#60835a', '#83a46b', '#48684c', '#afb88e', '#786d86', '#778b60', '#d3d7bb', '#b3c19a'],
  fogStart: 110, spawnPoint: [374, -90], spawnFacingRad: Math.PI / 2, respawnPointId: 'crownward_town',
  locations: [
    ...CROWNWARD_FISHERIES.sites.map(site => ({
      id: site.id, name: site.id.includes('trout') ? 'Crownmere Trout' : site.id.includes('tuna') ? 'Crownmere Tuna' : 'Pearlwater Salmon',
      position: site.centre, kind: 'water' as const, routeNode: false,
      blurb: site.id.includes('salmon') ? 'Salmon run through the slow river. Fishing 60.' : site.id.includes('trout') ? 'Trout gather by the lake bank. Fishing 30.' : 'Tuna schools circle the lake. Fishing 40.',
    })),
    ...CROWNWARD_RIVER_BRIDGES.flatMap(bridge => [
      {id:bridge.id+'_south',name:bridge.id.includes('kingroad')?'Kingroad Bridge South':'Coast Bridge South',position:[bridge.centre[0],bridge.centre[1]-15] as Spot,kind:'junction' as const,routeNode:true},
      {id:bridge.id+'_north',name:bridge.id.includes('kingroad')?'Kingroad Bridge North':'Coast Bridge North',position:[bridge.centre[0],bridge.centre[1]+15] as Spot,kind:'junction' as const,routeNode:true},
    ]),
    { id: 'crownward_south_crossing', name: 'Royal March Crossing', position: [374, -90], kind: 'junction', routeNode: true },
    { id: 'crownward_woodland_crossing', name: 'Maple Border', position: [370, 155], kind: 'junction', routeNode: true },
    { id: 'crownward_ash_crossing', name: 'Old Kingdom Road', position: [374, 355], kind: 'junction', routeNode: true },
    { id: 'crownward_town_square', name: 'Crownward Borough', position: [490, -42], kind: 'settlement', routeNode: true,
      blurb: 'A paved borough beside the southern castle. Its bank and open workshops serve the royal road.' },
    { id: 'crownward_bank_approach', name: 'Royal Bank', position: [489, -52], kind: 'bank', routeNode: true },
    { id: 'crownward_castle_approach', name: 'White Castle Approach', position: [554.2, -102], kind: 'junction', routeNode: true },
    { id: 'crownward_castle_gate', name: 'White Castle Gate', position: [554.2, -85.8], kind: 'gate', routeNode: true },
    { id: 'crownward_castle_court', name: 'White Castle Forecourt', position: [554.2, -79.8], kind: 'landmark', routeNode: true,
      blurb: 'The pointed royal entrance rises above a narrow paved forecourt.' },
    { id: 'crownward_middle_road', name: 'Kingroad Cross', position: [555, 140], kind: 'junction', routeNode: true },
    { id: 'crownward_fairy_gate', name: 'Fairy Portal', position: [470, 100], kind: 'gate', routeNode: true,
      blurb: 'A violet opening into Gloamgarden, the T30 fairy realm beneath the surface.' },
    { id: 'crownward_fairy_arrival', name: 'Portal Garden', position: [470, 108], kind: 'junction', routeNode: true,
      blurb: 'The clear garden path outside the fairy portal.' },
    { id: 'crownward_north_approach', name: 'Ivory Citadel Approach', position: [560, 278], kind: 'junction', routeNode: true },
    { id: 'crownward_north_gate', name: 'Ivory Citadel Gate', position: [560.2, 291.8], kind: 'gate', routeNode: true },
    { id: 'crownward_north_inner_gate', name: 'Citadel Arch', position: [560.2, 299.6], kind: 'junction', routeNode: true },
    { id: 'crownward_north_court_turn', name: 'Citadel Court Walk', position: [574.2, 300.6], kind: 'junction', routeNode: true },
    { id: 'crownward_north_court', name: 'Ivory Citadel Court', position: [574.2, 320.6], kind: 'landmark', routeNode: true,
      blurb: 'The Ivory Castellan keeps the old northern court.' },
    { id: 'crownward_north_track', name: 'Last White Milestone', position: [560, 446], kind: 'junction', routeNode: true,
      blurb: 'Beyond this stone, the royal road enters the Wilderness.' },
    ...resourceLocations,
  ],
  roads: [
    { from: 'crownward_south_crossing', to: 'royal_maple_grove' },
    { from: 'royal_maple_grove', to: 'crownward_town_square' },
    { from: 'crownward_town_square', to: 'crownward_bank_approach' },
    { from: 'crownward_town_square', to: 'crownward_castle_approach' },
    { from: 'crownward_castle_approach', to: 'crownward_castle_gate' },
    { from: 'crownward_castle_gate', to: 'crownward_castle_court' },
    { from: 'crownward_castle_approach', to: 'crown_silver_quarry' },
    { from: 'crownward_town_square', to: 'crownward_fairy_gate' },
    { from: 'crownward_fairy_gate', to: 'crownward_fairy_arrival' },
    { from: 'crownward_fairy_arrival', to: 'crownward_middle_road' },
    { from: 'crownward_woodland_crossing', to: 'crownward_fairy_arrival' },
    { from: 'crownward_middle_road', to: 'silverthorn_park' },
    { from: 'crownward_kingroad_bridge_north', to: 'argent_high_cut' },
    { from: 'crownward_middle_road', to: 'crownward_kingroad_bridge_south' },
    { from: 'crownward_kingroad_bridge_south', to: 'crownward_kingroad_bridge_north' },
    { from: 'crownward_kingroad_bridge_north', to: 'crownward_north_approach' },
    { from: 'silverthorn_park', to: 'crownward_coast_bridge_south' },
    { from: 'crownward_coast_bridge_south', to: 'crownward_coast_bridge_north' },
    { from: 'crownward_coast_bridge_north', to: 'argent_high_cut' },
    { from: 'crownward_north_approach', to: 'crownward_north_gate' },
    { from: 'crownward_north_gate', to: 'crownward_north_inner_gate' },
    { from: 'crownward_north_inner_gate', to: 'crownward_north_court_turn' },
    { from: 'crownward_north_court_turn', to: 'crownward_north_court' },
    { from: 'crownward_north_approach', to: 'whitebough_copse' },
    { from: 'whitebough_copse', to: 'crownward_ash_crossing' },
    { from: 'whitebough_copse', to: 'crownward_north_track' },
  ],
  clusters: [...CROWNWARD_FISHERIES.clusters, ...CROWNWARD_RESOURCE_INTENTS.map(intent => ({
    id: `${intent.id}_resources`, resourceId: intent.resourceId, count: intent.count,
    centre: intent.position, radius: intent.kind === 'mine' ? 13 : 18, locationId: intent.id,
  }))],
  stations: [], obstacles: [],
  settlement: {
    id: 'crownward_borough', name: 'Crownward Borough', kit: 'stone', centre: [490, -42], respawnPointId: 'crownward_town',
    buildings: [
      { id: 'crownward_borough_hall', name: 'Royal Survey Hall', prefab: 'hall', position: [490, -27], rotationY: 0, footprint: [12, 6] },
      { id: 'crownward_bank_porch', name: 'Royal Bank Counter', prefab: 'porch', position: [486, -51], rotationY: Math.PI / 2, footprint: [6, 3] },
      { id: 'crownward_borough_house', name: 'Mason House', prefab: 'townhouse', position: [505, -42], rotationY: Math.PI / 2, footprint: [6, 4] },
      { id: 'crownward_borough_arcade', name: 'Royal Workshops', prefab: 'arcade', position: [476, -40], rotationY: Math.PI / 2, footprint: [8, 3] },
    ],
    bank: { id: 'crownward_bank', name: 'Royal Bank', position: [485.25, -52.4], rotationY: Math.PI / 2,
      assetId: 'chest_wood', attachedTo: 'crownward_bank_porch' },
    stations: [], shops: [], npcs: [],
    paving: [{ id: 'crownward_borough_paving', rect: { minX: 479, maxX: 502, minZ: -57, maxZ: -33 }, assetId: 'floor_cobble' }],
  },
  enemyGroups: [
    ...resolveCrownwardDragonEncounters({
      crownward_red_whelp_south:[700,-75],crownward_red_whelp_north:[490,405],
      crownward_black_whelp_south:[405,45],crownward_black_whelp_north:[695,300],
      crownward_red_dragon_roost:[705,400],
    }),
    pack('crownward_south_meadow_harts', 'crown_hart', [395, -151], 4, 15),
    pack('crownward_royal_grove_harts', 'crown_hart', [405, -18], 3, 13),
    pack('crownward_quarry_knights', 'pearl_knight', [646, -67], 3, 12),
    pack('crownward_castle_patrol', 'pearl_knight', [596, -5], 3, 13),
    pack('crownward_silverthorn_harrows', 'silverthorn_harrow', [674, 132], 3, 13),
    pack('crownward_east_meadow_harts', 'crown_hart', [605, 42], 4, 15),
    pack('crownward_midroad_knights', 'pearl_knight', [600, 257], 3, 12),
    pack('crownward_whitebough_harrows', 'silverthorn_harrow', [390, 270], 3, 14),
    pack('crownward_copse_harts', 'crown_hart', [478, 366], 4, 15),
    pack('crownward_north_knights', 'pearl_knight', [638, 349], 4, 14),
    pack('crownward_border_harrows', 'silverthorn_harrow', [642, 416], 3, 14),
    pack('ivory_castellan_court', 'ivory_castellan', [574.2, 320.6], 1, 0, true),
  ],
  landmarks: [
    ...CROWNWARD_RIVER_BRIDGES.map(bridge => ({id:bridge.id,name:bridge.id.includes('kingroad')?'Kingroad Bridge':'Pearlwater Coast Bridge',position:bridge.centre,rotationY:bridge.rotationY,assetId:'crownward_timber_bridge',composition:'crownward_bridge' as const,compositionOnly:true,solid:false,blurb:'A paved medieval stone bridge over Pearlwater, lined with wooden rails and stone posts.'})),
    { id: 'crownward_white_castle', name: 'White Castle', position: [550, -60], assetId: 'wall_brick_straight',
      composition: 'crownward_castle', compositionOnly: true, rotationY: Math.PI,
      blurb: 'A royal castle of tall crenellated towers, a pointed gate and a high roofed keep.' },
    { id: 'crownward_ivory_citadel', name: 'Ivory Citadel', position: [560, 320], assetId: 'wall_brick_straight',
      composition: 'crownward_fortress', compositionOnly: true, rotationY: Math.PI,
      blurb: 'An established fortress with layered curtain walls, round towers and an open court beside the central keep.' },
    { id: 'crownward_portal_garden', name: 'Fairy Garden Stones', position: [480, 100], assetId: 'rock_medium_2',
      composition: 'garden', compositionOnly: true, solid: false,
      blurb: 'The castle gardeners leave this patch of strange flowers untouched.' },
    { id: 'crownward_kingroad_stone', name: 'Kingroad Waystone', position: [563, 140], assetId: 'corner_brick',
      composition: 'path_waypoint', scale: .85, blurb: 'The old road joins the castles, mines and portal garden.' },
  ],
  gates: [{ id: 'crownward_fairy_gate', name: 'Enter Gloamgarden', position: [470, 100],
    assetId: 'wall_brick_door', rotationY: 0, toRegionId: 'gloamgarden', toLocationId: 'gloamgarden_arrival' }],
  adjacency: [
    { toRegionId: 'karrowmoor', fromLocationId: 'crownward_south_crossing', toLocationId: 'upper_karrow_seam', meters: 188 },
    { toRegionId: 'vellenwood', fromLocationId: 'crownward_woodland_crossing', toLocationId: 'vellenwood_earth_cache', meters: 110 },
    { toRegionId: 'kilnhalt', fromLocationId: 'crownward_ash_crossing', toLocationId: 'kilnhalt_east_track', meters: 182 },
    { toRegionId: 'wilderness', fromLocationId: 'crownward_north_track', toLocationId: 'wilderness_crownward_track', meters: 27 },
  ],
};
