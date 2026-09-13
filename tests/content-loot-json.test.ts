import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { existsSync } from "node:fs";
import rawLootTables from "../game/content/data/lootTables.json";
import { LOOT_RECORDS, lootDrops, lootTableById } from "../game/src/content/lootData.js";
import { LootTableSchema } from "../game/src/content/schema/loot.js";
import { parseCollection } from "../game/src/content/schema/core.js";
import { buildM4Baseline, type M4Baseline } from "../tools/content/m4-baseline.js";
import { repoRoot } from "../tools/lib/paths.js";

describe("JSON loot loader", () => {
  it("reads the authored table in order and validates every row", () => {
    const parsed = parseCollection(LootTableSchema, rawLootTables, { name: "lootTables" });
    expect(LOOT_RECORDS).toEqual(parsed);
    expect(LOOT_RECORDS).toHaveLength(362);
    expect(new Set(LOOT_RECORDS.map((row) => row.id)).size).toBe(LOOT_RECORDS.length);
    for (const row of LOOT_RECORDS) {
      expect(row).toHaveProperty("catalog");
      expect(row).toHaveProperty("ownerId");
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

  const baselinePath = path.join(repoRoot, ".baseline", "game", "src", "content", "enemies.ts");
  describe.skipIf(!existsSync(baselinePath))("original M4 baseline parity", () => {
    let baseline: M4Baseline;
    beforeAll(async () => { baseline = await buildM4Baseline(); });

    it("matches every baseline owner row, preserving order and drop details", () => {
      expect(LOOT_RECORDS.map(({ derivation: _tag, ...row }) => row)).toEqual(baseline.records.lootTables);
      expect(LOOT_RECORDS.map((row) => row.id)).toEqual(baseline.records.lootTables.map((row) => row.id));
      expect(LOOT_RECORDS.filter((row) => row.catalog === "CREATURE_SOURCE_LOOT")).toHaveLength(18);
      expect(LOOT_RECORDS.filter((row) => row.catalog === "ENEMY_ALIAS_LOOT")).toHaveLength(6);
    });
  });
});
