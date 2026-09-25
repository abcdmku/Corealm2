import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { CollectionResponse } from "../devdocs/shared/contracts.js";
import { buildReferenceIndex, isOptionKind, optionsFor } from "../devdocs/src/model/refs.js";

function response(name: string, data: unknown): CollectionResponse {
  return { collection: { name, count: Array.isArray(data) ? data.length : 0, editable: false, idKey: "id", shape: "array" }, revision: "test", data };
}

const dataFile = (name: string): unknown => JSON.parse(readFileSync(resolve("game/content/data", `${name}.json`), "utf8")) as unknown;

const index = buildReferenceIndex([
  response("recipeTemplates", dataFile("recipeTemplates")),
  response("worldRegions", dataFile("worldRegions")),
  response("creatureDefinitions", dataFile("creatureDefinitions")),
]);

describe("optionsFor", () => {
  it("lists the schema enums for skills and elements with labels and glyphs", () => {
    const skills = optionsFor("skill", index)!;
    expect(skills.map(option => option.value)).toEqual(expect.arrayContaining(["mining", "smithing", "cooking", "fletching", "magic"]));
    expect(skills.length).toBe(10);
    expect(skills.find(option => option.value === "smithing")).toMatchObject({ label: "Smithing", thumb: { kind: "glyph" } });
    expect(optionsFor("element", index)!.map(option => option.value)).toEqual(["wind", "water", "earth", "fire"]);
  });

  it("derives stations from the recipe templates' station lists", () => {
    const templates = dataFile("recipeTemplates") as { stations?: string[] }[];
    const expected = [...new Set(templates.flatMap(template => template.stations ?? []))];
    const stations = optionsFor("station", index)!;
    expect(stations.map(option => option.value)).toEqual(expected);
    expect(expected).toContain("furnace");
    expect(stations.find(option => option.value === "crafting_table")?.label).toBe("Crafting table");
  });

  it("derives locations and settlements from worldRegions, including dungeon locations", () => {
    const regions = dataFile("worldRegions") as { id: string; name: string; locations: { id: string; name: string }[]; dungeon?: { locations?: { id: string }[] }; settlements: { id: string; name: string }[] }[];
    const locations = optionsFor("location", index)!;
    const expectedCount = new Set(regions.flatMap(region => [...region.locations.map(location => location.id), ...(region.dungeon?.locations ?? []).map(location => location.id)])).size;
    expect(locations.length).toBe(expectedCount);
    const first = regions[0]!;
    expect(locations.find(option => option.value === first.locations[0]!.id)).toMatchObject({ label: `${first.locations[0]!.name} · ${first.name}`, thumb: { kind: "map" } });
    const dungeonLocation = regions.find(region => region.dungeon?.locations?.length)?.dungeon!.locations![0]!.id;
    expect(locations.some(option => option.value === dungeonLocation)).toBe(true);

    const settlements = optionsFor("settlement", index)!;
    expect(settlements.map(option => option.value)).toEqual(regions.flatMap(region => region.settlements.map(settlement => settlement.id)));
    expect(settlements[0]).toMatchObject({ label: "Millfield · " + first.name });
  });

  it("derives enemy families and world entities", () => {
    const families = optionsFor("enemyFamily", index)!;
    expect(families.map(option => option.value)).toEqual(expect.arrayContaining(["frog", "hen", "goat"]));
    expect(families.every((option, i) => i === 0 || families[i - 1]!.label.localeCompare(option.label) <= 0)).toBe(true);
    const entities = optionsFor("entity", index)!;
    expect(entities.some(option => option.value === "fallowmarch_north_gate")).toBe(true);
    expect(entities.some(option => option.value === "fallowmarch_air_altar_ruins")).toBe(true);
  });

  it("returns undefined for collection-backed and unknown kinds", () => {
    expect(optionsFor("item", index)).toBeUndefined();
    expect(optionsFor("lootTable", index)).toBeUndefined();
    expect(optionsFor("nonsense", index)).toBeUndefined();
    expect(isOptionKind("skill")).toBe(true);
    expect(isOptionKind("item")).toBe(false);
    expect(isOptionKind("nonsense")).toBe(false);
  });

  it("returns empty derived lists when the source collection is not loaded", () => {
    expect(optionsFor("station", buildReferenceIndex([]))).toEqual([]);
  });
});
