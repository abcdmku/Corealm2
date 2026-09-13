import type { ItemDef } from "../../game/src/contracts.js";
import { itemFormula, type DerivedItemFormula } from "../../game/src/content/balance/itemFormula.js";
import type { GearBalance, RecipesBalance } from "../../game/src/content/schema/balance.js";
import { ItemFormulaDerivationSchema, type ItemFormulaBalance, type ItemFormulaDerivation } from "../../game/src/content/schema/itemFormula.js";
import { parseValue } from "../../game/src/content/schema/core.js";
import { collectDifferences, type ParityDifference } from "./parity.js";

export interface ItemFormulaTag { itemId: string; derivation: ItemFormulaDerivation }
const suffixes = {
  melee: { head: "helm", body: "plate", legs: "greaves", hands: "gauntlets", feet: "boots" },
  magic: { head: "hood", body: "robe", legs: "leggings", hands: "wraps", feet: "boots" },
} as const;

/** Include unexpected equipment/tool fields so a tag cannot conceal an incompatible row shape. */
export function itemFormulaFields(item: ItemDef, input: ItemFormulaDerivation): DerivedItemFormula {
  return { tier: item.tier, ...(input.variant === "baseTool" ? {} : { value: item.value }),
    ...(item.equip === undefined ? {} : { equip: item.equip }),
    ...(item.magicWeapon === undefined ? {} : { magicWeapon: item.magicWeapon }),
    ...(item.tool === undefined ? {} : { tool: item.tool }) };
}

/** Propose original-source locks in item order. No record or parameter is mutated. */
export function buildItemFormulaTags(params: ItemFormulaBalance, recipes: RecipesBalance, gearParams: GearBalance,
  items: readonly (ItemDef & { catalog: string })[]): ItemFormulaTag[] {
  const candidates = new Map<string, { catalog: string; derivation: ItemFormulaDerivation }>();
  const add = (id: string, catalog: string, derivation: ItemFormulaDerivation): void => {
    if (candidates.has(id)) throw new Error(`Duplicate item formula target ${id}`);
    candidates.set(id, { catalog, derivation: parseValue(ItemFormulaDerivationSchema, derivation, id) });
  };
  for (const set of params.bossArmor.sets) for (const slot of set.slots) {
    add(`${set.id}_${suffixes[set.style][slot]}`, "BOSS_ARMOR_ITEMS", { kind: "itemFormula", variant: "bossArmor", setId: set.id, slot });
  }
  for (const profile of params.elemental.profiles) for (const weapon of ["wand", "staff"] as const) {
    add(profile.outputs[weapon], "ELEMENTAL_MAGIC_WEAPONS", { kind: "itemFormula", variant: "elemental", element: profile.element, weapon });
  }
  for (const tool of params.baseTools) add(tool.id, "ITEMS", { kind: "itemFormula", variant: "baseTool", toolId: tool.id });
  const seen = new Set<string>();
  const output: ItemFormulaTag[] = [];
  for (const item of items) {
    const candidate = candidates.get(item.id);
    if (!candidate) {
      if (item.catalog === "BOSS_ARMOR_ITEMS" || item.catalog === "ELEMENTAL_MAGIC_WEAPONS"
        || (item.catalog === "ITEMS" && item.tool && item.tier > 0)) throw new Error(`Unmapped item formula target ${item.id}`);
      continue;
    }
    if (seen.has(item.id)) throw new Error(`Duplicate item record ${item.id}`);
    seen.add(item.id);
    if (item.catalog !== candidate.catalog) throw new Error(`Wrong item formula catalog for ${item.id}`);
    const differences: ParityDifference[] = [];
    collectDifferences(itemFormulaFields(item, candidate.derivation), itemFormula(params, recipes, gearParams, candidate.derivation), item.id, differences);
    if (differences.length) throw new Error(`Cannot tag drifted item formula ${item.id}: ${JSON.stringify(differences)}`);
    output.push({ itemId: item.id, derivation: candidate.derivation });
  }
  for (const id of candidates.keys()) if (!seen.has(id)) throw new Error(`Missing item formula target ${id}`);
  return output;
}
