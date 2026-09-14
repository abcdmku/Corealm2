import { resourceById, RESOURCE_DATA } from "./resourceData.js";
import { ITEM_DATA } from "./itemData.js";
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

/** Stable species/resource links and measured trunk geometry are world-authoring data. */
const TREE_IDENTITIES = [
  { id: "pine", resourceId: "tree_palewood", trunkRadius: .23 },
  { id: "ash", resourceId: "tree_duskoak", trunkRadius: .20 },
  { id: "oak", resourceId: "tree_cairnpine", trunkRadius: .58 },
  { id: "walnut", resourceId: "tree_cinderpine", trunkRadius: .52 },
  { id: "willow", resourceId: "tree_willow", trunkRadius: .34 },
  { id: "maple", resourceId: "tree_maple", trunkRadius: .27 },
  { id: "teak", resourceId: "tree_teak", trunkRadius: .24 },
  { id: "yew", resourceId: "tree_yew", trunkRadius: .32 },
  { id: "magic", resourceId: "tree_magic", trunkRadius: .72 },
] as const;

/** Project editable gameplay fields without modifying the supplied records. */
export function projectTreeSpecies(identity: Pick<TreeSpeciesDef, "id" | "resourceId" | "trunkRadius">,
  resource: ResourceDef, items: readonly ItemDef[]): TreeSpeciesDef {
  if (resource.id !== identity.resourceId || resource.archetype !== "tree") {
    throw new Error(`Invalid tree resource for ${identity.id}: ${resource.id}`);
  }
  const item = items.find(row => row.id === resource.itemId);
  if (!item) throw new Error(`Missing tree yield item ${resource.itemId}`);
  return { id: identity.id, name: resource.name, level: resource.reqLevel, resourceId: resource.id,
    logId: resource.itemId, variants: resource.presentation.availableAssetIds.length,
    trunkRadius: identity.trunkRadius, height: resource.presentation.targetWorldSize, logValue: item.value };
}

export const TREE_SPECIES: readonly TreeSpeciesDef[] = TREE_IDENTITIES.map(identity =>
  projectTreeSpecies(identity, resourceById(identity.resourceId), ITEM_DATA));

function nativeTreeResource(species: TreeSpeciesDef): ResourceDef {
  return resourceById(TREE_IDENTITIES.find(row => row.id === species.id)!.resourceId);
}

export function projectTreeAssetIds(resource: ResourceDef): string[] {
  return [...resource.presentation.availableAssetIds];
}

export function treeAssetIds(species: TreeSpeciesDef): string[] {
  return projectTreeAssetIds(nativeTreeResource(species));
}

const speciesByAsset = new Map(TREE_SPECIES.flatMap(species => treeAssetIds(species).map(id => [id, species] as const)));
// These regional names and geometry are presentation overrides of native species metadata.
// They also apply when the candidates are served in the isolated lab.
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
      ...nativeTreeResource(species).presentation,
      availableAssetIds: treeAssetIds(species),
      targetWorldSize: species.height, materialTier: species.level,
    },
  };
}

export const HIGH_TIER_TREE_RESOURCES: readonly ResourceDef[] = RESOURCE_DATA.filter(resource => resource.archetype === "tree" && resource.tier >= 30 && !resource.id.includes("wilderness") && !resource.id.includes("gloam") && !resource.id.includes("fae"));
export const HIGH_TIER_LOG_ITEMS: readonly ItemDef[] = ITEM_DATA.filter(item => item.id.endsWith("_log") && item.tier >= 30);

/** Regional preference within a mixed forest; higher tiers remain visible at declining frequency. */
export function treeEncounterWeight(species: TreeSpeciesDef, areaLevel: number): number {
  if (species.level <= areaLevel) return species.level === areaLevel ? 1 : .45 * Math.pow(.9, (areaLevel - species.level) / 10);
  return .5 * Math.pow(.65, (species.level - areaLevel) / 10);
}

speciesByAsset.set('fairy_hero_gloam_sheltered', { ...speciesByAsset.get('fairy_hero_gloam')!, trunkRadius: 1.75, height: 11 });

speciesByAsset.set('fairy_hero_fae_sheltered', { ...TREE_SPECIES.find(species => species.id === 'yew')!, resourceId: 'tree_fae_yew', name: 'Ancient Prism Tree', trunkRadius: 1.75, height: 11 });
