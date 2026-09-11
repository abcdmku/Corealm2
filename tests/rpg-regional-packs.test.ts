import { describe, expect, it } from "vitest";
import { REGIONAL_PACKS } from "../game/src/content/regionalPacks.js";
import { RPG_BESTIARY } from "../game/src/content/rpgBestiary.js";
import { CREATURE_SPECIES } from "../game/src/content/creatureSpecies.js";
import { STARTER_CREATURES } from "../game/src/content/starterCreatures.js";
import { createRpgRegionalPackCatalogue, RPG_REGIONAL_PACK_PLAN, regionalPackReplacements, RPG_ACCEPTED_SOURCE_PACK_ASSIGNMENTS } from "../game/src/content/rpgRegionalPacks.js";
import { assembleRegionalPackFixture } from "../game/src/featureLab/regionalPacks.js";
import { enemyCombatLevel } from "../game/src/content/index.js";
import MANIFEST from "../game/public/assets/manifest.json";
import { REGIONAL_PACK_LAYOUT } from "../game/src/content/regionalPackLayout.js";
import { encounterPopulationCount } from "../game/src/content/encounterPopulation.js";

// A controlled measured fixture model. Real candidate dimensions must pass this same factory
// separately; these tests do not establish that any art fits the authored world.
const measured = { size: { x: 0.8, y: 1.8, z: 0.8 }, base: { x: -0.4, y: 0, z: -0.4 } };
const assets = new Map(MANIFEST.assets.map(asset => [asset.id, asset]));
const measure = (assetId: string) => assets.get(assetId) ?? null;

describe("RPG regional encounter candidate catalogue", () => {
  it("varies regional inhabitants and preserves every member ID while filling packs to 7-15", () => {
    const catalogue = createRpgRegionalPackCatalogue(measure);
    expect(catalogue.packs).toHaveLength(96);
    const assignedIds = new Set(RPG_REGIONAL_PACK_PLAN.flatMap(row => row.speciesId ? [row.speciesId] : []));
    expect(assignedIds.size).toBeGreaterThan(30);
    expect(assignedIds.has("webweaver_spider")).toBe(true);
    expect(assignedIds.has("marsh_wasp")).toBe(true);
    for (const id of assignedIds) expect([...RPG_BESTIARY, ...CREATURE_SPECIES].some(species => species.id === id)).toBe(true);
    for (const species of RPG_BESTIARY.filter(row => assignedIds.has(row.id))) {
      expect(catalogue.packs.some((pack) => pack.speciesId === species.id && pack.regionId === species.regionId), species.id).toBe(true);
    }
    for (const regionId of ["fallowmarch", "vellenwood", "karrowmoor", "kilnhalt"]) {
      const packs = catalogue.packs.filter((pack) => pack.regionId === regionId);
      expect(packs).toHaveLength(24);
      expect(new Set(packs.map(pack => pack.speciesId)).size).toBeGreaterThanOrEqual(8);
    }
    for (const pack of catalogue.packs) {
      const original = REGIONAL_PACKS.find(row => row.id === pack.id)!;
      expect(pack.members.slice(0, original.members.length).map(row => row.id)).toEqual(original.members.map(row => row.id));
      expect(pack.members).toHaveLength(encounterPopulationCount({ id: original.id, count: original.members.length }));
      expect(pack.members.length).toBeGreaterThanOrEqual(7);
      expect(pack.members.length).toBeLessThanOrEqual(15);
      expect(pack.radius).toBeGreaterThanOrEqual(original.radius);
    }
    const starter = catalogue.packs.filter(pack => pack.regionId === "fallowmarch");
    expect(starter.filter(pack => pack.speciesId.startsWith("goblin_"))).toHaveLength(3);
    expect(starter.filter(pack => STARTER_CREATURES.some(row => row.id === pack.speciesId))).toHaveLength(16);
    expect(catalogue.packs.map((pack) => [pack.id, pack.centre]))
      .toEqual(REGIONAL_PACKS.map((pack) => [pack.id, pack.centre]));
  });
  it("constructs candidate packs through production entities and translated lab habitats", () => {
    const catalogue = createRpgRegionalPackCatalogue(measure);
    const first = catalogue.packs[0]!;
    const fixture = assembleRegionalPackFixture(first.id, {
      heightAt: () => 0, baseY: id => measure(id)?.base.y ?? NaN, assetSize: id => measure(id)?.size ?? null,
    }, catalogue);
    const stats = new Map(catalogue.variants.map((row) => [row.id, row.stats]));
    expect(fixture.entities).toHaveLength(7);
    expect(fixture.habitat.centre).toEqual([-72, 30]);
    for (const entity of fixture.entities) {
      const def = stats.get(String(entity.meta?.enemyDefId))!;
      expect(entity.name).toBe("Goblin Archer");
      expect(entity.view?.assetId).toBe("creature_goblin_archer");
      expect(entity.combat?.level).toBe(enemyCombatLevel(def));
      expect(entity.combat?.health).toBe(def.maxHealth);
      expect(entity.meta?.groupId).toBe(first.id);
    }
  });
  it("fails missing real measurements and formations whose bodies cannot fit", () => {
    expect(() => createRpgRegionalPackCatalogue(() => null)).toThrow("requires measured model");
    const id = RPG_REGIONAL_PACK_PLAN[0]!.packId;
    expect(() => createRpgRegionalPackCatalogue(assetId => assetId === "creature_goblin_archer"
      ? { ...measured, size: { x: 100, y: 2, z: 100 } } : measure(assetId), [id]))
      .toThrow(/exceeds habitat/);
  });
  it("isolates one candidate pack without requiring unrelated model downloads", () => {
    const id = RPG_REGIONAL_PACK_PLAN[0]!.packId;
    const needed = new Set(["creature_goblin_archer", ...REGIONAL_PACK_LAYOUT[id]!.dressing.map(piece => piece.assetId)]);
    const requested = new Set<string>();
    const catalogue = createRpgRegionalPackCatalogue((assetId) => {
      requested.add(assetId);
      return needed.has(assetId) ? measure(assetId) : null;
    }, [id]);
    expect(catalogue.packs).toHaveLength(1);
    expect(catalogue.groups).toHaveLength(1);
    expect(catalogue.variants).toHaveLength(3);
    expect(requested).toEqual(needed);
    expect(() => createRpgRegionalPackCatalogue(measure, ["missing"])).toThrow("Unknown RPG");
  });
  it("replaces occupants without moving saved pockets or their dressing", () => {
    const id = RPG_REGIONAL_PACK_PLAN[0]!.packId;
    const before = createRpgRegionalPackCatalogue(measure, [id]);
    const overrides = regionalPackReplacements({ goblin_archer: "goblin_shaman" });
    const after = createRpgRegionalPackCatalogue(measure, [id], overrides);
    expect(after.packs[0]!.speciesId).toBe("goblin_shaman");
    expect(after.packs[0]!.centre).toEqual(before.packs[0]!.centre);
    expect(after.packs[0]!.radius).toBe(before.packs[0]!.radius);
    expect(after.packs[0]!.members.map(member => member.id)).toEqual(before.packs[0]!.members.map(member => member.id));
    expect(after.habitats[0]!.dressing).toEqual(before.habitats[0]!.dressing);
    expect(() => regionalPackReplacements({ removed_unknown: "goblin_scout" })).toThrow("Unknown staged species");
    expect(() => createRpgRegionalPackCatalogue(measure, [id], { [id]: "stone_golem" })).toThrow("Invalid RPG pack species");
    expect(() => createRpgRegionalPackCatalogue(measure, [id], { missing: "goblin_scout" })).toThrow("Unknown RPG regional pack assignment");
  });

  it("binds seven promoted-body pockets and keeps Fire's stable stats on the accepted Lava asset", () => {
    const catalogue = createRpgRegionalPackCatalogue(measure);
    expect(Object.keys(RPG_ACCEPTED_SOURCE_PACK_ASSIGNMENTS)).toHaveLength(7);
    for (const [id, proposal] of Object.entries(RPG_ACCEPTED_SOURCE_PACK_ASSIGNMENTS)) {
      const pack = catalogue.packs.find(row => row.id === id)!;
      expect(pack.speciesId).toBe(proposal.speciesId);
      for (const member of pack.members) {
        const stats = catalogue.variants.find(row => row.id === member.variantId)!.stats;
        expect(enemyCombatLevel(stats)).toBeGreaterThanOrEqual(pack.levelRange[0]);
        expect(enemyCombatLevel(stats)).toBeLessThanOrEqual(pack.levelRange[1]);
      }
    }
    const fire = catalogue.packs.filter(pack => pack.speciesId === "fire_golem");
    expect(fire).toHaveLength(2);
    for (const pack of fire) {
      expect(pack.assetId).toBe("creature_lava_golem");
      expect(pack.baseEnemyDefId).toBe("fire_golem_t20");
    }
  });

});
