import { describe, expect, it } from "vitest";
import rawSets from "../game/content/data/equipmentSets.json";
import rawParams from "../game/content/data/balance/sets.json";
import { EQUIPMENT_SETS, getEquipmentSetBonuses, inferEquipmentSets, type EquipmentSetSlots } from "../game/src/content/equipmentSets.js";
import { BOSS_ARMOR_SETS } from "../game/src/content/bossArmor.js";
import { SET_DATA, SET_RECORDS, setRows } from "../game/src/content/setData.js";
import { EquipmentSetRecordSchema } from "../game/src/content/schema/equipmentSets.js";
import { parseCollection, parseValue } from "../game/src/content/schema/core.js";
import { setsBalanceSchema } from "../game/src/content/schema/balance.js";
import { setThresholds } from "../game/src/content/balance/sets.js";
import { buildSetRecords } from "../tools/content/export-sets.js";

const params = parseValue(setsBalanceSchema, rawParams, "balance/sets");

describe("JSON equipment sets", () => {
  it("preserves the authored table and shares boss source objects without metadata", () => {
    expect(EQUIPMENT_SETS).toBe(SET_DATA);
    expect(EQUIPMENT_SETS).toHaveLength(24);
    expect(EQUIPMENT_SETS).toEqual(rawSets.map(({ catalog: _catalog, derivation: _derivation, ...row }) => row));
    expect(BOSS_ARMOR_SETS).toHaveLength(6);
    expect(BOSS_ARMOR_SETS).toEqual(setRows("BOSS_ARMOR_SETS"));
    for (const row of SET_DATA) {
      expect(row).not.toHaveProperty("catalog");
      expect(row).not.toHaveProperty("derivation");
    }
    for (const row of BOSS_ARMOR_SETS) {
      expect(row).toBe(SET_DATA.find(set => set.id === row.id));
      expect(row.thresholds).toBe(SET_DATA.find(set => set.id === row.id)!.thresholds);
    }
    expect(setRows(["EQUIPMENT_SETS", "BOSS_ARMOR_SETS"])).toEqual(SET_DATA);
    expect(setRows(["BOSS_ARMOR_SETS", "BOSS_ARMOR_SETS"])).toEqual(BOSS_ARMOR_SETS);
    expect(setRows([])).toEqual([]);
  });

  it("reproduces every tagged threshold and responds only to supplied balance parameters", () => {
    expect(SET_RECORDS.filter(row => row.derivation)).toHaveLength(24);
    for (const row of SET_RECORDS) {
      if (row.derivation) expect(setThresholds(params, { tier: row.tier, bareheaded: !row.members.head }), row.id).toEqual(row.thresholds);
    }
    const changed = structuredClone(params);
    changed.byTier.find(row => row.tier === 50)!.defence = 23;
    changed.byTier.find(row => row.tier === 50)!.health = 17;
    changed.thresholds.healthPieces = 3;
    expect(setThresholds(changed, { tier: 50, bareheaded: false })).toMatchObject([
      { pieces: 2, bonuses: { defence: 23 } }, { pieces: 3, bonuses: { health: 17 } }, { pieces: 5, bonuses: { defence: 23 } },
    ]);
    expect(setThresholds(params, { tier: 50, bareheaded: true }).map(row => row.pieces)).toEqual([2, 3, 4]);
    expect(setThresholds(params, { tier: 50, bareheaded: false }).map(row => row.pieces)).toEqual([2, 4, 5]);
    expect(() => setThresholds(params, { tier: 51, bareheaded: false })).toThrow("Missing set balance tier");
    changed.thresholds.healthPieces = 2;
    expect(() => setThresholds(changed, { tier: 50, bareheaded: false })).toThrow("must increase");
    expect(rawParams.byTier.find(row => row.tier === 50)!.defence).toBe(10);
  });

  it("keeps runtime cumulative thresholds for normal and bareheaded sets", () => {
    for (const id of ["copper", "duskguard"]) {
      const set = SET_DATA.find(row => row.id === id)!;
      const slots: EquipmentSetSlots = {};
      for (const [slot, itemId] of Object.entries(set.members)) {
        slots[slot as keyof EquipmentSetSlots] = { itemId, quantity: 1 };
      }
      const progress = inferEquipmentSets(slots)[0]!;
      expect(progress.set).toBe(set);
      expect(progress.activeThresholds).toEqual(set.thresholds);
      expect(getEquipmentSetBonuses(slots).defence).toBe(set.thresholds[0]!.bonuses.defence * 2);
      slots.feet = null;
      expect(getEquipmentSetBonuses(slots).defence).toBe(set.thresholds[0]!.bonuses.defence);
    }
  });

  it("rejects unknown fields and invalid memberships, thresholds and derivations", () => {
    const first = rawSets[0]!;
    const parse = (row: unknown) => parseCollection(EquipmentSetRecordSchema, [row], { name: "equipmentSets" });
    expect(() => parse({ ...first, catalog: "UNKNOWN" })).toThrow("catalog");
    expect(() => parse({ ...first, members: { ...first.members, weapon: "axe" } })).toThrow("weapon");
    expect(() => parse({ ...first, members: {} })).toThrow("members must");
    expect(() => parse({ ...first, members: { head: "same", body: "same" } })).toThrow("must not repeat");
    expect(() => parse({ ...first, thresholds: [first.thresholds[0], first.thresholds[0]] })).toThrow("unique, increasing");
    expect(() => parse({ ...first, thresholds: [{ ...first.thresholds[0], pieces: 6 }] })).toThrow("pieces");
    expect(() => parse({ ...first, thresholds: [{ ...first.thresholds[0], bonuses: { ...first.thresholds[0]!.bonuses, defnce: 3 } }] })).toThrow("defnce");
    expect(() => parse({ ...first, derivation: { kind: "wrong" } })).toThrow("derivation.kind");
    expect(() => parseCollection(EquipmentSetRecordSchema, [first, first], { name: "equipmentSets" })).toThrow("duplicate id");
  });

  it("checks source order and values and leaves tuned thresholds untagged", () => {
    expect(buildSetRecords(SET_DATA, BOSS_ARMOR_SETS, params)).toEqual(SET_RECORDS);
    expect(() => buildSetRecords(SET_DATA, [...BOSS_ARMOR_SETS].reverse(), params)).toThrow("Set parity failed");
    expect(() => buildSetRecords(SET_DATA, [{ ...BOSS_ARMOR_SETS[0]!, id: "absent" }], params)).toThrow("absent from");
    expect(() => buildSetRecords(SET_DATA, BOSS_ARMOR_SETS.map(row => ({ ...row, name: "wrong" })), params)).toThrow("name");
    const tuned = structuredClone(SET_DATA);
    tuned[0]!.thresholds[0]!.bonuses.defence += 1;
    const records = buildSetRecords(tuned, BOSS_ARMOR_SETS, params);
    expect(records[0]).not.toHaveProperty("derivation");
    expect(records[1]!.derivation).toEqual({ kind: "setThresholds" });
  });
});
