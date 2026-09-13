import type { EquipmentBonuses, ItemDef } from "../../contracts.js";
import type { RecipesBalance } from "../schema/balance.js";
import type { GearProgressionBalance, GearProgressionDerivation } from "../schema/gearProgression.js";
import { toolBonus } from "./recipes.js";

export type DerivedGearProgression = Pick<ItemDef, "tier" | "value" | "equip" | "magicWeapon" | "tool">;
const bonusKeys = ["meleeAccuracy", "meleePower", "defence", "magicAccuracy", "magicPower", "health", "vitality"] as const;

/** Original two-segment interpolation: calculate each field independently and round once. */
export function interpolateGearProgression(tier: number, checkpoints: readonly [number, number, number], values: readonly [number, number, number]): number {
  const [lowTier, highTier, deepTier] = checkpoints;
  const [low, high, deep] = values;
  return Math.round(tier <= highTier
    ? low + (high - low) * (tier - lowTier) / (highTier - lowTier)
    : high + (deep - high) * (tier - highTier) / (deepTier - highTier));
}

/** Pure projection; loading parameter edits never rewrites item records. */
export function gearProgression(params: GearProgressionBalance, recipes: RecipesBalance, input: GearProgressionDerivation): DerivedGearProgression {
  const tier = input.ladderTier;
  const bonuses: EquipmentBonuses = { ...params.bonusDefaults };
  let row: { slot: NonNullable<ItemDef["equip"]>["slot"]; skill: "melee" | "magic"; weapon?: "sword" | "wand" | "staff" };
  let value: number;
  if (input.catalog === "REGIONAL_TIER_ITEMS") {
    const interpolate = (values: readonly [number, number, number]) => interpolateGearProgression(tier, params.regional.checkpointTiers, values);
    const tool = params.regional.tools.find(candidate => candidate.role === input.role);
    if (tool) return { tier, value: interpolate(tool.values), tool: { skill: tool.skill, gatherBonus: toolBonus(recipes, tier) } };
    const gear = params.regional.gear.find(candidate => candidate.role === input.role);
    if (!gear) throw new Error(`Unknown regional gear role ${input.role}`);
    row = gear;
    value = interpolate(gear.values);
    for (const key of bonusKeys) bonuses[key] = interpolate([
      gear.stats[0][key] ?? params.bonusDefaults[key],
      gear.stats[1][key] ?? params.bonusDefaults[key],
      gear.stats[2][key] ?? params.bonusDefaults[key],
    ]);
  } else {
    const special = params.wilderness.specialGear.find(candidate => candidate.role === input.role);
    if (special) {
      if (special.tier !== tier) throw new Error(`Wrong tier ${tier} for special gear ${special.role}`);
      row = special;
      value = special.value;
      for (const key of bonusKeys) {
        const stat = special.stats[key];
        if (stat) bonuses[key] = "value" in stat ? stat.value : Math.max(...stat.max);
      }
    } else {
      const index = params.wilderness.tiers.indexOf(tier);
      if (index < 0) throw new Error(`Unknown Wilderness gear tier ${tier}`);
      const pair = (values: readonly [number, number]) => values[index]!;
      const tool = params.wilderness.tools.find(candidate => candidate.role === input.role);
      if (tool) return { tier, value: pair(tool.values), tool: { skill: tool.skill, gatherBonus: toolBonus(recipes, tier) } };
      const gear = params.wilderness.gear.find(candidate => candidate.role === input.role);
      if (!gear) throw new Error(`Unknown Wilderness gear role ${input.role}`);
      row = gear;
      value = pair(gear.values);
      for (const key of bonusKeys) {
        const stat = gear.stats[key];
        if (stat) bonuses[key] = "pair" in stat ? pair(stat.pair) : Math.max(...stat.maxPairs.map(pair));
      }
    }
    // Original wilderness bonuses() always writes vitality after the partial bonuses.
    bonuses.vitality = params.bonusDefaults.vitality;
  }
  const equip: NonNullable<ItemDef["equip"]> = { slot: row.slot, requires: { [row.skill]: tier }, bonuses };
  if (row.weapon) equip.attackSpeedMs = params.weaponProfiles[row.weapon].attackSpeedMs;
  return { tier, value, equip,
    ...(row.weapon === "wand" || row.weapon === "staff"
      ? { magicWeapon: { kind: row.weapon, hands: params.weaponProfiles[row.weapon].hands } } : {}) };
}
