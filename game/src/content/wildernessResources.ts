import type { ResourceDef } from './index.js';
import type { LocationDef, ResourceClusterDef } from './regions.js';
import type { WorldSite } from './worldSites.js';
import { WILDERNESS_RESOURCE_INTENTS } from './wildernessDepth.js';

/** Native species aliases preserve the existing logs, gathering rules and forest persistence. */
export const WILDERNESS_TREE_VARIANTS = [
  { assetId: 'corealm_teak_lastroot', speciesId: 'teak', resourceId: 'tree_wilderness_teak', itemId: 'teak_log', tier: 50 },
  { assetId: 'corealm_teak_embershelter', speciesId: 'teak', resourceId: 'tree_wilderness_teak', itemId: 'teak_log', tier: 50 },
  { assetId: 'corealm_magic_starwood', speciesId: 'magic', resourceId: 'tree_wilderness_magic', itemId: 'magic_log', tier: 70 },
  { assetId: 'corealm_magic_moonvein', speciesId: 'magic', resourceId: 'tree_wilderness_magic', itemId: 'magic_log', tier: 70 },
] as const;

export const WILDERNESS_ORE_RESOURCES: readonly ResourceDef[] = [
  { id: 'cindervein_vein', name: 'Cindervein Deposit', archetype: 'ore', skill: 'mining', tier: 50, reqLevel: 50,
    itemId: 'cindervein_ore', bonus: [{ itemId: 'cairn_garnet', chance: .07 }], yieldRange: [5, 9], respawnSeconds: 75,
    presentation: { availableAssetIds: ['corealm_ore_cindervein'], depletedAssetId: 'corealm_ore_cindervein_spent', targetWorldSize: 1.55, variantScale: [.94, 1.10], materialTier: 50 } },
  { id: 'nightglass_vein', name: 'Nightglass Deposit', archetype: 'ore', skill: 'mining', tier: 70, reqLevel: 70,
    itemId: 'nightglass_ore', bonus: [{ itemId: 'fire_opal', chance: .07 }], yieldRange: [4, 8], respawnSeconds: 95,
    presentation: { availableAssetIds: ['corealm_ore_nightglass'], depletedAssetId: 'corealm_ore_nightglass_spent', targetWorldSize: 1.55, variantScale: [.94, 1.10], materialTier: 70 } },
];

/** Authored groves select Wilderness bodies while yielding the existing production timber. */
export const WILDERNESS_TREE_RESOURCES: readonly ResourceDef[] = [
  { id: 'tree_wilderness_teak', name: 'Veinwood', archetype: 'tree', skill: 'woodcutting', tier: 50, reqLevel: 50, itemId: 'teak_log',
    presentation: { availableAssetIds: ['corealm_teak_lastroot', 'corealm_teak_embershelter'], depletedAssetId: 'corealm_stump_wilderness_teak', targetWorldSize: 11, variantScale: [.86, 1.10], materialTier: 50 } },
  { id: 'tree_wilderness_magic', name: 'Magic Tree', archetype: 'tree', skill: 'woodcutting', tier: 70, reqLevel: 70, itemId: 'magic_log',
    presentation: { availableAssetIds: ['corealm_magic_starwood', 'corealm_magic_moonvein'], depletedAssetId: 'corealm_stump_wilderness_magic', targetWorldSize: 14, variantScale: [.90, 1.08], materialTier: 70 } },
];

const labels: Record<string, string> = {
  cindervein_workings: 'Cindervein Workings', nightglass_excavation: 'Nightglass Excavation', lastroot_teak: 'Lastroot Shelter',
  ember_shelter_teak: 'Ember Shelter', starwood_hollow: 'Starwood Hollow', moonvein_copse: 'Moonvein Copse',
  east_cinder_cut: 'East Cinder Cut', ashwind_shelter: 'Ashwind Shelter',
  nightglass_ridge: 'Nightglass Ridge', starfall_copse: 'Starfall Copse',
};
const clusterId = (id: string) => `${id}_resources`;
/** New eastern sites face the road that enters their open work aisle. */
const EASTERN_SITE_ROTATIONS: Readonly<Record<string, number>> = {
  east_cinder_cut: -1.25, ashwind_shelter: 1.42, nightglass_ridge: -1.99, starfall_copse: 2.09,
};
export const WILDERNESS_RESOURCE_LOCATIONS: LocationDef[] = WILDERNESS_RESOURCE_INTENTS.map(intent => ({
  id: intent.id, name: labels[intent.id]!, position: intent.position, kind: intent.kind === 'mine' ? 'seam' : 'grove', routeNode: true,
  blurb: intent.kind === 'mine' ? `Worked T${intent.tier} seams open above a dry mining aisle.` : intent.tier === 50 ? 'Veinwood survives in a sheltered pocket among scorched trunks.' : 'Old magic trees draw blue and violet sap through the deep stone.',
}));

export const WILDERNESS_RESOURCE_CLUSTERS: ResourceClusterDef[] = WILDERNESS_RESOURCE_INTENTS.map(intent => ({
  id: clusterId(intent.id), resourceId: intent.kind === 'mine' ? intent.tier === 50 ? 'cindervein_vein' : 'nightglass_vein' : intent.tier === 50 ? 'tree_wilderness_teak' : 'tree_wilderness_magic',
  count: intent.kind === 'mine' ? 7 : 9, centre: intent.position, radius: intent.kind === 'mine' ? 13 : 18, locationId: intent.id,
}));

export const WILDERNESS_RESOURCE_SITES: readonly WorldSite[] = WILDERNESS_RESOURCE_INTENTS.map(intent => {
  const mine = intent.kind === 'mine', cluster = clusterId(intent.id), deep = intent.tier === 70;
  const rotationY = EASTERN_SITE_ROTATIONS[intent.id] ?? (mine ? Math.PI : .18);
  const site: WorldSite = {
    id: intent.id, locationId: intent.id, regionId: 'wilderness', centre: intent.position, rotationY,
    kind: intent.kind, workRadius: mine ? 8 : 10, extent: mine ? [23, 25] : [23, 23],
    terrain: { floorRadius: mine ? 10.5 : 16, backRise: mine ? 5.4 : 1.15, backDistance: mine ? 7.2 : 21, bermWidth: mine ? 10 : 8, approachAngle: 0 },
    resourceSlots: mine ? Array.from({ length: 7 }, (_, i) => {
      const x = (i - 3) * 3.65;
      return { clusterId: cluster, index: i + 1, x, z: -4.5 + Math.abs(i - 3) * .46, yaw: -(i - 3) * .095, scale: [.94, 1.06, .98, 1.08, .95, 1.03, .97][i]! };
    }) : Array.from({ length: 9 }, (_, i) => {
      // Two unequal crescent rows keep the central approach clear; no tree sits in the aisle.
      const left = i < 5, rank = left ? i : i - 5;
      return { clusterId: cluster, index: i + 1, x: (left ? -1 : 1) * (8 + (rank % 2) * 6.6), z: -13 + rank * 6.1,
        yaw: i * 2.399963, scale: [.91, 1.02, .96, 1.06, .94, 1, .92, 1.04, .97][i]! };
    }),
    ...(mine ? { cutFace: { backDepth: 10.4, buryDepth: .65, frontSetback: .40,
      stations: Array.from({ length: 7 }, (_, i) => ({ clusterId: cluster, index: i + 1, crestHeight: [3.2, 3.7, 3.5, 3.9, 3.4, 3.6, 3.1][i]! })) } } : {}),
    dressing: mine ? [
      { id: 'west-shoulder', assetId: 'corealm_rock_strata_3', x: -13.8, z: -6.3, yaw: .62, scale: [1.25, 1.10, 1.10], sink: .48 },
      { id: 'east-shoulder', assetId: 'corealm_rock_strata_1', x: 13.7, z: -6.0, yaw: -.74, scale: [1.20, 1.05, 1.17], sink: .52 },
      { id: 'tailings', assetId: 'corealm_scree_2', x: -14.4, z: 2.5, yaw: .43, scale: [1.25, .85, 1.08], sink: .12 },
      // Handling sits on the graded floor east of the last station, inside the working area and
      // clear of both the mining stances and the central haul lane.
      { id: 'sorting-bench', assetId: 'workbench', x: 12.9, z: 1.5, yaw: -.28, scale: 1 },
      { id: 'ore-crate', assetId: 'crate_wood', x: 14.5, z: 2.3, yaw: .22, scale: .9 },
    ] : [
      { id: 'windbreak-west', assetId: 'corealm_rock_strata_1', x: -18.8, z: -8, yaw: .38, scale: [1.2, .84, .85], sink: .3 },
      { id: 'windbreak-east', assetId: 'corealm_rock_strata_3', x: 18.5, z: -6, yaw: -.45, scale: [1.12, .84, .9], sink: .3 },
      { id: 'old-trunk', assetId: 'corealm_deadwood_fallen', x: 0, z: -18, yaw: Math.PI / 2, scale: .75, sink: .08 },
      ...(!deep ? [
        { id: 'living-understory-west', assetId: 'corealm_fern_1', x: -8.8, z: 7.5, yaw: .3, scale: 1.1 },
        { id: 'living-understory-east', assetId: 'corealm_shrub_2', x: 9, z: 7.8, yaw: 1.2, scale: .85 },
      ] : []),
    ],
  };
  return site;
});
