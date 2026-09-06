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
  it.each([0, 1, 2, 3] as const)("keeps grade %i's grip on the guard-origin hand socket", (grade) => {
    const dagger = buildEquipmentDagger(grade);
    const bounds = new THREE.Box3().setFromObject(dagger);
    // A dagger, not a scaled sword: the tier-10 sword beside it is 1.03 m long on a 1.81 m rig.
    const height = bounds.getSize(new THREE.Vector3()).y;
    expect(height).toBeGreaterThan(0.40);
    expect(height).toBeLessThan(0.48);
    // Blade above the guard origin.
    expect(bounds.max.y).toBeGreaterThan(0.25);
    expect(bounds.max.y).toBeLessThan(0.31);
    // The axe form has to stay clearly wider; tests/equipment-weapons.test.ts pins that ratio.
    expect(bounds.getSize(new THREE.Vector3()).x).toBeLessThan(0.17);
    // Every grade keeps the reviewed grip, because the hand socket is measured against it.
    const grip = meshes(dagger).find((mesh) => mesh.material.userData.equipmentRole === "leather")!;
    expect(grip.geometry.boundingBox!.min.y).toBeCloseTo(-0.170, 6);
    expect(grip.geometry.boundingBox!.max.y).toBeCloseTo(-0.030, 6);
    const gripCenter = grip.geometry.boundingBox!.getCenter(new THREE.Vector3());
    expect(gripCenter.distanceTo(new THREE.Vector3(0, -0.100, 0))).toBeLessThan(0.0002);
    // The existing grip offset cancels the authored center after the +Y-to-hand-Z rotation.
    gripCenter.applyEuler(new THREE.Euler(Math.PI / 2, 0, 0)).add(new THREE.Vector3(0, 0, 0.100));
    expect(gripCenter.length()).toBeLessThan(0.0002);
    const blade = meshes(dagger).find((mesh) => mesh.material.userData.equipmentRole === "blade")!;
    // Real section, not a flat sliver, and it thickens with the grade.
    expect(blade.geometry.boundingBox!.getSize(new THREE.Vector3()).z).toBeGreaterThan(0.0075);
    expect(Math.abs(signedVolume(blade.geometry))).toBeGreaterThan(0.000015);
  });

  it("gives the four dagger grades separable silhouettes", () => {
    const measured = [0, 1, 2, 3].map((grade) => {
      const dagger = buildEquipmentDagger(grade as 0 | 1 | 2 | 3);
      const size = new THREE.Box3().setFromObject(dagger).getSize(new THREE.Vector3());
      const blade = meshes(dagger).find((mesh) => mesh.material.userData.equipmentRole === "blade")!;
      return { width: size.x, height: size.y, thickness: blade.geometry.boundingBox!.getSize(new THREE.Vector3()).z };
    });
    // No two grades share a width, and the blade section grows monotonically with the grade.
    expect(new Set(measured.map((row) => row.width.toFixed(4))).size).toBe(4);
    for (let grade = 1; grade < measured.length; grade += 1) {
      expect(measured[grade]!.thickness, `grade ${grade} section`).toBeGreaterThan(measured[grade - 1]!.thickness);
    }
  });

  it("separates tintable metal from leather and gem without per-detail draws", () => {
    for (const grade of [0, 1, 2, 3] as const) {
      const parts = meshes(buildEquipmentDagger(grade));
      // Stones are a high-grade feature: the two lower grades are plain steel and leather.
      const roles = grade >= 2
        ? ["blade", "metal", "leather", "gem"]
        : ["blade", "metal", "leather"];
      expect(parts, `grade ${grade}`).toHaveLength(roles.length);
      expect(new Set(parts.map((part) => part.material.userData.equipmentRole))).toEqual(new Set(roles));
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
    }
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
