/** Runtime item fields. Collection membership and derivations extend this schema separately. */
import { EQUIP_SLOTS, SKILL_IDS, SPELL_ELEMENTS } from "../../contracts.js";
import type { ItemCategory, ItemDef } from "../../contracts.js";
import { bool, enumOf, id, int, lit, num, obj, opt, ref, refine, str, union, type Schema } from "./core.js";

const skill = enumOf(SKILL_IDS, { label: "Skill", ref: "skill", role: "Uses skill" });
const element = enumOf(SPELL_ELEMENTS, { label: "Element", ref: "element", role: "Uses element" });
const requiredLevel = int({ min: 1 }, { label: "Required level", step: 1 });

/** Explicit optional keys preserve Partial<Record<SkillId, number>> in the inferred type. */
export const ItemSkillRequirementsSchema = obj({
  melee: opt(requiredLevel, { label: "Melee", group: "requirements" }),
  magic: opt(requiredLevel, { label: "Magic", group: "requirements" }),
  mining: opt(requiredLevel, { label: "Mining", group: "requirements" }),
  woodcutting: opt(requiredLevel, { label: "Woodcutting", group: "requirements" }),
  fishing: opt(requiredLevel, { label: "Fishing", group: "requirements" }),
  smithing: opt(requiredLevel, { label: "Smithing", group: "requirements" }),
  crafting: opt(requiredLevel, { label: "Crafting", group: "requirements" }),
  cooking: opt(requiredLevel, { label: "Cooking", group: "requirements" }),
  fletching: opt(requiredLevel, { label: "Fletching", group: "requirements" }),
  agility: opt(requiredLevel, { label: "Agility", group: "requirements" }),
}, {}, { label: "Skill requirements" });

/** All seven keys are required; negative bonuses can express an authored equipment penalty. */
export const EquipmentBonusesSchema = obj({
  meleeAccuracy: num({}, { label: "Melee accuracy", group: "bonuses" }),
  magicAccuracy: num({}, { label: "Magic accuracy", group: "bonuses" }),
  defence: num({}, { label: "Defence", group: "bonuses" }),
  health: num({}, { label: "Health", group: "bonuses" }),
  meleePower: num({}, { label: "Melee power", group: "bonuses" }),
  magicPower: num({}, { label: "Magic power", group: "bonuses" }),
  vitality: num({}, { label: "Vitality", group: "bonuses" }),
});

export const ElementalWeaponChargeSchema = refine(obj({
  element,
  capacity: int({ min: 1 }, { label: "Charge capacity", step: 1 }),
  initialCharges: int({ min: 0 }, { label: "Initial charges", step: 1 }),
  rechargeItemId: ref("item", { label: "Recharge item", role: "Recharges" }),
  rechargeCost: int({ min: 1 }, { label: "Items per recharge", step: 1 }),
  orbItemId: ref("item", { label: "Altar orb", role: "Altar orb for" }),
  released: bool({ label: "Released" }),
}), (charge) => charge.initialCharges <= charge.capacity, "initialCharges must not exceed capacity");

export const MagicWeaponSchema = obj({
  kind: enumOf(["wand", "staff"] as const, { label: "Weapon kind" }),
  hands: union([lit(1), lit(2)] as const, { label: "Hands required" }),
  charge: opt(ElementalWeaponChargeSchema, { label: "Elemental charge" }),
});

export const ItemSchema = obj({
  id: id(),
  name: str({ nonEmpty: true }, { label: "Name", display: true }),
  tier: int({ min: 0 }, { label: "Tier", step: 1, help: "Tier zero is used by starter gear." }),
  description: str({}, { label: "Description", multiline: true }),
  stackable: bool({ label: "Stackable" }),
  value: int({ min: 0 }, { label: "Buy value", unit: "gold", step: 1 }),
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
