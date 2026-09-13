import { gear } from "./gear.js";
import { deriveLegacyBoss, tierMarks } from './enemies.js';
import { EnemyBalanceSchema } from '../schema/enemyBalance.js';
import { EnemyDerivationSchema } from '../schema/enemyDerivation.js';
import { materialFood, type MaterialFoodItem } from "./materialFood.js";
import { MaterialFoodBalanceSchema, MaterialFoodDerivationSchema } from "../schema/materialFoodDerivation.js";
import { lootBalanceSchema } from "../schema/balance.js";
import { itemFormula } from "./itemFormula.js";
import { ItemFormulaBalanceSchema, ItemFormulaDerivationSchema } from "../schema/itemFormula.js";
import { campfireFuel } from "./campfires.js";
import { campfiresBalanceSchema } from "../schema/balance.js";
import { CampfireFuelRecordSchema } from "../schema/campfireFuels.js";
import { gearProgression } from "./gearProgression.js";
import { GearProgressionBalanceSchema, GearProgressionDerivationSchema } from "../schema/gearProgression.js";
import { setThresholds } from "./sets.js";
import { gearBalanceSchema, setsBalanceSchema, recipesBalanceSchema, jewelryBalanceSchema } from "../schema/balance.js";
import { JewelryDerivationSchema, JewelryRecipeDerivationSchema } from "../schema/jewelryDerivation.js";
import { jewelry, jewelryRecipe } from "./jewelry.js";
import { RecipeDerivationSchema } from "../schema/recipeDerivation.js";
import { RecipeRecordSchema } from "../schema/recipes.js";
import { recipeFieldsFromDerivation } from "./recipes.js";
import { GearDerivationSchema } from "../schema/gearDerivation.js";
import { EquipmentSetRecordSchema } from "../schema/equipmentSets.js";
import { parseValue } from "../schema/core.js";

export interface DerivationDiff {
  collection: string;
  recordId: string;
  kind: string;
  inputIds?: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}
export type DerivationCollections = ReadonlyMap<string, unknown>;
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

// Generated equipment owns these fields even when its variant omits them. Undefined is
// an explicit removal in an internal patch; canonical JSON serialization omits the key.
function equipmentFields(fields: Record<string, unknown>): Record<string, unknown> {
  return { equip: undefined, magicWeapon: undefined, tool: undefined, ...fields };
}

/** Calculate locked fields, including explicit undefined removals for absent generated fields. */
export function deriveRecord(collection: string, row: Record<string, unknown>, tables: DerivationCollections): Record<string, unknown> | undefined {
  if (row.derivation === undefined) return undefined;
  const tag = row.derivation as { kind?: unknown } | null;
  if (collection === 'enemies' && (tag?.kind === 'legacyMarks.v1' || tag?.kind === 'legacyBossCombat.v1')) {
    const inputTag = parseValue(EnemyDerivationSchema, tag, `enemies.${String(row.id)}.derivation`);
    const params = parseValue(EnemyBalanceSchema, tables.get('balance/enemies'), 'balance/enemies');
    if (row.catalog !== 'LEGACY_BLOCKS' || row.stage !== 'registered') throw new Error('Legacy formulas require a registered legacy canonical enemy');
    if (inputTag.kind === 'legacyMarks.v1') {
      const input = params.legacyMarksInputs.find(input => input.id === inputTag.inputId);
      if (!input || input.enemyId !== row.id) throw new Error(`Invalid legacy marks input for ${String(row.id)}`);
      return { marks: tierMarks(params.marksPerTier, input.tier, input.profile) };
    }
    const input = params.legacyBossInputs.find(input => input.id === inputTag.inputId);
    if (!input || input.enemyId !== row.id) throw new Error(`Invalid legacy boss input for ${String(row.id)}`);
    return { ...deriveLegacyBoss(params, input) };
  }
  if (tag?.kind === "materialFood" && collection === "items") {
    const input = parseValue(MaterialFoodDerivationSchema, tag, `${collection}.${String(row.id)}.derivation`);
    if (input.itemId !== row.id) throw new Error(`Material/food identity disagrees with ${String(row.id)}`);
    const tier = input.variant === "cookedFood" ? Number(row.tier) : input.tier;
    return { ...(input.variant === "cookedFood" ? {} : { tier }), ...materialFood(parseValue(MaterialFoodBalanceSchema, tables.get("balance/materialFood"), "balance/materialFood"), parseValue(recipesBalanceSchema, tables.get("balance/recipes"), "balance/recipes"), parseValue(lootBalanceSchema, tables.get("balance/loot"), "balance/loot"), { ...input, tier }, tables.get("items") as MaterialFoodItem[]) };
  }
  if (tag?.kind === "itemFormula" && collection === "items") {
    return equipmentFields({ ...itemFormula(parseValue(ItemFormulaBalanceSchema, tables.get("balance/itemFormula"), "balance/itemFormula"), parseValue(recipesBalanceSchema, tables.get("balance/recipes"), "balance/recipes"), parseValue(gearBalanceSchema, tables.get("balance/gear"), "balance/gear"), parseValue(ItemFormulaDerivationSchema, tag, `${collection}.${String(row.id)}.derivation`)) });
  }
  if (tag?.kind === "campfireFuel" && collection === "campfireFuels") {
    const parsed = parseValue(CampfireFuelRecordSchema, row, `${collection}.${String(row.logItemId)}`);
    const fuel = campfireFuel(parseValue(campfiresBalanceSchema, tables.get("balance/campfires"), "balance/campfires"), parseValue(recipesBalanceSchema, tables.get("balance/recipes"), "balance/recipes"), parsed);
    return { buildTimeMs: fuel.buildTimeMs, lifetimeMs: fuel.lifetimeMs, buildXp: fuel.buildXp };
  }
  if (tag?.kind === "gearProgression" && collection === "items") {
    return equipmentFields({ ...gearProgression(parseValue(GearProgressionBalanceSchema, tables.get("balance/gearProgression"), "balance/gearProgression"), parseValue(recipesBalanceSchema, tables.get("balance/recipes"), "balance/recipes"), parseValue(GearProgressionDerivationSchema, tag, `${collection}.${String(row.id)}.derivation`)) });
  }
  if (tag?.kind === "gear" && collection === "items") {
    const input = parseValue(GearDerivationSchema, tag, `${collection}.${String(row.id)}.derivation`);
    return { ...gear(parseValue(gearBalanceSchema, tables.get("balance/gear"), "balance/gear"), input) };
  }
  if (tag?.kind === "jewelry" && collection === "items") {
    return { ...jewelry(parseValue(jewelryBalanceSchema, tables.get("balance/jewelry"), "balance/jewelry"), parseValue(JewelryDerivationSchema, tag, `${collection}.${String(row.id)}.derivation`)) };
  }
  if (tag?.kind === "setThresholds" && collection === "equipmentSets") {
    const parsed = parseValue(EquipmentSetRecordSchema, row, `${collection}.${String(row.id)}`);
    return { thresholds: setThresholds(parseValue(setsBalanceSchema, tables.get("balance/sets"), "balance/sets"), { tier: parsed.tier, bareheaded: !parsed.members.head }) };
  }
  if (tag?.kind === "recipeXp" && collection === "recipes") {
    const parsed = parseValue(RecipeRecordSchema, row, `${collection}.${String(row.id)}`);
    return { ...recipeFieldsFromDerivation(parseValue(recipesBalanceSchema, tables.get("balance/recipes"), "balance/recipes"), parsed, parseValue(RecipeDerivationSchema, tag, `${collection}.${String(row.id)}.derivation`)) };
  }
  if (tag?.kind === "jewelryRecipe" && collection === "recipes") {
    return { ...jewelryRecipe(parseValue(jewelryBalanceSchema, tables.get("balance/jewelry"), "balance/jewelry"), parseValue(recipesBalanceSchema, tables.get("balance/recipes"), "balance/recipes"), parseValue(JewelryRecipeDerivationSchema, tag, `${collection}.${String(row.id)}.derivation`)) };
  }
  throw new Error(`${collection}.${String(row.id)}: unknown derivation kind ${String(tag?.kind)}`);
}

/** Shared by content:check, server previews and the editor's drift indicator. Never mutates rows. */
export function derivationDiffs(tables: DerivationCollections, kind?: string): DerivationDiff[] {
  const result: DerivationDiff[] = [];
  for (const [collection, value] of tables) {
    if (!Array.isArray(value)) continue;
    for (const row of value as Record<string, unknown>[]) {
      const tag = row.derivation as { kind?: string; inputId?: string } | undefined;
      if (!tag || (kind !== undefined && tag.kind !== kind)) continue;
      const after = deriveRecord(collection, row, tables);
      if (!after) continue;
      const before = Object.fromEntries(Object.keys(after).map(key => [key, row[key]]));
      if (!sameValue(before, after)) result.push({ collection, recordId: String(row.id ?? row.logItemId), kind: String(tag.kind),
        ...(typeof tag.inputId === 'string' ? { inputIds: [tag.inputId] } : {}), before, after });
    }
  }
  return result;
}
