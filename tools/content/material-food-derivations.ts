import type { ItemDef } from "../../game/src/contracts.js";
import { materialFood, type DerivedMaterialFood, type MaterialFoodInput, type MaterialFoodItem, type MaterialFoodRole } from "../../game/src/content/balance/materialFood.js";
import type { LootBalance, RecipesBalance } from "../../game/src/content/schema/balance.js";
import {
  MaterialFoodDerivationSchema,
  type MaterialFoodBalance,
  type MaterialFoodDerivation,
} from "../../game/src/content/schema/materialFoodDerivation.js";
import { parseValue } from "../../game/src/content/schema/core.js";
import { collectDifferences, type ParityDifference } from "./parity.js";

/** Structural input avoids a cycle with the item schema that will include this derivation union. */
export interface MaterialFoodDerivableRecord {
  id: string;
  catalog: string;
  tier: number;
  value: number;
  category: string;
  food?: ItemDef["food"];
  derivation?: unknown;
}

export type WithMaterialFoodDerivation<T extends MaterialFoodDerivableRecord> =
  Omit<T, "derivation"> & { derivation?: T["derivation"] | MaterialFoodDerivation };

export interface MaterialFoodTag {
  itemId: string;
  derivation: MaterialFoodDerivation;
}

/** The original creatureLoot.ts material rows, in source order. */
export const CREATURE_MATERIAL_ITEM_IDS = [
  "fox_guardhair", "lynx_sinew", "badger_bristle", "porcupine_quill", "horse_tailhair",
  "bighorn_fleece", "moose_antler_palm", "tapir_leather", "crocodile_scute", "salamander_secretion",
  "tortoise_shell_plate", "monitor_sinew", "goose_down", "heron_quill", "bustard_plume",
  "turkey_tailfeather", "snail_mucus", "beetle_mandible", "centipede_chitin", "spider_thread",
  "ravager_talon", "drake_scale", "mantis_scythe", "nightmare_plate",
] as const;

type CataloguedRecord = MaterialFoodDerivableRecord & MaterialFoodItem;
type Candidate = { itemId: string; derivation: MaterialFoodDerivation };

function inputFor(derivation: MaterialFoodDerivation, tier: number): MaterialFoodInput {
  if (derivation.variant === "cookedFood") return { ...derivation, tier };
  if (derivation.variant === "creatureMaterial") return { ...derivation, tier };
  return { ...derivation, tier };
}

function actualFields(record: MaterialFoodDerivableRecord, derived: DerivedMaterialFood): DerivedMaterialFood {
  const actual: Record<string, unknown> = {};
  for (const key of Object.keys(derived)) actual[key] = record[key as keyof MaterialFoodDerivableRecord];
  return actual as DerivedMaterialFood;
}

function assertExistingTag(record: MaterialFoodDerivableRecord, derivation: MaterialFoodDerivation): void {
  if (record.derivation === undefined) return;
  const differences: ParityDifference[] = [];
  collectDifferences(derivation, record.derivation, `${record.id}.derivation`, differences);
  if (differences.length) throw new Error(`Conflicting material food derivation ${record.id}: ${JSON.stringify(differences)}`);
}

function candidateFor(
  record: MaterialFoodDerivableRecord,
  params: MaterialFoodBalance,
  regionalById: ReadonlyMap<string, MaterialFoodRole>,
): Candidate | undefined {
  const cooked = params.cookedFoods.find(row => row.itemId === record.id);
  if (cooked) {
    if (record.catalog !== cooked.catalog) throw new Error(`Wrong material food catalog for ${record.id}`);
    if (record.category !== "food") throw new Error(`Material food ${record.id} is not a food item`);
    return {
      itemId: record.id,
      derivation: parseValue(MaterialFoodDerivationSchema, {
        kind: "materialFood", variant: "cookedFood", itemId: record.id, rawItemId: cooked.rawItemId,
      }, `${record.id}.derivation`),
    };
  }

  if ((CREATURE_MATERIAL_ITEM_IDS as readonly string[]).includes(record.id)) {
    if (record.catalog !== "CREATURE_LOOT_ITEMS") throw new Error(`Wrong material food catalog for ${record.id}`);
    if (record.category !== "component") throw new Error(`Creature material ${record.id} is not a component`);
    return {
      itemId: record.id,
      derivation: parseValue(MaterialFoodDerivationSchema, {
        kind: "materialFood", variant: "creatureMaterial", itemId: record.id, tier: record.tier,
      }, `${record.id}.derivation`),
    };
  }

  const role = regionalById.get(record.id);
  if (role !== undefined) {
    if (record.catalog !== "REGIONAL_TIER_ITEMS") throw new Error(`Wrong material food catalog for ${record.id}`);
    return {
      itemId: record.id,
      derivation: parseValue(MaterialFoodDerivationSchema, {
        kind: "materialFood", variant: "regionalMaterial", itemId: record.id, tier: record.tier, role,
      }, `${record.id}.derivation`),
    };
  }

  // The creature catalog is exclusively the 24 source material rows. A new component must be
  // mapped deliberately instead of being silently shipped without the material formula tag.
  if (record.catalog === "CREATURE_LOOT_ITEMS" && record.category === "component") {
    throw new Error(`Unmapped creature material ${record.id}`);
  }
  return undefined;
}

/**
 * Propose identity-only material/food tags in the source item order. All locked fields are checked
 * against the pure projection before a proposal is returned; this function never edits a record.
 */
export function buildMaterialFoodTags(
  params: MaterialFoodBalance,
  recipes: RecipesBalance,
  loot: LootBalance,
  records: readonly MaterialFoodDerivableRecord[],
): MaterialFoodTag[] {
  const regionalById = new Map(params.regional.identities.map(row => [row.itemId, row.role] as const));
  const seen = new Set<string>();
  const proposals: MaterialFoodTag[] = [];

  for (const record of records) {
    if (seen.has(record.id)) throw new Error(`Duplicate item record ${record.id}`);
    seen.add(record.id);
    const candidate = candidateFor(record, params, regionalById);
    if (!candidate) continue;
    assertExistingTag(record, candidate.derivation);
    const derived = materialFood(params, recipes, loot, inputFor(candidate.derivation, record.tier), records);
    const differences: ParityDifference[] = [];
    collectDifferences(derived, actualFields(record, derived), record.id, differences);
    if (differences.length) throw new Error(`Cannot tag drifted material food ${record.id}: ${JSON.stringify(differences)}`);
    proposals.push(candidate);
  }

  for (const row of params.cookedFoods) if (!proposals.some(tag => tag.itemId === row.itemId)) {
    throw new Error(`Missing material food target ${row.itemId}`);
  }
  for (const row of params.regional.identities) if (!proposals.some(tag => tag.itemId === row.itemId)) {
    throw new Error(`Missing material food target ${row.itemId}`);
  }
  for (const itemId of CREATURE_MATERIAL_ITEM_IDS) if (!proposals.some(tag => tag.itemId === itemId)) {
    throw new Error(`Missing material food target ${itemId}`);
  }
  return proposals;
}

/** Attach validated tags while preserving every unrelated record and field byte-for-byte. */
export function attachMaterialFoodDerivations<T extends MaterialFoodDerivableRecord>(
  records: readonly T[],
  params: MaterialFoodBalance,
  recipes: RecipesBalance,
  loot: LootBalance,
): WithMaterialFoodDerivation<T>[] {
  const proposals = buildMaterialFoodTags(params, recipes, loot, records);
  const byId = new Map(proposals.map(proposal => [proposal.itemId, proposal.derivation]));
  return records.map(record => {
    const derivation = byId.get(record.id);
    return derivation === undefined ? record : { ...record, derivation } as WithMaterialFoodDerivation<T>;
  });
}

/** Convenience name for callers that treat the migration as a record builder. */
export const buildMaterialFoodRecords = attachMaterialFoodDerivations;

export { MaterialFoodDerivationSchema };
