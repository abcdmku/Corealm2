import type { EquipmentBonuses } from '../../contracts.js';
import type { EquipmentFamily, RecipeTemplate } from '../schema/progression.js';

export function equipmentStats(tier: number, parameters: EquipmentFamily['parameters']) {
  const bonuses = { ...parameters.bonusesBase };
  for (const key of Object.keys(bonuses) as (keyof EquipmentBonuses)[]) {
    bonuses[key] = Math.round(parameters.bonusesBase[key] + tier * parameters.bonusesPerLevel[key]);
  }
  return { value: Math.max(0, Math.round(parameters.valueBase + tier * parameters.valuePerLevel)), bonuses,
    gatherBonus: tier * parameters.gatherBonusPerLevel };
}
export function productionStats(tier: number, parameters: RecipeTemplate['parameters']) {
  return { durationMs: parameters.durationMs, xp: Math.round(parameters.xpBase + tier * parameters.xpPerLevel) };
}