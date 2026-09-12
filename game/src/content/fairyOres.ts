import type { ResourceDef } from './index.js';

/** Regional seams refine into the existing metals, so every mined item has a production use. */
export const FAIRY_ORE_RESOURCES: readonly ResourceDef[] = [
  {
    id: 'dewglass_ore', name: 'Dewglass Cobalt Seam', archetype: 'ore', skill: 'mining', tier: 30, reqLevel: 30,
    itemId: 'kaldite_ore', yieldRange: [7, 11], respawnSeconds: 60,
    bonus: [{ itemId: 'cairn_garnet', chance: .12 }, { itemId: 'water_essence', chance: .25 }],
    presentation: {
      availableAssetIds: ['corealm_ore_kaldite'], depletedAssetId: 'corealm_ore_kaldite_spent',
      targetWorldSize: 1.55, variantScale: [.94, 1.08], materialTier: 30,
    },
  },
  {
    id: 'crown_silver_ore', name: 'Crownward Titanium Seam', archetype: 'ore', skill: 'mining', tier: 40, reqLevel: 40,
    itemId: 'emberite_ore', yieldRange: [8, 12], respawnSeconds: 70,
    bonus: [{ itemId: 'fire_opal', chance: .12 }, { itemId: 'kilnstone', chance: .35 }],
    presentation: {
      availableAssetIds: ['corealm_ore_corven'], depletedAssetId: 'corealm_ore_corven_spent',
      targetWorldSize: 1.55, variantScale: [.94, 1.08], materialTier: 40,
    },
  },
  {
    id: 'star_amethyst_ore', name: 'Star Amethyst Titanium Seam', archetype: 'ore', skill: 'mining', tier: 60, reqLevel: 60,
    itemId: 'emberite_ore', yieldRange: [10, 15], respawnSeconds: 85,
    bonus: [{ itemId: 'fire_opal', chance: .25 }, { itemId: 'fire_essence', chance: .4 }],
    presentation: {
      availableAssetIds: ['corealm_ore_nightglass'], depletedAssetId: 'corealm_ore_nightglass_spent',
      targetWorldSize: 1.55, variantScale: [.94, 1.08], materialTier: 60,
    },
  },
];

/** Local skins keep the native willow/yew logs and the existing gathering and save rules. */
export const FAIRY_TREE_RESOURCES: readonly ResourceDef[] = [
  {
    id: 'tree_gloam_willow', name: 'Gloam Willow', archetype: 'tree', skill: 'woodcutting', tier: 30, reqLevel: 30,
    itemId: 'willow_log',
    presentation: {
      availableAssetIds: ['corealm_willow_gloam_1', 'corealm_willow_gloam_2'], depletedAssetId: 'corealm_stump_oak',
      targetWorldSize: 10, variantScale: [.86, 1.1], materialTier: 30,
    },
  },
  {
    id: 'tree_fae_yew', name: 'Fae Yew', archetype: 'tree', skill: 'woodcutting', tier: 60, reqLevel: 60,
    itemId: 'yew_log',
    presentation: {
      availableAssetIds: ['corealm_yew_fae_1', 'corealm_yew_fae_2'], depletedAssetId: 'corealm_stump_oak',
      targetWorldSize: 9, variantScale: [.9, 1.1], materialTier: 60,
    },
  },
];
