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
      creatureDefinitions: [{ id: "wolf", name: "Wolf", loot: { rolls: [{ id: "main", name: "Main", count: 2, drops: [{ itemId: "ore", quantity: [1, 2], chance: 0.65 }], tables: [] }] } }],
    };

    const result = sourceUses("ore", collections);
    expect(result.targetKnown).toBe(true);
    expect(linksOf(result, "recipe-input")[0]).toMatchObject({ quantity: 2, detail: "Consumes ×2" });
    expect(linksOf(result, "resource-yield")[0]).toMatchObject({ quantity: [2, 4], detail: "Yields ×2–4" });
    expect(linksOf(result, "resource-bonus")[0]).toMatchObject({ chance: 0.25, detail: "Bonus yield (25% chance)" });
    expect(linksOf(result, "shop-sell")[0]).toMatchObject({ quantity: 9, detail: "Sells ×9 · in stock" });
    expect(linksOf(result, "quest-grant")).toHaveLength(4);
    expect(linksOf(result, "set-member")[0]).toMatchObject({ collection: "equipmentSets", detail: "Set member · head" });
    expect(linksOf(result, "enemy-drop")[0]).toMatchObject({ quantity: [1, 2], chance: 0.65, rollCount: 2, rollId: "main" });
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

  it("resolves nested table pools and inheritance while preserving separate rolls", () => {
    const main = { id: "main", name: "Main", count: 3, drops: [], tables: [{ tableId: "outer", rollId: "items" }] };
    const collections = {
      creatureDefinitions: [
        { id: "wolf", name: "Wolf", loot: { rolls: [main, { ...main, id: "bonus", count: 1 }] } },
        { id: "red_wolf", baseId: "wolf", name: "Red wolf" },
        { id: "empty_wolf", baseId: "wolf", loot: { rolls: [] } },
      ],
      lootTables: [
        { id: "outer", rolls: [{ id: "items", count: 9, drops: [], tables: [{ tableId: "inner", rollId: "items" }] }] },
        { id: "inner", rolls: [{ id: "items", count: 1, drops: [{ itemId: "ore", chance: .25, quantity: [1, 2] }], tables: [] }] },
      ],
    };
    const links = linksOf(sourceUses("ore", collections), "enemy-drop");
    expect(links).toHaveLength(4);
    expect(links.map(link => [link.recordId, link.rollId, link.rollCount, link.chance])).toEqual([
      ["wolf", "main", 3, .25], ["wolf", "bonus", 1, .25], ["red_wolf", "main", 3, .25], ["red_wolf", "bonus", 1, .25],
    ]);
    expect(links.every(link => link.collection === "creatureDefinitions" && link.detail.includes("chance per roll"))).toBe(true);
  });

  it("keeps direct item sources with missing linked pools and skips disabled rolls", () => {
    const drops = [{ itemId: "ore", chance: .25, quantity: [1, 1] }];
    const result = sourceUses("ore", { creatureDefinitions: { wolf: { name: "Wolf", loot: { rolls: [
      { id: "main", count: 1, drops, tables: [{ tableId: "missing", rollId: "items" }] },
      { id: "disabled", count: 0, drops, tables: [] },
    ] } } } });
    expect(linksOf(result, "enemy-drop")).toHaveLength(1);
    expect(linksOf(result, "enemy-drop")[0]).toMatchObject({ recordId: "wolf", chance: .25, rollCount: 1 });
  });
});
