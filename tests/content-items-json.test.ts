import { describe, expect, it } from "vitest";
import rawItems from "../game/content/data/items.json";
import { ALL_ITEMS, ITEMS } from "../game/src/content/items.js";
import { EQUIPMENT, MAGIC_ORBS, ELEMENTAL_MAGIC_WEAPONS, RARE_MINIBOSS_WEAPONS } from "../game/src/content/equipment.js";
import { CRAFTED_JEWELRY } from "../game/src/content/jewelry.js";
import { CREATURE_LOOT_ITEMS } from "../game/src/content/creatureLoot.js";
import { WILDERNESS_LOOT_ITEMS } from "../game/src/content/wildernessLoot.js";
import { BOSS_ARMOR_ITEMS } from "../game/src/content/bossArmor.js";
import { MINIBOSS_JEWELLERY } from "../game/src/content/universalMinibossLoot.js";
import { REGIONAL_TIER_ITEMS } from "../game/src/content/regionalTierEquipment.js";
import { HIGH_TIER_LOG_ITEMS } from "../game/src/content/treeSpecies.js";
import { CROWNWARD_FISH_ITEMS } from "../game/src/content/crownwardFishing.js";
import { ITEM_DATA, ITEM_RECORDS, itemRows } from "../game/src/content/itemData.js";
import { ITEM_SOURCE_CATALOGS, ITEM_SOURCE_VIEWS, ItemRecordSchema, type ItemCatalog } from "../game/src/content/schema/itemRecords.js";
import { parseCollection } from "../game/src/content/schema/core.js";

const views = {
  ITEMS, EQUIPMENT, MAGIC_ORBS, ELEMENTAL_MAGIC_WEAPONS, RARE_MINIBOSS_WEAPONS,
  CRAFTED_JEWELRY, CREATURE_LOOT_ITEMS, WILDERNESS_LOOT_ITEMS, BOSS_ARMOR_ITEMS,
  MINIBOSS_JEWELLERY, REGIONAL_TIER_ITEMS, HIGH_TIER_LOG_ITEMS, CROWNWARD_FISH_ITEMS,
};

describe("JSON item loaders", () => {
  it("loads the single authored table in file order and strips collection metadata", () => {
    expect(ITEM_RECORDS).toHaveLength(399);
    expect(ALL_ITEMS).toBe(ITEM_DATA);
    expect(ALL_ITEMS).toEqual(rawItems.map(({ catalog: _catalog, derivation: _derivation, ...item }) => item));
    for (const item of ALL_ITEMS) {
      expect(item).not.toHaveProperty("catalog");
      expect(item).not.toHaveProperty("derivation");
    }
    expect(new Set(ALL_ITEMS.map((item) => item.id)).size).toBe(ALL_ITEMS.length);
  });

  it("shares each runtime item object and nested fields across every named view", () => {
    const byId = new Map(ALL_ITEMS.map((item) => [item.id, item]));
    for (const source of ITEM_SOURCE_CATALOGS) {
      const catalogs = ITEM_SOURCE_VIEWS[source];
      const expected = ALL_ITEMS.filter((_item, index) => catalogs.includes(ITEM_RECORDS[index]!.catalog));
      expect(views[source], source).toEqual(expected);
      for (const row of views[source]) {
        expect(row, `${source}: ${row.id}`).toBe(byId.get(row.id));
        expect(row.equip, `${source}: ${row.id} equipment`).toBe(byId.get(row.id)!.equip);
      }
    }
    for (const row of CRAFTED_JEWELRY) expect(EQUIPMENT.includes(row)).toBe(true);
    for (const row of CROWNWARD_FISH_ITEMS) expect(ITEMS.includes(row)).toBe(true);
  });

  it("selects catalogs in global file order regardless of requested catalog order", () => {
    const selected: readonly ItemCatalog[] = ["MAGIC_ORBS", "CROWNWARD_FISH_ITEMS"];
    const rows = itemRows(selected);
    expect(rows.map((row) => row.id)).toEqual([...CROWNWARD_FISH_ITEMS, ...MAGIC_ORBS].map((row) => row.id));
    expect(itemRows([...selected].reverse())).toEqual(rows);
    expect(itemRows(["MAGIC_ORBS", "MAGIC_ORBS"])).toEqual(MAGIC_ORBS);
    expect(itemRows([])).toEqual([]);
    rows.forEach((row) => expect(ALL_ITEMS.includes(row)).toBe(true));
  });

  it("rejects unknown catalogs and runtime typos while validating JSON records", () => {
    const first = rawItems[0]!;
    expect(() => parseCollection(ItemRecordSchema, [{ ...first, catalog: "UNREGISTERED" }], { name: "items" }))
      .toThrow("catalog");
    expect(() => parseCollection(ItemRecordSchema, [{ ...first, stackible: true }], { name: "items" }))
      .toThrow("stackible");
    expect(() => parseCollection(ItemRecordSchema, [{ ...first, catalog: undefined }], { name: "items" }))
      .toThrow("catalog");
  });
});
