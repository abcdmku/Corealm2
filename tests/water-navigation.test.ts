import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import type { Vec3 } from "../game/src/contracts.js";
import { Navigation } from "../game/src/systems/navigation.js";
import { dryNavigationMeshes, type NavigationWaterBody } from "../game/src/world/waterNavigation.js";

function water(contour: NavigationWaterBody["contour"], level = 1): NavigationWaterBody {
  return { id: "pond", contour, level, floorY: 0 };
}

function triangle(vertices: number[]): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
}

function floor(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(40, 32, 20, 16);
  geometry.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
}

function dispose(source: THREE.Mesh[], clones: THREE.Mesh[]): void {
  for (const mesh of clones) mesh.geometry.dispose();
  for (const mesh of source) {
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
  }
}

function samplePath(path: Vec3[], check: (x: number, z: number) => void): void {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.1);
    for (let step = 0; step <= steps; step++) {
      const t = step / Math.max(1, steps);
      check(a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t);
    }
  }
}

beforeAll(async () => Navigation.initLibrary());

describe("water navigation geometry", () => {
  it("removes wet triangles crossed only by polygon edges, and ponds contained inside a triangle", () => {
    const source = triangle([-5, 0, -5, 5, 0, -5, 0, 0, 5]);
    const crossed = dryNavigationMeshes([source], [water([[-6, -0.2], [6, -0.2], [6, 0.2], [-6, 0.2]])]);
    const contained = dryNavigationMeshes([source], [water([[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]])]);
    expect(crossed.excludedTriangles).toBe(1);
    expect(contained.excludedTriangles).toBe(1);
    expect(crossed.meshes[0]!.geometry.index!.count).toBe(0);
    expect(source.geometry.index).toBeNull();
    dispose([source], [...crossed.meshes, ...contained.meshes]);
  });

  it("tests only the submerged portion of a sloping triangle", () => {
    const source = triangle([-5, 0, 0, 5, 4, -5, 5, 4, 5]);
    const dryEnd = dryNavigationMeshes([source], [water([[2, -1], [4, -1], [4, 1], [2, 1]])]);
    const wetEnd = dryNavigationMeshes([source], [water([[-4.8, -0.1], [-4.5, -0.1], [-4.5, 0.1], [-4.8, 0.1]])]);
    expect(dryEnd.excludedTriangles).toBe(0);
    expect(wetEnd.excludedTriangles).toBe(1);
    dispose([source], [...dryEnd.meshes, ...wetEnd.meshes]);
  });

  it("preserves elevated decks and original attributes, groups and parent transforms", () => {
    const parent = new THREE.Group();
    parent.position.set(12, 3, -9);
    parent.rotation.y = 0.37;
    parent.scale.set(1.2, 1, 0.8);
    const source = floor();
    source.geometry.clearGroups();
    source.geometry.addGroup(0, 960, 0);
    source.geometry.addGroup(960, 960, 1);
    parent.add(source);
    parent.updateMatrixWorld(true);
    const originalIndex = Array.from(source.geometry.index!.array);
    const originalPositions = Array.from(source.geometry.getAttribute("position").array);
    const filtered = dryNavigationMeshes([source], [water([[5, -15], [20, -15], [20, 0], [5, 0]])]);
    const clone = filtered.meshes[0]!;
    expect(filtered.excludedTriangles).toBe(0);
    expect(clone.parent).toBeNull();
    expect(clone.matrixWorld.elements).toEqual(source.matrixWorld.elements);
    expect(clone.material).toBe(source.material);
    expect(clone.geometry).not.toBe(source.geometry);
    expect(clone.geometry.getAttribute("position")).not.toBe(source.geometry.getAttribute("position"));
    expect(clone.geometry.groups).toEqual(source.geometry.groups);
    clone.updateWorldMatrix(true, false);
    expect(clone.matrixWorld.elements).toEqual(source.matrixWorld.elements);
    clone.geometry.dispose();
    expect(Array.from(source.geometry.index!.array)).toEqual(originalIndex);
    expect(Array.from(source.geometry.getAttribute("position").array)).toEqual(originalPositions);
    dispose([source], []);
  });

  it("preserves material-group ranges after triangles are removed", () => {
    const source = triangle([
      -5, 0, -1, -3, 0, -1, -4, 0, 1,
      -1, 0, -1, 1, 0, -1, 0, 0, 1,
      3, 0, -1, 5, 0, -1, 4, 0, 1,
    ]);
    source.geometry.addGroup(0, 6, 0);
    source.geometry.addGroup(6, 3, 1);
    source.geometry.setDrawRange(3, 6);
    const filtered = dryNavigationMeshes([source], [water([[-2, -2], [2, -2], [2, 2], [-2, 2]])]);
    expect(filtered.excludedTriangles).toBe(1);
    expect(filtered.meshes[0]!.geometry.groups).toEqual([
      { start: 0, count: 3, materialIndex: 0 }, { start: 3, count: 3, materialIndex: 1 },
    ]);
    expect(filtered.meshes[0]!.geometry.drawRange).toEqual({ start: 3, count: 3 });
    dispose([source], filtered.meshes);
  });

  it("masks parent-transformed indexed and non-indexed terrain in world coordinates", () => {
    const parent = new THREE.Group();
    parent.position.set(12, -2, -9);
    parent.rotation.y = 0.61;
    parent.scale.set(1.3, 1, 0.8);
    const source = floor();
    parent.add(source);
    parent.updateMatrixWorld(true);
    const baked = new THREE.Mesh(source.geometry.clone().applyMatrix4(source.matrixWorld), source.material);
    const flat = new THREE.Mesh(source.geometry.toNonIndexed(), source.material);
    parent.add(flat);
    parent.updateMatrixWorld(true);
    const body = water([[7, -14], [17, -14], [17, -4], [7, -4]]);
    const transformed = dryNavigationMeshes([source], [body]);
    const reference = dryNavigationMeshes([baked], [body]);
    const nonIndexed = dryNavigationMeshes([flat], [body]);
    expect(transformed.excludedTriangles).toBeGreaterThan(20);
    expect(transformed.excludedTriangles).toBe(reference.excludedTriangles);
    expect(transformed.excludedTriangles).toBe(nonIndexed.excludedTriangles);
    expect(Array.from(transformed.meshes[0]!.geometry.index!.array))
      .toEqual(Array.from(reference.meshes[0]!.geometry.index!.array));
    dispose([source], [...transformed.meshes, ...reference.meshes, ...nonIndexed.meshes]);
    baked.geometry.dispose();
    flat.geometry.dispose();
  });

  it("builds a real Recast route around the pond and leaves no wet floor island to snap onto", () => {
    const source = floor();
    const filtered = dryNavigationMeshes([source], [water([[-5, -5], [5, -5], [5, 5], [-5, 5]])]);
    try {
      const navigation = new Navigation();
      expect(navigation.build(filtered.meshes, "solo", { cs: 0.6 })).toBe(true);
      expect(filtered.sourceTriangles).toBe(640);
      expect(filtered.excludedTriangles).toBeGreaterThan(50);
      expect(filtered.excludedByBody.pond).toBe(filtered.excludedTriangles);
      expect(navigation.closestPoint([0, 0, 0])).toBeNull();
      for (const point of [[-8, 0, 0], [8, 0, 0]] as Vec3[]) {
        const snapped = navigation.closestPoint(point);
        expect(snapped).not.toBeNull();
        expect(Math.hypot(snapped![0] - point[0], snapped![2] - point[2])).toBeLessThan(0.7);
      }
      const path = navigation.findPath([-15, 0, 0], [15, 0, 0]);
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(2);
      samplePath(path!, (x, z) => expect(Math.abs(x) >= 5 || Math.abs(z) >= 5).toBe(true));
    } finally {
      dispose([source], filtered.meshes);
    }
  });

  it("keeps the dry inlet of a concave shoreline navigable instead of carving its bounding box", () => {
    const source = floor();
    const filtered = dryNavigationMeshes([source], [water([
      [-6, -6], [6, -6], [6, -2], [-2, -2], [-2, 6], [-6, 6],
    ])]);
    try {
      const navigation = new Navigation();
      expect(navigation.build(filtered.meshes, "solo", { cs: 0.6 })).toBe(true);
      const dryInlet = navigation.closestPoint([4, 0, 4]);
      expect(dryInlet).not.toBeNull();
      expect(Math.hypot(dryInlet![0] - 4, dryInlet![2] - 4)).toBeLessThan(0.2);
      const path = navigation.findPath([12, 0, 4], [4, 0, 4]);
      expect(path).not.toBeNull();
      samplePath(path!, (x, z) => expect(x > -2 && z > -2).toBe(true));
    } finally {
      dispose([source], filtered.meshes);
    }
  });
});
