import { describe, expect, it, vi } from "vitest";
import { SKILL_IDS, type SemanticEntity, type SkillId } from "../game/src/contracts.js";
import { EntityStore } from "../game/src/world/entities.js";

describe("visual observation without pathfinding", () => {
  const entity = (id: string, x: number): SemanticEntity => ({
    id, name: id, archetype: "npc", tier: 1, regionId: "fallowmarch", position: [x, 0, 0],
    state: "idle", interactions: ["inspect", "talk"],
  });
  function fixture() {
    const path = vi.fn((_from, to) => to[0] === 10 ? 80 : 30);
    const discovered = new Set(["near-place", "far-place"]);
    const store = new EntityStore({ distanceFn: path, discoveredLocationIds: () => discovered,
      skillLevels: () => Object.fromEntries(SKILL_IDS.map(id => [id, 1])) as Record<SkillId, number> });
    store.load([entity("near", 10), entity("far", 20), entity("undiscovered", 5)]);
    store.registerLocations([
      { id: "near-place", name: "Near", regionId: "fallowmarch", position: [10, 0, 0], entityId: "near" },
      { id: "far-place", name: "Far", regionId: "fallowmarch", position: [20, 0, 0], entityId: "far" },
      { id: "hidden-place", name: "Hidden", regionId: "fallowmarch", position: [5, 0, 0], entityId: "undiscovered" },
    ]);
    return { store, path };
  }
  it("keeps default route distances, radius and ordering for agent/navigation queries", () => {
    const { store, path } = fixture();
    expect(store.observe({ radius: 40 }, [0, 0, 0]).map(row => row.id)).not.toContain("near");
    expect(store.observe({ scope: "known" }, [0, 0, 0]).map(row => [row.id, row.distance]))
      .toEqual([["far", 30], ["near", 80]]);
    expect(path).toHaveBeenCalled();
  });
  it("uses working positions, filtering and limits without any route queries for markers", () => {
    const { store, path } = fixture();
    store.get("near")!.interactionPosition = [3, 4, 0];
    const visible = store.observe({ distanceMetric: "straight-line", radius: 15, limit: 1, interaction: "talk" }, [0, 0, 0]);
    expect(visible[0]).toMatchObject({ id: "near", distance: 5 });
    expect(store.observe({ scope: "known", distanceMetric: "straight-line" }, [0, 0, 0])
      .map(row => [row.id, row.distance])).toEqual([["near", 5], ["far", 20]]);
    expect(store.observe({ scope: "known", distanceMetric: "straight-line", regionId: "gloamgarden" }, [0, 0, 0])).toEqual([]);
    expect(path).not.toHaveBeenCalled();
  });
});
