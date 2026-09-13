import type { ItemDef } from "../../contracts.js";
import type { GearBalance } from "../schema/balance.js";
import type { GearDerivation } from "../schema/gearDerivation.js";

export interface DerivedGear {
  tier: number;
  value: number;
  equip: NonNullable<ItemDef["equip"]>;
}

/**
 * Assemble numeric gear fields from the authored baseline and shared cadence parameters.
 * Baseline stats are explicit authored inputs. The rare variant preserves the original
 * ceil-per-offensive-stat and round-on-value operations from equipment.ts rare().
 */
export function gear(params: GearBalance, input: GearDerivation): DerivedGear {
  const baseline = params.baselines.find((row) => row.id === input.baselineId);
  if (!baseline) throw new Error(`Unknown gear baseline ${input.baselineId}`);
  const equip: DerivedGear["equip"] = {
    slot: baseline.slot,
    bonuses: { ...baseline.bonuses },
    requires: { ...baseline.requires },
  };
  if (input.attackKind !== undefined) equip.attackSpeedMs = params.attackSpeedMs[input.attackKind];
  let value = baseline.value;
  if (input.variant === "rare") {
    const boosted = input.attackKind === "melee"
      ? ["meleeAccuracy", "meleePower"] as const
      : ["magicAccuracy", "magicPower"] as const;
    for (const key of boosted) equip.bonuses[key] = Math.ceil(baseline.bonuses[key] * params.rare.bonusMultiplier);
    value = Math.round(baseline.value * params.rare.valueMultiplier);
  }
  return { tier: baseline.tier, value, equip };
}
