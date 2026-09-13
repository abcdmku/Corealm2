import type { EquipmentBonuses, ItemDef } from "../../contracts.js";
import type { GearBalance, RecipesBalance } from "../schema/balance.js";
import type { ItemFormulaBalance, ItemFormulaDerivation } from "../schema/itemFormula.js";
import { toolBonus } from "./recipes.js";
import { gear } from "./gear.js";

export type DerivedItemFormula = Partial<Pick<ItemDef, "tier" | "value" | "equip" | "magicWeapon" | "tool">>;
const bonusKeys = ["meleeAccuracy", "meleePower", "defence", "magicAccuracy", "magicPower", "health", "vitality"] as const;
function operand(value: { value: number } | { max: readonly [number, number] } | undefined, fallback: number): number {
  return value === undefined ? fallback : "value" in value ? value.value : Math.max(...value.max);
}

/** Return locked fields only. The caller decides whether to apply a previewed patch. */
export function itemFormula(params: ItemFormulaBalance, recipes: RecipesBalance, gearParams: GearBalance, input: ItemFormulaDerivation): DerivedItemFormula {
  if (input.variant === "baseTool") {
    const tool = params.baseTools.find(row => row.id === input.toolId);
    if (!tool) throw new Error(`Unknown base tool ${input.toolId}`);
    return { tier: tool.tier, tool: { skill: tool.skill, gatherBonus: toolBonus(recipes, tool.tier) } };
  }
  if (input.variant === "bossArmor") {
    const set = params.bossArmor.sets.find(row => row.id === input.setId);
    if (!set || !set.slots.includes(input.slot)) throw new Error(`Unknown boss armor piece ${input.setId}/${input.slot}`);
    const row = params.bossArmor.baselines[set.style].find(row => row.slot === input.slot);
    if (!row) throw new Error(`Missing boss armor baseline ${set.style}/${input.slot}`);
    const bonuses: EquipmentBonuses = { ...params.bonusDefaults };
    for (const key of bonusKeys) {
      const low = operand(row.low[key], params.bonusDefaults[key]);
      const high = operand(row.high[key], params.bonusDefaults[key]);
      const base = set.tier === params.bossArmor.baselineTiers[0] ? low
        : set.tier === params.bossArmor.baselineTiers[1] ? high
        : set.tier === params.bossArmor.extrapolatedTier ? high + (high - low)
        : undefined;
      if (base === undefined) throw new Error(`Unknown boss armor tier ${set.tier}`);
      bonuses[key] = Math.round(base * params.bossArmor.premium);
    }
    return { tier: set.tier, value: Math.round(set.tier * params.bossArmor.valuePerTier[input.slot]),
      equip: { slot: input.slot, requires: { [set.style]: set.tier }, bonuses } };
  }
  const profile = params.elemental.profiles.find(row => row.element === input.element);
  if (!profile) throw new Error(`Unknown elemental profile ${input.element}`);
  const metadata = params.elemental.baseWeapons.find(row => row.id === profile.bases[input.weapon]);
  if (!metadata || metadata.magicWeapon.kind !== input.weapon) throw new Error(`Missing elemental ${input.weapon} base for ${input.element}`);
  const base = gear(gearParams, { kind: "gear", variant: "base", baselineId: metadata.id, attackKind: metadata.magicWeapon.kind });
  const bonuses: EquipmentBonuses = { ...params.bonusDefaults };
  for (const key of bonusKeys) {
    if (key === "vitality") continue;
    const value = base.equip.bonuses[key] + operand(profile.addedBonuses[key], params.elemental.additiveDefault);
    // The original chargedWeapon() retained this repeated merged-defence operand.
    bonuses[key] = key === "defence" ? Math.max(value, value) : value;
  }
  return { tier: base.tier, value: base.value,
    equip: { ...base.equip, requires: { ...base.equip.requires }, bonuses },
    magicWeapon: { ...metadata.magicWeapon, charge: { ...profile.charge } } };
}
