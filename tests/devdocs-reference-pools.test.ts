import * as fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readDevdocsReferencePools } from "../devdocs/server/lib/referencePools.js";
import { content } from "../game/src/content/index.js";
import { ALL_PROCEDURAL_GEAR_ASSETS } from "../game/src/render/proceduralGear.js";
import { TRAVERSAL_CONTACTS } from "../game/src/systems/traversalContacts.js";
import { gameRoot } from "../tools/lib/paths.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile), readdir: vi.fn(actual.readdir) };
});
afterEach(() => { vi.clearAllMocks(); });

describe("devdocs production reference pools", () => {
  it("builds production world IDs without registering mutable content and includes procedural/audio assets", async () => {
    const register = vi.spyOn(content, "register");
    try {
      const pools = await readDevdocsReferencePools();
      expect(register).not.toHaveBeenCalled();
      expect(pools.entity!.size).toBeGreaterThan(10000);
      expect(pools.location!.has("bracken_pit")).toBe(true);
      expect(pools.region!.has("gravelmaw")).toBe(true);
      expect(pools.settlement!.size).toBeGreaterThan(0);
      expect(pools.enemy!.size).toBeGreaterThan(400);
      expect(pools.enemyFamily!.size).toBeGreaterThan(100);
      expect(pools.species!.size).toBeGreaterThan(200);
      expect(pools.resourceCluster!.has("bracken_pit_grithe")).toBe(true);
      for (const kind of ["furnace", "anvil", "range", "campfire", "crafting_table", "fletching_bench", "essence_altar"]) expect(pools.station!.has(kind), kind).toBe(true);
      for (const asset of ALL_PROCEDURAL_GEAR_ASSETS) expect(pools.asset!.has(asset.assetId)).toBe(true);
      for (const asset of Object.values(TRAVERSAL_CONTACTS)) expect(pools.asset!.has(asset.assetId)).toBe(true);
      expect([...pools.asset!].some(id => id.startsWith("audio/") && id.endsWith(".ogg"))).toBe(true);
      for (const mutable of ["item", "recipe", "resource", "npc", "shop", "quest", "dialogue", "spell", "rune", "set", "campfireFuel"] as const) expect(pools[mutable]).toBeUndefined();
    } finally { register.mockRestore(); }
  });

  it("rereads a newly promoted manifest on the next call and does not expose shared cached sets", async () => {
    const text = await fs.readFile(path.join(gameRoot, "public", "assets", "manifest.json"), "utf8");
    const manifest = JSON.parse(text);
    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({ ...manifest, assets: [...manifest.assets, { ...manifest.assets[0], id: "test-newly-promoted-asset" }] }));
    const promoted = await readDevdocsReferencePools();
    expect(promoted.asset!.has("test-newly-promoted-asset")).toBe(true);
    const original = await readDevdocsReferencePools();
    expect(original.asset!.has("test-newly-promoted-asset")).toBe(false);
    expect(original.entity).not.toBe(promoted.entity);
    expect([...original.entity!]).toEqual([...promoted.entity!]);
    expect(vi.mocked(fs.readdir).mock.calls.filter(([directory]) => String(directory) === path.join(gameRoot, "public", "audio"))).toHaveLength(2);
  });
});
