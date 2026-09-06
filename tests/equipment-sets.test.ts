import { describe, expect, it } from "vitest";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { ARMOUR_SET_SLOTS, EQUIPMENT_SETS, getEquipmentSetBonuses, inferEquipmentSets,
  type EquipmentSetSlots } from "../game/src/content/equipmentSets.js";

describe("derived armour sets", () => {
  it("uses five distinct real armour members with matching ordinary names and slots", () => {
    expect(EQUIPMENT_SETS).toHaveLength(8);
    const ids = new Set<string>();
    for (const set of EQUIPMENT_SETS) {
      for (const slot of ARMOUR_SET_SLOTS) {
        const id = set.members[slot];
        expect(ids.has(id)).toBe(false);
        ids.add(id);
        const item = ALL_ITEMS.find((candidate) => candidate.id === id);
        expect(item?.equip?.slot).toBe(slot);
        expect(item?.tier).toBe(set.tier);
        expect(item?.name.startsWith(`${set.name} `)).toBe(true);
      }
    }
  });

  for (const set of EQUIPMENT_SETS) {
    it(`${set.name} activates and removes cumulative thresholds without changing damage or accuracy`, () => {
      const slots: EquipmentSetSlots = {};
      const defence = [2, 3, 4, 6][[1, 5, 10, 20].indexOf(set.tier)]!;
      const vitality = [1, 2, 3, 4][[1, 5, 10, 20].indexOf(set.tier)]!;
      for (let count = 0; count <= 5; count++) {
        if (count > 0) {
          const slot = ARMOUR_SET_SLOTS[count - 1]!;
          slots[slot] = { itemId: set.members[slot], quantity: 1 };
        }
        const result = getEquipmentSetBonuses(slots);
        expect(result).toEqual({ accuracy: 0, power: 0, magicAccuracy: 0, magicPower: 0,
          armour: count >= (set.style === "melee" ? 2 : 5) ? defence : 0,
          magicArmour: count >= (set.style === "magic" ? 2 : 5) ? defence : 0,
          vitality: count >= 4 ? vitality : 0 });
      }
      slots.feet = null;
      expect(inferEquipmentSets(slots)[0]?.activeThresholds.map((row) => row.pieces)).toEqual([2, 4]);
      expect(getEquipmentSetBonuses(slots)[set.style === "melee" ? "magicArmour" : "armour"]).toBe(0);
    });
  }

  it("never combines tiers or styles into one set", () => {
    const slots = { head: { itemId: "grithe_helm", quantity: 1 },
      body: { itemId: "corven_plate", quantity: 1 }, legs: { itemId: "marchhide_leggings", quantity: 1 } };
    expect(inferEquipmentSets(slots).map((row) => row.pieces)).toEqual([1, 1, 1]);
    expect(Object.values(getEquipmentSetBonuses(slots)).every((value) => value === 0)).toBe(true);
  });

  it("counts each slot once and rejects misplaced, missing and empty members", () => {
    const slots = { head: { itemId: "grithe_cuirass", quantity: 1 },
      body: { itemId: "grithe_helm", quantity: 1 }, mainHand: { itemId: "grithe_boots", quantity: 1 },
      hands: { itemId: "grithe_gloves", quantity: 0 }, feet: { itemId: "unknown", quantity: 1 } };
    expect(inferEquipmentSets(slots)).toEqual([]);
    expect(inferEquipmentSets({ head: { itemId: "grithe_helm", quantity: 99 } })[0]?.pieces).toBe(1);
  });

  it("sums independent active sets and does not mutate the input", () => {
    const slots = Object.freeze({ head: Object.freeze({ itemId: "grithe_helm", quantity: 1 }),
      body: Object.freeze({ itemId: "grithe_cuirass", quantity: 1 }),
      hands: Object.freeze({ itemId: "marchhide_wraps", quantity: 1 }),
      feet: Object.freeze({ itemId: "marchhide_boots", quantity: 1 }) });
    expect(getEquipmentSetBonuses(slots)).toMatchObject({ armour: 2, magicArmour: 2, vitality: 0 });
    const first = getEquipmentSetBonuses(slots);
    first.armour = 100;
    expect(getEquipmentSetBonuses(slots).armour).toBe(2);
  });
});
