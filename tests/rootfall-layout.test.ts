/**
 * Oakwood (`rootfall`, Vellenwood): the plan the player walks, checked against the solids the real
 * world build emits for seed 1337.
 *
 *   z144 ##########LL#####   L Log Gate  Q Quarry Gate  C Cart Gate  W West Gate
 *        |wy S  back lane |  wy woodyard, S shed, lg Ansel's logs
 *   z137 |logs [CNT.HSE]lg Q  CNT.HSE Counting House (townhouse), p bank porch
 *        | H1  [ p p p ] yard wagon
 *   W====Oak Row==[ THE GREEN ]  well  [FORGE]
 *        | H2   (respawn @60,121.5)  cart[FORGE]
 *   z110 | H3 [TRADE ROW]  ==cart lane==C
 *        |      [smk] H4
 *   z102 ##################
 *
 * The respawn sits on open deck at the mouth of Oak Row. Every gate, service stand and door is
 * reachable from it along straight corridors wide enough for navigation clearance, and no two
 * roofs come within a metre of each other except the bank porch, which is built against the
 * Counting House on purpose.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SolidVolume, Vec3 } from "../game/src/contracts.js";
import { INTERACT_RANGE } from "../game/src/app/config.js";
import { REGIONS } from "../game/src/content/regions.js";
import { buildPrefab, roofOverhang, variantSeed } from "../game/src/render/buildings.js";
import { Solids } from "../game/src/systems/solids.js";
import { buildWorld } from "../game/src/world/regionBuilder.js";

const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8")) as {
  assets: { id: string; size: { x: number; y: number; z: number }; base: { x: number; y: number; z: number } }[];
};
const models = new Map(manifest.assets.map((asset) => [asset.id, asset]));
const flat = () => 0;
const world = buildWorld(1337, flat, {
  heightAt: flat, baseY: (id) => models.get(id)?.base.y ?? 0,
  assetSize: (id) => models.get(id)?.size ?? null,
  assetCenterXZ: (id) => {
    const asset = models.get(id);
    return asset ? { x: asset.base.x + asset.size.x / 2, z: asset.base.z + asset.size.z / 2 } : null;
  },
});
const solids = new Solids(world.solids);
const vellenwood = REGIONS.find((region) => region.id === "vellenwood")!;
const oakwood = vellenwood.settlements.find(town => town.id === "rootfall")!;
const hamlet = vellenwood.locations.find((location) => location.id === "rootfall_hamlet")!.position;
const CLEARANCE = 0.8;

function clearAt(x: number, z: number, label: string, radius = CLEARANCE): void {
  const position: Vec3 = [x, 0, z];
  const resolved = solids.resolve(position, position, radius);
  expect(Math.hypot(resolved[0] - x, resolved[2] - z), label).toBeLessThan(0.001);
}

function clearPath(points: readonly (readonly number[])[], label: string): void {
  for (let leg = 1; leg < points.length; leg++) {
    const a = points[leg - 1]!, b = points[leg]!;
    const count = Math.ceil(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) / 0.15);
    for (let step = 0; step <= count; step++) {
      const t = step / Math.max(1, count);
      clearAt(a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, `${label}, leg ${leg} at ${t.toFixed(2)}`);
    }
  }
}

/** Plan-view box around a building's roof, in world axes after its rotation. */
function roofBox(building: (typeof oakwood.buildings)[number]) {
  const overhang = roofOverhang(building.prefab, building.footprint, oakwood.kit);
  const halfX = building.footprint[0] / 2 + overhang.x, halfZ = building.footprint[1] / 2 + overhang.z;
  const quarter = Math.abs(Math.sin(building.rotationY)) > 0.5;
  const [hx, hz] = quarter ? [halfZ, halfX] : [halfX, halfZ];
  return { minX: building.position[0] - hx, maxX: building.position[0] + hx,
    minZ: building.position[1] - hz, maxZ: building.position[1] + hz };
}

const STANDS: Record<string, readonly [number, number]> = {
  rootfall_bank_chest: [60, 132],
  rootfall_cosmic: [55.5, 110.65],
  rootfall_crafting: [58.3, 110.6],
  rootfall_fletching: [60.5, 110.7],
  rootfall_anvil: [73.2, 122.4],
  rootfall_range: [64.2, 107],
  rootfall_smith: [71.15, 116.3],
};

describe("Oakwood layout", () => {
  it("has no stump left anywhere in the world", () => {
    expect(world.entities.filter((entity) => entity.id.startsWith("rootfall_stump"))).toEqual([]);
    expect(vellenwood.landmarks.map((landmark) => landmark.id)).not.toContain("rootfall_stump");
  });

  it("respawns on open deck at the mouth of Oak Row", () => {
    expect(hamlet).toEqual([60, 121.5]);
    clearAt(hamlet[0]!, hamlet[1]!, "respawn", 4.5);
  });

  it("walks from the respawn to all four gates and along the back lane", () => {
    clearPath([hamlet, [49, 124], [40, 124]], "West Gate");
    clearPath([hamlet, [68, 110], [84, 110]], "Cart Gate");
    clearPath([hamlet, [70, 133], [75, 138], [84, 138]], "Quarry Gate");
    clearPath([hamlet, [70, 133], [70, 139], [70, 148]], "Log Gate");
    clearPath([[70, 141], [52, 141]], "back lane");
    // Out of the Quarry Gate the Forest Quarry path runs straight; the Root Tunnel arch stands south of it.
    clearPath([[84, 138], [90, 142.2]], "Quarry Gate to the Forest Quarry");
  });

  it("stands every townsperson on open deck at least a metre from any solid", () => {
    expect(oakwood.npcs.map((npc) => npc.id).sort())
      .toEqual(["npc_seamer_juno", "npc_smith_corra", "npc_trapper_mott", "npc_woodward_ansel"]);
    for (const npc of oakwood.npcs) clearAt(npc.position[0], npc.position[1], npc.id, 1);
  });

  it("puts every service in reach of a clear stand the respawn can walk to", () => {
    const services = [oakwood.bank, ...oakwood.stations, ...oakwood.shops];
    expect(services.map((service) => service.id).sort()).toEqual(Object.keys(STANDS).sort());
    for (const service of services) {
      const stand = STANDS[service.id]!;
      expect(Math.hypot(service.position[0] - stand[0], service.position[1] - stand[1]), service.id)
        .toBeLessThanOrEqual(INTERACT_RANGE);
      // The smoke porch sits behind the Trade Row's east end, so its lane turns at the cart lane.
      clearPath(service.id === "rootfall_range" ? [hamlet, [65.6, 110], stand] : [hamlet, stand], service.id);
    }
  });

  it("keeps roofs a metre apart except the porch built against the Counting House", () => {
    const boxes = oakwood.buildings.map((building) => ({ id: building.id, ...roofBox(building) }));
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const left = boxes[a]!, right = boxes[b]!;
      const pair = [left.id, right.id].sort().join(" / ");
      if (pair === "rootfall_bank_porch / rootfall_counting_house") continue;
      const gap = Math.max(right.minX - left.maxX, left.minX - right.maxX, right.minZ - left.maxZ, left.minZ - right.maxZ);
      expect(gap, pair).toBeGreaterThanOrEqual(1);
    }
  });

  it("leaves the ground in front of every door clear", () => {
    const doored = oakwood.buildings.filter((building) =>
      building.prefab === "cottage" || building.prefab === "townhouse" || building.prefab === "shed");
    expect(doored).toHaveLength(6);
    for (const building of doored) {
      const door = buildPrefab(building.prefab, building.footprint, variantSeed(building.id), oakwood.kit)
        .find((part) => /^wall_\w+_door$/.test(part.assetId))!;
      const localX = door.dx, localZ = -building.footprint[1] / 2 - 1.2;
      const c = Math.cos(building.rotationY), s = Math.sin(building.rotationY);
      clearAt(building.position[0] + localX * c + localZ * s, building.position[1] - localX * s + localZ * c,
        `${building.id} doorstep`);
    }
  });

  it("stands the log piles on the ground as obstacles, not at roof_log's buried pivot", () => {
    for (const [x, z] of [[65.2, 138], [54.5, 136.5]] as const) {
      const resolved = solids.resolve([x, 0, z], [x, 0, z], 0.35);
      expect(Math.hypot(resolved[0] - x, resolved[2] - z), `logs at ${x},${z}`).toBeGreaterThan(0.1);
    }
  });

  it("keeps every settlement solid inside the palisade", () => {
    const inside = (solid: SolidVolume) => solid.position[0] > 44 && solid.position[0] < 80
      && solid.position[2] > 102 && solid.position[2] < 144;
    const owned = world.solids.filter((solid) => solid.id.startsWith("rootfall_") && !solid.id.includes("wall")
      && !solid.id.includes("gate") && !solid.id.includes("postern"));
    expect(owned.length).toBeGreaterThan(20);
    for (const solid of owned) expect(inside(solid), solid.id).toBe(true);
  });
});
