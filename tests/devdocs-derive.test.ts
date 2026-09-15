import { describe, expect, it } from "vitest";

import type { CreatureDefinition, CreatureProfile } from "../game/src/content/schema/creatureDefinitions.js";
import type { EquipmentFamily, RecipeTemplate } from "../game/src/content/schema/progression.js";
import {
  deriveCreature, deriveEquipmentMember, deriveProductionEntry, resolveInherited,
  type EquipmentMember, type ProductionEntry, type TierRef,
} from "../devdocs/src/model/derive.js";
import { chainText, originState, revertTarget } from "../devdocs/src/model/origin.js";

const GRAZER: CreatureProfile = {
  id: "grazer", name: "Grazer", role: "grazer",
  healthBase: 10, healthPerLevel: 3, attackMultiplier: 0.8, defenceMultiplier: 0.9,
  accuracyPerLevel: 1.2, armourPerLevel: 0.5, magicArmourPerLevel: 0.25, hitPerLevel: 0.4,
  attackSpeedMs: 2400, marksPerLevel: 0.5,
};

const heathJack = (adjustments?: CreatureDefinition["adjustments"]): CreatureDefinition => ({
  id: "heath_jack", name: "Heath Jack", availability: "world", level: 10, profileId: "grazer",
  ...(adjustments ? { adjustments } : {}),
});
const variant = (adjustments?: CreatureDefinition["adjustments"]): CreatureDefinition => ({
  id: "heath_jack_elder", baseId: "heath_jack", availability: "world",
  ...(adjustments ? { adjustments } : {}),
});

const NO_BONUS = { meleeAccuracy: 0, magicAccuracy: 0, defence: 0, health: 0, meleePower: 0, magicPower: 0, vitality: 0 };
const SWORDS: EquipmentFamily = {
  id: "swords", name: "Swords", slot: "mainHand", skill: "melee", category: "equipment", formula: "equipment.linear",
  parameters: {
    valueBase: 10, valuePerLevel: 5,
    bonusesBase: { ...NO_BONUS, defence: 2 }, bonusesPerLevel: { ...NO_BONUS, defence: 1 },
    gatherBonusPerLevel: 0,
  },
};
const SMELTING: RecipeTemplate = {
  id: "smelt_bar", name: "Bar smelting", formula: "production.linear", kind: "smelt", skill: "smithing",
  stations: ["furnace"], parameters: { durationMs: 2400, xpBase: 0, xpPerLevel: 2 },
};
const TIER_5: TierRef = { id: "tier_5", tier: 5, reqLevel: 5 };

describe("creature origin chains", () => {
  it("explains an untouched combat field with the role curve alone", () => {
    const { combat } = deriveCreature(heathJack(), undefined, GRAZER);
    const health = combat.maxHealth!;
    expect(health.value).toBe(40);
    expect(health.resolved.value).toBe(40);
    expect(health.resolved.path).toEqual(["adjustments", "maxHealth"]);
    expect(health.resolved.storedOn).toBeUndefined();
    expect(health.resolved.chain).toEqual([{
      origin: { kind: "curve", expression: "max(1, round(10 + 10 × 3))", source: { collection: "creatureProfiles", id: "grazer", label: "Grazer", path: "healthPerLevel" } },
      value: 40,
    }]);
    expect(originState(health.resolved)).toBe("curve");
    expect(chainText(health.resolved)).toBe("from Grazer");
    expect(revertTarget(health.resolved)).toBeUndefined();
  });

  it("marks an own adjustment as overriding the curve and reverts to the curve link", () => {
    const { combat } = deriveCreature(heathJack({ attackSpeedMs: 1800 }), undefined, GRAZER);
    const speed = combat.attackSpeedMs!;
    expect(speed.value).toBe(1800);
    expect(speed.overridden).toBe(true);
    expect(originState(speed.resolved)).toBe("overridden");
    expect(speed.resolved.chain.map(link => link.value)).toEqual([1800, 2400]);
    const revert = revertTarget(speed.resolved)!;
    expect(revert.value).toBe(2400);
    expect(revert.origin.kind).toBe("curve");
    expect(chainText(speed.resolved, "ms")).toBe("was 2400 ms from Grazer");
  });

  it("carries a base adjustment onto a variant and says where it is stored", () => {
    const base = heathJack({ attackSpeedMs: 1800 });
    const { combat } = deriveCreature(variant(), base, GRAZER);
    const speed = combat.attackSpeedMs!;
    expect(speed.value).toBe(1800);
    expect(originState(speed.resolved)).toBe("inherited");
    expect(speed.resolved.storedOn).toEqual({ collection: "creatureDefinitions", id: "heath_jack", label: "Heath Jack", path: "adjustments.attackSpeedMs" });
    expect(speed.resolved.path).toEqual(["adjustments", "attackSpeedMs"]);
    expect(speed.resolved.chain.map(link => link.origin.kind)).toEqual(["inherited", "curve"]);
    expect(chainText(speed.resolved, "ms")).toBe("from Heath Jack · was 2400 ms from Grazer");
  });

  it("keeps all three links when a variant beats its base's override of the curve", () => {
    const base = heathJack({ attackSpeedMs: 1800 });
    const { combat } = deriveCreature(variant({ attackSpeedMs: 1500 }), base, GRAZER);
    const speed = combat.attackSpeedMs!;
    expect(speed.value).toBe(1500);
    expect(originState(speed.resolved)).toBe("overridden");
    expect(speed.resolved.chain.map(link => link.value)).toEqual([1500, 1800, 2400]);
    expect(speed.resolved.storedOn).toBeUndefined();
    expect(chainText(speed.resolved, "ms")).toBe("was 1800 ms from Heath Jack · was 2400 ms from Grazer");
    expect(revertTarget(speed.resolved)!.value).toBe(1800);
  });

  it("resolves identity fields a variant never authors to the base record", () => {
    const base = heathJack();
    const name = resolveInherited(variant(), base, "name");
    expect(name.value).toBe("Heath Jack");
    expect(originState(name)).toBe("inherited");
    expect(name.path).toEqual(["name"]);
    expect(name.storedOn).toEqual({ collection: "creatureDefinitions", id: "heath_jack", label: "Heath Jack", path: "name" });
    expect(originState(resolveInherited(heathJack(), undefined, "name"))).toBe("own");
    expect(originState(resolveInherited(variant(), base, "loot"))).toBe("absent");
  });

  it("leaves movement speeds absent until something sets them", () => {
    const { combat } = deriveCreature(heathJack(), undefined, GRAZER);
    const move = combat.moveSpeedMps!;
    expect(move.value).toBeUndefined();
    expect(move.resolved.value).toBeUndefined();
    expect(originState(move.resolved)).toBe("absent");
    expect(move.resolved.chain).toHaveLength(1);
    expect(chainText(move.resolved)).toBe("");

    const carried = deriveCreature(variant(), heathJack({ walkSpeedMps: 1.2 }), GRAZER).combat.walkSpeedMps!;
    expect(originState(carried.resolved)).toBe("inherited");
    expect(carried.resolved.value).toBe(1.2);
    expect(carried.resolved.chain.map(link => link.origin.kind)).toEqual(["inherited"]);

    const own = deriveCreature(heathJack({ walkSpeedMps: 1.4 }), undefined, GRAZER).combat.walkSpeedMps!;
    expect(originState(own.resolved)).toBe("own");
    expect(own.resolved.chain.map(link => link.origin.kind)).toEqual(["own"]);
  });
});

describe("progression origin chains", () => {
  it("writes an equipment bonus override onto the tier row it beats the family curve from", () => {
    const member: EquipmentMember = {
      familyId: "swords", id: "grithe_sword", name: "Grithe sword", description: "A sword.",
      adjustments: { bonuses: { defence: 40 } },
    };
    const derived = deriveEquipmentMember(TIER_5, member, SWORDS);
    const defence = derived.bonuses.defence;
    expect(defence.value).toBe(40);
    expect(defence.computed).toBe(7);
    expect(originState(defence.resolved)).toBe("overridden");
    expect(defence.resolved.path).toEqual(["adjustments", "bonuses", "defence"]);
    expect(defence.resolved.storedOn).toEqual({ collection: "progression", id: "tier_5", label: "Tier 5" });
    expect(defence.resolved.chain[1]!.origin).toEqual({
      kind: "curve", expression: "round(2 + 5 × 1)",
      source: { collection: "equipmentFamilies", id: "swords", label: "Swords", path: "parameters.bonusesPerLevel.defence" },
    });
    expect(chainText(defence.resolved)).toBe("was 7 from Swords");

    const health = derived.bonuses.health;
    expect(originState(health.resolved)).toBe("curve");
    expect(health.resolved.value).toBe(0);
    expect(originState(derived.value.resolved)).toBe("curve");
    expect(derived.value.resolved.value).toBe(35);
  });

  it("inherits a production entry's required level from the tier row", () => {
    const entry: ProductionEntry = {
      id: "smelt_grithe_bar", name: "Grithe bar", templateId: "smelt_bar",
      inputs: [{ itemId: "grithe_ore", quantity: 1 }], output: { itemId: "grithe_bar", quantity: 1 },
    };
    const derived = deriveProductionEntry(TIER_5, entry, SMELTING);
    expect(derived.reqLevel.value).toBe(5);
    expect(originState(derived.reqLevel.resolved)).toBe("inherited");
    expect(derived.reqLevel.resolved.path).toEqual(["adjustments", "reqLevel"]);
    expect(derived.reqLevel.resolved.chain).toEqual([{
      origin: { kind: "inherited", from: { collection: "progression", id: "tier_5", label: "Tier 5", path: "reqLevel" } },
      value: 5,
    }]);
    expect(chainText(derived.reqLevel.resolved)).toBe("from Tier 5");

    const overridden = deriveProductionEntry(TIER_5, { ...entry, adjustments: { reqLevel: 8 } }, SMELTING);
    expect(originState(overridden.reqLevel.resolved)).toBe("overridden");
    expect(revertTarget(overridden.reqLevel.resolved)!.value).toBe(5);
    expect(overridden.reqLevel.resolved.storedOn).toEqual({ collection: "progression", id: "tier_5", label: "Tier 5" });

    expect(originState(derived.durationMs.resolved)).toBe("curve");
    expect(derived.durationMs.resolved.value).toBe(2400);
    expect(chainText(derived.durationMs.resolved, "ms")).toBe("from Bar smelting");
    expect(derived.xp.resolved.value).toBe(10);
  });
});
