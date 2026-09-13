import { describe, expect, it } from "vitest";
import rawParams from "../game/content/data/balance/itemFormula.json";
import rawGear from "../game/content/data/balance/gear.json";
import rawRecipes from "../game/content/data/balance/recipes.json";
import { ITEM_RECORDS } from "../game/src/content/itemData.js";
import { ItemFormulaBalanceSchema, ItemFormulaDerivationSchema, type ItemFormulaDerivation } from "../game/src/content/schema/itemFormula.js";
import { gearBalanceSchema, recipesBalanceSchema } from "../game/src/content/schema/balance.js";
import { parseValue } from "../game/src/content/schema/core.js";
import { itemFormula } from "../game/src/content/balance/itemFormula.js";
import { gear } from "../game/src/content/balance/gear.js";
import { buildItemFormulaTags, itemFormulaFields } from "../tools/content/item-formula-derivations.js";

const params = parseValue(ItemFormulaBalanceSchema, rawParams, "itemFormula");
const recipes = parseValue(recipesBalanceSchema, rawRecipes, "recipes");
const gearParams = parseValue(gearBalanceSchema, rawGear, "gear");
const proposals = buildItemFormulaTags(params, recipes, gearParams, ITEM_RECORDS);
const tag = (id: string): ItemFormulaDerivation => proposals.find(row => row.itemId === id)!.derivation;

describe("boss armor, elemental weapon and base tool formulas", () => {
  it("recomputes all 48 source-backed targets without modifying records or parameters", () => {
    const before = structuredClone({ params, recipes, gearParams, items: ITEM_RECORDS });
    expect(proposals).toHaveLength(48);
    expect(proposals.filter(row => row.derivation.variant === "bossArmor")).toHaveLength(28);
    expect(proposals.filter(row => row.derivation.variant === "elemental")).toHaveLength(8);
    expect(proposals.filter(row => row.derivation.variant === "baseTool")).toHaveLength(12);
    for (const { itemId, derivation } of proposals) {
      const item = ITEM_RECORDS.find(row => row.id === itemId)!;
      expect(itemFormula(params, recipes, gearParams, derivation), itemId).toEqual(itemFormulaFields(item, derivation));
    }
    expect({ params, recipes, gearParams, items: ITEM_RECORDS }).toEqual(before);
  });

  it("keeps both boss baseline operands and applies the rare premium after T90 extrapolation", () => {
    const edited = structuredClone(params);
    const body = edited.bossArmor.baselines.melee.find(row => row.slot === "body")!;
    expect(body.low.defence).toEqual({ max: [60, 16] });
    expect(body.high.defence).toEqual({ max: [79, 22] });
    expect(itemFormula(params, recipes, gearParams, tag("frostguard_plate")).equip!.bonuses.defence).toBe(108);
    if (!body.low.defence || !("max" in body.low.defence)) throw new Error("Missing original operands");
    body.low.defence.max = [60, 90];
    expect(itemFormula(edited, recipes, gearParams, tag("duskguard_plate")).equip!.bonuses.defence).toBe(99);
    expect(itemFormula(edited, recipes, gearParams, tag("frostguard_plate")).equip!.bonuses.defence).toBe(75);
    edited.bossArmor.valuePerTier.body = 250;
    expect(itemFormula(edited, recipes, gearParams, tag("frostguard_plate")).value).toBe(22500);
    expect(() => itemFormula(params, recipes, gearParams, { kind: "itemFormula", variant: "bossArmor", setId: "duskguard", slot: "head" })).toThrow("Unknown boss armor piece");
  });

  it("reads elemental boosts and charge profiles from original source parameters", () => {
    const edited = structuredClone(params);
    const earth = edited.elemental.profiles.find(row => row.element === "earth")!;
    expect(earth.addedBonuses.defence).toEqual({ max: [1, 3] });
    if (!earth.addedBonuses.defence || !("max" in earth.addedBonuses.defence)) throw new Error("Missing original operands");
    earth.addedBonuses.defence.max = [20, 3];
    earth.charge.capacity = 1500;
    earth.charge.rechargeCost = 120;
    const metadata = edited.elemental.baseWeapons.find(row => row.id === earth.bases.wand)!;
    metadata.magicWeapon.hands = 2;
    const editedGear = structuredClone(gearParams);
    const base = editedGear.baselines.find(row => row.id === metadata.id)!;
    base.value = 12345;
    base.bonuses.defence = 15;
    editedGear.attackSpeedMs.wand = 2750;
    const derived = itemFormula(edited, recipes, editedGear, tag("earth_wand"));
    const plain = gear(editedGear, { kind: "gear", variant: "base", baselineId: metadata.id, attackKind: "wand" });
    expect(derived.value).toBe(plain.value);
    expect(derived.equip!.attackSpeedMs).toBe(plain.equip.attackSpeedMs);
    expect(derived.equip!.bonuses.defence).toBe(plain.equip.bonuses.defence + 20);
    for (const baseMetadata of params.elemental.baseWeapons) expect(Object.keys(baseMetadata).sort()).toEqual(["id", "magicWeapon"]);
    expect(derived.equip!.bonuses.defence).toBe(base.bonuses.defence + 20);
    expect(derived.value).toBe(12345);
    expect(derived.equip!.attackSpeedMs).toBe(2750);
    expect(derived.magicWeapon).toEqual({ kind: "wand", hands: 2, charge: earth.charge });
    expect(derived.magicWeapon!.charge).not.toBe(earth.charge);
    expect(derived.equip!.requires).not.toBe(base.requires);
  });

  it("uses toolBonus parameters while retaining authored prices and worn-tool exceptions", () => {
    const edited = structuredClone(recipes);
    edited.toolBonus.maximum = 99;
    edited.toolBonus.base = 3;
    edited.toolBonus.perTier = 2;
    expect(itemFormula(params, edited, gearParams, tag("emberite_hatchet"))).toEqual({ tier: 20, tool: { skill: "woodcutting", gatherBonus: 43 } });
    expect(itemFormula(params, recipes, gearParams, tag("grithe_pickaxe"))).not.toHaveProperty("value");
    expect(proposals.some(row => row.itemId.startsWith("worn_"))).toBe(false);
    expect(() => itemFormula(params, recipes, gearParams, { kind: "itemFormula", variant: "baseTool", toolId: "worn_pickaxe" })).toThrow("Unknown base tool");
  });

  it("refuses drift, broken identity, missing targets and unexpected runtime fields", () => {
    const drifted = ITEM_RECORDS.map(row => row.id === "air_wand" ? { ...row, tool: { skill: "mining" as const, gatherBonus: 1 } } : row);
    expect(() => buildItemFormulaTags(params, recipes, gearParams, drifted)).toThrow("Cannot tag drifted item formula");
    expect(() => buildItemFormulaTags(params, recipes, gearParams, ITEM_RECORDS.filter(row => row.id !== "air_wand"))).toThrow("Missing item formula target");
    expect(() => buildItemFormulaTags(params, recipes, gearParams, ITEM_RECORDS.map(row => row.id === "air_wand" ? { ...row, catalog: "EQUIPMENT" } : row))).toThrow("Wrong item formula catalog");
    expect(() => buildItemFormulaTags(params, recipes, gearParams, [...ITEM_RECORDS, ITEM_RECORDS.find(row => row.id === "air_wand")!])).toThrow("Duplicate item record");
  });

  it("rejects invalid tag fields, duplicate profiles, incompatible base references and malformed numbers", () => {
    expect(() => parseValue(ItemFormulaDerivationSchema, { ...tag("air_wand"), bonuses: {} }, "tag")).toThrow();
    expect(() => parseValue(ItemFormulaDerivationSchema, { ...tag("duskguard_plate"), slot: "offHand" }, "tag")).toThrow();
    const badReference = structuredClone(params);
    badReference.elemental.profiles[0]!.bases.wand = "missing_weapon";
    expect(() => parseValue(ItemFormulaBalanceSchema, badReference, "params")).toThrow("references must match");
    const duplicate = structuredClone(params);
    duplicate.baseTools[1] = duplicate.baseTools[0]!;
    expect(() => parseValue(ItemFormulaBalanceSchema, duplicate, "params")).toThrow("unique");
    const badCharge = structuredClone(params);
    badCharge.elemental.profiles[0]!.charge.capacity = 0;
    expect(() => parseValue(ItemFormulaBalanceSchema, badCharge, "params")).toThrow();
    expect(() => parseValue(ItemFormulaBalanceSchema, { ...params, elemental: { ...params.elemental,
      baseWeapons: params.elemental.baseWeapons.map(base => ({ ...base, value: 100 })),
    } }, "params")).toThrow();
  });
});
