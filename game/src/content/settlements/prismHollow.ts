import type { BuildingDef, LocationDef, RoadDef, SettlementDef } from '../regions.js';

/** A quieter T60 pocket under the Prism Table cliff, using Faeholme's cooler palette. */
const buildings: BuildingDef[] = [
  { id: 'prism_hollow_root_cottage', name: 'Starroot Cottage', prefab: 'cottage',
    position: [2290, 144], rotationY: -Math.PI / 2, footprint: [6, 4] },
  { id: 'prism_hollow_orchid_cottage', name: 'Frost Orchid Cottage', prefab: 'cottage',
    position: [2310, 150], rotationY: Math.PI / 2, footprint: [6, 4] },
  { id: 'prism_hollow_moon_cottage', name: 'Moonshade Cottage', prefab: 'cottage',
    position: [2301, 160], rotationY: 0, footprint: [6, 4] },
  { id: 'prism_hollow_bank_porch', name: 'Prism Bank Pavilion', prefab: 'forge',
    position: [2309.8, 135.65], rotationY: -Math.PI / 2, footprint: [6, 4] },
];

export const PRISM_HOLLOW_FOUNDATIONS = buildings.map(building => ({
  buildingId: building.id,
  x: building.position[0],
  z: building.position[1],
  halfExtents: [building.footprint[0] / 2 + 1, building.footprint[1] / 2 + 1] as const,
  rotationY: building.rotationY,
  radius: Math.hypot(building.footprint[0] / 2 + 1, building.footprint[1] / 2 + 1),
  blend: 1,
}));

/** Door nodes grade only the small paths. They must not generate circular location pads. */
export const PRISM_HOLLOW_LOCATIONS: LocationDef[] = [
  { id: 'prism_hollow_square', name: 'Prism Hollow', position: [2300, 146], kind: 'settlement', routeNode: true,
    blurb: 'Small violet-roofed cottages shelter below the high gardens, with a bank beside the southern path.' },
  { id: 'prism_hollow_bank_approach', name: 'Prism Hollow Bank', position: [2304.5, 135.8], kind: 'bank', routeNode: true },
  { id: 'prism_hollow_west_lane', name: 'Starroot Lane', position: [2278, 152], kind: 'junction', routeNode: true },
  { id: 'prism_hollow_east_lane', name: 'Orchid Lane', position: [2323, 140], kind: 'junction', routeNode: true },
  { id: 'prism_hollow_root_door', name: 'Starroot Cottage', position: [2293.6, 144], kind: 'junction', routeNode: true },
  { id: 'prism_hollow_orchid_door', name: 'Frost Orchid Cottage', position: [2306.4, 150], kind: 'junction', routeNode: true },
  { id: 'prism_hollow_moon_door', name: 'Moonshade Cottage', position: [2301, 156.4], kind: 'junction', routeNode: true },
];

/** Outgoing paths leave east and west; the raised combat table has a separate wilderness ascent. */
export const PRISM_HOLLOW_ROADS: RoadDef[] = [
  { from: 'faeholme_south_path', to: 'prism_hollow_square' },
  { from: 'prism_hollow_square', to: 'prism_hollow_bank_approach' },
  { from: 'prism_hollow_square', to: 'prism_hollow_west_lane' },
  { from: 'prism_hollow_square', to: 'prism_hollow_east_lane' },
  { from: 'prism_hollow_square', to: 'prism_hollow_root_door' },
  { from: 'prism_hollow_square', to: 'prism_hollow_orchid_door' },
  { from: 'prism_hollow_square', to: 'prism_hollow_moon_door' },
];

export const PRISM_HOLLOW: SettlementDef = {
  id: 'prism_hollow', name: 'Prism Hollow', kit: 'timber', centre: [2300, 146],
  // The existing region respawn remains Lantern Rest; this bank does not change progression.
  respawnPointId: 'lantern_rest',
  buildings,
  bank: { id: 'prism_hollow_bank', name: 'Prism Hollow Bank', position: [2308.4, 135.65], rotationY: -Math.PI / 2,
    assetId: 'chest_wood', attachedTo: 'prism_hollow_bank_porch' },
  stations: [], shops: [], npcs: [],
  props: [
    { id: 'prism_hollow_bank_sack', assetId: 'sack', position: [2310.5, 133.8], rotationY: 0.6 },
    { id: 'prism_hollow_root_barrel', assetId: 'barrel', position: [2292.6, 140.6], rotationY: 0.2 },
    { id: 'prism_hollow_orchid_bench', assetId: 'bench', position: [2307.5, 154.2], rotationY: -Math.PI / 2 },
    { id: 'prism_hollow_moon_flowers', assetId: 'flower_b_group', position: [2297.6, 157.4], rotationY: 1.1, scale: 0.55 },
    { id: 'prism_hollow_bank_fern', assetId: 'fern_1', position: [2307.1, 132.3], rotationY: 0.7, scale: 0.65 },
    { id: 'prism_hollow_root_fence', assetId: 'fence_wood_single', position: [2293.5, 140.1], rotationY: 0, solid: true },
    { id: 'prism_hollow_moon_fence', assetId: 'fence_wood_single', position: [2296.5, 157.4], rotationY: Math.PI / 2, solid: true },
  ],
};
