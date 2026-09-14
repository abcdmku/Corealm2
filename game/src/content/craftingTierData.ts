import { COMPILED_PROGRESSION } from './compiler/runtime.js';
/** Crafting and acquisition pages select rows from the same authored progression. */
export const PROGRESSION_TIERS = COMPILED_PROGRESSION.progression;
export const CRAFTING_TIER_RECORDS = PROGRESSION_TIERS;
const materialItem = (id: string | undefined) => COMPILED_PROGRESSION.materials.find(row => row.id === id)?.itemId ?? '';
export const REGIONAL_CRAFTING_TIER_DATA = PROGRESSION_TIERS.filter(row => row.materials.thread && !row.materials.flux).map(row => ({
  ...row.presentation, tier: row.tier, hide: materialItem(row.materials.hide), thread: materialItem(row.materials.thread),
  metal: row.presentation.metal ?? '', wood: row.presentation.wood ?? '', jewellery: row.presentation.jewellery ?? '',
  ore: materialItem(row.materials.ore), flux: materialItem(row.materials.flux), gem: materialItem(row.materials.gem),
}));
export const WILDERNESS_CRAFTING_TIER_DATA = PROGRESSION_TIERS.filter(row => row.materials.thread && row.materials.flux).map(row => ({
  ...row.presentation, tier: row.tier, hide: materialItem(row.materials.hide), thread: materialItem(row.materials.thread),
  metal: row.presentation.metal ?? '', wood: row.presentation.wood ?? '', jewellery: row.presentation.jewellery ?? '',
  ore: materialItem(row.materials.ore), flux: materialItem(row.materials.flux), gem: materialItem(row.materials.gem),
}));
