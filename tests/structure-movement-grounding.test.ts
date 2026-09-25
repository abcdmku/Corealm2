import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import type { Vec3 } from "../game/src/contracts.js";
import { EventBus } from "../game/src/core/events.js";
import { createInitialState } from "../game/src/state/store.js";
import { Movement } from "../game/src/systems/movement.js";
import { Navigation } from "../game/src/systems/navigation.js";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { WorldScene } from "../game/src/render/scene.js";
import { COMBAT_LAB_BOOT_PROFILE, GAME_BOOT_PROFILE } from "../game/src/app/bootProfile.js";
import { assembleFeatureLabStructure } from "../game/src/featureLab/structures.js";

beforeAll(async () => Navigation.initLibrary());

function stairsFixture() {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20).rotateX(-Math.PI / 2));
  const stairs: THREE.Mesh[] = [];
  // Six imported-mesh tread surrogates reach the native Rootfall first-flight height.
  for (let step = 0; step < 6; step++) {
    const height = (step + 1) * 0.196;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, height, 4));
    mesh.position.set(step + 0.5, height / 2, 0);
    stairs.push(mesh);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(4, 1.176, 4));
  top.position.set(8, 1.176 / 2, 0);
  stairs.push(top);
  const bounds = stairs.map((mesh) => new THREE.Box3().setFromObject(mesh));
  const preserveNavigationHeight = (point: Vec3) => bounds.some((box) =>
    point[0] >= box.min.x && point[0] <= box.max.x && point[2] >= box.min.z && point[2] <= box.max.z);
  const nav = new Navigation();
  expect(nav.build([floor, ...stairs])).toBe(true);
  return { nav, preserveNavigationHeight };
}

function walk(movement: Movement, state: ReturnType<typeof createInitialState>, direction: number,
  reached: (point: Vec3) => boolean) {
  movement.setDirectInput({ forward: 0, strafe: direction, cameraYaw: 0 });
  const positions: Vec3[] = [[...state.player.position]];
  for (let tick = 0; tick < 100 && !reached(state.player.position); tick++) {
    movement.update(state, 100, tick * 100);
    const previous = positions.at(-1)!;
    const point = state.player.position;
    // Real movement must cover the flight continuously, with no recovery placement.
    expect(Math.hypot(point[0] - previous[0], point[2] - previous[2])).toBeLessThan(0.8);
    expect(Math.abs(point[1] - previous[1])).toBeLessThan(0.5);
    positions.push([...point]);
  }
  return positions;
}

describe("imported structure movement grounding", () => {
  it("walks from terrain up low mesh stairs, across the top and back down", () => {
    const { nav, preserveNavigationHeight } = stairsFixture();
    const state = createInitialState();
    state.player.position = [-3, 0, 0];
    const movement = new Movement(nav, new EventBus(), {
      heightAt: () => 0,
      preserveNavigationHeight,
      regionAt: (point) => point[0] >= 6 ? "karrowmoor" : "fallowmarch",
    });
    const ascent = walk(movement, state, 1, (point) => point[0] >= 8);
    expect(state.player.position[0]).toBeGreaterThanOrEqual(8);
    expect(state.player.position[1]).toBeGreaterThan(1.1);
    expect(state.player.regionId).toBe("karrowmoor");
    expect(ascent.some((point) => point[1] > 0.3 && point[1] < 0.9)).toBe(true);
    const descent = walk(movement, state, -1, (point) => point[0] <= -2);
    expect(state.player.position[0]).toBeLessThanOrEqual(-2);
    expect(state.player.position[1]).toBe(0);
    expect(state.player.regionId).toBe("fallowmarch");
    expect(descent.some((point) => point[1] > 0.3 && point[1] < 0.9)).toBe(true);
  });

  it("walks onto and off a footprint whose navmesh floats over the terrain, from a standstill at host substeps", () => {
    // The navmesh stands 0.2 m over the drawn ground, as it does around imported stairs.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20).rotateX(-Math.PI / 2).translate(0, 0.2, 0));
    const platform = new THREE.Mesh(new THREE.BoxGeometry(4, 0.6, 4));
    platform.position.set(4, 0.3, 0);
    const nav = new Navigation();
    expect(nav.build([floor, platform])).toBe(true);
    const bounds = new THREE.Box3().setFromObject(platform).expandByScalar(0.35);
    const movement = new Movement(nav, new EventBus(), {
      heightAt: () => 0, authoritativeGround: true,
      preserveNavigationHeight: (point) => bounds.containsPoint(new THREE.Vector3(...point)),
    });
    const state = createInitialState();
    for (const [start, goal] of [[[-2, 0, 0], [4, 0.6, 0]], [[4, 0.6, 0], [-2, 0, 0]], [[1.6, 0, 1], [9, 0, 1]]] as const) {
      const snapped = nav.closestPoint([start[0], 1, start[2]])!;
      // The player stands at the grounded height: the terrain's off the platform.
      state.player.position = [snapped[0], start[1], snapped[2]];
      const destination = nav.closestPoint([goal[0], 1, goal[2]])!;
      expect(movement.startPath(state, destination, null, 0)).not.toBeNull();
      // Host movement: five 20 ms collision substeps per 100 ms tick.
      for (let tick = 0; tick < 400 && state.player.movement.mode === "path"; tick++) movement.update(state, 20, tick * 20);
      expect(state.player.movement.mode).toBe("idle");
      expect(Math.hypot(state.player.position[0] - destination[0], state.player.position[2] - destination[2])).toBeLessThan(0.4);
      // On the platform the player keeps the navmesh height; on the ground, the terrain's.
      expect(state.player.position[1]).toBeCloseTo(goal[1] > 0 ? destination[1] : 0, 1);
    }
  });

  it("retains analytic terrain grounding outside structure footprints and without the port", () => {
    const { nav, preserveNavigationHeight } = stairsFixture();
    for (const preserve of [undefined, preserveNavigationHeight]) {
      const state = createInitialState();
      state.player.position = [-3, 0, 6];
      const movement = new Movement(nav, new EventBus(), {
        heightAt: () => 0,
        ...(preserve ? { preserveNavigationHeight: preserve } : {}),
      });
      const positions = walk(movement, state, 1, (point) => point[0] >= 8);
      expect(state.player.position[0]).toBeGreaterThanOrEqual(8);
      expect(positions.every((point) => point[1] === 0)).toBe(true);
    }
  });
});
