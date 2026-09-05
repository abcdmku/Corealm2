import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldSite } from "../game/src/content/worldSites.js";
import {
  WorldScene, type GrassSpritePlacement, type GroundStamps, type WorldTerrainSpec,
} from "../game/src/render/scene.js";

const MINE: WorldSite = {
  id: "surface_test_mine", locationId: "surface_test_seam", regionId: "fallowmarch",
  centre: [0, 0], rotationY: 0, kind: "mine", workRadius: 4, extent: [16, 16],
  terrain: { floorRadius: 8, backRise: 4, backDistance: 10, bermWidth: 6, approachAngle: 0 },
  resourceSlots: [], dressing: [],
};
const SMALL_WORLD: WorldTerrainSpec = {
  bounds: { minX: -24, maxX: 24, minZ: -24, maxZ: 24 },
  chunkSize: 48, metresPerQuad: 2, blendMetres: 2,
  regions: [{
    regionId: "fallowmarch", rect: { minX: -24, maxX: 24, minZ: -24, maxZ: 24 },
    seed: 417, character: "plains", baseHeight: 3, amplitude: 0,
  }],
};
const ROAD: GroundStamps["roads"] = [{ points: [[-12, 0, 0], [0, 0, 0], [12, 0, 0]], width: 3.2 }];
const WATER: GroundStamps["water"] = [{ centre: [0, 0], radius: 4, level: 4 }];
const PAVING: GroundStamps["paving"] = [{ centre: [0, 0], halfExtents: [3, 3], kerb: true, surface: "stone" }];
const liveScenes: WorldScene[] = [];

function buildScene(sites: readonly WorldSite[] = [MINE], stamps?: GroundStamps): WorldScene {
  const scene = new WorldScene(new THREE.Scene());
  liveScenes.push(scene);
  scene.buildWorld({ ...SMALL_WORLD, worldSites: sites }, (prepared) => {
    if (stamps) prepared.setGroundStamps(stamps);
  });
  return scene;
}

afterEach(() => {
  for (const scene of liveScenes.splice(0)) scene.dispose();
});

describe("mine ground surfaces", () => {
  it("makes the work floor predominantly dirt and gravel instead of meadow grass", () => {
    const scene = buildScene();
    const baseline = buildScene([]);
    // This fixture's seam runs across z=-5.2. Wear follows the mining stance in front of it.
    for (const [x, z] of [[0, -3], [-2, -3], [2, -3], [4, -3]] as const) {
      const worked = scene.groundSurfaceAt(x, z);
      const untouched = baseline.groundSurfaceAt(x, z);
      expect(worked.dirt + worked.gravel, `${x},${z}`).toBeGreaterThan(0.8);
      expect(worked.grass, `${x},${z}`).toBeLessThan(0.15);
      expect(worked.dirt - untouched.dirt, `${x},${z}`).toBeGreaterThan(0.5);
    }
  });

  it("joins the work strip to a narrow approach without painting the rear hill or an empty apron", () => {
    const scene = buildScene();
    const approach = scene.groundSurfaceAt(0, 3);
    expect(approach.dirt).toBeGreaterThan(0.5);
    for (const [x, z] of [[12, 0], [-12, 0], [0, -12], [5, 12], [-5, 12], [0, 12]] as const) {
      const shoulder = scene.groundSurfaceAt(x, z);
      expect(shoulder.dirt, `${x},${z} outside haul track`).toBeLessThan(0.05);
    }
  });

  it("does not change surfaces beyond the mine extent and its terrain sampling stencil", () => {
    const scene = buildScene();
    const baseline = buildScene([]);
    // Four metres beyond the extent also excludes the neighbouring two-metre slope stencil.
    for (const [x, z] of [[20, 0], [-20, 0], [0, 20], [0, -20], [22, 22], [-22, -22]] as const) {
      expect(scene.groundSurfaceAt(x, z), `${x},${z}`).toEqual(baseline.groundSurfaceAt(x, z));
    }
  });

  it("preserves natural ground through a grove's floor and approach", () => {
    const grove = buildScene([{ ...MINE, kind: "grove" }]);
    const baseline = buildScene([]);
    for (let x = -18; x <= 18; x += 6) {
      for (let z = -18; z <= 18; z += 6) {
        expect(grove.groundSurfaceAt(x, z), `${x},${z}`).toEqual(baseline.groundSurfaceAt(x, z));
      }
    }
  });

  it.each([
    { name: "paving over roads and wet ground", channel: "cobble", stamps: { paving: PAVING, roads: ROAD, water: WATER } },
    { name: "roads over wet ground", channel: "dirt", stamps: { roads: ROAD, water: WATER } },
    { name: "wet ground", channel: "wet", stamps: { water: WATER } },
  ] as const)("preserves $name ahead of mine wear", ({ channel, stamps }) => {
    const scene = buildScene([MINE], stamps);
    const baseline = buildScene([], stamps);
    const sample = scene.groundSurfaceAt(0, 0);
    expect(sample[channel]).toBeGreaterThan(0.99);
    expect(sample).toEqual(baseline.groundSurfaceAt(0, 0));
  });

  it("preserves a partly muddy bank while mine wear replaces its remaining natural ground", () => {
    const scene = buildScene();
    const baseline = buildScene([]);
    for (const current of [scene, baseline]) {
      current.setGroundStamps({ water: [{
        centre: [0, 0], radius: 4, level: current.meshHeightAt(0, 0) - 0.5,
      }] });
    }
    const worked = scene.groundSurfaceAt(0, 0);
    const untouched = baseline.groundSurfaceAt(0, 0);
    expect(untouched.mud).toBeGreaterThan(0.5);
    expect(untouched.mud).toBeLessThan(0.9);
    expect(worked.mud).toBeCloseTo(untouched.mud, 12);
    expect(worked.wet).toBeCloseTo(untouched.wet, 12);
    expect(worked.dirt).toBeGreaterThan(untouched.dirt + 0.1);
  });

  it("keeps all ground weights finite, nonnegative and normalized across overlapping treatments", () => {
    const scene = buildScene([MINE], { paving: PAVING, roads: ROAD, water: WATER });
    for (let x = -20; x <= 20; x += 2) {
      for (let z = -20; z <= 20; z += 2) {
        const weights = Object.values(scene.groundSurfaceAt(x, z));
        expect(weights.every((weight) => Number.isFinite(weight) && weight >= 0 && weight <= 1), `${x},${z}`).toBe(true);
        expect(weights.reduce((sum, weight) => sum + weight, 0), `${x},${z}`).toBeCloseTo(1, 12);
      }
    }
  });
});

describe("scene-owned grass geometry", () => {
  it("retains native grass across clear and releases its derived geometry on final disposal", () => {
    const scene = new WorldScene(new THREE.Scene());
    const sourceGeometry = new THREE.BoxGeometry(1, 2, 0.1);
    const sourceMaterial = new THREE.MeshStandardMaterial();
    const sourceDisposed = vi.fn();
    sourceGeometry.addEventListener("dispose", sourceDisposed);
    const placement: GrassSpritePlacement = {
      position: [0, 0, 0], rotationY: 0.3, width: 0.8, height: 1, colour: 0x71804a,
    };
    try {
      scene.setGrassSource(new THREE.Mesh(sourceGeometry, sourceMaterial));
      const first = scene.scatterGrassSprites([placement], "first-tile")[0]!;
      const nativeGeometry = first.geometry;
      const nativeDisposed = vi.fn();
      nativeGeometry.addEventListener("dispose", nativeDisposed);
      expect(nativeGeometry).not.toBe(sourceGeometry);

      scene.clear();
      expect(nativeDisposed).not.toHaveBeenCalled();
      expect(scene.hasNativeGrass()).toBe(true);
      const rebuilt = scene.scatterGrassSprites([placement], "rebuilt-tile")[0]!;
      expect(rebuilt.geometry).toBe(nativeGeometry);

      scene.dispose();
      expect(nativeDisposed).toHaveBeenCalledOnce();
      expect(scene.hasNativeGrass()).toBe(false);
      expect(scene.scatterGroup.children).toHaveLength(0);
      expect(sourceDisposed).not.toHaveBeenCalled();
    } finally {
      if (scene.hasNativeGrass()) scene.dispose();
      sourceGeometry.dispose();
      sourceMaterial.dispose();
    }
  });
});
