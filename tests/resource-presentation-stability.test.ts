import { describe, expect, it, vi } from "vitest";
import { REGIONS } from "../game/src/content/regions.js";
import * as worldSites from "../game/src/content/worldSites.js";
import { buildWorld, type BuiltWorld } from "../game/src/world/regionBuilder.js";

const SEED = 12_345;
const FLAT_GROUND = (): number => 0;

function resourceEntities(world: BuiltWorld) {
  return world.entities.filter((entity) => entity.resource);
}

function gatheringState(world: BuiltWorld) {
  return resourceEntities(world).map((entity) => ({
    id: entity.id, resource: entity.resource, requirements: entity.requirements,
    interactions: entity.interactions, state: entity.state,
  }));
}

describe("resource presentation stability", () => {
  it("retains every declared resource ID and its initial yield state in deterministic replay", () => {
    const first = resourceEntities(buildWorld(SEED, FLAT_GROUND));
    const replay = resourceEntities(buildWorld(SEED, FLAT_GROUND));
    const expectedIds = REGIONS.flatMap((region) => region.clusters.flatMap((cluster) =>
      Array.from({ length: cluster.count }, (_, index) => `${cluster.id}_${index + 1}`)));

    expect(first.map((entity) => entity.id).sort()).toEqual(expectedIds.sort());
    expect(replay).toEqual(first);
    for (const entity of first) {
      expect(entity.resource!.remaining, entity.id).toBe(entity.resource!.maxYields);
      expect(entity.resource!.maxYields, entity.id).toBeGreaterThan(0);
    }
  });

  it("builds resource positions and facing from authored slots independently of the world seed", () => {
    const first = new Map(resourceEntities(buildWorld(SEED, FLAT_GROUND)).map((entity) => [entity.id, entity]));
    const otherSeed = new Map(resourceEntities(buildWorld(SEED + 1, FLAT_GROUND)).map((entity) => [entity.id, entity]));
    for (const site of worldSites.WORLD_SITES) {
      for (const slot of site.resourceSlots) {
        const id = `${slot.clusterId}_${slot.index}`;
        const entity = first.get(id)!;
        const other = otherSeed.get(id)!;
        expect(entity, id).toBeDefined();
        const [x, z] = worldSites.worldSitePoint(site, slot.x, slot.z);
        expect(entity.position[0], id).toBeCloseTo(x, 2);
        expect(entity.position[2], id).toBeCloseTo(z, 2);
        expect(entity.view!.rotationY, id).toBeCloseTo(site.rotationY + slot.yaw, 10);
        expect(entity.meta?.worldSiteId, id).toBe(site.id);
        expect(other.position, id).toEqual(entity.position);
        expect(other.view!.rotationY, id).toBe(entity.view!.rotationY);
      }
    }
    expect([...otherSeed.values()].map((entity) => entity.resource!.maxYields))
      .not.toEqual([...first.values()].map((entity) => entity.resource!.maxYields));
  });

  it("lets an art edit move and turn a site without rerolling resources or disturbing other nodes", () => {
    const baseline = buildWorld(SEED, FLAT_GROUND);
    const originalLookup = worldSites.worldSiteResourceSlot;
    const lookup = vi.spyOn(worldSites, "worldSiteResourceSlot").mockImplementation((clusterId, index) => {
      const authored = originalLookup(clusterId, index);
      if (!authored) return null;
      return {
        site: { ...authored.site, centre: [authored.site.centre[0] + 11, authored.site.centre[1] - 7],
          rotationY: authored.site.rotationY + 0.7 },
        slot: { ...authored.slot, yaw: authored.slot.yaw + 0.2, scale: authored.slot.scale * 1.1 },
      };
    });
    try {
      const edited = buildWorld(SEED, FLAT_GROUND);
      expect(gatheringState(edited)).toEqual(gatheringState(baseline));
      const originalEntities = new Map(resourceEntities(baseline).map((entity) => [entity.id, entity]));
      for (const entity of resourceEntities(edited)) {
        const original = originalEntities.get(entity.id)!;
        if (entity.meta?.worldSiteId) {
          expect(entity.position, entity.id).not.toEqual(original.position);
          expect(entity.view!.rotationY! - original.view!.rotationY!, entity.id).toBeCloseTo(0.9, 10);
          expect(entity.view!.scale! / original.view!.scale!, entity.id).toBeCloseTo(1.1, 10);
        } else {
          expect(entity, entity.id).toEqual(original);
        }
      }
    } finally {
      lookup.mockRestore();
    }
  });
});
