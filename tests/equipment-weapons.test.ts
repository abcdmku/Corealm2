import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildEquipmentWeapon } from "../game/src/render/equipmentWeapons.js";
import { buildWeaponCandidate } from "../tools/build-corealm-equipment.js";
import { NodeIO } from "@gltf-transform/core";
import { KHRMaterialsClearcoat } from "@gltf-transform/extensions";
import { readFile } from "node:fs/promises";
import { gearAppearance, gatheringToolAppearance, weaponAttachment } from "../game/src/render/equipmentVisuals.js";

describe("original equipment candidates", () => {
  it("binds the published sword grades and carried axe to the reviewed grips without double size progression", async () => {
    const tiers = ["grithe", "corven", "kaldite", "emberite"];
    for (const [grade, tier] of tiers.entries()) {
      const appearance = gearAppearance(`${tier}_sword`)!;
      expect(appearance.assetId).toBe(`corealm_sword_${grade + 1}`);
      expect(appearance.scale).toBe(0.9);
      expect(weaponAttachment(appearance)?.position).toEqual([-0.01, 0.085, 0.09]);
      const data = await readFile(`game/public/assets/models/corealm/equipment/${appearance.assetId}.glb`);
      const doc = await new NodeIO().registerExtensions([KHRMaterialsClearcoat]).readBinary(data);
      expect(doc.getRoot().listMaterials().some(material => material.getExtras().equipmentRole === "leather" && material.getBaseColorTexture())).toBe(true);
      expect(doc.getRoot().listMaterials().find(material => material.getExtras().equipmentRole === "blade")?.getMetallicFactor()).toBeGreaterThan(0.7);
    }
    const axe = gatheringToolAppearance("grithe_hatchet")!;
    expect(axe.assetId).toBe("corealm_axe_1");
    expect(weaponAttachment(axe)?.position).toEqual([-0.01, 0.085, 0.225]);
    const doc = await new NodeIO().registerExtensions([KHRMaterialsClearcoat]).readBinary(await readFile("game/public/assets/models/corealm/equipment/corealm_axe_1.glb"));
    expect(doc.getRoot().listMaterials().find(material => material.getExtras().equipmentRole === "wood")?.getMetallicFactor()).toBe(0);
  });
  it("keeps six independently authored forms and native hand grip measurements", () => {
    const bounds = new Map();
    for (const form of ["sword", "dagger", "axe", "shield", "staff", "wand"] as const) {
      const model = buildEquipmentWeapon(form, 0);
      expect(model.userData.gripCenter).toHaveLength(3);
      bounds.set(form, new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()));
      model.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        expect([...child.geometry.getAttribute("position").array].every(Number.isFinite)).toBe(true);
      });
    }
    expect(bounds.get("dagger").y).toBeLessThan(bounds.get("sword").y * 0.8);
    expect(bounds.get("axe").x).toBeGreaterThan(bounds.get("dagger").x * 1.7);
    expect(bounds.get("shield").x).toBeGreaterThan(0.58);
    expect(bounds.get("staff").y).toBeGreaterThan(bounds.get("wand").y * 2.4);
  });
  it("exports material-separated GLBs with embedded wood grain and measured bounds", async () => {
    const { glb, entry, gripCenter } = await buildWeaponCandidate("staff", 2);
    const doc = await new NodeIO().registerExtensions([KHRMaterialsClearcoat]).readBinary(glb);
    expect(doc.getRoot().listMaterials()).toHaveLength(4);
    expect(doc.getRoot().listTextures()).toHaveLength(2);
    expect(doc.getRoot().listMeshes()).toHaveLength(4);
    expect(entry.bytes).toBe(glb.byteLength);
    expect(entry.size.y).toBeGreaterThan(1.65);
    expect(gripCenter).toEqual([0, 0, 0]);
    expect(doc.getRoot().listMaterials().find(m => m.getExtras().equipmentRole === "leather")!.getMetallicFactor()).toBe(0);
  });
  it("changes sword blade profiles without resizing its palm grip", () => {
    const sizes = [];
    for (const grade of [0, 1, 2, 3] as const) {
      const model = buildEquipmentWeapon("sword", grade);
      expect(model.userData.gripCenter).toEqual([0, -0.1, 0]);
      const blade = model.getObjectByName("ground-blade") as THREE.Mesh;
      sizes.push(blade.geometry.getAttribute("position").count);
    }
    expect(new Set(sizes).size).toBeGreaterThan(1);
  });
  it("winds every sword face outward, including both cutting edges and the base cap", () => {
    for (const grade of [0, 1, 2, 3] as const) {
      const model = buildEquipmentWeapon("sword", grade);
      const geometry = (model.getObjectByName("ground-blade") as THREE.Mesh).geometry;
      const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
      for (let vertex = 0; vertex < positions.count; vertex += 3) {
        const points = [vertex, vertex + 1, vertex + 2].map(i => new THREE.Vector3().fromBufferAttribute(positions, i));
        const normal = points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!));
        expect(normal.lengthSq()).toBeGreaterThan(0);
        normal.normalize();
        const stored = new THREE.Vector3().fromBufferAttribute(normals, vertex);
        expect(normal.dot(stored)).toBeGreaterThan(0.9999);
        if (points.every(point => Math.abs(point.y - 0.006) < 1e-6)) expect(normal.y).toBeLessThan(-0.999);
        else {
          const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / 3);
          expect(normal.x * center.x + normal.z * center.z, `grade ${grade} inward blade face ${vertex / 3}`).toBeGreaterThan(0);
        }
      }
    }
  });
  it("gives the axe a thin outward-facing cutting edge beyond the forged slab", () => {
    const axe = buildEquipmentWeapon("axe", 0);
    const bit = (axe.getObjectByName("honed-cutting-bit") as THREE.Mesh).geometry;
    const positions = bit.getAttribute("position"), normals = bit.getAttribute("normal");
    let edgeFaces = 0;
    for (let vertex = 0; vertex < positions.count; vertex += 3) {
      const corners = [vertex, vertex + 1, vertex + 2];
      if (corners.every(i => Math.abs(positions.getZ(i)) <= 0.00101)) {
        edgeFaces++;
        expect(normals.getX(vertex)).toBeGreaterThan(0.8);
      }
      if (corners.every(i => Math.abs(positions.getY(i) - 0.44) < 0.00001)) expect(normals.getY(vertex)).toBeGreaterThan(0.9);
      if (corners.every(i => Math.abs(positions.getY(i) - 0.12) < 0.00001)) expect(normals.getY(vertex)).toBeLessThan(-0.9);
    }
    expect(edgeFaces).toBe(28);
    const slab = (axe.getObjectByName("bearded-forged-head") as THREE.Mesh).geometry;
    slab.computeBoundingBox(); bit.computeBoundingBox();
    expect(bit.boundingBox!.max.x - slab.boundingBox!.max.x).toBeGreaterThan(0.02);
  });
});
