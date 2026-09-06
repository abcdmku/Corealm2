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
import { buildRootfallNavigationSources } from "../game/src/render/rootfallNavigation.js";
import { ROOTFALL_STUMP } from "../game/src/world/rootfallStump.js";

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
  it.each(["lab", "world"] as const)("crosses every native Rootfall flight and returns to %s terrain", async (mode) => {
    const origin: Vec3 = mode === "world" ? [60, 8.29, 120] : [-8, 0, 12];
    const loaded = new Map<string, THREE.Group>();
    for (const [id, file] of [
      ["corealm_stump_oak", "corealm/nature/corealm_stump_oak"],
      ["stairs_exterior", "building/stairs_exterior"],
    ] as const) {
      const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS)
        .read(`game/public/assets/models/${file}.glb`);
      const root = new THREE.Group();
      for (const node of document.getRoot().listNodes()) {
        for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.Float32BufferAttribute(primitive.getAttribute("POSITION")!.getArray()!, 3));
          const indices = primitive.getIndices();
          if (indices) geometry.setIndex(Array.from(indices.getArray()!));
          geometry.applyMatrix4(new THREE.Matrix4().fromArray(node.getWorldMatrix()));
          root.add(new THREE.Mesh(geometry));
        }
      }
      loaded.set(id, root);
    }
    const fixture = assembleFeatureLabStructure({ kind: "composition", id: "rootfall_stump",
      kit: "timber", width: 6, depth: 6, seed: 1 }, origin);
    const sources = await buildRootfallNavigationSources({
      load: async (id) => loaded.get(id)!, instance: (id) => loaded.get(id)!.clone(true),
    }, fixture.entities);
    const world = new WorldScene(new THREE.Scene());
    const terrain = world.buildWorld((mode === "world" ? GAME_BOOT_PROFILE : COMBAT_LAB_BOOT_PROFILE).terrain());
    if (mode === "world") {
      // A distant downward triangle sets a reproducible vertical voxel origin. This phase
      // exposed a disconnected first-flight tread despite a passing zero-height lab.
      const box = new THREE.Box3();
      for (const mesh of terrain) box.expandByObject(mesh);
      const x = box.min.x + 2, z = box.min.z + 2;
      const y = Math.floor(box.min.y / 0.2) * 0.2 - 0.4 + 0.04;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute([x, y, z, x + 0.1, y, z, x, y, z + 0.1], 3));
      terrain.push(new THREE.Mesh(geometry));
    }
    const nav = new Navigation();
    expect(nav.build([...terrain, ...sources.meshes])).toBe(true);
    const bounds = sources.meshes.map((mesh) => new THREE.Box3().setFromObject(mesh).expandByScalar(0.35));
    const state = createInitialState();
    const yaw = ROOTFALL_STUMP.stairYaw;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const approach = ROOTFALL_STUMP.stairFrontZ + 4;
    const along = (point: Vec3) => (point[0] - origin[0]) * sin + (point[2] - origin[2]) * cos;
    state.player.position = [origin[0] + approach * sin, origin[1], origin[2] + approach * cos];
    const movement = new Movement(nav, new EventBus(), {
      heightAt: (_region, x, z) => world.heightAtXZ(x, z),
      preserveNavigationHeight: (point) => bounds.some((box) => box.containsPoint(new THREE.Vector3(...point))),
    });
    const heights: number[] = [];
    for (const [forward, destination] of [[1, 0.5], [-1, approach]] as const) {
      movement.setDirectInput({ forward, strafe: 0, cameraYaw: yaw });
      for (let tick = 0; tick < 120 && forward * (along(state.player.position) - destination) > 0; tick++) {
        const previous = state.player.position;
        movement.update(state, 100, tick * 100);
        const point = state.player.position;
        expect(Math.hypot(point[0] - previous[0], point[2] - previous[2])).toBeLessThan(0.8);
        expect(Math.abs(point[1] - previous[1])).toBeLessThan(0.7);
        heights.push(point[1]);
      }
      expect(forward * (along(state.player.position) - destination)).toBeLessThanOrEqual(0);
      expect(Math.abs((state.player.position[0] - origin[0]) * cos - (state.player.position[2] - origin[2]) * sin)).toBeLessThan(0.1);
      if (forward === 1) expect(state.player.position[1] - origin[1]).toBeGreaterThan(3.3);
    }
    expect(state.player.position[1]).toBeCloseTo(world.heightAtXZ(state.player.position[0], state.player.position[2]), 6);
    expect(heights.some((height) => height - origin[1] > 1.2 && height - origin[1] < 2.5)).toBe(true);
  }, 20000);

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
