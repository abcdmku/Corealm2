import { afterEach, describe, expect, it } from "vitest";
import type { SemanticEntity } from "../game/src/contracts.js";
import { CREATURE_CATALOG } from "../game/src/content/creatureRuntime.js";
import type { CreatureSpeciesDef } from "../game/src/content/creatureSpecies.js";
import { rollCreatureLook, type CreatureVariation } from "../game/src/content/creatureVariation.js";
import { WORLD_CONTENT } from "../game/src/content/worldData.js";
import { Rng } from "../game/src/core/rng.js";
import { buildEnemyGroup } from "../game/src/world/regionBuilder.js";

const ids = Array.from({ length: 400 }, (_, index) => `herd_${index}`);

describe("rollCreatureLook", () => {
  it("returns the plain scale and the definition's own skin without a variation range", () => {
    expect(rollCreatureLook({ scale: 2.2 }, "a")).toEqual({ scale: 2.2 });
    expect(rollCreatureLook({ scale: 1.3, skinId: "frog_moss" }, "a")).toEqual({ scale: 1.3, skinId: "frog_moss" });
  });

  it("is deterministic per entity id and differs between ids", () => {
    const variation: CreatureVariation = { scale: [0.8, 1.2], hue: 30, saturation: [0.7, 1.3], value: [0.8, 1.1] };
    for (const id of ids.slice(0, 20)) expect(rollCreatureLook({ scale: 2, variation }, id)).toEqual(rollCreatureLook({ scale: 2, variation }, id));
    expect(new Set(ids.map(id => rollCreatureLook({ scale: 2, variation }, id).scale)).size).toBeGreaterThan(300);
  });

  it("keeps every roll inside its range and spans it", () => {
    const variation: CreatureVariation = { scale: [0.8, 1.2], hue: 30, saturation: [0.7, 1.3], value: [0.8, 1.1] };
    const looks = ids.map(id => rollCreatureLook({ scale: 2, variation }, id));
    const scales = looks.map(look => look.scale), hues = looks.map(look => look.colour!.hue);
    const saturations = looks.map(look => look.colour!.saturation), values = looks.map(look => look.colour!.value);
    for (const [rolled, min, max] of [[scales, 1.6, 2.4], [hues, -30, 30], [saturations, .7, 1.3], [values, .8, 1.1]] as const) {
      expect(Math.min(...rolled)).toBeGreaterThanOrEqual(min);
      expect(Math.max(...rolled)).toBeLessThanOrEqual(max);
      // 400 uniform rolls cover at least 90% of the range.
      expect(Math.max(...rolled) - Math.min(...rolled)).toBeGreaterThan((max - min) * .9);
    }
  });

  it("rolls no colour for a size-only range, and each aspect from its own stream", () => {
    const size = rollCreatureLook({ scale: 1, variation: { scale: [0.5, 1.5] } }, "x");
    expect(size.colour).toBeUndefined();
    // Adding a colour spread or a skin pool never moves an individual's size.
    const full = rollCreatureLook({ scale: 1, variation: { scale: [0.5, 1.5], hue: 90, skins: [{ skinId: "b", weight: 1 }] } }, "x");
    expect(full.scale).toBe(size.scale);
  });

  it("picks skins by weight, with the definition's own look keeping baseWeight", () => {
    const variation: CreatureVariation = { skins: [{ skinId: "moss", weight: 1 }, { skinId: "ash", weight: 2 }], baseWeight: 1 };
    const counts = new Map<string, number>();
    for (const id of ids) {
      const skin = rollCreatureLook({ scale: 1, skinId: "own", variation }, id).skinId!;
      counts.set(skin, (counts.get(skin) ?? 0) + 1);
    }
    // Expected shares 1/4, 1/4, 1/2 of 400.
    expect(counts.get("own")).toBeGreaterThan(60);
    expect(counts.get("own")).toBeLessThan(140);
    expect(counts.get("moss")).toBeGreaterThan(60);
    expect(counts.get("moss")).toBeLessThan(140);
    expect(counts.get("ash")).toBeGreaterThan(150);
    expect(counts.get("ash")).toBeLessThan(250);
    const none = rollCreatureLook({ scale: 1, variation: { skins: [{ skinId: "moss", weight: 1 }], baseWeight: 0 } }, "y");
    expect(none.skinId).toBe("moss");
  });
});

describe("buildEnemyGroup creature looks", () => {
  const group = [...WORLD_CONTENT.groupsByRegion.values()].flat().find(row => row.id === "redsill_frogs")!;
  const creature = WORLD_CONTENT.creatureByGroup.get(group.id)!;
  const presentation = CREATURE_CATALOG.byCreatureId.get(creature.id)!.presentation as CreatureSpeciesDef & { variation?: CreatureVariation; skinId?: string };
  const original = { variation: presentation.variation, skinId: presentation.skinId };

  const build = (): SemanticEntity[] => {
    const out: SemanticEntity[] = [];
    buildEnemyGroup("fallowmarch", group, new Rng(7), (spot) => [spot[0], 0, spot[1]], out, () => ({ x: 1, y: 1, z: 1 }),
      { habitat: null, stats: creature.stats });
    return out;
  };

  afterEach(() => {
    if (original.variation === undefined) delete presentation.variation; else presentation.variation = original.variation;
    if (original.skinId === undefined) delete presentation.skinId; else presentation.skinId = original.skinId;
  });

  it("leaves a real definition without variation exactly as it was drawn", () => {
    expect(original.variation).toBeUndefined();
    expect(original.skinId).toBeUndefined();
    const entities = build();
    expect(entities).toHaveLength(group.count);
    for (const entity of entities) {
      expect(entity.view!.scale).toBe(group.scale);
      expect(entity.view!.skinId).toBeUndefined();
      expect(entity.view!.colour).toBeUndefined();
    }
  });

  it("writes each individual's rolled scale, skin and colour into its view", () => {
    const variation: CreatureVariation = { scale: [0.8, 1.25], hue: 40, value: [0.85, 1.1], skins: [{ skinId: "frog_moss", weight: 1 }] };
    presentation.variation = variation;
    const entities = build();
    for (const entity of entities) {
      const look = rollCreatureLook({ scale: group.scale, variation }, entity.id);
      expect(entity.view!.scale).toBe(look.scale);
      expect(entity.view!.skinId).toBe(look.skinId);
      expect(entity.view!.colour).toEqual(look.colour);
    }
    expect(new Set(entities.map(entity => entity.view!.scale)).size).toBe(entities.length);
    // Deterministic: a rebuild of the same ids draws the same individuals.
    expect(build().map(entity => entity.view)).toEqual(entities.map(entity => entity.view));
  });

  it("keeps the boss rank multiplier on top of the rolled scale", () => {
    presentation.variation = { scale: [0.9, 1.1] };
    const boss = { ...group, id: "variation_test_boss", count: 1, legacyCount: 1, boss: true };
    const out: SemanticEntity[] = [];
    buildEnemyGroup("fallowmarch", boss, new Rng(1), (spot) => [spot[0], 0, spot[1]], out, () => null, { habitat: null, stats: creature.stats });
    expect(out[0]!.view!.scale).toBe(rollCreatureLook({ scale: group.scale, variation: presentation.variation }, boss.id).scale * 1.6);
  });
});
