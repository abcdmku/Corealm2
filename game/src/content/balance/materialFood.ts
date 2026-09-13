import type { ItemDef } from "../../contracts.js";
import type { LootBalance, RecipesBalance } from "../schema/balance.js";
import type { MaterialFoodBalance, MaterialFoodDerivation } from "../schema/materialFoodDerivation.js";
import { healAmount } from "./recipes.js";

export type MaterialFoodRole = "ore" | "bar" | "hide" | "thread" | "handle";

/** A derivation tag plus the row tier supplied by the item table. */
export type MaterialFoodInput =
  | ({ kind: "materialFood"; variant: "cookedFood"; itemId: string; rawItemId: string; tier: number })
  | ({ kind: "materialFood"; variant: "creatureMaterial"; itemId: string; tier: number })
  | ({ kind: "materialFood"; variant: "regionalMaterial"; itemId: string; tier: number; role: MaterialFoodRole });

/** Only fields calculated by the formula are returned; authored presentation fields stay in JSON. */
export type DerivedMaterialFood = Partial<Pick<ItemDef, "value" | "food">>;

/** Item rows passed by the registry/exporter. The catalog is absent from runtime ItemDef rows. */
export type MaterialFoodItem = Pick<ItemDef, "id" | "tier" | "value" | "food"> & { catalog?: string };

/** Original regional-tier interpolation, with one final rounding operation. */
export function interpolateMaterialValue(
  tier: number,
  checkpoints: readonly [number, number, number],
  values: readonly [number, number, number],
): number {
  const [lowTier, highTier, deepTier] = checkpoints;
  const [low, high, deep] = values;
  return Math.round(tier <= highTier
    ? low + (high - low) * (tier - lowTier) / (highTier - lowTier)
    : high + (deep - high) * (tier - highTier) / (deepTier - highTier));
}

function findItem(items: readonly MaterialFoodItem[], itemId: string, purpose: string): MaterialFoodItem {
  const matches = items.filter(item => item.id === itemId);
  if (matches.length !== 1) throw new Error(`Expected one ${purpose} item ${itemId}, found ${matches.length}`);
  return matches[0]!;
}

function materialValue(loot: LootBalance, tier: number): number {
  const matches = loot.materialValues.filter(row => row.tier === tier);
  if (matches.length !== 1) throw new Error(`Expected one creature material value for tier ${tier}, found ${matches.length}`);
  return matches[0]!.value;
}

/** Projects locked fields from explicit shared parameters and current item records. */
export function materialFood(
  params: MaterialFoodBalance,
  recipes: RecipesBalance,
  loot: LootBalance,
  input: MaterialFoodInput,
  items: readonly MaterialFoodItem[],
): DerivedMaterialFood {
  const target = findItem(items, input.itemId, "target");
  if (target.tier !== input.tier) throw new Error(`Material food tier mismatch for ${input.itemId}: expected ${input.tier}, got ${target.tier}`);

  if (input.variant === "cookedFood") {
    const row = params.cookedFoods.find(candidate => candidate.itemId === input.itemId);
    if (!row) throw new Error(`Unknown cooked food ${input.itemId}`);
    if (row.rawItemId !== input.rawItemId) throw new Error(`Cooked food raw identity mismatch for ${input.itemId}`);
    if (target.catalog !== undefined && target.catalog !== row.catalog) {
      throw new Error(`Cooked food catalog mismatch for ${input.itemId}: expected ${row.catalog}, got ${target.catalog}`);
    }
    const raw = findItem(items, input.rawItemId, "raw");
    if (raw.tier !== target.tier) throw new Error(`Cooked food raw tier mismatch for ${input.itemId}`);
    const fields: DerivedMaterialFood = { food: { healAmount: healAmount(recipes, input.tier) } };
    // Base cooked prices are authored literals. Only the Crownward generator applies this value
    // formula, preserving the source's Math.round(raw.value * 1.4) operation exactly.
    if (row.catalog === "CROWNWARD_FISH_ITEMS") {
      return { value: Math.round(raw.value * params.cookedValueMultiplier), ...fields };
    }
    return fields;
  }

  if (input.variant === "creatureMaterial") {
    if (target.catalog !== undefined && target.catalog !== "CREATURE_LOOT_ITEMS") {
      throw new Error(`Creature material catalog mismatch for ${input.itemId}`);
    }
    if (!loot) throw new Error(`LootBalance is required for creature material ${input.itemId}`);
    return { value: materialValue(loot, input.tier) };
  }

  const identity = params.regional.identities.find(candidate => candidate.itemId === input.itemId);
  if (!identity) throw new Error(`Unknown regional material ${input.itemId}`);
  if (identity.role !== input.role) throw new Error(`Regional material role mismatch for ${input.itemId}`);
  if (target.catalog !== undefined && target.catalog !== "REGIONAL_TIER_ITEMS") {
    throw new Error(`Regional material catalog mismatch for ${input.itemId}`);
  }
  const profile = params.regional.values.find(candidate => candidate.role === input.role);
  if (!profile) throw new Error(`Unknown regional material role ${input.role}`);
  return { value: interpolateMaterialValue(input.tier, params.regional.checkpointTiers, profile.values) };
}

/** Descriptive alias for registries that name the operation by its derivation role. */
export const deriveMaterialFood = materialFood;
