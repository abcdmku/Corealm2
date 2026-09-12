import type { BuildingDef, LocationDef, RoadDef, SettlementDef } from '../regions.js';

/**
 * Lantern Rest occupies separate pockets at the foot of the Gloamgarden banks.
 * Footings stop behind each wall, so the terrain can rise beside and behind the cottages.
 * Closed cottage doors face local -Z; the forge, market and bank open toward local +Z.
 * Production timber recipes supply the dormers, shutters, vines and warm entrance lamps.
 * Gloamgarden's existing architecture palette supplies the violet roofs and pale walls.
 */
const buildings: BuildingDef[] = [
  { id: 'lantern_rest_willow_cottage', name: 'Willow Cottage', prefab: 'cottage',
    position: [2069, -102], rotationY: -Math.PI / 2, footprint: [6, 4] },
  { id: 'lantern_rest_moss_cottage', name: 'Moss Cottage', prefab: 'cottage',
    position: [2069, -84], rotationY: 0, footprint: [4, 6] },
  { id: 'lantern_rest_moonpetal_cottage', name: 'Moonpetal Cottage', prefab: 'cottage',
    position: [2094, -84], rotationY: 0, footprint: [4, 6] },
  { id: 'lantern_rest_orchid_cottage', name: 'Orchid Cottage', prefab: 'cottage',
    position: [2094, -101], rotationY: Math.PI / 2, footprint: [6, 4] },
  { id: 'lantern_rest_dewglass_cottage', name: 'Dewglass Cottage', prefab: 'cottage',
    position: [2097, -124], rotationY: Math.PI, footprint: [6, 4] },
  { id: 'lantern_rest_forge', name: 'Lantern Forge', prefab: 'forge',
    position: [2060, -122], rotationY: 0, footprint: [6, 4] },
  // Preserve both original structure identities and the exact bank position below.
  { id: 'lantern_rest_shelter', name: 'Lantern Market', prefab: 'market_row',
    position: [2081, -96], rotationY: Math.PI, footprint: [12, 3] },
  { id: 'lantern_rest_bank_porch', name: 'Lantern Bank Pavilion', prefab: 'forge',
    position: [2084.1, -116.55], rotationY: Math.PI / 4, footprint: [6, 4] },
];

/** Individual footings retain the planted banks between these lab-proven structures. */
export const LANTERN_REST_FOUNDATIONS = buildings.map(building => ({
  buildingId: building.id,
  x: building.position[0],
  z: building.position[1],
  halfExtents: [building.footprint[0] / 2 + 1, building.footprint[1] / 2 + 1] as const,
  rotationY: building.rotationY,
  radius: Math.hypot(building.footprint[0] / 2 + 1, building.footprint[1] / 2 + 1),
  blend: 1,
}));

/** Small lanes around the market replace the former road through its back wall. */
export const LANTERN_REST_LOCATIONS: LocationDef[] = [
  { id: 'lantern_rest_market_approach', name: 'Lantern Market', position: [2081, -100], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_market_west_walk', name: 'Willow Market Walk', position: [2073.4, -100.2], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_west_fork', name: 'Willow Fork', position: [2073, -91], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_west_garden_lane', name: 'Willow Garden Lane', position: [2073, -78], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_market_east_walk', name: 'Market Walk', position: [2088.4, -100.2], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_north_fork', name: 'Moonpetal Lane', position: [2088, -91], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_north_lane', name: 'Garden Lane', position: [2086, -72], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_west_lane', name: 'Willow Lane', position: [2075, -103], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_willow_door', name: 'Willow Cottage', position: [2072.6, -102], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_moss_door', name: 'Moss Cottage', position: [2068, -88.2], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_moonpetal_door', name: 'Moonpetal Cottage', position: [2093, -88.2], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_east_lane', name: 'Orchid Lane', position: [2104, -111], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_bank_lane', name: 'Lantern Bank Lane', position: [2091, -106], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_orchid_lane', name: 'Orchid Cottage Walk', position: [2089, -104], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_orchid_door', name: 'Orchid Cottage', position: [2090.4, -101], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_south_lane', name: 'Dewglass Lane', position: [2093, -117], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_dewglass_door', name: 'Dewglass Cottage', position: [2097, -120.4], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_forge_lane', name: 'Forge Lane', position: [2067, -115], kind: 'junction', routeNode: true },
  { id: 'lantern_rest_forge_approach', name: 'Lantern Forge', position: [2060, -118], kind: 'junction', routeNode: true },
];

/** These add internal routes; connect Garden Lane to Dewsong Copse and Orchid Lane to Dewglass Workings. */
export const LANTERN_REST_ROADS: RoadDef[] = [
  { from: 'lantern_rest_square', to: 'lantern_rest_market_approach' },
  { from: 'lantern_rest_market_approach', to: 'lantern_rest_market_east_walk' },
  { from: 'lantern_rest_market_east_walk', to: 'lantern_rest_north_fork' },
  { from: 'lantern_rest_north_fork', to: 'lantern_rest_north_lane' },
  { from: 'lantern_rest_market_approach', to: 'lantern_rest_market_west_walk' },
  { from: 'lantern_rest_market_west_walk', to: 'lantern_rest_west_fork' },
  { from: 'lantern_rest_west_fork', to: 'lantern_rest_moss_door' },
  { from: 'lantern_rest_west_fork', to: 'lantern_rest_west_garden_lane' },
  { from: 'lantern_rest_west_garden_lane', to: 'lantern_rest_north_lane' },
  { from: 'lantern_rest_north_fork', to: 'lantern_rest_moonpetal_door' },
  { from: 'lantern_rest_square', to: 'lantern_rest_west_lane' },
  { from: 'lantern_rest_west_lane', to: 'lantern_rest_willow_door' },
  { from: 'lantern_rest_square', to: 'lantern_rest_east_lane' },
  { from: 'lantern_rest_square', to: 'lantern_rest_orchid_lane' },
  { from: 'lantern_rest_orchid_lane', to: 'lantern_rest_orchid_door' },
  { from: 'lantern_rest_square', to: 'lantern_rest_bank_lane' },
  { from: 'lantern_rest_bank_lane', to: 'lantern_rest_bank_approach' },
  { from: 'lantern_rest_bank_approach', to: 'lantern_rest_south_lane' },
  { from: 'lantern_rest_south_lane', to: 'lantern_rest_dewglass_door' },
  { from: 'gloamgarden_arrival', to: 'lantern_rest_forge_lane' },
  { from: 'lantern_rest_forge_lane', to: 'lantern_rest_forge_approach' },
];

export const LANTERN_REST: SettlementDef = {
  id: 'lantern_rest', name: 'Lantern Rest', kit: 'timber', centre: [2080, -105], respawnPointId: 'lantern_rest',
  buildings,
  bank: { id: 'lantern_rest_bank', name: 'Lantern Rest Bank', position: [2085.25, -115.4], rotationY: Math.PI / 2,
    assetId: 'chest_wood', attachedTo: 'lantern_rest_bank_porch' },
  stations: [
    { id: 'lantern_rest_furnace', name: 'Lantern Furnace', kind: 'furnace', skill: 'smithing',
      position: [2058.7, -122.6], rotationY: 0, assetId: 'cauldron', scale: 2, recipeIds: [], attachedTo: 'lantern_rest_forge' },
    { id: 'lantern_rest_anvil', name: 'Lantern Anvil', kind: 'anvil', skill: 'smithing',
      position: [2061, -121.2], rotationY: 0, assetId: 'anvil', scale: 1.4, recipeIds: [], attachedTo: 'lantern_rest_forge' },
    { id: 'lantern_rest_range', name: 'Moonpetal Cooking Pot', kind: 'range', skill: 'cooking',
      position: [2085.6, -95.4], rotationY: Math.PI, assetId: 'cooking_pot', scale: 2.2, recipeIds: [], attachedTo: 'lantern_rest_shelter' },
    { id: 'lantern_rest_crafting', name: 'Lantern Workbench', kind: 'crafting_table', skill: 'crafting',
      position: [2076.4, -95.6], rotationY: Math.PI, assetId: 'workbench', recipeIds: [], attachedTo: 'lantern_rest_shelter' },
  ],
  shops: [
    { id: 'lantern_rest_general', name: 'Moonpetal Provisions', shopKind: 'general',
      // The market recipe supplies three stalls; the crate is the shop's goods interaction target.
      position: [2078, -96.25], rotationY: 0, assetId: 'farm_crate_apple', attachedTo: 'lantern_rest_shelter' },
    { id: 'lantern_rest_smith', name: 'Lantern Smith', shopKind: 'smith',
      position: [2056, -117.6], rotationY: 0, assetId: 'market_stall_cart', attachedTo: 'lantern_rest_forge' },
  ],
  // Fey variants are integrated after their actor fixture has passed the combat lab.
  npcs: [],
  props: [
    { id: 'lantern_rest_entry_post_w', assetId: 'corner_wood', position: [2073, -104.5], rotationY: .1, scale: .92, solid: true },
    { id: 'lantern_rest_entry_lamp_w', assetId: 'lamp_wall', position: [2073, -104.5], rotationY: Math.PI, scale: 1.15, dy: 2.1 },
    { id: 'lantern_rest_entry_post_e', assetId: 'corner_wood', position: [2093, -112.5], rotationY: -.15, scale: .92, solid: true },
    { id: 'lantern_rest_entry_lamp_e', assetId: 'lamp_wall', position: [2093, -112.5], rotationY: Math.PI, scale: 1.15, dy: 2.1 },
    { id: 'lantern_rest_entry_fence_w', assetId: 'fence_wood_single', position: [2072.1, -105.7], rotationY: Math.PI / 2, solid: true },
    { id: 'lantern_rest_entry_fence_e', assetId: 'fence_wood_single', position: [2093, -114], rotationY: Math.PI / 2, solid: true },
    { id: 'lantern_rest_entry_barrel', assetId: 'barrel', position: [2072.6, -105.2], rotationY: .15, scale: .9 },
    { id: 'lantern_rest_forge_rack', assetId: 'weapon_rack', position: [2061.6, -123.3], rotationY: 0 },
    { id: 'lantern_rest_forge_whetstone', assetId: 'whetstone', position: [2058.2, -120.4], rotationY: 0 },
    { id: 'lantern_rest_forge_barrel', assetId: 'barrel', position: [2063.6, -120.6], rotationY: 0.3 },
    { id: 'lantern_rest_forge_sack', assetId: 'sack', position: [2056.2, -120.6], rotationY: 1.1 },
    { id: 'lantern_rest_market_barrel', assetId: 'barrel_apples', position: [2075.8, -94.6], rotationY: 0.4 },
    { id: 'lantern_rest_market_sack', assetId: 'sack', position: [2085.7, -94.2], rotationY: 0.4 },
    { id: 'lantern_rest_bank_sack', assetId: 'sack', position: [2082, -115.6], rotationY: 0.7 },
    { id: 'lantern_rest_willow_bench', assetId: 'bench', position: [2071.2, -107.1], rotationY: 0 },
    { id: 'lantern_rest_moss_barrel', assetId: 'barrel', position: [2065.6, -86.6], rotationY: 0.2 },
    { id: 'lantern_rest_orchid_crate', assetId: 'crate_village', position: [2091.4, -97.2], rotationY: 0.4 },
    { id: 'lantern_rest_dewglass_barrel', assetId: 'barrel', position: [2100.3, -121.4], rotationY: 0.5 },
    { id: 'lantern_rest_market_fern', assetId: 'fern_1', position: [2087.1, -93.9], rotationY: 0.7, scale: 0.6 },
    { id: 'lantern_rest_market_flowers', assetId: 'flower_b_group', position: [2074.6, -93.7], rotationY: 0.5, scale: 0.65 },
    { id: 'lantern_rest_bank_flowers', assetId: 'flower_a_group', position: [2088.3, -115.1], rotationY: 1, scale: 0.5 },
    { id: 'lantern_rest_bank_bench', assetId: 'bench', position: [2083.3, -118], rotationY: Math.PI / 4, scale: 0.8 },
    { id: 'lantern_rest_willow_fence', assetId: 'fence_wood_single', position: [2072.7, -106.1], rotationY: 0, solid: true },
    { id: 'lantern_rest_moss_fence', assetId: 'fence_wood_single', position: [2064.7, -86.6], rotationY: Math.PI / 2, solid: true },
    { id: 'lantern_rest_orchid_fence', assetId: 'fence_wood_single', position: [2094.5, -105.8], rotationY: 0, solid: true },
    { id: 'lantern_rest_dewglass_fence', assetId: 'fence_wood_single', position: [2101.3, -121.5], rotationY: Math.PI / 2, solid: true },
  ],
};
