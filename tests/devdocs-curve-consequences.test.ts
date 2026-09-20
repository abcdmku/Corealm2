import { describe, expect, it } from "vitest";

import type { CreatureDefinition, CreatureProfile } from "../game/src/content/schema/creatureDefinitions.js";
import type { EquipmentFamily, RecipeTemplate } from "../game/src/content/schema/progression.js";
import { movesWith, rowMovement, sameValue, tally, type Movement } from "../devdocs/src/dev/formulas/consequence.js";
import {
  deriveCreature, deriveEquipmentMember, deriveProductionEntry,
  type EquipmentMember, type ProductionEntry, type TierRef,
} from "../devdocs/src/model/derive.js";

/*
  Step 8 of docs/devdocs-inputs.md: a curve drawer shows what a parameter change does to the records
  that use it, before it is saved. These are the numbers behind that view — what moves, what an own
  override holds still, and the tally the section aside prints.
*/

const GRAZER: CreatureProfile = {
  id: "grazer", name: "Grazer", role: "grazer",
  healthBase: 10, healthPerLevel: 3, attackMultiplier: 0.8, defenceMultiplier: 0.9,
  accuracyPerLevel: 1.2, armourPerLevel: 0.5, magicArmourPerLevel: 0.25, hitPerLevel: 0.4,
  attackSpeedMs: 2400, goldPerLevel: 0.5,
};
const FATTER: CreatureProfile = { ...GRAZER, healthPerLevel: 6 };

const follower: CreatureDefinition = { id: "heath_jack", name: "Heath Jack", availability: "world", level: 10, profileId: "grazer" };
const pinned: CreatureDefinition = { ...follower, id: "moor_jack", name: "Moor Jack", adjustments: { maxHealth: 999 } };

const NO_BONUS = { meleeAccuracy: 0, magicAccuracy: 0, defence: 0, health: 0, meleePower: 0, magicPower: 0, vitality: 0 };
const SWORDS: EquipmentFamily = {
  id: "swords", name: "Swords", slot: "mainHand", skill: "melee", category: "equipment", formula: "equipment.linear",
  parameters: { valueBase: 10, valuePerLevel: 5, bonusesBase: { ...NO_BONUS }, bonusesPerLevel: { ...NO_BONUS, defence: 1 }, gatherBonusPerLevel: 0 },
};
const DEARER: EquipmentFamily = { ...SWORDS, parameters: { ...SWORDS.parameters, valuePerLevel: 9 } };
const TIER_5: TierRef = { id: "tier_5", tier: 5, reqLevel: 5 };
const plainSword: EquipmentMember = { id: "iron_sword", name: "Iron sword", familyId: "swords" } as EquipmentMember;
const pricedSword: EquipmentMember = { id: "gilt_sword", name: "Gilt sword", familyId: "swords", adjustments: { value: 400 } } as EquipmentMember;

const SMELT: RecipeTemplate = {
  id: "smelt_bar", name: "Bar smelting", formula: "production.linear", kind: "smelt", skill: "smithing",
  stations: ["furnace"], parameters: { durationMs: 2400, xpBase: 0, xpPerLevel: 2 },
};
const SLOWER: RecipeTemplate = { ...SMELT, parameters: { ...SMELT.parameters, durationMs: 3600 } };
const plainSmelt: ProductionEntry = { id: "smelt_iron", name: "Smelt iron", templateId: "smelt_bar" } as ProductionEntry;
const timedSmelt: ProductionEntry = { id: "smelt_gold", name: "Smelt gold", templateId: "smelt_bar", adjustments: { durationMs: 1000 } } as ProductionEntry;

/** The cell a drawer builds for one number: the curve either side of the edit plus the row's own value. */
const cell = (before: { computed: unknown }, after: { computed: unknown; overridden: boolean }) =>
  ({ before: before.computed, after: after.computed, ...movesWith(before.computed, after.computed, after.overridden) });

describe("value comparison", () => {
  it("compares a rebuilt array by its contents, not its identity", () => {
    expect(sameValue([3, 6], [3, 6])).toBe(true);
    expect(sameValue([3, 6], [4, 8])).toBe(false);
    expect(sameValue(undefined, undefined)).toBe(true);
    expect(sameValue(12, 12)).toBe(true);
  });
});

describe("movement", () => {
  it("separates a consumer that follows the curve from one its own override pins", () => {
    expect(movesWith(30, 60, false)).toEqual({ moved: true, pinned: false });
    expect(movesWith(30, 60, true)).toEqual({ moved: false, pinned: true });
    expect(movesWith(30, 30, false)).toEqual({ moved: false, pinned: false });
    // An override over a number the edit never touched is not a consequence worth flagging.
    expect(movesWith(30, 30, true)).toEqual({ moved: false, pinned: false });
  });

  it("calls a row unmoved only when nothing on it moved", () => {
    const moved: Movement = { moved: true, pinned: false };
    const held: Movement = { moved: false, pinned: true };
    const still: Movement = { moved: false, pinned: false };
    expect(rowMovement([moved, held])).toEqual({ moved: true, pinned: false });
    expect(rowMovement([held, still])).toEqual({ moved: false, pinned: true });
    expect(rowMovement([still, still])).toEqual({ moved: false, pinned: false });
  });

  it("tallies what the section aside prints", () => {
    expect(tally([{ moved: true, pinned: false }, { moved: false, pinned: true }, { moved: false, pinned: false }]))
      .toEqual({ total: 3, moved: 1, pinned: 1 });
  });
});

describe("role curve consequences", () => {
  it("moves a creature that follows the curve and reports the new health", () => {
    const before = deriveCreature(follower, undefined, GRAZER);
    const after = deriveCreature(follower, undefined, FATTER);
    expect(before.combat.maxHealth!.value).toBe(40);
    expect(after.combat.maxHealth!.value).toBe(70);
    expect(cell(before.combat.maxHealth!, after.combat.maxHealth!)).toEqual({ before: 40, after: 70, moved: true, pinned: false });
  });

  it("leaves a creature with its own health where it was, and still says what the curve did", () => {
    const before = deriveCreature(pinned, undefined, GRAZER);
    const after = deriveCreature(pinned, undefined, FATTER);
    expect(after.combat.maxHealth!.value).toBe(999);
    expect(after.combat.maxHealth!.overridden).toBe(true);
    expect(cell(before.combat.maxHealth!, after.combat.maxHealth!)).toEqual({ before: 40, after: 70, moved: false, pinned: true });
  });

  it("only offers the columns the edit actually moves", () => {
    const fields = ["maxHealth", "attackLevel", "defenceLevel", "maxHit"] as const;
    const rows = [follower, pinned].map(definition => ({
      before: deriveCreature(definition, undefined, GRAZER),
      after: deriveCreature(definition, undefined, FATTER),
    }));
    const changed = fields.filter(field => rows.some(row => !sameValue(row.before.combat[field]!.computed, row.after.combat[field]!.computed)));
    expect(changed).toEqual(["maxHealth"]);
    expect(tally(rows.map(row => rowMovement(changed.map(field => cell(row.before.combat[field]!, row.after.combat[field]!))))))
      .toEqual({ total: 2, moved: 1, pinned: 1 });
  });

  it("follows a variant's inherited override, so the base's adjustment pins the variant too", () => {
    const heir: CreatureDefinition = { id: "moor_jack_elder", baseId: "moor_jack", availability: "world" };
    const before = deriveCreature(heir, pinned, GRAZER);
    const after = deriveCreature(heir, pinned, FATTER);
    expect(after.combat.maxHealth!.value).toBe(999);
    expect(cell(before.combat.maxHealth!, after.combat.maxHealth!).pinned).toBe(true);
  });
});

describe("family and template consequences", () => {
  it("reprices the members that follow the family curve and pins the one with its own value", () => {
    const plain = cell(deriveEquipmentMember(TIER_5, plainSword, SWORDS).value, deriveEquipmentMember(TIER_5, plainSword, DEARER).value);
    const priced = cell(deriveEquipmentMember(TIER_5, pricedSword, SWORDS).value, deriveEquipmentMember(TIER_5, pricedSword, DEARER).value);
    expect(plain).toEqual({ before: 35, after: 55, moved: true, pinned: false });
    expect(priced).toEqual({ before: 35, after: 55, moved: false, pinned: true });
    expect(deriveEquipmentMember(TIER_5, pricedSword, DEARER).value.value).toBe(400);
    expect(tally([rowMovement([plain]), rowMovement([priced])])).toEqual({ total: 2, moved: 1, pinned: 1 });
  });

  it("slows the recipes that follow the template and leaves the timed one alone", () => {
    const plain = cell(deriveProductionEntry(TIER_5, plainSmelt, SMELT).durationMs, deriveProductionEntry(TIER_5, plainSmelt, SLOWER).durationMs);
    const timed = cell(deriveProductionEntry(TIER_5, timedSmelt, SMELT).durationMs, deriveProductionEntry(TIER_5, timedSmelt, SLOWER).durationMs);
    expect(plain).toEqual({ before: 2400, after: 3600, moved: true, pinned: false });
    expect(timed).toEqual({ before: 2400, after: 3600, moved: false, pinned: true });
    expect(deriveProductionEntry(TIER_5, timedSmelt, SLOWER).durationMs.value).toBe(1000);
  });
});
