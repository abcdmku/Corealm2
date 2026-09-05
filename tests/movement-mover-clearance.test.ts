import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAYER_RADIUS } from "../game/src/app/config.js";
import type { SemanticEntity, SkillId, SolidVolume, Vec3 } from "../game/src/contracts.js";
import { COLDBRACE } from "../game/src/content/settlements/coldbrace.js";
import { EventBus } from "../game/src/core/events.js";
import { distanceXZ } from "../game/src/core/math.js";
import { createInitialState } from "../game/src/state/store.js";
import { Movement } from "../game/src/systems/movement.js";
import type { Navigation } from "../game/src/systems/navigation.js";
import { Solids } from "../game/src/systems/solids.js";
import { EntityStore } from "../game/src/world/entities.js";
import { ForestObstacles } from "../game/src/world/forestObstacles.js";
import { assetSolidFromMeasurements } from "../game/src/world/regionBuilder.js";

const dorn = COLDBRACE.npcs.find((npc) => npc.id === "npc_pitmaster_dorn")!;
const counter = COLDBRACE.props!.find((prop) => prop.id === "coldbrace_prop_bank_counter")!;
const manifest = JSON.parse(readFileSync(new URL("../game/public/assets/manifest.json", import.meta.url), "utf8")) as {
  assets: { id: string; size: { x: number; y: number; z: number }; base: { x: number; y: number; z: number } }[];
};
const asset = manifest.assets.find((row) => row.id === counter.assetId)!;
const counterSolid = assetSolidFromMeasurements(counter.id,
  [counter.position[0], 0, counter.position[1]], counter.assetId, counter.scale ?? 1, counter.rotationY, false, {
    assetSize: (id) => id === asset.id ? asset.size : null,
    assetCenterXZ: (id) => id === asset.id ? { x: asset.base.x + asset.size.x / 2, z: asset.base.z + asset.size.z / 2 } : null,
  })!;

function fixture(start: Vec3, npcPosition: Vec3, volumes: SolidVolume[] = [],
  closestPoint: (point: Vec3) => Vec3 | null = (point) => point) {
  const state = createInitialState();
  state.player.position = start;
  const entities = new EntityStore({ skillLevels: () => Object.fromEntries(
    Object.entries(state.skills).map(([id, skill]) => [id, skill.level]),
  ) as Record<SkillId, number> });
  const npc: SemanticEntity = { id: dorn.id, name: dorn.name, archetype: "npc", tier: 1,
    regionId: "fallowmarch", position: npcPosition, state: "idle", interactions: ["talk"] };
  entities.add(npc);
  const solids = new Solids(volumes);
  const forest = new ForestObstacles();
  const nav = { closestPoint, findPathDetailed: (from: Vec3, to: Vec3) => ({
    path: [from, to], partial: false, arrivalGap: 0,
  }) } as Navigation;
  const movement = new Movement(nav, new EventBus(), { solids, entities, dynamicObstacles: forest });
  return { state, movement, solids, forest, npc };
}

describe("NPC separation preserves world clearance", () => {
  it.each(["direct", "path"] as const)("keeps %s movement outside Coldbrace's bank counter after Dorn pushes", (mode) => {
    // Last clear browser position before the bank-to-shop leg penetrated this counter by 0.118 m.
    // The flat floor removes irrelevant terrain height; XZ placement and the counter bounds are authored data.
    const start: Vec3 = [-162.551, 0, -89.219];
    const h = fixture(start, [dorn.position[0], 0, dorn.position[1]], [counterSolid]);
    expect(h.forest.size).toBe(0);
    if (mode === "direct") h.movement.setDirectInput({ forward: -0.6, strafe: -0.8, cameraYaw: 0 });
    else {
      const destination: Vec3 = [-164, 0, -87.5];
      Object.assign(h.state.player.movement, { mode: "path", path: [destination], pathIndex: 0, destination });
    }

    for (let tick = 1; tick <= 8; tick++) {
      h.movement.update(h.state, 100, tick * 100);
      const point = h.state.player.position;
      expect(distanceXZ(h.solids.resolve(point, point, PLAYER_RADIUS), point)).toBeLessThanOrEqual(0.005);
      expect(distanceXZ(point, h.npc.position)).toBeGreaterThanOrEqual(0.8 - 1e-6);
    }
    // A rejected step must leave the player able to retreat through the open side of the yard.
    const stopped = h.state.player.position;
    h.movement.setDirectInput({ forward: 1, strafe: 0, cameraYaw: 0 });
    for (let tick = 9; tick <= 18; tick++) h.movement.update(h.state, 100, tick * 100);
    expect(stopped[2] - h.state.player.position[2]).toBeGreaterThan(1);
    expect(distanceXZ(h.solids.resolve(h.state.player.position, h.state.player.position, PLAYER_RADIUS), h.state.player.position)).toBeLessThanOrEqual(0.005);
  });

  it("rejects NPC separation past a navigation edge with no forest correction", () => {
    const nearest = (point: Vec3): Vec3 => [Math.max(0, point[0]), point[1], point[2]];
    const h = fixture([0.1, 0, -0.95], [0.5, 0, 0], [], nearest);
    h.movement.setDirectInput({ forward: -1, strafe: 0, cameraYaw: 0 });
    for (let tick = 1; tick <= 12; tick++) {
      h.movement.update(h.state, 100, tick * 100);
      const point = h.state.player.position;
      expect(distanceXZ(nearest(point), point)).toBeLessThanOrEqual(0.08);
      expect(distanceXZ(point, h.npc.position)).toBeGreaterThanOrEqual(0.8 - 1e-6);
    }
    expect(h.state.player.position[2]).toBeGreaterThan(-0.8);
  });

  it("still separates and walks around an NPC in open space", () => {
    const h = fixture([-1.5, 0, -0.4], [0, 0, 0]);
    h.movement.setDirectInput({ forward: 0, strafe: 1, cameraYaw: 0 });
    let closest = Infinity;
    for (let tick = 1; tick <= 18; tick++) {
      h.movement.update(h.state, 100, tick * 100);
      const gap = distanceXZ(h.state.player.position, h.npc.position);
      closest = Math.min(closest, gap);
      expect(gap).toBeGreaterThanOrEqual(0.8 - 1e-6);
    }
    expect(closest).toBeCloseTo(0.8, 5);
    expect(h.state.player.position[0]).toBeGreaterThan(2);
  });
});
