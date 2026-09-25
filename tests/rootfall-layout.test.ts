/**
 * Oakwood (`rootfall`, Vellenwood): the plan the player walks, checked against the solids the real
 * world build emits for seed 1337.
 *
 *   z144 ##########LL#####   L Log Gate  Q Quarry Gate  C Cart Gate  W West Gate
 *        | S  back lane  lg |  S drying shed, wy woodyard logs, lg Ansel's logs
 *   z137 |H1 wy [CNT.HSE] H4 Q  H1 Gatewarden's, H4 Woodward's House, CNT.HSE Counting House
 *        |      [ p p p ]  yard  p bank porch (brick), yard the Quarry Gate approach
 *   W====Oak Row==[ THE GREEN ]  [FORGE]  the Green: cobble with kerbs, the well at its middle
 *        |   (respawn @60,121.5) smith[FORGE]  forge yard (brick)
 *   z110 | smk [TRADE ROW] ==cart lane==C  trade row (brick): bench, Juno's stall, rack
 *        | smk              [carter's]  smk Mott's smokehouse, carter's shelter by the Cart Gate
 *   z102 ##################
 *
 * The respawn sits on open cobble at the mouth of Oak Row. Every gate, service stand and door is
 * reachable from it along straight corridors wide enough for navigation clearance, and no two
 * roofs come within a metre of each other except the bank porch, which is built against the
 * Counting House on purpose. Houses stand in the corners, out of reach of the default camera arm at
 * every stand, so the camera never has to cut a neighbour open while a player is trading.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SolidVolume, Vec3 } from "../game/src/contracts.js";
import { CAMERA, INTERACT_RANGE } from "../game/src/app/config.js";
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
  rootfall_cosmic: [58.4, 110.65],
  rootfall_crafting: [54.8, 110.6],
  rootfall_fletching: [63.6, 110.7],
  rootfall_anvil: [71.15, 122.4],
  rootfall_range: [49.2, 107],
  rootfall_smith: [71.6, 116.3],
};

/** Drawn building parts in plan and height, as oriented boxes of their manifest bounds. */
const parts = world.entities.flatMap((entity) => {
  const buildingId = entity.meta?.buildingId;
  const asset = entity.view ? models.get(entity.view.assetId) : undefined;
  if (typeof buildingId !== "string" || !buildingId.startsWith("rootfall_") || !asset) return [];
  const scale = entity.view!.scale ?? 1, axes = entity.view!.scaleAxes ?? [1, 1, 1];
  const low = [asset.base.x * scale * axes[0], asset.base.y * scale * axes[1], asset.base.z * scale * axes[2]];
  const high = [(asset.base.x + asset.size.x) * scale * axes[0], (asset.base.y + asset.size.y) * scale * axes[1],
    (asset.base.z + asset.size.z) * scale * axes[2]];
  const rotation = entity.view!.rotationY ?? 0;
  return [{ buildingId, position: entity.position, cos: Math.cos(rotation), sin: Math.sin(rotation), low, high }];
});

/** Buildings the default follow arm passes through at any of 72 yaws around a stand. */
function armBlockers(x: number, z: number): string[] {
  const reach = Math.cos(CAMERA.defaultPitch) * CAMERA.defaultDistance;
  const rise = Math.sin(CAMERA.defaultPitch) * CAMERA.defaultDistance;
  const blockers = new Set<string>();
  for (let step = 0; step < 72; step++) {
    const yaw = step * Math.PI / 36;
    const head = [x, 1.1, z], seat = [x + Math.sin(yaw) * reach, 1.1 + rise, z + Math.cos(yaw) * reach];
    for (const part of parts) {
      // The segment in the part's own frame, clipped against its box one axis at a time.
      const local = (point: number[]) => {
        const dx = point[0]! - part.position[0], dz = point[2]! - part.position[2];
        return [part.cos * dx - part.sin * dz, point[1]! - part.position[1], part.sin * dx + part.cos * dz];
      };
      const from = local(head), to = local(seat);
      let enter = 0, exit = 1;
      for (let axis = 0; axis < 3 && enter <= exit; axis++) {
        const delta = to[axis]! - from[axis]!;
        if (Math.abs(delta) < 1e-9) {
          if (from[axis]! < part.low[axis]! || from[axis]! > part.high[axis]!) exit = -1;
          continue;
        }
        const a = (part.low[axis]! - from[axis]!) / delta, b = (part.high[axis]! - from[axis]!) / delta;
        enter = Math.max(enter, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
      }
      if (enter <= exit) blockers.add(part.buildingId);
    }
  }
  return [...blockers].sort();
}

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
    clearPath([hamlet, [62, 128], [77, 131], [76.8, 138], [84, 138]], "Quarry Gate");
    clearPath([hamlet, [62, 128], [70, 133], [70, 139], [70, 148]], "Log Gate");
    clearPath([[70, 141], [53, 141]], "back lane");
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
      clearPath([hamlet, stand], service.id);
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
    expect(doored).toHaveLength(4);
    for (const building of doored) {
      const door = buildPrefab(building.prefab, building.footprint, variantSeed(building.id), oakwood.kit)
        .find((part) => /^wall_\w+_door$/.test(part.assetId))!;
      const localX = door.dx, localZ = -building.footprint[1] / 2 - 1.2;
      const c = Math.cos(building.rotationY), s = Math.sin(building.rotationY);
      clearAt(building.position[0] + localX * c + localZ * s, building.position[1] - localX * s + localZ * c,
        `${building.id} doorstep`);
    }
  });

  it("keeps every neighbour out of the default camera arm at the respawn and at every stand", () => {
    // A gatehouse cannot move off its wall, so the cutaway opens it (tests/gatehouse-cutaway.test.ts).
    const gatehouses = new Set(oakwood.buildings.filter((building) => building.prefab === "gatehouse").map((building) => building.id));
    expect(armBlockers(hamlet[0]!, hamlet[1]!)).toEqual([]);
    const services = [oakwood.bank, ...oakwood.stations, ...oakwood.shops];
    const hosts: Record<string, string[]> = {};
    for (const service of services) {
      const stand = STANDS[service.id]!;
      hosts[service.id] = armBlockers(stand[0], stand[1]).filter((id) => !gatehouses.has(id));
    }
    expect(hosts).toEqual({
      rootfall_bank_chest: ["rootfall_bank_porch", "rootfall_counting_house"],
      rootfall_range: ["rootfall_smokehouse"],
      rootfall_anvil: ["rootfall_forge"],
      rootfall_crafting: [],
      rootfall_fletching: [],
      rootfall_smith: ["rootfall_forge"],
      rootfall_cosmic: [],
    });
    // Each of those is the service's own structure, or the Counting House its porch is built on.
    for (const service of services) for (const id of hosts[service.id]!) {
      expect([service.attachedTo, "rootfall_counting_house"], service.id).toContain(id);
    }
  });

  it("stands the keepers beside their stalls, back from the counter line", () => {
    for (const [keeper, stallId] of [["npc_seamer_juno", "rootfall_cosmic"], ["npc_smith_corra", "rootfall_smith"]] as const) {
      const npc = oakwood.npcs.find((candidate) => candidate.id === keeper)!;
      const stall = oakwood.shops.find((shop) => shop.id === stallId)!;
      const stand = STANDS[stallId]!;
      // Beside or behind: never between the counter and the customer's stand.
      const front = [Math.sin(stall.rotationY), Math.cos(stall.rotationY)] as const;
      const along = (npc.position[0] - stall.position[0]) * front[0] + (npc.position[1] - stall.position[1]) * front[1];
      expect(along, keeper).toBeLessThan(0.5);
      expect(Math.hypot(npc.position[0] - stand[0], npc.position[1] - stand[1]), keeper).toBeGreaterThan(2);
      expect(Math.hypot(npc.position[0] - stall.position[0], npc.position[1] - stall.position[1]), keeper).toBeLessThan(3.5);
    }
  });

  it("paves a kerbed cobble Green between brick yards and plank lanes", () => {
    const paving = new Map((oakwood.paving ?? []).map((rect) => [rect.id, rect]));
    expect(paving.get("rootfall_paving_green")).toMatchObject({ assetId: "floor_cobble", kerb: true });
    for (const id of ["rootfall_paving_trade_row", "rootfall_paving_bank", "rootfall_paving_smokehouse", "rootfall_paving_forge_yard"]) {
      expect(paving.get(id)?.assetId, id).toBe("floor_brick");
    }
    for (const id of ["rootfall_paving_oak_row", "rootfall_paving_cart_lane", "rootfall_paving_north_lane"]) {
      expect(paving.get(id)?.assetId, id).toBe("floor_wood");
    }
    // Kerbs come in whole two-metre modules, so the Green's sides must be whole modules too.
    const green = paving.get("rootfall_paving_green")!.rect;
    expect([(green.maxX - green.minX) % 2, (green.maxZ - green.minZ) % 2]).toEqual([0, 0]);
    const rects = [...paving.values()];
    for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
      const left = rects[a]!.rect, right = rects[b]!.rect;
      const overlap = Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX) > 1e-6
        && Math.min(left.maxZ, right.maxZ) - Math.max(left.minZ, right.minZ) > 1e-6;
      expect(overlap, `${rects[a]!.id} / ${rects[b]!.id}`).toBe(false);
    }
  });

  it("puts the well in the middle half of the Green, on the Oak Row axis", () => {
    const well = oakwood.buildings.find((building) => building.id === "rootfall_well")!;
    const green = oakwood.paving!.find((rect) => rect.id === "rootfall_paving_green")!.rect;
    const quarterX = (green.maxX - green.minX) / 4, quarterZ = (green.maxZ - green.minZ) / 4;
    expect(well.position[0]).toBeGreaterThan(green.minX + quarterX);
    expect(well.position[0]).toBeLessThan(green.maxX - quarterX);
    expect(well.position[1]).toBeGreaterThan(green.minZ + quarterZ);
    expect(well.position[1]).toBeLessThan(green.maxZ - quarterZ);
    // Seen straight down Oak Row from the West Gate.
    expect(well.position[1]).toBe(124);
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
