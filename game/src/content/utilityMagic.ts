import type { ItemId, UtilityEffectGroup, UtilitySpellId } from "../contracts.js";

export interface UtilitySpellDef {
  id: UtilitySpellId; name: string; reqLevel: number; target: "self" | "enemy" | "area";
  durationMs: number; radius: number; group: UtilityEffectGroup | "healing"; magnitude: number;
  costs: { itemId: ItemId; quantity: number }[]; description: string;
}
function spell(id: UtilitySpellId, name: string, reqLevel: number, cosmic: number, arc: number,
  target: UtilitySpellDef["target"], group: UtilitySpellDef["group"], magnitude: number,
  radius: number, description: string): UtilitySpellDef {
  return { id, name, reqLevel, target, group, magnitude, radius, description,
    durationMs: target === "self" ? 60_000 : 30_000,
    costs: [{ itemId: "cosmic_essence", quantity: cosmic }, ...(arc ? [{ itemId: "arc_essence", quantity: arc }] : [])] };
}
export const UTILITY_SPELLS: readonly UtilitySpellDef[] = [
  spell("lesser_ward", "Lesser Ward", 5, 1, 0, "self", "ward", .1, 0, "Take 10% less damage for 60 seconds."),
  spell("weaken", "Weaken", 10, 1, 0, "enemy", "weaken", .1, 0, "An enemy deals 10% less damage for 30 seconds."),
  spell("binding_thread", "Binding Thread", 15, 2, 0, "enemy", "root", 1, 0, "Root an ordinary enemy for 30 seconds. Bosses resist."),
  spell("enchant_weapon", "Enchant Weapon", 20, 2, 0, "self", "accuracy", .1, 0, "Gain 10% accuracy for 60 seconds."),
  spell("warding_circle", "Warding Circle", 30, 3, 1, "area", "ward", .1, 5, "Allies within 5 metres take 10% less damage for 30 seconds."),
  spell("enfeebling_mist", "Enfeebling Mist", 35, 3, 1, "area", "weaken", .1, 4, "Enemies within 4 metres deal 10% less damage for 30 seconds."),
  spell("binding_field", "Binding Field", 40, 4, 1, "area", "root", 1, 4, "Root ordinary enemies within 4 metres for 30 seconds. Bosses resist."),
  spell("greater_enchantment", "Greater Enchantment", 45, 4, 0, "self", "accuracy", .15, 0, "Gain 15% accuracy for 60 seconds."),
  spell("mending_circle", "Mending Circle", 50, 5, 1, "area", "healing", .15, 5, "Allies within 5 metres recover 15% maximum health over 30 seconds."),
  spell("haste", "Haste", 55, 4, 0, "self", "haste", .15, 0, "Move 15% faster for 60 seconds."),
  spell("stillness", "Stillness", 60, 5, 2, "area", "slow", .3, 5, "Enemies within 5 metres move 30% slower for 30 seconds."),
  spell("sanctuary", "Sanctuary", 70, 6, 2, "area", "ward", .2, 5, "Allies within 5 metres take 20% less damage for 30 seconds."),
];
export function utilitySpell(id: UtilitySpellId): UtilitySpellDef | undefined { return UTILITY_SPELLS.find(spell => spell.id === id); }
