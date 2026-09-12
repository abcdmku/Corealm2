import type { ItemDef } from "../contracts.js";
import type { ResourceDef } from "./index.js";

export type TreeSpeciesId = "pine" | "ash" | "oak" | "walnut" | "willow" | "maple" | "teak" | "yew" | "magic";

export interface TreeSpeciesDef {
  id: TreeSpeciesId;
  name: string;
  level: number;
  resourceId: string;
  logId: string;
  variants: number;
  trunkRadius: number;
  height: number;
  logValue: number;
}

/** Legacy resource/item IDs keep saves, quests, and existing recipes connected. */
export const TREE_SPECIES: readonly TreeSpeciesDef[] = [
  { id: "pine", name: "Pine", level: 1, resourceId: "tree_palewood", logId: "palewood_log", variants: 5, trunkRadius: .23, height: 8, logValue: 10 },
  { id: "ash", name: "Ash", level: 5, resourceId: "tree_duskoak", logId: "duskoak_log", variants: 2, trunkRadius: .20, height: 10, logValue: 38 },
  { id: "oak", name: "Oak", level: 10, resourceId: "tree_cairnpine", logId: "cairnpine_log", variants: 5, trunkRadius: .58, height: 16, logValue: 88 },
  { id: "walnut", name: "Walnut", level: 20, resourceId: "tree_cinderpine", logId: "cinderpine_log", variants: 2, trunkRadius: .52, height: 17, logValue: 195 },
  { id: "willow", name: "Willow", level: 30, resourceId: "tree_willow", logId: "willow_log", variants: 2, trunkRadius: .34, height: 10, logValue: 310 },
  { id: "maple", name: "Maple", level: 40, resourceId: "tree_maple", logId: "maple_log", variants: 2, trunkRadius: .27, height: 11, logValue: 440 },
  { id: "teak", name: "Teak", level: 50, resourceId: "tree_teak", logId: "teak_log", variants: 2, trunkRadius: .24, height: 12, logValue: 590 },
  { id: "yew", name: "Yew", level: 60, resourceId: "tree_yew", logId: "yew_log", variants: 2, trunkRadius: .32, height: 8, logValue: 755 },
  { id: "magic", name: "Magic", level: 70, resourceId: "tree_magic", logId: "magic_log", variants: 2, trunkRadius: .72, height: 14, logValue: 940 },
];

export function treeAssetIds(species: TreeSpeciesDef): string[] {
  return Array.from({ length: species.variants }, (_, index) => `corealm_${species.id}_${index + 1}`);
}

const speciesByAsset = new Map(TREE_SPECIES.flatMap(species => treeAssetIds(species).map(id => [id, species] as const)));
// Native metadata also applies when these candidates are served in the isolated lab.
for (const [id, speciesId] of [
  ['corealm_teak_lastroot', 'teak'], ['corealm_teak_embershelter', 'teak'],
  ['corealm_magic_starwood', 'magic'], ['corealm_magic_moonvein', 'magic'],
] as const) speciesByAsset.set(id, {
  ...TREE_SPECIES.find(species => species.id === speciesId)!,
  resourceId: `tree_wilderness_${speciesId}`,
  name: speciesId === 'teak' ? 'Veinwood' : 'Magic',
});

for (const [prefix, speciesId, resourceId, name] of [
  ['corealm_willow_gloam', 'willow', 'tree_gloam_willow', 'Gloam Willow'],
  ['corealm_yew_fae', 'yew', 'tree_fae_yew', 'Fae Yew'],
  ['fairy_canopy_gloam', 'willow', 'tree_gloam_willow', 'Moonpetal Tree'],
  ['fairy_canopy_fae', 'yew', 'tree_fae_yew', 'Prism Tree'],
] as const) for (const index of [1, 2]) speciesByAsset.set(`${prefix}_${index}`, {
  ...TREE_SPECIES.find(species => species.id === speciesId)!, resourceId, name,
});

speciesByAsset.set('fairy_hero_gloam', { ...TREE_SPECIES.find(species => species.id === 'willow')!,
  resourceId: 'tree_gloam_willow', name: 'Ancient Moonpetal Tree', trunkRadius: .686, height: 15.5 });

export function treeSpeciesForAsset(assetId: string): TreeSpeciesDef | undefined {
  return speciesByAsset.get(assetId);
}

/** Living species and shared stumps retain authored materials during forest promotion. */
export function isNativeTreeAsset(assetId: string): boolean {
  return speciesByAsset.has(assetId) || /^corealm_stump_(?:oak|pine|wilderness_teak|wilderness_magic)$/.test(assetId);
}

export function treeResource(species: TreeSpeciesDef): ResourceDef {
  return {
    id: species.resourceId, name: species.name, archetype: "tree", skill: "woodcutting",
    tier: species.level, reqLevel: species.level, itemId: species.logId,
    presentation: {
      availableAssetIds: treeAssetIds(species),
      depletedAssetId: species.id === "pine" ? "corealm_stump_pine" : "corealm_stump_oak",
      targetWorldSize: species.height, variantScale: [.86, 1.12], materialTier: species.level,
    },
  };
}

export const HIGH_TIER_TREE_RESOURCES = TREE_SPECIES.filter(species => species.level > 20).map(treeResource);
export const HIGH_TIER_LOG_ITEMS: readonly ItemDef[] = TREE_SPECIES.filter(species => species.level > 20).map(species => ({
  id: species.logId, name: `${species.name} Log`, tier: species.level,
  description: `Timber cut from a ${species.name.toLowerCase()} tree.`,
  stackable: false, value: species.logValue, category: "resource",
}));

/** Regional preference within a mixed forest; higher tiers remain visible at declining frequency. */
export function treeEncounterWeight(species: TreeSpeciesDef, areaLevel: number): number {
  if (species.level <= areaLevel) return species.level === areaLevel ? 1 : .45 * Math.pow(.9, (areaLevel - species.level) / 10);
  return .5 * Math.pow(.65, (species.level - areaLevel) / 10);
}

speciesByAsset.set('fairy_hero_gloam_sheltered', { ...speciesByAsset.get('fairy_hero_gloam')!, trunkRadius: 1.75, height: 11 });

speciesByAsset.set('fairy_hero_fae_sheltered', { ...TREE_SPECIES.find(species => species.id === 'yew')!, resourceId: 'tree_fae_yew', name: 'Ancient Prism Tree', trunkRadius: 1.75, height: 11 });
