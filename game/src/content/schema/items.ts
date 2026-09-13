/** Runtime item fields. Collection membership and derivations extend this schema separately. */
import { EQUIP_SLOTS, SKILL_IDS, SPELL_ELEMENTS } from "../../contracts.js";
import type { ItemCategory, ItemDef } from "../../contracts.js";
import { bool, enumOf, id, int, lit, num, obj, opt, ref, refine, str, union, type Schema } from "./core.js";

const skill = enumOf(SKILL_IDS, { label: "Skill", ref: "skill" });
const element = enumOf(SPELL_ELEMENTS, { label: "Element", ref: "element" });
const requiredLevel = int({ min: 1 }, { label: "Required level", step: 1 });

/** Explicit optional keys preserve Partial<Record<SkillId, number>> in the inferred type. */
export const ItemSkillRequirementsSchema = obj({
  melee: opt(requiredLevel, { label: "Melee" }),
  magic: opt(requiredLevel, { label: "Magic" }),
  mining: opt(requiredLevel, { label: "Mining" }),
  woodcutting: opt(requiredLevel, { label: "Woodcutting" }),
  fishing: opt(requiredLevel, { label: "Fishing" }),
  smithing: opt(requiredLevel, { label: "Smithing" }),
  crafting: opt(requiredLevel, { label: "Crafting" }),
  cooking: opt(requiredLevel, { label: "Cooking" }),
  fletching: opt(requiredLevel, { label: "Fletching" }),
  agility: opt(requiredLevel, { label: "Agility" }),
}, {}, { label: "Skill requirements" });

/** All seven keys are required; negative bonuses can express an authored equipment penalty. */
export const EquipmentBonusesSchema = obj({
  meleeAccuracy: num({}, { label: "Melee accuracy" }),
  magicAccuracy: num({}, { label: "Magic accuracy" }),
  defence: num({}, { label: "Defence" }),
  health: num({}, { label: "Health" }),
  meleePower: num({}, { label: "Melee power" }),
  magicPower: num({}, { label: "Magic power" }),
  vitality: num({}, { label: "Vitality" }),
});

export const ElementalWeaponChargeSchema = refine(obj({
  element,
  capacity: int({ min: 1 }, { label: "Charge capacity", step: 1 }),
  initialCharges: int({ min: 0 }, { label: "Initial charges", step: 1 }),
  rechargeItemId: ref("item", { label: "Recharge item" }),
  rechargeCost: int({ min: 1 }, { label: "Items per recharge", step: 1 }),
  orbItemId: ref("item", { label: "Altar orb" }),
  released: bool({ label: "Released" }),
}), (charge) => charge.initialCharges <= charge.capacity, "initialCharges must not exceed capacity");

export const MagicWeaponSchema = obj({
  kind: enumOf(["wand", "staff"] as const, { label: "Weapon kind" }),
  hands: union([lit(1), lit(2)] as const, { label: "Hands required" }),
  charge: opt(ElementalWeaponChargeSchema, { label: "Elemental charge" }),
});

export const ItemSchema = obj({
  id: id(),
  name: str({ nonEmpty: true }, { label: "Name" }),
  tier: int({ min: 0 }, { label: "Tier", step: 1, help: "Tier zero is used by starter gear." }),
  description: str({}, { label: "Description", multiline: true }),
  stackable: bool({ label: "Stackable" }),
  value: int({ min: 0 }, { label: "Buy value", unit: "marks", step: 1 }),
  category: enumOf([
    "resource", "bar", "equipment", "food", "tool", "quest", "currency", "component",
  ] as const satisfies readonly ItemCategory[], { label: "Category" }),
  equip: opt(obj({
    slot: enumOf(EQUIP_SLOTS, { label: "Equipment slot" }),
    bonuses: EquipmentBonusesSchema,
    attackSpeedMs: opt(num({ exclusiveMin: 0 }, { label: "Attack interval", unit: "ms" })),
    requires: ItemSkillRequirementsSchema,
  }), { label: "Equipment" }),
  magicWeapon: opt(MagicWeaponSchema, { label: "Magic weapon" }),
  orb: opt(obj({ element, released: bool({ label: "Released" }) }), { label: "Essence orb" }),
  food: opt(obj({
    healAmount: num({ min: 0 }, { label: "Health restored" }),
  }), { label: "Food effect", help: "Burnt food has no food effect." }),
  tool: opt(obj({
    skill,
    gatherBonus: num({ min: 0 }, { label: "Effective gathering levels" }),
  }), { label: "Gathering tool" }),
}) satisfies Schema<ItemDef>;
