import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_COLLECTIONS } from "../game/src/content/compiler/collections.js";
import { NON_BAKE_CONTENT_FILES, worldGeometryView } from "../tools/lib/bake-inputs.js";
import { generationInputs } from "../tools/lib/generation-revision.js";
import { gameRoot } from "../tools/lib/paths.js";
import { compileContent, readContentSources } from "../tools/content/compile.js";

/** Every value the navigation fingerprint and the generation revision may leave out. */
type Row = Record<string, unknown>;

async function compiled(edit?: (values: Map<string, unknown>) => void) {
  const values = new Map(await readContentSources());
  edit?.(values);
  const build = compileContent(values);
  expect(build.diagnostics.filter(issue => issue.severity === "error")).toEqual([]);
  const world = (build.tables as Row).world;
  return { whole: JSON.stringify(world), geometry: JSON.stringify(worldGeometryView(world)) };
}

function scaleEvery(node: unknown, key: string, by: number): number {
  let changed = 0;
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    for (const [name, held] of Object.entries(value as Row)) {
      if (name === key && typeof held === "number" && held > 0) { (value as Row)[name] = held * by; changed++; }
      else walk(held);
    }
  };
  walk(node);
  return changed;
}

/**
 * The pins on the baked world used to be coarser than the bake, so one exported loot drop failed
 * three artifact tests. These recompile the catalog with real edits and check the narrowing both
 * ways: loot must not move the hashed view, and geometry must.
 */
describe("bake inputs", () => {
  it("leaves the navigation geometry view untouched by a loot edit that does move the world table", async () => {
    const before = await compiled();
    const after = await compiled(values => {
      expect(scaleEvery(values.get("lootTables"), "chance", 0.5)).toBeGreaterThan(50);
    });
    expect(after.whole).not.toBe(before.whole);
    expect(after.geometry).toBe(before.geometry);
  }, 120_000);

  it("moves the navigation geometry view when a placement moves", async () => {
    const before = await compiled();
    const after = await compiled(values => {
      const placements = values.get("placements") as { centre: number[] }[];
      placements[0]!.centre[0]! += 1;
    });
    expect(after.geometry).not.toBe(before.geometry);
  }, 120_000);

  it("keeps no loot plan in the geometry view", async () => {
    const { geometry } = await compiled();
    for (const needle of ['"lootRolls"', '"itemId"', '"chance"', '"drops"']) expect(geometry).not.toContain(needle);
  }, 120_000);

  it("names content files that exist and that the generation revision then skips", () => {
    const files = CONTENT_COLLECTIONS.map(spec => `content/${spec.file}`);
    expect(NON_BAKE_CONTENT_FILES.filter(file => !files.includes(file))).toEqual([]);
    const hashed = new Set(generationInputs(gameRoot).map(file => path.resolve(file)));
    expect(NON_BAKE_CONTENT_FILES.filter(file => hashed.has(path.resolve(gameRoot, file)))).toEqual([]);
    // Everything else still pins the bake, including `items`: retiring one filters resource yields.
    expect(files.filter(file => !NON_BAKE_CONTENT_FILES.includes(file as never))
      .filter(file => !hashed.has(path.resolve(gameRoot, file)))).toEqual([]);
  });
});
