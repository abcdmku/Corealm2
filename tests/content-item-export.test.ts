import { describe, expect, it } from "vitest";
import type { ItemDef } from "../game/src/contracts.js";
import { ALL_ITEMS, ITEMS } from "../game/src/content/items.js";
import { EQUIPMENT, MAGIC_ORBS, ELEMENTAL_MAGIC_WEAPONS, RARE_MINIBOSS_WEAPONS } from "../game/src/content/equipment.js";
import { CROWNWARD_FISH_ITEMS } from "../game/src/content/crownwardFishing.js";
import { HIGH_TIER_LOG_ITEMS } from "../game/src/content/treeSpecies.js";
import { CRAFTED_JEWELRY } from "../game/src/content/jewelry.js";
import { CREATURE_LOOT_ITEMS } from "../game/src/content/creatureLoot.js";
import { WILDERNESS_LOOT_ITEMS } from "../game/src/content/wildernessLoot.js";
import { BOSS_ARMOR_ITEMS } from "../game/src/content/bossArmor.js";
import { MINIBOSS_JEWELLERY } from "../game/src/content/universalMinibossLoot.js";
import { REGIONAL_TIER_ITEMS } from "../game/src/content/regionalTierEquipment.js";
import { buildItemRecords, itemSourceView, ITEM_SOURCE_NAMES, type ItemSourceTables } from "../tools/content/export-items.js";

const currentSources = {
  ITEMS, EQUIPMENT, MAGIC_ORBS, ELEMENTAL_MAGIC_WEAPONS, RARE_MINIBOSS_WEAPONS,
  CROWNWARD_FISH_ITEMS, HIGH_TIER_LOG_ITEMS, CRAFTED_JEWELRY, CREATURE_LOOT_ITEMS,
  WILDERNESS_LOOT_ITEMS, BOSS_ARMOR_ITEMS, MINIBOSS_JEWELLERY, REGIONAL_TIER_ITEMS,
} satisfies ItemSourceTables;

function sources(overrides: Partial<ItemSourceTables> = {}): ItemSourceTables {
  return {
    ITEMS: [], EQUIPMENT: [], MAGIC_ORBS: [], ELEMENTAL_MAGIC_WEAPONS: [], RARE_MINIBOSS_WEAPONS: [],
    CROWNWARD_FISH_ITEMS: [], HIGH_TIER_LOG_ITEMS: [], CRAFTED_JEWELRY: [], CREATURE_LOOT_ITEMS: [],
    WILDERNESS_LOOT_ITEMS: [], BOSS_ARMOR_ITEMS: [], MINIBOSS_JEWELLERY: [], REGIONAL_TIER_ITEMS: [],
    ...overrides,
  };
}

function fixture(id: string): ItemDef {
  return { id, name: id, tier: 1, description: "Fixture", stackable: true, value: 1, category: "component" };
}

describe("item JSON export", () => {
  it("reconstructs every named source and all 399 current items in their original order", () => {
    const records = buildItemRecords(currentSources, ALL_ITEMS);
    expect(records).toHaveLength(399);
    expect(records.map(({ catalog: _catalog, ...item }) => item)).toEqual(ALL_ITEMS);
    for (const source of ITEM_SOURCE_NAMES) expect(itemSourceView(records, source), source).toEqual(currentSources[source]);
    expect(records.filter((row) => row.catalog === "ITEMS")).toHaveLength(102);
    expect(records.filter((row) => row.catalog === "EQUIPMENT")).toHaveLength(63);
  });

  it("gives specific sources precedence without regrouping interleaved rows or changing inputs", () => {
    const a = fixture("a"), b = fixture("b"), c = fixture("c");
    const all = Object.freeze([a, b, c]);
    const tables = sources({ EQUIPMENT: all, CRAFTED_JEWELRY: [a, c] });
    const before = JSON.stringify(tables);
    const records = buildItemRecords(tables, all);
    expect(records.map(({ id, catalog }) => [id, catalog])).toEqual([
      ["a", "CRAFTED_JEWELRY"], ["b", "EQUIPMENT"], ["c", "CRAFTED_JEWELRY"],
    ]);
    expect(itemSourceView(records, "EQUIPMENT")).toEqual(all);
    expect(JSON.stringify(tables)).toBe(before);
  });

  it("compares values structurally and canonicalizes key order", () => {
    const a = fixture("a");
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as unknown as ItemDef;
    const records = buildItemRecords(sources({ ITEMS: [reordered] }), [a]);
    expect(Object.keys(records[0]!)).toEqual(["id", "name", "tier", "description", "stackable", "value", "category", "catalog"]);
  });

  it("rejects unnamed items and source items absent from the aggregate", () => {
    const a = fixture("a");
    expect(() => buildItemRecords(sources(), [a])).toThrow("has no named source");
    expect(() => buildItemRecords(sources({ ITEMS: [a] }), [])).toThrow("absent from ALL_ITEMS");
  });

  it("rejects duplicate ids in the aggregate and individual source tables", () => {
    const a = fixture("a");
    expect(() => buildItemRecords(sources({ ITEMS: [a] }), [a, a])).toThrow("duplicate id");
    expect(() => buildItemRecords(sources({ ITEMS: [a, a] }), [a])).toThrow("duplicate id");
  });

  it("rejects unrelated overlap and missing aggregate membership", () => {
    const a = fixture("a");
    expect(() => buildItemRecords(sources({ ITEMS: [a], MAGIC_ORBS: [a] }), [a])).toThrow("overlaps unrelated sources");
    expect(() => buildItemRecords(sources({ CRAFTED_JEWELRY: [a] }), [a])).toThrow("parity failed for EQUIPMENT");
  });

  it("rejects a source order that cannot be reconstructed by filtering", () => {
    const a = fixture("a"), b = fixture("b");
    expect(() => buildItemRecords(sources({ ITEMS: [b, a] }), [a, b])).toThrow("parity failed for ITEMS");
  });

  it("rejects conflicting source values and invalid nested data before producing records", () => {
    const a = fixture("a");
    expect(() => buildItemRecords(sources({ ITEMS: [{ ...a, value: 2 }] }), [a])).toThrow("ITEMS[0].value");
    const invalid = { ...a, tool: { skill: "mining" as const, gatherBonus: Number.NaN } };
    expect(() => buildItemRecords(sources({ ITEMS: [invalid] }), [a])).toThrow("tool.gatherBonus");
  });
});
