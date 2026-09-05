import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildEquipmentCoreGeometry } from "../game/src/render/equipmentDetails.js";
import { buildEquipmentDagger } from "../game/src/render/proceduralGearModels.js";

function meshes(group: THREE.Group): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] {
  const result: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) result.push(object);
  });
  return result;
}

function signedVolume(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute("position");
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let volume = 0;
  for (let offset = 0; offset < position.count; offset += 3) {
    a.fromBufferAttribute(position, offset);
    b.fromBufferAttribute(position, offset + 1);
    c.fromBufferAttribute(position, offset + 2);
    volume += a.dot(b.cross(c)) / 6;
  }
  return volume;
}

describe("shared production equipment details", () => {
  it("keeps a full grip at the guard-origin hand socket and a closed short blade", () => {
    const dagger = buildEquipmentDagger();
    const bounds = new THREE.Box3().setFromObject(dagger);
    expect(bounds.min.y).toBeCloseTo(-0.208, 6);
    expect(bounds.max.y).toBeCloseTo(0.570, 6);
    expect(bounds.getSize(new THREE.Vector3()).x).toBeCloseTo(0.180, 6);
    const grip = meshes(dagger).find((mesh) => mesh.material.userData.equipmentRole === "leather")!;
    expect(grip.geometry.boundingBox!.min.y).toBeCloseTo(-0.170, 6);
    expect(grip.geometry.boundingBox!.max.y).toBeCloseTo(-0.030, 6);
    const gripCenter = grip.geometry.boundingBox!.getCenter(new THREE.Vector3());
    expect(gripCenter.distanceTo(new THREE.Vector3(0, -0.100, 0))).toBeLessThan(0.0002);
    // The existing grip offset cancels the authored center after the +Y-to-hand-Z rotation.
    gripCenter.applyEuler(new THREE.Euler(Math.PI / 2, 0, 0)).add(new THREE.Vector3(0, 0, 0.100));
    expect(gripCenter.length()).toBeLessThan(0.0002);
    const blade = meshes(dagger).find((mesh) => mesh.material.userData.equipmentRole === "blade")!;
    expect(blade.geometry.boundingBox!.getSize(new THREE.Vector3()).z).toBeGreaterThan(0.019);
    expect(signedVolume(blade.geometry)).toBeGreaterThan(0.00025);
  });

  it("separates tintable metal from leather and gem without per-detail draws", () => {
    const parts = meshes(buildEquipmentDagger());
    expect(parts).toHaveLength(4);
    expect(new Set(parts.map((part) => part.material.userData.equipmentRole)))
      .toEqual(new Set(["blade", "metal", "leather", "gem"]));
    for (const part of parts) {
      expect(part.material.name).toBe(`equipment-dagger-${part.material.userData.equipmentRole}`);
      expect(part.material.vertexColors).toBe(true);
      const geometry = part.geometry;
      for (const attribute of ["position", "normal", "color"]) {
        expect(Array.from(geometry.getAttribute(attribute).array).every(Number.isFinite), `${part.name} ${attribute}`).toBe(true);
      }
      expect(geometry.boundingSphere!.radius).toBeGreaterThan(0);
    }
    const leather = parts.find((part) => part.material.userData.equipmentRole === "leather")!;
    const blade = parts.find((part) => part.material.userData.equipmentRole === "blade")!;
    expect(leather.material.roughness).toBeGreaterThan(blade.material.roughness);
    expect(leather.material.metalness).toBe(0);
  });

  it("builds a closed unit crystal with outward facets and restrained stone variation", () => {
    const core = buildEquipmentCoreGeometry();
    const position = core.getAttribute("position");
    const normal = core.getAttribute("normal");
    expect(position.count / 3).toBeGreaterThan(100);
    expect(position.count / 3).toBeLessThan(400);
    expect(core.boundingBox!.getCenter(new THREE.Vector3()).length()).toBeLessThan(1e-7);
    expect(core.boundingSphere!.radius).toBeCloseTo(1, 6);
    expect(signedVolume(core)).toBeGreaterThan(3.7);
    expect(signedVolume(core)).toBeLessThan(4.19);
    const point = new THREE.Vector3();
    const direction = new THREE.Vector3();
    for (let vertex = 0; vertex < position.count; vertex++) {
      point.fromBufferAttribute(position, vertex);
      direction.fromBufferAttribute(normal, vertex);
      expect(direction.length()).toBeCloseTo(1, 5);
      expect(point.dot(direction)).toBeGreaterThan(0.8);
    }
    const colors = Array.from(core.getAttribute("color").array);
    expect(Math.min(...colors)).toBeGreaterThanOrEqual(0.72);
    expect(Math.min(...colors)).toBeLessThan(0.8);
    expect(Math.max(...colors)).toBeLessThanOrEqual(1);
  });

  it("gives callers independent resources for asset caching and icon disposal", () => {
    const first = meshes(buildEquipmentDagger());
    const second = meshes(buildEquipmentDagger());
    first.forEach((part, index) => {
      const other = second[index]!;
      expect(part.material).not.toBe(other.material);
      expect(part.geometry).not.toBe(other.geometry);
      expect(part.geometry.getAttribute("position").array).not.toBe(other.geometry.getAttribute("position").array);
      const originalColor = other.material.color.getHex();
      part.material.color.setHex(0xff00ff);
      part.geometry.translate(100, 0, 0);
      part.geometry.dispose();
      part.material.dispose();
      expect(other.material.color.getHex()).toBe(originalColor);
      expect(other.geometry.getAttribute("position").getX(0)).toBeLessThan(1);
    });
    const firstCore = buildEquipmentCoreGeometry();
    const secondCore = buildEquipmentCoreGeometry();
    firstCore.scale(10, 10, 10);
    firstCore.dispose();
    secondCore.computeBoundingSphere();
    expect(secondCore.boundingSphere!.radius).toBeCloseTo(1, 6);
  });
});
