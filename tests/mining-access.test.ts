import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { miningAccessPositions, type MiningAssetMeasurements } from "../game/src/app/miningAccess.js";
import { PLAYER_RADIUS } from "../game/src/app/config.js";
import { WORLD_SITES, worldSitePoint, type WorldSite } from "../game/src/content/worldSites.js";
import { tierSilhouetteScale } from "../game/src/core/math.js";
import { buildWorld } from "../game/src/world/regionBuilder.js";

const manifest = JSON.parse(readFileSync(new URL("../game/public/assets/manifest.json", import.meta.url), "utf8")) as {
  assets: { id: string; size: { x: number; y: number; z: number }; base: { x: number; y: number; z: number } }[];
};
const models = new Map(manifest.assets.map((entry) => [entry.id, entry]));
const measurements: MiningAssetMeasurements = {
  assetSize: (id) => models.get(id)?.size ?? null,
  assetCenterXZ: (id) => {
    const model = models.get(id);
    return model ? { x: model.base.x + model.size.x / 2, z: model.base.z + model.size.z / 2 } : null;
  },
};

function singleMine(overrides: Partial<WorldSite> = {}): WorldSite {
  const source = WORLD_SITES.find((site) => site.id === "bracken_workings")!;
  return { ...source, centre: [0, 0], rotationY: 0,
    resourceSlots: [{ ...source.resourceSlots[0]!, x: 0, z: 0, yaw: 0, scale: 1 }], ...overrides };
}

describe("mining working positions", () => {
  it("clears the actual production mineral bounds and cylinders without moving resource entities", () => {
    const heightAt = (x: number, z: number) => x * 0.015 - z * 0.02;
    const access = miningAccessPositions(WORLD_SITES, heightAt, measurements);
    const world = buildWorld(12345, (_region, x, z) => heightAt(x, z), {
      heightAt: (_region, x, z) => heightAt(x, z), ...measurements,
      baseY: (id) => models.get(id)?.base.y ?? 0, accessPositions: access,
    });
    const byId = new Map(world.entities.map((entity) => [entity.id, entity]));
    const solids = new Map(world.solids.map((solid) => [solid.id, solid]));
    const expectedIds = WORLD_SITES.filter((site) => site.kind === "mine")
      .flatMap((site) => site.resourceSlots.map((slot) => `${slot.clusterId}_${slot.index}`));
    expect([...access.keys()].sort()).toEqual(expectedIds.sort());

    for (const site of WORLD_SITES.filter((candidate) => candidate.kind === "mine")) {
      for (const slot of site.resourceSlots) {
        const id = `${slot.clusterId}_${slot.index}`;
        const entity = byId.get(id)!;
        const stance = access.get(id)!;
        const view = entity.view!;
        const model = models.get(view.assetId)!;
        const drawnScale = view.scale! * tierSilhouetteScale(view.materialTier ?? entity.tier);
        const yaw = view.rotationY!;
        const dx = stance[0] - entity.position[0];
        const dz = stance[2] - entity.position[2];
        const ahead = dx * Math.sin(yaw) + dz * Math.cos(yaw);
        const sideways = dx * Math.cos(yaw) - dz * Math.sin(yaw);
        const sourceFront = (model.base.z + model.size.z) * drawnScale;
        const solid = solids.get(id)!;
        expect(solid.kind, id).toBe("cylinder");
        if (solid.kind !== "cylinder") throw new Error(`Missing ore cylinder ${id}`);
        expect(ahead - sourceFront, id).toBeGreaterThanOrEqual(0.70 - 1e-8);
        expect(ahead - sourceFront, id).toBeLessThan(1.05);
        expect(Math.hypot(dx, dz) - solid.radius, id).toBeGreaterThanOrEqual(PLAYER_RADIUS + 0.20 - 1e-8);
        expect(sideways, id).toBeCloseTo(0, 9);
        const source = worldSitePoint(site, slot.x, slot.z);
        expect(entity.position[0], id).toBe(source[0]);
        expect(entity.position[2], id).toBe(source[1]);
        expect(entity.interactionPosition, id).toEqual(stance);
        expect(stance[1], id).toBe(heightAt(stance[0], stance[2]));
      }
    }
  });

  it("rotates a stance with both the site and its individual mineral slot", () => {
    const source = singleMine();
    const slot = source.resourceSlots[0]!;
    const reference = miningAccessPositions([source], () => 2, measurements).values().next().value!;
    const rotation = 0.83;
    const yaw = -0.36;
    const site = singleMine({ centre: [17, -12], rotationY: rotation,
      resourceSlots: [{ ...slot, x: -4, z: 3, yaw }] });
    const stance = miningAccessPositions([site], () => 7, measurements).values().next().value!;
    const origin = worldSitePoint(site, -4, 3);
    expect(stance[0]).toBeCloseTo(origin[0] + reference[2] * Math.sin(rotation + yaw), 10);
    expect(stance[2]).toBeCloseTo(origin[1] + reference[2] * Math.cos(rotation + yaw), 10);
    expect(stance[1]).toBe(7);
  });

  it("uses measured source depth and off-centre bounds instead of a fixed pivot offset", () => {
    const site = singleMine();
    const ordinary = miningAccessPositions([site], () => 0, measurements).values().next().value!;
    const moved = miningAccessPositions([site], () => 0, {
      assetSize: () => ({ x: 2.6, y: 1.6, z: 1.5 }),
      assetCenterXZ: () => ({ x: 0.4, z: 0.2 }),
    }).values().next().value!;
    expect(ordinary[0]).toBeCloseTo(0);
    expect(moved[0]).toBeGreaterThan(0.3);
    expect(moved[2]).toBeGreaterThan(ordinary[2] + 0.3);
  });

  it("requires valid measurements and ground rather than guessing a reachable point", () => {
    const site = singleMine();
    expect(miningAccessPositions([], () => 0).size).toBe(0);
    expect(miningAccessPositions([{ ...site, kind: "grove" }], () => 0).size).toBe(0);
    expect(() => miningAccessPositions([site], () => 0)).toThrow(/measured resource bounds/);
    expect(() => miningAccessPositions([site], () => 0, { assetSize: () => null })).toThrow(/source bounds/);
    expect(() => miningAccessPositions([site], () => Number.NaN, measurements)).toThrow(/working ground/);
    expect(() => miningAccessPositions([site, site], () => 0, measurements)).toThrow(/Duplicate/);
    expect(() => miningAccessPositions([{ ...site, rotationY: Number.NaN }], () => 0, measurements)).toThrow(/site transform/);
    expect(() => miningAccessPositions([{ ...site, resourceSlots: [{ ...site.resourceSlots[0]!, scale: 0 }] }], () => 0, measurements))
      .toThrow(/invalid resource slot/);
  });
});
