import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SemanticEntity, Vec3 } from "../game/src/contracts.js";
import { PLAYER_RADIUS } from "../game/src/app/config.js";
import { EventBus } from "../game/src/core/events.js";
import { createInitialState } from "../game/src/state/store.js";
import { Movement } from "../game/src/systems/movement.js";
import { Navigation, solidObstacleMeshes } from "../game/src/systems/navigation.js";
import { Solids } from "../game/src/systems/solids.js";
import { REGIONS } from "../game/src/content/regions.js";
import { assembleDungeonDoorFixture } from "../game/src/featureLab/dungeonDoors.js";
import { DungeonDoors, authoredThresholds, type DungeonDoorBarrier } from "../game/src/world/dungeonDoors.js";
import { buildWorld } from "../game/src/world/regionBuilder.js";

const threshold: DungeonDoorBarrier = {
  id: "stone_door", position: [0, 0, 0], size: [3.2, 3.4, 0.32], rotationY: 0,
};

function fixture(barrier = threshold, initial = "locked") {
  const entities = new Map<string, Pick<SemanticEntity, "archetype" | "state">>([
    [barrier.id, { archetype: "door", state: initial }],
  ]);
  return { entities, doors: new DungeonDoors([barrier], (id) => entities.get(id)) };
}

function point(x: number, z: number, barrier = threshold): Vec3 {
  return [
    barrier.position[0] + x * Math.cos(barrier.rotationY) + z * Math.sin(barrier.rotationY),
    barrier.position[1],
    barrier.position[2] - x * Math.sin(barrier.rotationY) + z * Math.cos(barrier.rotationY),
  ];
}

describe("dungeon door barriers", () => {
  it.each(["locked", "sealed", "closed"])("physically blocks a %s leaf in both directions", (state) => {
    const { doors } = fixture(threshold, state);
    for (const side of [-1, 1]) {
      const from = point(0, side * 3);
      const to = point(0, -side * 3);
      const result = doors.resolve(to, from, PLAYER_RADIUS);
      expect(result[2]).toBeCloseTo(side * (0.16 + PLAYER_RADIUS + 0.002), 5);
      expect(doors.blocksSegment(from, to)).toBe(true);
      expect(doors.pathIsClear([from, to])).toBe(false);
    }
  });

  it.each(["unbarred", "open"])("immediately removes collision and route blocking when %s", (state) => {
    const { doors, entities } = fixture();
    const from = point(0, -3);
    const to = point(0, 3);
    expect(doors.getSolids()).toHaveLength(1);
    entities.get(threshold.id)!.state = state;
    expect(doors.getSolids()).toEqual([]);
    expect(doors.resolve(to, from, PLAYER_RADIUS)).toEqual(to);
    expect(doors.pathIsClear([from, to])).toBe(true);
    entities.set(threshold.id, { archetype: "door", state: "sealed" });
    expect(doors.blocksSegment(from, to)).toBe(true);
  });

  it("clips a real near-face approach while refusing to claim arrival beyond a locked leaf", () => {
    const { doors } = fixture();
    const path: Vec3[] = [[0, 0, -5], [0, 0, -2], [0, 0, 2], [1, 0, 5]];
    const clipped = doors.clipPath(path);
    expect(clipped.blocked).toBe(true);
    expect(clipped.path).toHaveLength(3);
    expect(clipped.path.slice(0, 2)).toEqual(path.slice(0, 2));
    expect(clipped.path.at(-1)![2]).toBeCloseTo(-0.512, 5);
    expect(doors.pathIsClear(clipped.path)).toBe(true);
    expect(path).toHaveLength(4);
  });

  it("sweeps rotated barriers and preserves motion parallel to their face", () => {
    const barrier: DungeonDoorBarrier = { ...threshold, position: [17, -8, 31], rotationY: 0.5404195 };
    const { doors } = fixture(barrier);
    const from = point(-0.7, -2, barrier);
    const to = point(0.8, 2, barrier);
    const result = doors.resolve(to, from, PLAYER_RADIUS);
    const dx = result[0] - barrier.position[0];
    const dz = result[2] - barrier.position[2];
    expect(dx * Math.cos(barrier.rotationY) - dz * Math.sin(barrier.rotationY)).toBeCloseTo(0.8, 5);
    expect(dx * Math.sin(barrier.rotationY) + dz * Math.cos(barrier.rotationY)).toBeLessThanOrEqual(-0.51);
    expect(doors.contains(point(0, 0, barrier))).toBe(true);
  });

  it("keeps surface movement and routes independent of the door underneath", () => {
    const { doors } = fixture({ ...threshold, position: [0, -11, 0] });
    const from: Vec3 = [0, 0, -3];
    const to: Vec3 = [0, 0, 3];
    expect(doors.resolve(to, from, PLAYER_RADIUS)).toEqual(to);
    expect(doors.pathIsClear([from, to])).toBe(true);
    expect(doors.contains([0, 0, 0])).toBe(false);
  });

  it("intersects the vertical sweep interval when a descending path enters the leaf after horizontal entry", () => {
    const { doors } = fixture();
    const from: Vec3 = [0, 5, -0.6];
    const to: Vec3 = [0, 0, 0.6];
    expect(doors.blocksSegment(from, to)).toBe(true);
    const clipped = doors.clipPath([from, to]);
    expect(clipped.blocked).toBe(true);
    expect(clipped.path.at(-1)![1]).toBeGreaterThan(3.9);
    expect(doors.pathIsClear(clipped.path)).toBe(true);
    expect(doors.resolve(to, from, PLAYER_RADIUS)[1]).toBeGreaterThan(3.9);
    expect(doors.resolve([0, -4, 0], [0, 5, 0], PLAYER_RADIUS)[1]).toBeGreaterThan(3.9);
    // This descent reaches the vertical interval only after leaving the leaf's footprint.
    expect(doors.blocksSegment([0, 6, -2], [0, 3, 2])).toBe(false);
  });

  it("permits gradual overlap escape after load but prevents crossing to the other face", () => {
    const { doors } = fixture();
    expect(doors.resolve([0, 0, -0.3], [0, 0, -0.1], PLAYER_RADIUS)).toEqual([0, 0, -0.3]);
    expect(doors.resolve([0, 0, 0.3], [0, 0, -0.1], PLAYER_RADIUS)).toEqual([0, 0, -0.1]);
    expect(doors.resolve([0.3, 0, -0.1], [0, 0, -0.1], PLAYER_RADIUS)).toEqual([0.3, 0, -0.1]);
    expect(doors.resolve([0, 0, 0.2], [0, 0, 0], PLAYER_RADIUS)).toEqual([0, 0, 0.2]);
  });

  it("keeps missing or invalid door state blocked during entity replacement", () => {
    const { doors, entities } = fixture();
    entities.delete(threshold.id);
    expect(doors.blocksSegment(point(0, -2), point(0, 2))).toBe(true);
    entities.set(threshold.id, { archetype: "door", state: "unknown" });
    expect(doors.getSolids()).toHaveLength(1);
    entities.set(threshold.id, { archetype: "landmark", state: "open" });
    expect(doors.getSolids()).toHaveLength(1);
  });

  it("blocks real direct Movement while locked and permits the same input after opening", () => {
    const barrier: DungeonDoorBarrier = { ...threshold, rotationY: Math.PI / 2 };
    const { doors, entities } = fixture(barrier);
    const nav = {
      closestPoint: (position: Vec3) => position,
      nearestWalkable: (position: Vec3) => position,
    } as Navigation;
    const movement = new Movement(nav, new EventBus(), { solids: doors });
    const state = createInitialState();
    state.player.position = [-3, 0, 0];
    movement.setDirectInput({ forward: 0, strafe: 1, cameraYaw: 0 });
    for (let tick = 0; tick < 20; tick += 1) movement.update(state, 100, tick * 100);
    expect(state.player.position[0]).toBeLessThanOrEqual(-0.51);
    entities.get(barrier.id)!.state = "open";
    for (let tick = 20; tick < 40; tick += 1) movement.update(state, 100, tick * 100);
    expect(state.player.position[0]).toBeGreaterThan(2);
  });

  it("stops a production path that was already active when the leaf closes", () => {
    const barrier: DungeonDoorBarrier = { ...threshold, rotationY: Math.PI / 2 };
    const { doors } = fixture(barrier);
    const nav = {
      closestPoint: (position: Vec3) => position,
      nearestWalkable: (position: Vec3) => position,
    } as Navigation;
    const movement = new Movement(nav, new EventBus(), { solids: doors });
    const state = createInitialState();
    state.player.position = [-3, 0, 0];
    state.player.movement.mode = "path";
    state.player.movement.path = [[3, 0, 0]];
    state.player.movement.pathIndex = 0;
    state.player.movement.destination = [3, 0, 0];
    for (let tick = 0; tick < 15; tick += 1) movement.update(state, 100, tick * 100);
    expect(state.player.position[0]).toBeLessThanOrEqual(-0.51);
  });

  it("seats authored thresholds on the shared cavern floor and follows a changed dungeon base", () => {
    const dungeon = REGIONS.find((region) => region.dungeon)?.dungeon!;
    const thresholds = authoredThresholds(dungeon, 0);
    const lowered = authoredThresholds(dungeon, -30);
    expect(thresholds).toHaveLength(2);
    expect(thresholds.map((entry) => [entry.walls[0]!.minX, entry.walls[1]!.maxX]))
      .toEqual([[-14, 13], [-13, 14.5]]);
    for (const [index, threshold] of thresholds.entries()) {
      const counterpart = lowered[index]!;
      expect(counterpart.origin[1]).toBeCloseTo(threshold.origin[1] - 30, 9);
      expect(threshold.origin[1]).toBeLessThan(dungeon.doors[index]!.floorOffset - 0.5);
      expect(threshold.barrier.size).toEqual([3.2, 3.4, 0.32]);
      const solids = new Solids(threshold.staticSolids);
      const c = Math.cos(threshold.rotationY);
      const s = Math.sin(threshold.rotationY);
      for (const x of [-10, -6, -2, 2, 6, 10]) {
        const wing = x < 0 ? threshold.walls[0]! : threshold.walls[1]!;
        expect(solids.contains([threshold.origin[0] + x * c,
          threshold.origin[1] + wing.bottomAt(x) + 0.5,
          threshold.origin[2] - x * s])).toBe(true);
      }
      expect(solids.contains([threshold.origin[0], threshold.origin[1] + 0.5, threshold.origin[2]])).toBe(false);
    }
  });

  it("uses the same leaf geometry in the enclosed lab and keeps its openings free of baked solids", () => {
    const lab = assembleDungeonDoorFixture(() => 0);
    const fixed = new Solids(lab.solids);
    expect(lab.thresholds).toHaveLength(2);
    expect(lab.entities.filter((entity) => entity.archetype === "door").map((entity) => entity.view!.assetId))
      .toEqual(["corealm_dungeon_portcullis", "corealm_dungeon_portcullis"]);
    for (const threshold of lab.thresholds) {
      expect(fixed.contains([threshold.origin[0], 0, threshold.origin[2]])).toBe(false);
      expect(fixed.contains([threshold.origin[0] + 3, 0, threshold.origin[2]])).toBe(true);
    }
    for (const point of [[30, 0, -12], [42, 0, -12], [36, 0, 6], [36, 0, -30]] as Vec3[]) {
      expect(fixed.contains(point)).toBe(true);
    }
    expect(lab.routeEdges).toHaveLength(4);
  });

  it("stages new world assets explicitly and never bakes the movable leaf into permanent navigation", () => {
    const heightAt = () => 0;
    const staged = buildWorld(1337, heightAt, { heightAt, dungeonGates: true });
    const ordinary = buildWorld(1337, heightAt);
    for (const id of ["gravelmaw_stone_door", "ordrun_gate"]) {
      expect(staged.entities.find((entity) => entity.id === id)!.view!.assetId).toBe("corealm_dungeon_portcullis");
      expect(staged.entities.some((entity) => entity.id === `${id}:frame`)).toBe(true);
      expect(staged.solids.some((solid) => solid.id.startsWith(`${id}:partition:`))).toBe(true);
      expect(staged.solids.some((solid) => solid.id === id)).toBe(false);
      expect(ordinary.entities.find((entity) => entity.id === id)!.view!.assetId).toBe("cage");
      expect(ordinary.entities.some((entity) => entity.id === `${id}:frame`)).toBe(false);
    }
  });
});

describe("production dungeon door navigation", () => {
  const lab = assembleDungeonDoorFixture(() => 0);
  const entities = new Map(lab.entities.map((entity) => [entity.id, entity]));
  const doors = new DungeonDoors(lab.thresholds.map((entry) => entry.barrier), (id) => entities.get(id));
  const nav = new Navigation();
  let meshes: THREE.Mesh[] = [];
  const before = lab.routeNodes[0]!;
  const middle = lab.routeNodes[1]!;
  const after = lab.routeNodes[2]!;

  beforeAll(async () => {
    await Navigation.initLibrary();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(96, 96, 48, 48), new THREE.MeshBasicMaterial());
    floor.geometry.rotateX(-Math.PI / 2);
    meshes = [floor, ...solidObstacleMeshes(lab.solids)];
    expect(nav.build(meshes, "solo")).toBe(true);
    nav.setRouteGraph(lab.routeNodes, lab.routeEdges);
    nav.setPathConstraint((path) => doors.clipPath(path));
  });

  afterAll(() => {
    for (const mesh of meshes) {
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    }
  });

  it("honors both live door states in Detour paths and semantic routes without rebuilding", () => {
    const polys = nav.getDiagnostics().polyCount;
    expect(nav.findPath(before.position, middle.position)).toBeNull();
    expect(nav.findPath(middle.position, after.position)).toBeNull();
    expect(nav.planRoute(before.id, middle.id, 1)).toBeNull();
    expect(nav.planRoute(middle.id, after.id, 1)).toBeNull();
    const stopped = nav.findPathDetailed(before.position, middle.position)!;
    expect(stopped.partial).toBe(true);
    expect(stopped.path.at(-1)![2]).toBeCloseTo(-5.488, 3);
    entities.get("gravelmaw_stone_door")!.state = "unbarred";
    expect(nav.findPath(before.position, middle.position)).not.toBeNull();
    expect(nav.planRoute(before.id, middle.id, 1)).not.toBeNull();
    expect(nav.planRoute(before.id, after.id, 1)).toBeNull();
    entities.get("ordrun_gate")!.state = "open";
    expect(nav.findPath(before.position, after.position)).not.toBeNull();
    expect(nav.planRoute(before.id, after.id, 1, { withPaths: true })!.legs).toHaveLength(2);
    entities.get("gravelmaw_stone_door")!.state = "locked";
    expect(nav.findPath(before.position, middle.position)).toBeNull();
    expect(nav.getDiagnostics().polyCount).toBe(polys);
  });

  it("allows a normal interaction approach but reports nearby opposite faces disconnected", () => {
    entities.get("gravelmaw_stone_door")!.state = "locked";
    const destination = entities.get("gravelmaw_stone_door")!.position;
    const approach = nav.findPathDetailed(before.position, destination)!;
    expect(approach.partial).toBe(true);
    expect(approach.arrivalGap).toBeLessThan(2.4);
    const state = createInitialState();
    state.player.position = [...before.position];
    const movement = new Movement(nav, new EventBus(), { solids: doors });
    expect(movement.startPath(state, destination, "gravelmaw_stone_door", 0, { stopDistance: 2 })).not.toBeNull();
    for (let tick = 0; tick < 20; tick += 1) movement.update(state, 100, tick * 100);
    expect(Math.abs(state.player.position[2] - destination[2])).toBeLessThan(2.4);
    expect(state.player.position[2]).toBeGreaterThan(destination[2]);
    expect(nav.isConnected([36, 0, -5], [36, 0, -7])).toBe(false);
  });
});
