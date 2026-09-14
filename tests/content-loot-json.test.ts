import { describe, expect, it } from "vitest";
import rawLootTables from "../game/content/data/lootTables.json";
import { LOOT_RECORDS, lootDrops, lootTableById } from "../game/src/content/lootData.js";
import { LootTableSchema } from "../game/src/content/schema/loot.js";
import { parseCollection } from "../game/src/content/schema/core.js";

describe("JSON loot loader", () => {
  it("reads the authored table in order and validates every row", () => {
    const parsed = parseCollection(LootTableSchema, rawLootTables, { name: "lootTables" });
    expect(LOOT_RECORDS).toEqual(parsed);
    expect(LOOT_RECORDS.length).toBeGreaterThan(0);
    expect(new Set(LOOT_RECORDS.map((row) => row.id)).size).toBe(LOOT_RECORDS.length);
    for (const row of LOOT_RECORDS) {
      expect(row.drops).toBeInstanceOf(Array);
    }
  });

  it("returns the parsed record and cached drop array by id", () => {
    const first = LOOT_RECORDS[0]!;
    expect(lootTableById(first.id)).toBe(first);
    expect(lootDrops(first.id)).toBe(first.drops);
    expect(lootDrops(first.id)).toBe(lootDrops(first.id));
    expect(lootTableById(LOOT_RECORDS.at(-1)!.id)).toBe(LOOT_RECORDS.at(-1));
  });

  it("throws for an unknown id", () => {
    expect(() => lootTableById("loot_enemy_missing_t1")).toThrow("Unknown loot table");
    expect(() => lootDrops("loot_enemy_missing_t1")).toThrow("Unknown loot table");
  });

});
