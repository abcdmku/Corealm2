import type { EquipmentBonuses } from "../../contracts.js";
import type { EquipmentSetThreshold } from "../equipmentSets.js";
import type { SetsBalance } from "../schema/balance.js";

function bonuses(partial: Partial<EquipmentBonuses>): EquipmentBonuses {
  return { meleeAccuracy: 0, meleePower: 0, defence: 0, magicAccuracy: 0, magicPower: 0,
    health: 0, vitality: 0, ...partial };
}

function pieces(value: number): EquipmentSetThreshold["pieces"] {
  if (value !== 2 && value !== 3 && value !== 4 && value !== 5) {
    throw new Error(`Set threshold requires 2, 3, 4 or 5 pieces; got ${value}`);
  }
  return value;
}

/** Uses only supplied balance parameters; callers decide whether to apply the result. */
export function setThresholds(params: SetsBalance, input: { tier: number; bareheaded: boolean }): EquipmentSetThreshold[] {
  const tier = params.byTier.find(row => row.tier === input.tier);
  if (!tier) throw new Error(`Missing set balance tier ${input.tier}`);
  const defence = input.bareheaded ? params.thresholds.bareheadedDefencePieces : params.thresholds.defencePieces;
  const health = input.bareheaded ? params.thresholds.bareheadedHealthPieces : params.thresholds.healthPieces;
  const counts = [pieces(defence[0]), pieces(health), pieces(defence[1])];
  if (counts[0]! >= counts[1]! || counts[1]! >= counts[2]!) throw new Error("Set threshold piece counts must increase");
  return [
    { pieces: counts[0]!, bonuses: bonuses({ defence: tier.defence }) },
    { pieces: counts[1]!, bonuses: bonuses({ health: tier.health }) },
    { pieces: counts[2]!, bonuses: bonuses({ defence: tier.defence }) },
  ];
}
