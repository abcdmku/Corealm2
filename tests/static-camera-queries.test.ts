import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Vec3 } from "../game/src/contracts.js";
import { StaticCameraQueries, type HeightfieldInput } from "../game/src/systems/staticCameraQueries.js";

function random(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
}

/** An independent brute-force Three.js oracle. All triangles have both visible faces. */
function referenceDistance(mesh: THREE.Mesh, origin: Vec3, direction: Vec3, limit = 100): number | null {
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize(), 0, limit,
  );
  mesh.updateWorldMatrix(true, false);
  const hit = raycaster.intersectObject(mesh, false)[0];
  return hit && hit.distance < limit ? hit.distance : null;
}

function expectDistance(actual: number | null, expected: number | null): void {
  if (expected === null) expect(actual).toBeNull();
  else {
    expect(actual).not.toBeNull();
    expect(actual!).toBeCloseTo(expected, 4);
  }
}

/** Rapier's default diagonal crosses from the cell's +X corner to its +Z corner. */
function heightfieldMesh(field: HeightfieldInput): THREE.Mesh {
  const positions: number[] = [];
  for (let x = 0; x <= field.ncols; x += 1) {
    for (let z = 0; z <= field.nrows; z += 1) {
      positions.push(
        field.centre.x + (x / field.ncols - 0.5) * field.scale.x,
        field.centre.y + field.heights[x * (field.nrows + 1) + z]! * field.scale.y,
        field.centre.z + (z / field.nrows - 0.5) * field.scale.z,
      );
    }
  }
  const indices: number[] = [];
  for (let x = 0; x < field.ncols; x += 1) {
    for (let z = 0; z < field.nrows; z += 1) {
      const a = x * (field.nrows + 1) + z;
      const b = a + field.nrows + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}

describe("static camera queries", () => {
  it("normalizes directions, returns nearest geometry, and refreshes after registration or clearing", () => {
    const queries = new StaticCameraQueries();
    expect(queries.raycast([0, 0, 0], [2, 0, 0])).toBeNull();
    queries.addStaticBox([9, 0, 0], [1, 1, 1]);
    expect(queries.raycast([0, 0, 0], [20, 0, 0])).toBe(8);
    queries.addStaticCylinder([4, -1, 0], 1, 2);
    expect(queries.raycast([0, 0, 0], [0.2, 0, 0])).toBe(3);
    queries.clearStatic();
    expect(queries.raycast([0, 0, 0], [1, 0, 0])).toBeNull();
    queries.addStaticBox([2, 0, 0], [1, 1, 1]);
    expect(queries.raycast([0, 0, 0], [1, 0, 0])).toBe(1);
  });

  it("matches native Rapier World endpoint and solid-origin semantics", () => {
    const queries = new StaticCameraQueries();
    queries.addStaticBox([0, 0, 0], [1, 1, 1]);
    expect(queries.raycast([0, 2, 0], [0, -1, 0], 1)).toBeNull();
    expect(queries.raycast([0, 2, 0], [0, -1, 0], 1.00001)).toBe(1);
    expect(queries.raycast([0, 0, 0], [1, 0, 0])).toBe(0);
    expect(queries.raycast([0, 0, 0], [1, 0, 0], 0)).toBeNull();
    expect(queries.raycast([0, 0, 0], [0, 0, 0])).toBe(0);
    expect(queries.raycast([0, 2, 0], [0, 0, 0])).toBeNull();
    expect(queries.raycast([0, 2, 0], [0, -1, 0], -1)).toBeNull();
  });

  it("uses rotated box faces rather than their world bounding boxes", () => {
    const queries = new StaticCameraQueries();
    queries.addStaticBox([0, 0, 0], [2, 1, 0.5], Math.PI / 4);
    expect(queries.raycast([0, 0, 4], [0, 0, -1])).toBeCloseTo(4 - Math.SQRT1_2, 8);
    expect(queries.raycast([1.7, 4, 1.7], [0, -1, 0])).toBeNull();
    expect(queries.raycast([0, 0, 0], [0, 1, 0])).toBe(0);
    expect(queries.raycast([0, 4, 0], [0, -1, 0])).toBe(3);
  });

  it("keeps box corner rays stable after inverse-yaw roundoff", () => {
    const queries = new StaticCameraQueries();
    queries.addStaticBox([7, 2, -9], [2, 3, 4], Math.PI / 2);
    expect(queries.raycast([2.999999999999999, -1, -3.000000000000001], [8.881784197001252e-16, 0, -4])).toBeCloseTo(4, 10);
    queries.clearStatic();
    queries.addStaticBox([7, 2, -9], [2, 3, 4], 0.4);
    expect(queries.raycast([3.600204642759628, -7, -11.90540729139424], [0, 6, 0])).toBeCloseTo(6, 10);
  });

  it("intersects cylindrical sides, both caps, tangents and contained origins", () => {
    const queries = new StaticCameraQueries();
    queries.addStaticCylinder([3, 5, 7], 2, 4);
    expect(queries.raycast([3, 7, 12], [0, 0, -1])).toBe(3);
    expect(queries.raycast([3, 12, 7], [0, -1, 0])).toBe(3);
    expect(queries.raycast([3, 2, 7], [0, 1, 0])).toBe(3);
    expect(queries.raycast([5, 7, 12], [0, 0, -1])).toBe(5);
    expect(queries.raycast([3, 7, 7], [1, 1, 1])).toBe(0);
    expect(queries.raycast([3, 10, 12], [0, 0, -1])).toBeNull();
    expect(queries.raycast([5.01, 12, 7], [0, -1, 0])).toBeNull();
  });

  it("uses every indexed and nonindexed triangle with parent transforms and nonuniform scale", () => {
    const rng = random(726);
    for (const indexed of [true, false]) {
      const geometry = new THREE.TorusKnotGeometry(1.5, 0.3, 70, 10);
      const mesh = new THREE.Mesh(indexed ? geometry : geometry.toNonIndexed(), new THREE.MeshBasicMaterial());
      mesh.position.set(1, 2, -1);
      mesh.rotation.set(0.3, -0.7, 0.4);
      mesh.scale.set(1.3, 0.7, 1.6);
      const parent = new THREE.Group();
      parent.position.set(5, -1, 3);
      parent.rotation.set(-0.2, 0.6, 0.1);
      parent.scale.set(0.8, 1.4, 1.2);
      parent.add(mesh);
      const queries = new StaticCameraQueries();
      expect(queries.addStaticMesh(mesh)).toBe(true);
      // Collider registration ignores drawRange and material sidedness.
      mesh.material.side = THREE.DoubleSide;
      const centre = mesh.getWorldPosition(new THREE.Vector3());
      for (let index = 0; index < 250; index += 1) {
        const origin: Vec3 = [centre.x + (rng() - 0.5) * 14, centre.y + (rng() - 0.5) * 14, centre.z + (rng() - 0.5) * 14];
        const direction: Vec3 = [centre.x - origin[0] + (rng() - 0.5) * 3, centre.y - origin[1] + (rng() - 0.5) * 3, centre.z - origin[2] + (rng() - 0.5) * 3];
        expectDistance(queries.raycast(origin, direction), referenceDistance(mesh, origin, direction));
      }
      mesh.geometry.dispose(); mesh.material.dispose();
    }
  });

  it("keeps triangle meshes as two-sided surfaces even when their shape is closed", () => {
    const queries = new StaticCameraQueries();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    expect(queries.addStaticMesh(mesh)).toBe(true);
    expect(queries.raycast([0, 0, 0], [1, 0, 0])).toBe(1);
    expect(queries.raycast([3, 0, 0], [-1, 0, 0])).toBe(2);
    mesh.position.x = 100;
    mesh.geometry.translate(100, 0, 0);
    expect(queries.raycast([3, 0, 0], [-1, 0, 0])).toBe(2);
    mesh.geometry.dispose(); mesh.material.dispose();
  });

  it("includes thin surfaces and ignores degenerate triangles", () => {
    const queries = new StaticCameraQueries();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 1, 0.000001, 0, 0,
    ], 3));
    geometry.setDrawRange(0, 3);
    const mesh = new THREE.Mesh(geometry);
    queries.addStaticMesh(mesh);
    expect(queries.raycast([0.0000002, 1, 0.2], [0, -1, 0])).toBeCloseTo(1, 10);
    expect(queries.raycast([0.0000002, -1, 0.2], [0, 1, 0])).toBeCloseTo(1, 10);
    expect(queries.raycast([0.0000002, 0, 0.2], [1, 0, 0])).toBeNull();
    geometry.dispose();
  });

  it("matches native heightfield diagonal, sample layout, translation and surface-origin behavior", () => {
    const queries = new StaticCameraQueries();
    queries.addHeightfield({
      ncols: 1, nrows: 1, heights: new Float32Array([0, 0, 0, 8]),
      centre: { x: 10, y: 3, z: 20 }, scale: { x: 2, y: 2, z: 2 },
    });
    expect(queries.raycast([9.5, 30, 19.5], [0, -1, 0])).toBe(27);
    expect(queries.raycast([10.5, 30, 20.5], [0, -1, 0])).toBe(19);
    expect(queries.raycast([9.5, 2.5, 19.5], [0, 1, 0])).toBe(0.5);
    expect(queries.raycast([9.5, 2.5, 19.5], [0, -1, 0])).toBeNull();
    expect(queries.raycast([9.5, 3, 19.5], [0, 1, 0])).toBeNull();
    expect(queries.raycast([9.5, 3, 19.5], [0, -1, 0])).toBe(0);
  });

  it("traverses non-square terrain cells accurately in every ray direction", () => {
    const rng = random(98243);
    const field: HeightfieldInput = {
      ncols: 31, nrows: 17, heights: Float32Array.from({ length: 32 * 18 }, () => (rng() - 0.5) * 8),
      centre: { x: 11, y: 3, z: -7 }, scale: { x: 62, y: 1.7, z: 51 },
    };
    const queries = new StaticCameraQueries();
    queries.addHeightfield(field);
    const mesh = heightfieldMesh(field);
    for (let index = 0; index < 500; index += 1) {
      const origin: Vec3 = [11 + (rng() - 0.5) * 100, 3 + (rng() - 0.5) * 35, -7 + (rng() - 0.5) * 90];
      const target: Vec3 = [11 + (rng() - 0.5) * 60, 3 + (rng() - 0.5) * 10, -7 + (rng() - 0.5) * 50];
      const direction: Vec3 = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
      const limit = 10 + rng() * 90;
      expectDistance(queries.raycast(origin, direction, limit), referenceDistance(mesh, origin, direction, limit));
    }
    // Exact grid seams and outer vertices remain closed, including the seams Rapier can miss.
    for (let col = 0; col <= field.ncols; col += 1) {
      const origin: Vec3 = [field.centre.x - field.scale.x / 2 + col * 2, 30, field.centre.z];
      expectDistance(queries.raycast(origin, [0, -1, 0]), referenceDistance(mesh, origin, [0, -1, 0]));
    }
    field.heights.fill(-1000);
    expect(queries.raycast([11, 30, -7], [0, -1, 0])).not.toBeNull();
    mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
  });

  it("keeps nearest-hit results across many spatially separated obstacles", () => {
    const queries = new StaticCameraQueries();
    for (let x = -20; x <= 20; x += 1) {
      for (let z = -20; z <= 20; z += 1) queries.addStaticBox([x * 5, 1, z * 5], [0.5, 1, 0.5]);
    }
    for (let x = -20; x <= 20; x += 1) {
      expect(queries.raycast([x * 5, 1, -110], [0, 0, 1], 250)).toBe(9.5);
      expect(queries.raycast([x * 5 + 2, 1, -110], [0, 0, 1], 250)).toBeNull();
    }
  });

  it("rejects malformed registrations and nonfinite rays without corrupting later queries", () => {
    const queries = new StaticCameraQueries();
    expect(queries.addStaticBox([0, 0, 0], [-1, 1, 1])).toBe(false);
    expect(queries.addStaticCylinder([0, 0, 0], 1, NaN)).toBe(false);
    expect(queries.addStaticMesh(new THREE.Mesh(new THREE.BufferGeometry()))).toBe(false);
    expect(queries.addHeightfield({ nrows: 1, ncols: 1, heights: new Float32Array(3), centre: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 1, z: 2 } })).toBe(false);
    queries.addStaticBox([0, 0, 0], [1, 1, 1]);
    expect(queries.raycast([Infinity, 0, 0], [1, 0, 0])).toBeNull();
    expect(queries.raycast([0, 0, 0], [NaN, 0, 0])).toBeNull();
    expect(queries.raycast([3, 0, 0], [-1, 0, 0])).toBe(2);
  });
});
