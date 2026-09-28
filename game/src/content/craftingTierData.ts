import { COMPILED_PROGRESSION } from './compiler/runtime.js';
/** Crafting and acquisition pages select rows from the same authored progression. */
export const PROGRESSION_TIERS = COMPILED_PROGRESSION.progression;
export const CRAFTING_TIER_RECORDS = PROGRESSION_TIERS;
const materialItem = (id: string | undefined) => COMPILED_PROGRESSION.materials.find(row => row.id === id)?.itemId ?? '';
const craftingRows = (wilderness: boolean) => PROGRESSION_TIERS.filter(row => row.materials.thread && !!row.materials.flux === wilderness).map(row => ({
  ...row.presentation, tier: row.tier, hide: materialItem(row.materials.hide), thread: materialItem(row.materials.thread),
  metal: row.presentation.metal ?? '', wood: row.presentation.wood ?? '', jewellery: row.presentation.jewellery ?? '',
  ore: materialItem(row.materials.ore), flux: materialItem(row.materials.flux), gem: materialItem(row.materials.gem),
}));
const regional = craftingRows(false), wilderness = craftingRows(true);
export const REGIONAL_CRAFTING_TIER_DATA = regional;
export const WILDERNESS_CRAFTING_TIER_DATA = wilderness;
/** After the catalog moved. `PROGRESSION_TIERS` is the catalog's own array, refilled in place; these follow it. */
export function reindexCraftingTiers(): void {
  regional.splice(0, regional.length, ...craftingRows(false));
  wilderness.splice(0, wilderness.length, ...craftingRows(true));
}
