import { describe, expect, it } from "vitest";
import { geometryContentHash } from "../game/src/world/geometryContent.js";
import { compileContent, readContentSources } from "../tools/content/compile.js";

type Row = Record<string, any>;

/** The geometry hash of the repo's content, recompiled with `edit` applied to its sources. */
async function hashOf(edit?: (sources: Map<string, any>) => void): Promise<string> {
  const sources = new Map(await readContentSources());
  edit?.(sources);
  const build = compileContent(sources);
  expect(build.diagnostics.filter(issue => issue.severity === "error")).toEqual([]);
  return geometryContentHash(build.tables as Record<string, unknown>);
}

/**
 * A publish bakes a world only when its geometry hash moves. These recompile the real catalog with
 * real edits: what players only read or fight (drops, names, numbers) must not move it, and what
 * shapes terrain, navigation or placement must.
 */
describe("server world geometry hash", () => {
  let base: string;
  it("is stable across compiles of the same content", async () => {
    base = await hashOf();
    expect(await hashOf()).toBe(base);
    expect(base).toMatch(/^[a-f0-9]{64}$/);
  }, 120_000);

  it.each<[string, (sources: Map<string, any>) => void]>([
    ["a loot drop chance", sources => { for (const table of sources.get("lootTables") as Row[]) for (const roll of table.rolls ?? []) for (const drop of roll.drops ?? []) drop.chance /= 2; }],
    ["a creature's drops and name", sources => { const frog = (sources.get("creatureDefinitions") as Row[]).find(row => row.id === "frog_t1")!; frog.name = "Marsh Frog"; frog.loot.rolls[0].drops[0].chance = 0.5; }],
    ["a creature's combat numbers", sources => { const frog = (sources.get("creatureDefinitions") as Row[]).find(row => row.id === "frog_t1")!; frog.adjustments.aggroRadius = 9; frog.adjustments.attackSpeedMs = 1800; }],
    ["an item's name and value", sources => { const item = (sources.get("items") as Row[])[0]!; item.name = `${item.name} (renamed)`; item.value = (item.value ?? 0) + 7; }],
    ["a resource's yield and respawn", sources => { const resource = (sources.get("resources") as Row[])[0]!; resource.respawnSeconds += 5; resource.yieldRange = [1, 2]; }],
    ["a region's name and lore", sources => { const region = (sources.get("worldRegions") as Row[])[0]!; region.name = "Renamed"; region.lore = "Other words."; }],
  ])("stays put for %s", async (_name, edit) => {
    expect(await hashOf(edit)).toBe(base);
  }, 120_000);

  it.each<[string, (sources: Map<string, any>) => void]>([
    ["the sea level", sources => { (sources.get("worldTerrain") as Row[])[0]!.coast.seaLevel -= 0.25; }],
    ["a creature placement", sources => { (sources.get("placements") as Row[])[0]!.centre[0] += 1; }],
    ["a resource placement", sources => { (sources.get("resourcePlacements") as Row[])[0]!.centre[0] += 1; }],
    ["a region's ground height", sources => { (sources.get("worldRegions") as Row[])[0]!.baseHeight += 0.5; }],
    ["a resource's model", sources => { (sources.get("resources") as Row[])[0]!.presentation.targetWorldSize *= 1.5; }],
    ["a placed creature's size", sources => { const placement = (sources.get("placements") as Row[])[0]!; placement.scaleMultiplier = (placement.scaleMultiplier ?? 1) * 1.5; }],
  ])("moves for %s", async (_name, edit) => {
    expect(await hashOf(edit)).not.toBe(base);
  }, 120_000);
});
