import * as THREE from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Vec3 } from "../game/src/contracts.js";
import { NAVMESH_AUTHORING_INPUTS } from "../game/src/generated/navmeshFingerprint.js";
import { Navigation } from "../game/src/systems/navigation.js";

const WORLD_SEED = 1337;
const START: Vec3 = [-8, 3, -6];
const MIDDLE: Vec3 = [0, 3, 0];
const END: Vec3 = [8, 3, 6];

let source: Navigation;
let sourceMeshes: THREE.Mesh[];
let artifactBytes: Uint8Array;

function makeWalkable(mutator?: (mesh: THREE.Mesh) => void): THREE.Mesh[] {
  const geometry = new THREE.PlaneGeometry(24, 20, 12, 10);
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = "terrain-nav-artifact-fixture";
  mesh.userData.walkable = true;
  mutator?.(mesh);
  mesh.updateMatrixWorld(true);
  return [mesh];
}

function disposeMeshes(meshes: readonly THREE.Mesh[]): void {
  for (const mesh of meshes) {
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material.dispose();
  }
}

function expectPointParity(actual: Vec3 | null, expected: Vec3 | null): void {
  expect(actual === null).toBe(expected === null);
  if (!actual || !expected) return;
  expect(actual[0]).toBeCloseTo(expected[0], 5);
  expect(actual[1]).toBeCloseTo(expected[1], 5);
  expect(actual[2]).toBeCloseTo(expected[2], 5);
}

function expectPathParity(imported: Navigation, runtime: Navigation, from: Vec3, to: Vec3): void {
  const actual = imported.findPathDetailed(from, to);
  const expected = runtime.findPathDetailed(from, to);
  expect(actual === null).toBe(expected === null);
  if (!actual || !expected) return;

  expect(actual.partial).toBe(expected.partial);
  expect(actual.arrivalGap).toBeCloseTo(expected.arrivalGap, 5);
  expect(actual.path).toHaveLength(expected.path.length);
  for (let index = 0; index < expected.path.length; index += 1) {
    expectPointParity(actual.path[index] ?? null, expected.path[index] ?? null);
  }
}

async function expectRuntimeFallback(
  meshes: THREE.Mesh[],
  options: Parameters<Navigation["buildOrImport"]>[1],
  reason: RegExp,
  overrides: Parameters<Navigation["buildOrImport"]>[3] = {},
): Promise<Navigation> {
  const navigation = new Navigation();
  const build = vi.spyOn(navigation, "build");

  await expect(navigation.buildOrImport(meshes, options, "solo", overrides)).resolves.toBe(true);

  const diagnostics = navigation.getDiagnostics();
  expect(build).toHaveBeenCalledOnce();
  expect(diagnostics.status).toBe("ready");
  expect(diagnostics.artifact.status).toBe("runtime-fallback");
  expect(diagnostics.artifact.reason).toMatch(reason);
  expect(diagnostics.polyCount).toBeGreaterThan(0);
  return navigation;
}

beforeAll(async () => {
  await Navigation.initLibrary();
  sourceMeshes = makeWalkable();
  source = new Navigation();
  expect(source.build(sourceMeshes, "solo")).toBe(true);
  artifactBytes = await source.exportArtifact(sourceMeshes, { worldSeed: WORLD_SEED });
});

afterAll(() => {
  disposeMeshes(sourceMeshes);
});

describe("prebaked navigation artifact", () => {
  it.each(["solo", "tiled"] as const)("%s keeps indexed and non-indexed floors connected under parent transforms", (strategy) => {
    const parent = new THREE.Group();
    parent.position.set(37, 4, -29);
    parent.rotation.y = 0.37;
    parent.scale.set(1.25, 1, 1.15);
    const transformed = [-6, 6].map((x, index) => {
      let geometry: THREE.BufferGeometry = new THREE.PlaneGeometry(12, 20, 6, 10);
      geometry.rotateX(-Math.PI / 2);
      if (index === 1) {
        const flat = geometry.toNonIndexed();
        geometry.dispose();
        geometry = flat;
      }
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      mesh.position.x = x;
      parent.add(mesh);
      return mesh;
    });
    parent.updateMatrixWorld(true);
    const sourcePositions = transformed.map((mesh) => Array.from(mesh.geometry.getAttribute("position").array));
    const baked = transformed.map((mesh) => {
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    });
    try {
      const actual = new Navigation();
      const reference = new Navigation();
      expect(actual.build(transformed, strategy)).toBe(true);
      expect(reference.build(baked, strategy)).toBe(true);
      const worldPoint = (x: number): Vec3 => new THREE.Vector3(x, 0, 0).applyMatrix4(parent.matrixWorld).toArray();
      const from = worldPoint(-8);
      const to = worldPoint(8);
      const route = actual.findPathDetailed(from, to);
      expect(route, "path must cross the indexed/non-indexed floor join").not.toBeNull();
      expect(route!.partial).toBe(false);
      expect(route!.path[0]![1]).toBeCloseTo(4, 0);
      expectPathParity(actual, reference, from, to);
      for (const point of [from, worldPoint(0), to]) expectPointParity(actual.closestPoint(point), reference.closestPoint(point));
      expect(transformed.map((mesh) => Array.from(mesh.geometry.getAttribute("position").array))).toEqual(sourcePositions);
    } finally {
      disposeMeshes(transformed);
      disposeMeshes(baked);
    }
  });

  it("imports without running Recast and preserves closest-point and path queries", async () => {
    const meshes = makeWalkable();
    const imported = new Navigation();
    const build = vi.spyOn(imported, "build");

    await expect(imported.buildOrImport(meshes, {
      worldSeed: WORLD_SEED,
      artifactBytes,
    }, "solo")).resolves.toBe(true);

    const diagnostics = imported.getDiagnostics();
    expect(build).not.toHaveBeenCalled();
    expect(diagnostics.status).toBe("ready");
    expect(diagnostics.artifact.status).toBe("imported");
    expect(diagnostics.artifact.reason).toBeNull();
    expect(diagnostics.artifact.bytes).toBe(artifactBytes.byteLength);
    expect(diagnostics.artifact.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(diagnostics.artifact.importMs).toBeLessThan(250);
    expect(diagnostics.polyCount).toBe(source.getDiagnostics().polyCount);

    for (const probe of [START, MIDDLE, END]) {
      expectPointParity(imported.closestPoint(probe), source.closestPoint(probe));
    }
    expectPathParity(imported, source, START, END);
    expectPathParity(imported, source, END, MIDDLE);

    disposeMeshes(meshes);
  });

  it("falls back when transformed geometry changes the fingerprint", async () => {
    const meshes = makeWalkable((mesh) => mesh.position.set(0.25, 0, 0));
    const navigation = await expectRuntimeFallback(meshes, {
      worldSeed: WORLD_SEED,
      artifactBytes,
    }, /fingerprint mismatch/i);

    expect(navigation.closestPoint(MIDDLE)).not.toBeNull();
    disposeMeshes(meshes);
  });

  it("fingerprints the world seed, authored inputs, and navigation settings", async () => {
    const seedMeshes = makeWalkable();
    await expectRuntimeFallback(seedMeshes, {
      worldSeed: WORLD_SEED + 1,
      artifactBytes,
    }, /fingerprint mismatch/i);
    disposeMeshes(seedMeshes);

    const authoredMeshes = makeWalkable();
    await expectRuntimeFallback(authoredMeshes, {
      worldSeed: WORLD_SEED,
      artifactBytes,
      authoredInputs: {
        ...NAVMESH_AUTHORING_INPUTS,
        roads: `${NAVMESH_AUTHORING_INPUTS.roads}-changed`,
      },
    }, /fingerprint mismatch/i);
    disposeMeshes(authoredMeshes);

    const settingsMeshes = makeWalkable();
    await expectRuntimeFallback(settingsMeshes, {
      worldSeed: WORLD_SEED,
      artifactBytes,
    }, /fingerprint mismatch/i, { cs: 0.35 });
    disposeMeshes(settingsMeshes);
  });

  it("rejects a corrupted or truncated container and still produces a ready runtime mesh", async () => {
    const corrupted = artifactBytes.slice();
    corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1]! + 1) & 0xff;
    const corruptedMeshes = makeWalkable();
    await expectRuntimeFallback(corruptedMeshes, {
      worldSeed: WORLD_SEED,
      artifactBytes: corrupted,
    }, /payload hash does not match/i);
    disposeMeshes(corruptedMeshes);

    const truncatedMeshes = makeWalkable();
    await expectRuntimeFallback(truncatedMeshes, {
      worldSeed: WORLD_SEED,
      artifactBytes: artifactBytes.subarray(0, 12),
    }, /truncated|lengths do not match/i);
    disposeMeshes(truncatedMeshes);
  });
});
