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
});
