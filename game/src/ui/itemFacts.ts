/**
 * The words the game puts on an item, with no dependency on the content registry.
 *
 * The live tooltip, the generated Codex and the Codex editor all print the same sentences about an
 * item, and the editor cannot import `content/index.ts` — it edits a draft that the registry has
 * never seen. So the wording lives here, over a plain `ItemDef`, and `itemTooltipContent.ts` builds
 * its model from these. Change a label here and every surface changes with it.
 */
import type { EquipmentBonuses, ItemDef, SkillId, SpellElement } from "../contracts.js";
import { SKILLS } from "../content/skills.js";

/** The bonus rows, in the order the tooltip lists them. */
export const BONUS_LABELS: readonly [keyof EquipmentBonuses, string][] = [
  ["meleeAccuracy", "Melee Accuracy"],
  ["magicAccuracy", "Magic Accuracy"],
  ["defence", "Defence"],
  ["health", "Health"],
  ["meleePower", "Melee Power"],
  ["magicPower", "Magic Power"],
  ["vitality", "Vitality (crit %)"],
];

/** The player-facing name of an element. `wind` is "Air" everywhere the player can read it. */
export const ELEMENT_LABELS: Readonly<Record<SpellElement, string>> = {
  wind: "Air", water: "Water", earth: "Earth", fire: "Fire",
};

/** A shop pays this much of an item's value for it. */
export const SELL_RATIO = 0.6;

export const sellPrice = (value: number): number => Math.round(value * SELL_RATIO);

const count = (value: number): string => value.toLocaleString("en-US");

export function itemIsReleased(def: Pick<ItemDef, "orb" | "magicWeapon">): boolean {
  return def.orb?.released ?? def.magicWeapon?.charge?.released ?? true;
}

/** "equipment · stacks" — the line under the title. */
export const categoryLine = (def: Pick<ItemDef, "category" | "stackable">): string =>
  `${def.category}${def.stackable ? " · stacks" : ""}`;

/** "Value 26,000 · sells for 15,600". */
export const valueLine = (value: number): string =>
  `Value ${count(value)} · sells for ${count(sellPrice(value))}`;

/** A weapon's swing or cast cadence, in seconds to one decimal. */
export const attackSpeedLine = (attackSpeedMs: number, casts: boolean): string =>
  `${casts ? "Cast cadence" : "Attack speed"} ${(attackSpeedMs / 1000).toFixed(1)} s`;

export const magicWeaponLine = (kind: "wand" | "staff"): string => kind === "wand"
  ? "Wand: one-handed, faster casts, weaker hits."
  : "Staff: two-handed, slower casts, stronger hits.";

export function formatWeaponChargeLine(element: SpellElement, capacity: number, charges: number | null): string {
  const name = ELEMENT_LABELS[element];
  const maximum = count(Math.max(0, Math.floor(capacity)));
  if (charges === null) return `${name} weapon · ${maximum} charge capacity.`;
  const current = count(Math.max(0, Math.min(capacity, Math.floor(charges))));
  return `${name} weapon · ${current} / ${maximum} charges remaining.`;
}

export const foodLine = (healAmount: number): string => `Heals ${healAmount} health.`;

export const toolLine = (skill: SkillId, gatherBonus: number): string =>
  `${SKILLS[skill].name} tool, +${gatherBonus} effective levels.`;

/** "Requires Melee 70", with "— you have 41" appended when the player falls short. */
export function requirementLine(skill: SkillId, level: number, have?: number): string {
  const base = `Requires ${SKILLS[skill].name} ${level}`;
  return have === undefined || have >= level ? base : `${base} — you have ${have}`;
}

/** "Craft this into an Air wand or staff. The finished weapon starts with 1,000 charges." */
export function orbCraftLine(element: SpellElement, initialCharges: number): string {
  const name = ELEMENT_LABELS[element];
  const article = /^[AEIOU]/.test(name) ? "an" : "a";
  return `Craft this into ${article} ${name} wand or staff. The finished weapon starts with ${count(initialCharges)} charges.`;
}
