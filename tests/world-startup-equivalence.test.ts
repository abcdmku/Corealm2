import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemoryGenerationCache } from "./support/generation-cache.js";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";
import {
  WorldScene,
  type GroundStamps,
  type WorldTerrainSpec,
} from "../game/src/render/scene.js";

const SMALL_WORLD: WorldTerrainSpec = {
  bounds: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
  chunkSize: 8,
  metresPerQuad: 2,
  blendMetres: 2,
  regions: [{
    regionId: "fallowmarch",
    rect: { minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
    seed: 0x51_7f_ac,
    character: "plains",
    baseHeight: 3,
    amplitude: 9,
  }],
};

const STAMPS: GroundStamps = {
  seed: 1337,
  roads: [{
    points: [[-3, 0, -2], [0, 0, 1], [3, 0, 2]],
    width: 3.2,
  }],
  paving: [{
    centre: [0, 0],
    halfExtents: [1.5, 1],
    rotationY: 0.25,
    surface: "stone",
    kerb: true,
  }],
  water: [],
};

function buildPreparedScene(): WorldScene {
  const scene = new WorldScene(new THREE.Scene());
  scene.buildWorld(SMALL_WORLD, (prepared) => {
    expect(prepared).toBe(scene);
    expect(prepared.getWalkableMeshes()).toHaveLength(0);
    prepared.setGroundStamps(STAMPS);
  });
  return scene;
}

describe("prepared world startup", () => {
  it("restores identical terrain, coast, physics and road buffers and rejects stale or malformed records", async () => {
    const cache = new MemoryGenerationCache();
    const spec: WorldTerrainSpec = { ...SMALL_WORLD, coast: { ...buildWorldTerrainSpec().coast!,
      collar: 16, shoreline: [8, 12], gridStep: 2, oceanSize: 100 } };
    const prepare = (scene: WorldScene) => scene.setGroundStamps(STAMPS);
    const digest = (scene: WorldScene) => {
      const hash = createHash("sha256");
      scene.root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        hash.update(object.name);
        for (const [name, attribute] of Object.entries((object.geometry as THREE.BufferGeometry).attributes)) {
          hash.update(name); hash.update(new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
        }
        const index = object.geometry.index?.array;
        if (index) hash.update(new Uint8Array(index.buffer, index.byteOffset, index.byteLength));
      });
      return hash.digest("hex");
    };
    const cold = new WorldScene(new THREE.Scene()), warm = new WorldScene(new THREE.Scene());
    await cold.buildWorldCached(cache, "fixture", spec, prepare);
    await warm.buildWorldCached(cache, "fixture", spec, prepare);
    expect(cache.hits).toBe(1);
    expect(digest(warm)).toBe(digest(cold));
    expect(warm.getRoadPolylines()).toEqual(cold.getRoadPolylines());
    expect(warm.heightfieldSamples()).toEqual(cold.heightfieldSamples());
    for (let x = -18; x < 18; x += 3.1) for (let z = -18; z < 18; z += 2.9) {
      expect(warm.sampleWorld(x, z)).toEqual(cold.sampleWorld(x, z));
    }
    const changed = new WorldScene(new THREE.Scene());
    await changed.buildWorldCached(cache, "fixture", { ...spec, regions: [{ ...spec.regions[0]!, seed: 22 }] }, prepare);
    expect(cache.hits).toBe(1);
    expect(digest(changed)).not.toBe(digest(cold));
    cache.entries.set("terrain/fixture", { input: "bad record" });
    const recovered = new WorldScene(new THREE.Scene());
    await recovered.buildWorldCached(cache, "fixture", spec, prepare);
    expect(digest(recovered)).toBe(digest(cold));
    for (const scene of [cold, warm, changed, recovered]) scene.dispose();
  });

  it("uses the same built surface for placement without evaluating biome diagnostics", () => {
    const scene = buildPreparedScene();
    for (let x = -5; x <= 5; x += 0.5) for (let z = -5; z <= 5; z += 0.5) {
      const sample = scene.sampleWorld(x, z);
      const placed = scene.placementSurfaceAt(x, z);
      expect(placed !== null).toBe(sample.playable);
      if (placed) expect(placed).toEqual({ height: sample.height, slope: sample.slope,
        semanticRegion: sample.semanticRegion, waterBodyId: sample.waterBodyId });
    }
    scene.clear();
  });

  it("establishes stamps before building and shading each chunk once", () => {
    const scene = buildPreparedScene();

    expect(scene.getWalkableMeshes()).toHaveLength(1);
    expect(scene.getTerrainBuildStats()).toEqual({
      chunkBuildCount: 1,
      restampPassCount: 0,
      restampedVertexCount: 0,
    });
    expect(scene.getRoadPolylines()).not.toHaveLength(0);

    scene.clear();
  });

  it("derives the physics heightfield from the same interpolated lattice as the visible mesh", () => {
    const scene = buildPreparedScene();
    const samples = scene.heightfieldSamples(1);
    const bounds = SMALL_WORLD.bounds;
    const width = bounds.maxX - bounds.minX;
    const depth = bounds.maxZ - bounds.minZ;

    for (let col = 0; col <= samples.ncols; col += 1) {
      const x = bounds.minX + (col / samples.ncols) * width;
      for (let row = 0; row <= samples.nrows; row += 1) {
        const z = bounds.minZ + (row / samples.nrows) * depth;
        const physicsHeight = samples.heights[col * (samples.nrows + 1) + row];
        expect(physicsHeight).toBeCloseTo(scene.meshHeightAt(x, z), 6);
      }
    }

    const [walkable] = scene.getWalkableMeshes();
    const positions = walkable!.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index += 1) {
      const x = walkable!.position.x + positions.getX(index);
      const z = walkable!.position.z + positions.getZ(index);
      expect(positions.getY(index)).toBeCloseTo(scene.meshHeightAt(x, z), 6);
    }

    scene.clear();
  });

  it("keeps the solved road lines and heightfield deterministic", () => {
    const first = buildPreparedScene();
    const second = buildPreparedScene();

    expect(second.getRoadPolylines()).toEqual(first.getRoadPolylines());
    expect([...second.heightfieldSamples(1).heights]).toEqual([...first.heightfieldSamples(1).heights]);

    first.clear();
    second.clear();
  });

  it("retains measurable late-stamp compatibility without using it on the prepared path", () => {
    const scene = new WorldScene(new THREE.Scene());
    scene.buildWorld(SMALL_WORLD);
    const before = scene.getTerrainBuildStats();

    scene.setGroundStamps(STAMPS);
    const after = scene.getTerrainBuildStats();

    expect(before.restampPassCount).toBe(0);
    expect(after.restampPassCount).toBe(1);
    expect(after.restampedVertexCount).toBeGreaterThan(0);
    expect(after.chunkBuildCount).toBe(before.chunkBuildCount);

    scene.clear();
  });
});
