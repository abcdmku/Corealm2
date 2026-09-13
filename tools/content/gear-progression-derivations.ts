import type { ItemDef } from "../../game/src/contracts.js";
import { gearProgression, type DerivedGearProgression } from "../../game/src/content/balance/gearProgression.js";
import type { RecipesBalance } from "../../game/src/content/schema/balance.js";
import type { CraftingTierRecord } from "../../game/src/content/schema/craftingTiers.js";
import { GearProgressionDerivationSchema, type GearProgressionBalance, type GearProgressionDerivation } from "../../game/src/content/schema/gearProgression.js";
import { parseValue } from "../../game/src/content/schema/core.js";
import { collectDifferences, type ParityDifference } from "./parity.js";

export interface GearProgressionTag { itemId: string; derivation: GearProgressionDerivation }

/** Match the exact presence of equipment, tool and magic fields, not merely their nested numbers. */
export function gearProgressionFields(item: ItemDef): DerivedGearProgression {
  return { tier: item.tier, value: item.value,
    ...(item.equip === undefined ? {} : { equip: item.equip }),
    ...(item.tool === undefined ? {} : { tool: item.tool }),
    ...(item.magicWeapon === undefined ? {} : { magicWeapon: item.magicWeapon }) };
}

/** Build tag proposals from original role identities and explicit crafting rows. Never rewrite items. */
export function buildGearProgressionTags(params: GearProgressionBalance, recipes: RecipesBalance,
  craftingTiers: readonly CraftingTierRecord[], items: readonly (ItemDef & { catalog: string })[]): GearProgressionTag[] {
  const candidates = new Map<string, GearProgressionDerivation>();
  const add = (itemId: string, input: GearProgressionDerivation): void => {
    if (candidates.has(itemId)) throw new Error(`Duplicate progression item ${itemId}`);
    candidates.set(itemId, parseValue(GearProgressionDerivationSchema, input, itemId));
  };
  for (const tier of craftingTiers) {
    if (tier.catalog === "REGIONAL_CRAFTING_TIERS") {
      for (const role of params.regional.gear) add(`${tier[role.family]}_${role.suffix}`,
        { kind: "gearProgression", catalog: "REGIONAL_TIER_ITEMS", ladderTier: tier.tier, role: role.role });
      for (const role of params.regional.tools) add(`${tier[role.family]}_${role.role}`,
        { kind: "gearProgression", catalog: "REGIONAL_TIER_ITEMS", ladderTier: tier.tier, role: role.role });
    } else {
      for (const role of params.wilderness.gear) add(`${tier[role.family]}_${role.suffix}`,
        { kind: "gearProgression", catalog: "WILDERNESS_LOOT_ITEMS", ladderTier: tier.tier, role: role.role });
      for (const role of params.wilderness.tools) add(`${tier[role.family]}_${role.role}`,
        { kind: "gearProgression", catalog: "WILDERNESS_LOOT_ITEMS", ladderTier: tier.tier, role: role.role });
    }
  }
  for (const special of params.wilderness.specialGear) {
    const input = parseValue(GearProgressionDerivationSchema, { kind: "gearProgression", catalog: "WILDERNESS_LOOT_ITEMS",
      ladderTier: special.tier, role: special.role }, special.role);
    add(special.role, input);
  }
  const seen = new Set<string>();
  const proposals: GearProgressionTag[] = [];
  for (const item of items) {
    const derivation = candidates.get(item.id);
    const targetCatalog = item.catalog === "REGIONAL_TIER_ITEMS" || item.catalog === "WILDERNESS_LOOT_ITEMS";
    if (!derivation) {
      if (targetCatalog && (item.equip || item.tool)) throw new Error(`Unmapped progression gear ${item.id}`);
      continue;
    }
    if (seen.has(item.id)) throw new Error(`Duplicate item record ${item.id}`);
    seen.add(item.id);
    if (item.catalog !== derivation.catalog) throw new Error(`Wrong progression catalog for ${item.id}`);
    const actual = gearProgression(params, recipes, derivation);
    const differences: ParityDifference[] = [];
    collectDifferences(gearProgressionFields(item), actual, item.id, differences);
    if (differences.length) throw new Error(`Cannot tag drifted progression gear ${item.id}: ${JSON.stringify(differences)}`);
    proposals.push({ itemId: item.id, derivation });
  }
  for (const id of candidates.keys()) if (!seen.has(id)) throw new Error(`Missing progression item ${id}`);
  return proposals;
}
