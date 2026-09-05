import { createHash } from "node:crypto";
import { NodeIO, getBounds } from "@gltf-transform/core";
import { KHRMaterialsIOR, KHRMaterialsTransmission, KHRMaterialsVolume, type IOR, type Transmission, type Volume } from "@gltf-transform/extensions";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FARM_ASSET_IDS, buildFarmAsset, buildFarmGeometry, farmOutputPaths } from "../tools/build-corealm-farm.js";

function down(group: THREE.Object3D, x: number, z: number): THREE.Intersection[] {
  group.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0), 0, 3).intersectObject(group, true);
}

describe("native farm props", () => {
  it("keeps grounded compact native bounds suitable for the existing yard scales", () => {
    for (const id of FARM_ASSET_IDS) {
      const group = buildFarmGeometry(id), bounds = new THREE.Box3().setFromObject(group);
      const size = bounds.getSize(new THREE.Vector3());
      expect(size.toArray().map(value => Number(value.toFixed(5)))).toEqual(id === "corealm_scarecrow" ? [1.65, 1.95, 0.58] : [1.4, 0.76, 0.76]);
      expect(bounds.min.y).toBeCloseTo(0, 5);
      expect(bounds.min.x + bounds.max.x).toBeCloseTo(0, 5);
      expect(bounds.min.z + bounds.max.z).toBeCloseTo(0, 5);
    }
  });

  it("builds a hollow timber basin with inset fills and identical hulls", () => {
    const feed = buildFarmGeometry("corealm_feed_trough"), water = buildFarmGeometry("corealm_water_trough");
    const hull = (group: THREE.Group) => group.children.filter(child => ["timber", "iron"].includes(child.userData.farmRole));
    expect(hull(feed).map(child => child.name)).toEqual(hull(water).map(child => child.name));
    for (const child of hull(feed) as THREE.Mesh[]) {
      const same = water.getObjectByName(child.name) as THREE.Mesh;
      for (const attribute of ["position", "normal", "uv"]) expect(same.geometry.getAttribute(attribute).array).toEqual(child.geometry.getAttribute(attribute).array);
    }
    for (const group of [feed, water]) {
      const shell = new THREE.Group(); for (const child of hull(group)) shell.add(child.clone());
      const floor = down(shell, 0, 0)[0];
      expect(floor).toBeDefined();
      expect(floor!.object.name).toContain("hull-stave");
      expect(floor!.point.y).toBeGreaterThan(0.3);
      expect(floor!.point.y).toBeLessThan(0.45);
      for (const x of [-0.4, 0.4]) for (const z of [-0.35, 0.35]) {
        const rim = down(shell, x, z)[0];
        expect(rim?.object.name).toContain("rim");
        expect(rim!.point.y).toBeGreaterThan(floor!.point.y + 0.28);
      }
      for (const x of [-0.67, 0.67]) {
        const end = down(shell, x, 0)[0];
        expect(end?.object.name).toMatch(/end-rim|end-board/);
        expect(end!.point.y).toBeGreaterThan(0.7);
      }
      const fill = down(group, 0, 0)[0];
      expect(fill!.point.y).toBeGreaterThan(floor!.point.y + 0.07);
      expect(fill!.point.y).toBeLessThan(0.70);
      expect(fill!.object.name).toBe(group === feed ? "low-feed-bed" : "inset-waterline");
    }
  });

  it("exposes feed at the approach angle and retains a closed rippled water volume", () => {
    const feed = buildFarmGeometry("corealm_feed_trough");
    feed.updateMatrixWorld(true);
    for (const x of [-0.4, 0, 0.4]) {
      const origin = new THREE.Vector3(x, 1.8, 3), target = new THREE.Vector3(x, 0.65, -0.1);
      const first = new THREE.Raycaster(origin, target.sub(origin).normalize(), 0, 5).intersectObject(feed, true)[0];
      expect(first?.object.userData.farmRole, `feed visible above approach-side lip at x=${x}`).toBe("straw");
    }
    const water = buildFarmGeometry("corealm_water_trough");
    const top = (water.getObjectByName("inset-waterline") as THREE.Mesh).geometry;
    const normals = top.getAttribute("normal"), position = top.getAttribute("position");
    const heights = Array.from({ length: position.count }, (_, i) => position.getY(i));
    const slopes = Array.from({ length: normals.count }, (_, i) => Math.hypot(normals.getX(i), normals.getZ(i)));
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.009);
    expect(Math.max(...slopes)).toBeGreaterThan(0.18);
    expect(Math.min(...Array.from({ length: normals.count }, (_, i) => normals.getY(i)))).toBeGreaterThan(0.9);
    const edgeCounts = new Map<string, number>();
    const edgeDirections = new Map<string, number>();
    for (const mesh of water.children.filter(child => child.userData.farmRole === "water") as THREE.Mesh[]) {
      const points = mesh.geometry.getAttribute("position");
      const key = (index: number) => [points.getX(index), points.getY(index), points.getZ(index)].map(value => value.toFixed(5)).join(",");
      for (let i = 0; i < points.count; i += 3) for (let corner = 0; corner < 3; corner++) {
        const ends = [key(i + corner), key(i + (corner + 1) % 3)];
        const direction = ends[0]! < ends[1]! ? 1 : -1;
        const edge = ends.sort().join("|");
        edgeCounts.set(edge, (edgeCounts.get(edge) ?? 0) + 1);
        edgeDirections.set(edge, (edgeDirections.get(edge) ?? 0) + direction);
      }
    }
    expect([...edgeCounts.values()].every(count => count === 2), "closed water volume has no boundary or duplicate faces").toBe(true);
    expect([...edgeDirections.values()].every(direction => direction === 0), "water volume faces share consistent outward winding").toBe(true);
  });

  it("has finite nondegenerate geometry, unit smooth normals, and valid texture triangles", () => {
    for (const id of FARM_ASSET_IDS) {
      const group = buildFarmGeometry(id);
      for (const mesh of group.children as THREE.Mesh[]) {
        const position = mesh.geometry.getAttribute("position"), normal = mesh.geometry.getAttribute("normal"), uv = mesh.geometry.getAttribute("uv");
        expect([...position.array, ...normal.array, ...uv.array].every(Number.isFinite), mesh.name).toBe(true);
        let invalidGeometry = 0, invalidUVs = 0, invalidNormals = 0;
        for (let i = 0; i < position.count; i++) {
          if (Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1) > 0.001) invalidNormals++;
        }
        for (let i = 0; i < position.count; i += 3) {
          const a = new THREE.Vector3().fromBufferAttribute(position, i), b = new THREE.Vector3().fromBufferAttribute(position, i + 1), c = new THREE.Vector3().fromBufferAttribute(position, i + 2);
          if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-18) invalidGeometry++;
          const ua = new THREE.Vector2(uv.getX(i), uv.getY(i)), ub = new THREE.Vector2(uv.getX(i + 1), uv.getY(i + 1)), uc = new THREE.Vector2(uv.getX(i + 2), uv.getY(i + 2));
          if (Math.abs(ub.sub(ua).cross(uc.sub(ua))) < 1e-12) invalidUVs++;
        }
        expect(invalidGeometry, `${mesh.name} degenerate geometry`).toBe(0);
        expect(invalidNormals, `${mesh.name} invalid normals`).toBe(0);
        expect(invalidUVs, `${mesh.name} degenerate texture triangles`).toBe(0);
      }
    }
  });

  it("keeps the cloth and timber UV islands inside the shared atlas's plain material regions", () => {
    for (const id of FARM_ASSET_IDS) for (const mesh of buildFarmGeometry(id).children as THREE.Mesh[]) {
      const role = mesh.userData.farmRole;
      if (!["cloth", "sack", "hat", "timber"].includes(role)) continue;
      const uv = mesh.geometry.getAttribute("uv");
      const values = Array.from({ length: uv.count }, (_, i) => [uv.getX(i), uv.getY(i)] as const);
      const u = values.map(value => value[0]), v = values.map(value => value[1]);
      const region = role === "timber" ? [0.045, 0.945, 0.225, 0.385] : [0.055, 0.185, 0.16, 0.42];
      expect(Math.min(...u), mesh.name).toBeGreaterThanOrEqual(region[0]! - 1e-6);
      expect(Math.max(...u), mesh.name).toBeLessThanOrEqual(region[1]! + 1e-6);
      expect(Math.min(...v), mesh.name).toBeGreaterThanOrEqual(region[2]! - 1e-6);
      expect(Math.max(...v), mesh.name).toBeLessThanOrEqual(region[3]! + 1e-6);
    }
  });

  it("serializes original geometry with preserved existing cloth and timber PBR maps", async () => {
    const io = new NodeIO().registerExtensions([KHRMaterialsIOR, KHRMaterialsTransmission, KHRMaterialsVolume]);
    const source = await io.read("game/public/assets/models/prop/training_dummy.glb");
    const sourceHashes = new Set(source.getRoot().listTextures().map(texture => createHash("sha256").update(texture.getImage()!).digest("hex")));
    for (const id of FARM_ASSET_IDS) {
      const { glb, entry } = await buildFarmAsset(id), document = await io.readBinary(glb);
      const bounds = getBounds(document.getRoot().getDefaultScene()!);
      expect(entry.sha256).toBe(createHash("sha256").update(glb).digest("hex"));
      if (id === "corealm_scarecrow") expect(entry.sha256, "accepted scarecrow stays byte exact").toBe("8fb47a7e34920781004a4e53ccccb9bc1085c659966905271d7b4721850ff81f");
      expect(entry.pack).toBe("corealm-original-farm");
      expect(document.getRoot().listNodes().length).toBeLessThanOrEqual(7);
      expect(document.getRoot().listAnimations()).toHaveLength(0);
      expect(entry.triangles).toBeLessThan(50000);
      for (let axis = 0; axis < 3; axis++) {
        expect(bounds.min[axis]).toBeCloseTo(Object.values(entry.base!)[axis]!, 5);
        expect(bounds.max[axis]! - bounds.min[axis]!).toBeCloseTo(Object.values(entry.size)[axis]!, 5);
      }
      for (const material of document.getRoot().listMaterials()) {
        expect(material.getName()).toMatch(/^Corealm farm /);
        if (/timber|cloth|sacking|felt/.test(material.getName())) {
          expect(material.getBaseColorTexture()).not.toBeNull();
          expect(material.getNormalTexture()).not.toBeNull();
          expect(material.getMetallicRoughnessTexture()).not.toBeNull();
        }
        if (material.getName().startsWith("Corealm farm water")) {
          expect(material.getExtension<IOR>("KHR_materials_ior")?.getIOR()).toBe(1.333);
          expect(material.getExtension<Transmission>("KHR_materials_transmission")?.getTransmissionFactor()).toBe(0.94);
          expect(material.getExtension<Volume>("KHR_materials_volume")?.getThicknessFactor()).toBe(0.12);
          expect(material.getRoughnessFactor()).toBe(0.085);
          expect(material.getEmissiveFactor()).toEqual([0, 0, 0]);
          expect(material.getExtras().entityCastShadow).toBe(false);
        }
      }
      for (const texture of document.getRoot().listTextures()) {
        expect(sourceHashes.has(createHash("sha256").update(texture.getImage()!).digest("hex"))).toBe(true);
      }
    }
  });

  it("cannot write staged assets into public or outside test-results", () => {
    expect(farmOutputPaths().models).toMatch(/test-results[\\/]farm-props[\\/]models[\\/]corealm[\\/]farm$/);
    for (const target of ["game/public/assets", "test-results/../../game/public/assets", "", "../farm-props"]) expect(() => farmOutputPaths(target)).toThrow(/inside test-results/);
  });
});
