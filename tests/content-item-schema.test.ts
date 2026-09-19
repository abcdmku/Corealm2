import { describe, expect, it } from "vitest";
import type { ItemDef } from "../game/src/contracts.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { ObjectSchema, parseCollection, parseValue, validateCollection, type Infer } from "../game/src/content/schema/core.js";
import { ElementalWeaponChargeSchema, ItemSchema } from "../game/src/content/schema/items.js";

function item(id: string): ItemDef {
  const found = ALL_ITEMS.find((row) => row.id === id);
  if (!found) throw new Error(`Missing fixture item ${id}`);
  return found;
}

describe("item runtime schema", () => {
  it("parses every current runtime item and its JSON representation without changing values or order", () => {
    expect(ALL_ITEMS).toHaveLength(409);
    const parsed: ItemDef[] = parseCollection(ItemSchema, ALL_ITEMS, { name: "items" });
    expect(parsed).toEqual(ALL_ITEMS);
    expect(parseCollection(ItemSchema, JSON.parse(JSON.stringify(ALL_ITEMS)), { name: "items" })).toEqual(ALL_ITEMS);
    // Keep the schema's inferred optional fields compatible in both directions with the contract.
    const typed: Infer<typeof ItemSchema> = item("marks");
    expect(parseValue(ItemSchema, typed, "item")).toEqual(typed);
  });

  it("retains valid absent effects, tier-zero gear, zero prices, and signed equipment bonuses", () => {
    expect(parseValue(ItemSchema, item("burnt_crown_trout"), "item").food).toBeUndefined();
    expect(parseValue(ItemSchema, item("worn_pickaxe"), "item").tier).toBe(0);
    const base = item("worn_sword");
    const edited = { ...base, value: 0, equip: { ...base.equip!, bonuses: { ...base.equip!.bonuses, meleeAccuracy: -2 } } };
    expect(parseValue(ItemSchema, edited, "item")).toEqual(edited);
  });

  it.each([
    ["equipment bonus typo", { ...item("worn_sword"), equip: { ...item("worn_sword").equip, bonuses: { ...item("worn_sword").equip!.bonuses, armor: 5 } } }, ".equip.bonuses.armor"],
    ["missing bonus", { ...item("worn_sword"), equip: { ...item("worn_sword").equip, bonuses: { meleeAccuracy: 1 } } }, ".equip.bonuses.magicAccuracy"],
    ["invalid slot", { ...item("worn_sword"), equip: { ...item("worn_sword").equip, slot: "leftHand" } }, ".equip.slot"],
    ["invalid requirement skill", { ...item("worn_sword"), equip: { ...item("worn_sword").equip, requires: { alchemy: 1 } } }, ".equip.requires.alchemy"],
    ["fractional requirement", { ...item("worn_sword"), equip: { ...item("worn_sword").equip, requires: { melee: 1.5 } } }, ".equip.requires.melee"],
    ["zero attack interval", { ...item("worn_sword"), equip: { ...item("worn_sword").equip, attackSpeedMs: 0 } }, ".equip.attackSpeedMs"],
    ["invalid weapon hands", { ...item("air_wand"), magicWeapon: { ...item("air_wand").magicWeapon, hands: 3 } }, ".magicWeapon.hands"],
    ["invalid charge item reference", { ...item("air_wand"), magicWeapon: { ...item("air_wand").magicWeapon, charge: { ...item("air_wand").magicWeapon!.charge, rechargeItemId: "" } } }, ".magicWeapon.charge.rechargeItemId"],
    ["invalid charge element", { ...item("air_wand"), magicWeapon: { ...item("air_wand").magicWeapon, charge: { ...item("air_wand").magicWeapon!.charge, element: "ice" } } }, ".magicWeapon.charge.element"],
    ["invalid orb flag", { ...item("air_orb"), orb: { ...item("air_orb").orb, released: "yes" } }, ".orb.released"],
    ["invalid food effect", { ...item("roast_game"), food: { healAmount: -1 } }, ".food.healAmount"],
    ["invalid tool skill", { ...item("worn_pickaxe"), tool: { skill: "digging", gatherBonus: 1 } }, ".tool.skill"],
    ["nonfinite tool bonus", { ...item("worn_pickaxe"), tool: { skill: "mining", gatherBonus: Number.NaN } }, ".tool.gatherBonus"],
  ])("rejects %s at the nested field", (_name, row, suffix) => {
    const { issues } = validateCollection(ItemSchema, [row], { name: "items" });
    expect(issues.some((issue) => issue.severity === "error" && issue.path.endsWith(suffix))).toBe(true);
  });

  it("rejects overfilled and fractional charge counts", () => {
    const charge = item("air_wand").magicWeapon!.charge!;
    expect(() => parseValue(ElementalWeaponChargeSchema, { ...charge, initialCharges: charge.capacity + 1 }, "charge"))
      .toThrow("initialCharges must not exceed capacity");
    expect(() => parseValue(ElementalWeaponChargeSchema, { ...charge, initialCharges: 0.5 }, "charge"))
      .toThrow("initialCharges");
  });

  it("rejects duplicate ids and uncontracted collection extras", () => {
    expect(() => parseCollection(ItemSchema, [item("marks"), item("marks")], { name: "items" })).toThrow("duplicate id");
    expect(() => parseValue(ItemSchema, { ...item("marks"), derivation: { kind: "gear" } }, "item")).toThrow("unknown field");
  });

  it("exposes identity and foreign-key metadata for forms", () => {
    expect(ItemSchema.fields.id.meta).toMatchObject({ readOnly: true, identity: true });
    const charge = ElementalWeaponChargeSchema.inner;
    if (!(charge instanceof ObjectSchema)) throw new Error("Charge fields must remain inspectable by the editor");
    expect(charge.fields.rechargeItemId.meta.ref).toBe("item");
    expect(charge.fields.orbItemId.meta.ref).toBe("item");
  });
});
