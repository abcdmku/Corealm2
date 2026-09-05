import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { finalizeScatterBounds, scatterWindMargin } from "../game/src/render/scatterBounds.js";

function windOffset(main: number, ripple: number, strength: number): THREE.Vector3 {
  return new THREE.Vector3(0.86 * main - 0.22 * ripple, 0, 0.51 * main + 0.37 * ripple)
    .multiplyScalar(strength);
}

function transformOffset(offset: THREE.Vector3, matrix: THREE.Matrix4): THREE.Vector3 {
  return offset.applyMatrix3(new THREE.Matrix3().setFromMatrix4(matrix));
}

describe("scatter wind margin", () => {
  it("ignores translation and encloses the full bend range after rotation and nonuniform scale", () => {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(800, -300, 1400),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.62, 1.1, -0.45)),
      new THREE.Vector3(0.4, 2.8, 3.7),
    );
    const strength = 0.085;
    const margin = scatterWindMargin(matrix, strength);
    const translated = matrix.clone().setPosition(-2000, 90, 3000);
    expect(scatterWindMargin(translated, strength)).toBeCloseTo(margin, 12);
    expect(scatterWindMargin(matrix, -strength)).toBe(margin);
    expect(scatterWindMargin(matrix, 0)).toBe(0);

    let greatestSample = 0;
    for (let main = -10; main <= 10; main += 1) {
      for (let ripple = -10; ripple <= 10; ripple += 1) {
        const distance = transformOffset(windOffset(main / 10, ripple / 10, strength), matrix).length();
        expect(distance).toBeLessThanOrEqual(margin + 1e-12);
        greatestSample = Math.max(greatestSample, distance);
      }
    }
    expect(greatestSample).toBeCloseTo(margin, 12);
  });

  it("retains displacement for a shear that would defeat a single axis scale estimate", () => {
    const matrix = new THREE.Matrix4().set(
      1, 0, 1.6, 0,
      0.4, 1, -0.8, 0,
      0.7, 0, 1, 0,
      0, 0, 0, 1,
    );
    const margin = scatterWindMargin(matrix, 0.075);
    for (const main of [-1, 1]) {
      for (const ripple of [-1, 1]) {
        const bend = transformOffset(windOffset(main, ripple, 0.075), matrix);
        expect(bend.length()).toBeLessThanOrEqual(margin + 1e-12);
      }
    }
  });
});

describe("scatter bounds", () => {
  it("contains transformed vertices at all wind extremes and preserves source data", () => {
    const geometry = new THREE.BoxGeometry(1.6, 3.2, 0.7);
    geometry.translate(0.3, 1.4, -0.2);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.InstancedMesh(geometry, material, 4);
    const transforms = [
      new THREE.Matrix4().compose(
        new THREE.Vector3(-45, 1, -35),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, 0.9, -0.2)),
        new THREE.Vector3(2, 0.7, 1.4),
      ),
      new THREE.Matrix4().compose(
        new THREE.Vector3(50, 5, -25),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 2.1, 0.6)),
        new THREE.Vector3(0.5, 3, 2.2),
      ),
      new THREE.Matrix4().makeTranslation(-40, -2, 45),
      new THREE.Matrix4().makeTranslation(55, 3, 50),
    ];
    for (const [index, matrix] of transforms.entries()) mesh.setMatrixAt(index, matrix);
    // Use the uploaded float32 matrices, which are the transforms the renderer sees.
    const renderedTransforms = transforms.map((_, index) => {
      const matrix = new THREE.Matrix4();
      mesh.getMatrixAt(index, matrix);
      return matrix;
    });
    const positions = Array.from(geometry.getAttribute("position").array);
    const matrices = Array.from(mesh.instanceMatrix.array);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const sourceBox = geometry.boundingBox!.clone();
    const sourceSphere = geometry.boundingSphere!.clone();
    const strength = 0.085;
    const margin = Math.max(...renderedTransforms.map((matrix) => scatterWindMargin(matrix, strength)));

    finalizeScatterBounds(mesh, margin);

    expect(Array.from(geometry.getAttribute("position").array)).toEqual(positions);
    expect(Array.from(mesh.instanceMatrix.array)).toEqual(matrices);
    expect(geometry.boundingBox!.equals(sourceBox)).toBe(true);
    expect(geometry.boundingSphere!.equals(sourceSphere)).toBe(true);
    const attribute = geometry.getAttribute("position");
    for (const matrix of renderedTransforms) {
      for (let index = 0; index < attribute.count; index += 1) {
        for (const main of [-1, 0, 1]) {
          for (const ripple of [-1, 0, 1]) {
            const point = new THREE.Vector3().fromBufferAttribute(attribute, index)
              .add(windOffset(main, ripple, strength)).applyMatrix4(matrix);
            expect(mesh.boundingBox!.distanceToPoint(point)).toBeLessThanOrEqual(1e-10);
            expect(point.distanceTo(mesh.boundingSphere!.center))
              .toBeLessThanOrEqual(mesh.boundingSphere!.radius + 1e-10);
          }
        }
      }
    }
    geometry.dispose();
    material.dispose();
  });

  it("tightens an inflated sphere around a flat tile", () => {
    const geometry = new THREE.SphereGeometry(1, 12, 8);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.InstancedMesh(geometry, material, 4);
    for (const [index, [x, z]] of [[-50, -50], [50, -50], [50, 50], [-50, 50]].entries()) {
      mesh.setMatrixAt(index, new THREE.Matrix4().makeTranslation(x!, 0, z!));
    }
    mesh.computeBoundingSphere();
    const originalRadius = mesh.boundingSphere!.radius;

    finalizeScatterBounds(mesh, 0.25);

    expect(mesh.boundingSphere!.radius).toBeLessThan(originalRadius);
    expect(mesh.boundingSphere!.radius).toBeCloseTo(Math.sqrt(51.25 ** 2 * 2 + 1.25 ** 2), 5);
    geometry.dispose();
    material.dispose();
  });

  it("keeps the existing sphere when the box would loosen a round asset", () => {
    const geometry = new THREE.SphereGeometry(2, 16, 8);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.InstancedMesh(geometry, material, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(17, 3, -8));
    mesh.computeBoundingSphere();
    const originalRadius = mesh.boundingSphere!.radius;

    finalizeScatterBounds(mesh, 0.2);

    expect(mesh.boundingSphere!.radius).toBeCloseTo(originalRadius + 0.2, 12);
    expect(mesh.boundingSphere!.center.toArray()).toEqual([17, 3, -8]);
    geometry.dispose();
    material.dispose();
  });

  it("keeps empty instances empty and can finalize again after matrices change", () => {
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.InstancedMesh(geometry, material, 1);
    mesh.count = 0;

    finalizeScatterBounds(mesh, 3);

    expect(mesh.boundingBox!.isEmpty()).toBe(true);
    expect(mesh.boundingSphere!.isEmpty()).toBe(true);
    expect(Number.isNaN(mesh.boundingSphere!.radius)).toBe(false);
    mesh.count = 1;
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(12, 0, 5));
    finalizeScatterBounds(mesh, 0);
    expect(mesh.boundingBox!.containsPoint(new THREE.Vector3(12, 0, 5))).toBe(true);
    expect(mesh.boundingSphere!.containsPoint(new THREE.Vector3(12, 0, 5))).toBe(true);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-20, 0, -10));
    finalizeScatterBounds(mesh, 0);
    expect(mesh.boundingBox!.containsPoint(new THREE.Vector3(-20, 0, -10))).toBe(true);
    expect(mesh.boundingBox!.containsPoint(new THREE.Vector3(12, 0, 5))).toBe(false);
    geometry.dispose();
    material.dispose();
  });
});
