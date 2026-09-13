import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { CollectionResponse } from "../devdocs/shared/contracts.js";
import { sourceUses, type SourceUseLink } from "../devdocs/src/model/joins.js";

function response(name: string, data: unknown, shape: "array" | "object" = "array", idKey = "id"): CollectionResponse {
  return {
    collection: { name, count: Array.isArray(data) ? data.length : 0, editable: false, idKey, shape },
    revision: "test",
    data,
  };
}

function linksOf(result: ReturnType<typeof sourceUses>, kind: SourceUseLink["kind"]): SourceUseLink[] {
  return result.links.filter((link) => link.kind === kind) as SourceUseLink[];
}

function dataFile(name: string): unknown {
  return JSON.parse(readFileSync(resolve("game/content/data", `${name}.json`), "utf8")) as unknown;
}

describe("sourceUses", () => {
  it("joins the current recipe JSON, including its burnt output", () => {
    const recipes = dataFile("recipes");
    const result = sourceUses("burnt_minnow", [response("recipes", recipes)]);

    expect(result.targetKnown).toBe(false);
    expect(result.links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "recipe-output",
        collection: "recipes",
        recordId: "cook_seared_minnow",
        recordLabel: "Seared Minnow",
        quantity: 1,
        detail: expect.stringContaining("Burnt output"),
        targetKnown: true,
      }),
    ]));
  });

  it("reads quest rewards from the authored grant shape and ignores objective/take references", () => {
    const quests = dataFile("quests") as Array<Record<string, unknown>>;
    const coldIron = quests.find((quest) => quest.id === "cold_iron");
    expect(coldIron).toBeDefined();

    const result = sourceUses("grithe_hatchet", [response("quests", [coldIron])]);
    const grants = linksOf(result, "quest-grant");
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      collection: "quests",
      recordId: "cold_iron",
      recordLabel: "Cold Iron",
      quantity: 1,
      targetKnown: true,
    });
    expect(grants[0]!.detail).toContain("completion reward");

    const noTake = sourceUses("grithe_ore", [response("quests", [{
      id: "take-only",
      name: "Take only",
      onStart: { takeItems: [{ itemId: "grithe_ore", quantity: 1 }] },
      rewards: { items: [], xp: {}, currency: 0, unlocks: [] },
      stages: [{ index: 0, completion: {}, grants: { takeItems: [{ itemId: "grithe_ore", quantity: 3 }] } }],
    }])]);
    expect(linksOf(noTake, "quest-grant")).toHaveLength(0);
  });

  it("joins all supported source tables with quantities, ranges, chances, and supplied names", () => {
    const collections = {
      items: response("items", [{ id: "ore", name: "Ore" }]),
      recipes: [{
        id: "forge-ore",
        name: "Forge Ore",
        inputs: [{ itemId: "ore", quantity: 2 }],
        output: { itemId: "bar", quantity: 1 },
      }],
      resources: [{
        id: "ore-node",
        name: "Ore Node",
        itemId: "ore",
        yieldRange: [2, 4],
        bonus: [{ itemId: "ore", chance: 0.25 }],
      }],
      shops: [{ id: "smith", name: "Smith", stock: [{ itemId: "ore", quantity: 9 }] }],
      quests: [{
        id: "ore-quest",
        name: "Ore Quest",
        onStart: { items: [{ itemId: "ore", quantity: 1 }] },
        rewards: { items: [{ itemId: "ore", quantity: 3 }] },
        stages: [{
          index: 0,
          grants: { items: [{ itemId: "ore", quantity: 4 }] },
          onFlag: [{ flag: "found", grant: { items: [{ itemId: "ore", quantity: 5 }] } }],
        }],
      }],
      equipmentSets: [{ id: "set-a", name: "Set A", members: { head: "ore" } }],
      creatures: [{ id: "wolf", name: "Wolf", stats: { drops: [{ itemId: "ore", quantity: [1, 2], chance: 0.65 }] } }],
    };

    const result = sourceUses("ore", collections);
    expect(result.targetKnown).toBe(true);
    expect(linksOf(result, "recipe-input")[0]).toMatchObject({ quantity: 2, detail: "Consumes ×2" });
    expect(linksOf(result, "resource-yield")[0]).toMatchObject({ quantity: [2, 4], detail: "Yields ×2–4" });
    expect(linksOf(result, "resource-bonus")[0]).toMatchObject({ chance: 0.25, detail: "Bonus yield (25% chance)" });
    expect(linksOf(result, "shop-sell")[0]).toMatchObject({ quantity: 9, detail: "Sells ×9 · in stock" });
    expect(linksOf(result, "quest-grant")).toHaveLength(4);
    expect(linksOf(result, "set-member")[0]).toMatchObject({ collection: "equipmentSets", detail: "Set member · head" });
    expect(linksOf(result, "enemy-drop")[0]).toMatchObject({ quantity: [1, 2], chance: 0.65, detail: "Drops ×1–2 (65% chance)" });
  });

  it("accepts object-shaped response data and leaves unknown item refs visible", () => {
    const result = sourceUses("missing", [
      response("items", { known: { name: "Known" } }, "object"),
      response("sets", { ancient: { name: "Ancient", members: { body: "missing" } } }, "object"),
    ]);

    expect(result.targetKnown).toBe(false);
    expect(linksOf(result, "set-member")[0]).toMatchObject({
      collection: "sets",
      recordId: "ancient",
      targetKnown: true,
    });
  });

  it("skips null and unrelated malformed properties instead of treating them as rows", () => {
    const result = sourceUses("ore", {
      items: null,
      recipes: { metadata: { version: 1 }, unrelated: { value: "ore" } },
      resources: { metadata: { value: "ore" } },
      equipmentSets: { config: { members: { head: "ore" } } },
      enemies: [{ id: "bad", drops: [{ itemId: null, quantity: [1, 2], chance: 0.5 }] }, null],
    });

    expect(result.targetKnown).toBe(false);
    expect(result.links).toHaveLength(0);
  });

  it("resolves normalized enemy, species, and alias loot to their owning routes", () => {
    const result = sourceUses("ore", {
      items: response("items", [{ id: "ore", name: "Ore" }]),
      enemies: response("enemies", [
        { id: "wolf_t1", name: "Wolf", lootTableId: "loot_enemy_wolf_t1" },
        { id: "boar_t1", name: "Boar", lootTableId: "loot_enemy_boar_t1" },
      ]),
      creatures: response("creatures", [
        { id: "wolf_source", blockId: "wolf_t1", lootTableId: "loot_species_wolf_source" },
        { id: "wolf_inherit", blockId: "wolf_t1", lootTableId: "loot_enemy_wolf_t1" },
      ]),
      enemyAliases: response("enemyAliases", [
        { id: "boar_group", blockId: "boar_t1", overrides: { name: "Red Boar" }, lootTableId: "loot_alias_boar_group" },
      ]),
      lootTables: response("lootTables", [
        { id: "loot_enemy_wolf_t1", ownerId: "wolf_t1", catalog: "ENEMY_BLOCK_LOOT", drops: [{ itemId: "ore", quantity: [1, 1], chance: 0.2 }] },
        { id: "loot_species_wolf_source", ownerId: "wolf_source", catalog: "CREATURE_SOURCE_LOOT", drops: [{ itemId: "ore", quantity: [2, 3], chance: 0.4 }] },
        { id: "loot_alias_boar_group", ownerId: "boar_group", catalog: "ENEMY_ALIAS_LOOT", drops: [{ itemId: "ore", quantity: [4, 4], chance: 0.1 }] },
      ]),
    });

    expect(result.targetKnown).toBe(true);
    expect(result.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ collection: "enemies", recordId: "wolf_t1", recordLabel: "Wolf", quantity: [1, 1], chance: 0.2 }),
      expect.objectContaining({ collection: "creatures", recordId: "wolf_source", recordLabel: "Wolf", quantity: [2, 3], chance: 0.4 }),
      expect.objectContaining({ collection: "enemyAliases", recordId: "boar_group", recordLabel: "Red Boar", quantity: [4, 4], chance: 0.1 }),
    ]));
    expect(result.links.some(link => link.collection === "lootTables")).toBe(false);
    expect(result.links.some(link => link.recordId === "wolf_inherit")).toBe(false);
  });

  it("keeps normalized owner links safe when references are missing", () => {
    const result = sourceUses("ore", [
      response("items", [{ id: "ore", name: "Ore" }]),
      response("creatures", [{ id: "orphan_species", blockId: "missing_block", lootTableId: "loot_species_orphan_species" }]),
      response("lootTables", [
        { id: "loot_species_orphan_species", ownerId: "orphan_species", catalog: "CREATURE_SOURCE_LOOT", drops: [{ itemId: "ore", quantity: 1, chance: 0.3 }] },
        { id: "loot_enemy_missing", ownerId: "missing_enemy", catalog: "ENEMY_BLOCK_LOOT", drops: [{ itemId: "ore", quantity: 1, chance: 0.3 }] },
        { id: "loot_alias_missing", ownerId: "missing_alias", catalog: "ENEMY_ALIAS_LOOT", drops: [{ itemId: "ore", quantity: 1, chance: 0.3 }] },
      ]),
    ]);

    expect(result.links).toHaveLength(1);
    expect(result.links[0]).toMatchObject({ collection: "creatures", recordId: "orphan_species", recordLabel: "orphan_species", targetKnown: true });
  });

  it("accepts raw ID-keyed maps for normalized owner tables", () => {
    const result = sourceUses("ore", {
      items: [{ id: "ore", name: "Ore" }],
      enemies: { wolf_t1: { name: "Wolf", lootTableId: "loot_enemy_wolf_t1" } },
      lootTables: {
        loot_enemy_wolf_t1: {
          ownerId: "wolf_t1",
          catalog: "ENEMY_BLOCK_LOOT",
          drops: [{ itemId: "ore", quantity: 1, chance: 0.5 }],
        },
      },
    });

    expect(result.links).toEqual([expect.objectContaining({ collection: "enemies", recordId: "wolf_t1", recordLabel: "Wolf" })]);
  });

  it("deduplicates inline and normalized copies without merging separate rolls", () => {
    const drops = [
      { itemId: "ore", quantity: [1, 1], chance: 0.2 },
      { itemId: "ore", quantity: [2, 3], chance: 0.4 },
    ];
    const result = sourceUses("ore", {
      items: response("items", [{ id: "ore", name: "Ore" }]),
      enemies: response("enemies", [{ id: "wolf_t1", name: "Wolf", lootTableId: "loot_enemy_wolf_t1", drops }]),
      lootTables: response("lootTables", [
        { id: "loot_enemy_wolf_t1", ownerId: "wolf_t1", catalog: "ENEMY_BLOCK_LOOT", drops },
        { id: "loot_enemy_wolf_t1", ownerId: "wolf_t1", catalog: "ENEMY_BLOCK_LOOT", drops },
      ]),
    });

    const links = linksOf(result, "enemy-drop");
    expect(links).toHaveLength(2);
    expect(links.map(link => link.chance)).toEqual([0.2, 0.4]);
    expect(links.map(link => link.quantity)).toEqual([[1, 1], [2, 3]]);
  });

  it("preserves drop order and exclusive groups for legacy and normalized rows", () => {
    const drops = [
      { itemId: "ore", quantity: [1, 2], chance: 0.35, exclusiveGroup: "jewelry" },
      { itemId: "ore", quantity: [3, 3], chance: 0.1 },
    ];
    const result = sourceUses("ore", {
      items: response("items", [{ id: "ore", name: "Ore" }]),
      enemies: response("enemies", [{ id: "legacy", name: "Legacy", stats: { drops } }]),
      enemyBlocks: response("enemyBlocks", [{ id: "normalized", name: "Normalized", lootTableId: "loot_enemy_normalized" }]),
      lootTables: response("lootTables", [{ id: "loot_enemy_normalized", ownerId: "normalized", catalog: "ENEMY_BLOCK_LOOT", drops }]),
    });

    const links = linksOf(result, "enemy-drop");
    expect(links.map(link => link.recordId)).toEqual(["normalized", "normalized", "legacy", "legacy"]);
    expect(links.map(link => link.quantity)).toEqual([[1, 2], [3, 3], [1, 2], [3, 3]]);
    expect(links.map(link => link.chance)).toEqual([0.35, 0.1, 0.35, 0.1]);
    expect(links[0]).toMatchObject({ exclusiveGroup: "jewelry" });
    expect(links[1]).not.toHaveProperty("exclusiveGroup");
    expect(links[2]).toMatchObject({ exclusiveGroup: "jewelry" });
  });

  it("uses the canonical owner for inherited aliases and the alias owner for overrides", () => {
    const result = sourceUses("ore", {
      items: response("items", [{ id: "ore", name: "Ore" }]),
      enemies: response("enemies", [{ id: "wolf_t1", name: "Wolf", lootTableId: "loot_enemy_wolf_t1" }]),
      enemyAliases: response("enemyAliases", [
        { id: "wolf_pack", blockId: "wolf_t1", overrides: { name: "Wolf Pack" } },
        { id: "red_wolf_pack", blockId: "wolf_t1", overrides: { name: "Red Wolf Pack" }, lootTableId: "loot_alias_red_wolf_pack" },
      ]),
      lootTables: response("lootTables", [
        { id: "loot_enemy_wolf_t1", ownerId: "wolf_t1", catalog: "ENEMY_BLOCK_LOOT", drops: [{ itemId: "ore", quantity: 1, chance: 0.25 }] },
        { id: "loot_alias_red_wolf_pack", ownerId: "red_wolf_pack", catalog: "ENEMY_ALIAS_LOOT", drops: [{ itemId: "ore", quantity: 2, chance: 0.5 }] },
      ]),
    });

    const links = linksOf(result, "enemy-drop");
    expect(links).toHaveLength(2);
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({ collection: "enemies", recordId: "wolf_t1", recordLabel: "Wolf", quantity: 1 }),
      expect.objectContaining({ collection: "enemyAliases", recordId: "red_wolf_pack", recordLabel: "Red Wolf Pack", quantity: 2 }),
    ]));
    expect(links.some(link => link.recordId === "wolf_pack")).toBe(false);
  });
});
