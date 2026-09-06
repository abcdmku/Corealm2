import * as THREE from "three";
import { afterAll, describe, expect, it } from "vitest";
import { ITEMS } from "../game/src/content/items.js";
import {
  FISHING_ROD_LOOKS,
  fishingRodAssetId,
  fishingRodItemForTier,
  isProceduralGearAsset,
  PROCEDURAL_FISHING_ROD_ASSETS,
  registerProceduralGear,
} from "../game/src/render/proceduralGear.js";
import { buildFishingRod } from "../game/src/render/proceduralGearModels.js";
import { AssetRegistry } from "../game/src/render/assets.js";

const rods = Object.entries(FISHING_ROD_LOOKS).map(([itemId, look]) => ({
  itemId, look, group: buildFishingRod(look),
}));

afterAll(() => {
  for (const { group } of rods) {
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    });
  }
});

describe("production fishing rods", () => {
  it("provides the actual carried rod for every fishing tier, including cinderpine", async () => {
    const fishingTools = ITEMS.filter((item) => item.tool?.skill === "fishing");
    const registered = new Map<string, THREE.Group>();
    const assets = new AssetRegistry();
    const registeredIds = registerProceduralGear(assets);
    expect(assets.stats().loaded).toBe(0);
    await Promise.all(registeredIds.map(async (id) => { registered.set(id, await assets.load(id)); }));
    expect(fishingTools.map((item) => item.id).sort()).toEqual(Object.keys(FISHING_ROD_LOOKS).sort());
    for (const item of fishingTools) {
      expect(fishingRodItemForTier(item.tier)).toBe(item.id);
      expect(PROCEDURAL_FISHING_ROD_ASSETS).toContainEqual({
        itemId: item.id, assetId: fishingRodAssetId(item.id),
      });
      expect(isProceduralGearAsset(fishingRodAssetId(item.id))).toBe(true);
      expect(registered.get(fishingRodAssetId(item.id))?.getObjectByName("rod-shaft")).toBeInstanceOf(THREE.Mesh);
    }
    const boundaries: readonly (readonly [number | null | undefined, string])[] = [
      [undefined, "worn_rod"], [null, "worn_rod"], [0, "worn_rod"],
      [1, "palewood_rod"], [4, "palewood_rod"], [5, "duskoak_rod"],
      [9, "duskoak_rod"], [10, "cairnpine_rod"], [19, "cairnpine_rod"],
      [20, "cinderpine_rod"], [25, "cinderpine_rod"],
    ];
    for (const [tier, expected] of boundaries) expect(fishingRodItemForTier(tier)).toBe(expected);
    expect(FISHING_ROD_LOOKS["cinderpine_rod"]!.shaft).not.toBe(FISHING_ROD_LOOKS["cairnpine_rod"]!.shaft);
    for (const group of registered.values()) group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    });
  });

  it("retains the grip origin and held envelope while length increases through the tiers", () => {
    let previousHeight = 0;
    for (const { look, group } of rods) {
      expect(group.position.toArray()).toEqual([0, 0, 0]);
      expect(group.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
      const bounds = new THREE.Box3().setFromObject(group);
      const height = bounds.max.y - bounds.min.y;
      expect(bounds.min.y).toBeCloseTo(-look.length * 0.18 - 0.0005, 5);
      // The model now ENDS at its tip guide. The line and float used to be baked in as static
      // geometry, which is why the envelope reached 0.364 m past the tip and 0.568 m in +Z: a
      // bobber hung in mid-air beside the player for the whole activity. `render/fishingPose.ts`
      // solves both in world space against the school instead.
      expect(bounds.max.y).toBeCloseTo(look.length * 0.82 + 0.0018, 4);
      expect(bounds.min.x).toBeGreaterThan(-0.030);
      expect(bounds.max.x).toBeLessThan(look.bend + 0.030);
      expect(bounds.min.z).toBeGreaterThan(-0.030);
      // Guide eyes and the reel are the only things standing off the shaft, at every tier.
      expect(bounds.max.z).toBeCloseTo(0.088, 3);
      expect(height).toBeGreaterThan(previousHeight);
      if (previousHeight > 0) expect(height / previousHeight).toBeLessThan(1.2);
      previousHeight = height;
    }
  });

  it("covers the wood butt with a separate metal cap plane", () => {
    for (const { group } of rods) {
      const shaft = group.getObjectByName("rod-shaft") as THREE.Mesh<THREE.BufferGeometry>;
      const fittings = group.getObjectByName("rod-fittings") as THREE.Mesh<THREE.BufferGeometry>;
      const shaftBase = shaft.geometry.boundingBox!.min.y;
      const metalBase = fittings.geometry.boundingBox!.min.y;
      expect(shaftBase - metalBase).toBeCloseTo(0.0005, 5);
      const capRadius = (geometry: THREE.BufferGeometry, base: number): number => {
        const positions = geometry.getAttribute("position");
        let radius = 0;
        for (let index = 0; index < positions.count; index += 1) {
          if (Math.abs(positions.getY(index) - base) > 1e-7) continue;
          radius = Math.max(radius, Math.hypot(positions.getX(index), positions.getZ(index)));
        }
        return radius;
      };
      expect(capRadius(fittings.geometry, metalBase)).toBeGreaterThan(capRadius(shaft.geometry, shaftBase));
    }
  });

  it("fits every guide cuff around the curved shaft without exposed gaps or intersections", () => {
    for (const { look, group } of rods) {
      const bindings = group.getObjectByName("rod-line-bobber") as THREE.Mesh<THREE.BufferGeometry>;
      const positions = bindings.geometry.getAttribute("position");
      const colours = bindings.geometry.getAttribute("color");
      const bindingColour = new THREE.Color(look.binding);
      const curvature = 2 * look.bend / (look.length * 0.82) ** 2;
      for (const fraction of [0.20, 0.42, 0.64, 0.82]) {
        const guideY = look.length * fraction;
        let samples = 0;
        for (let index = 0; index < positions.count; index += 1) {
          const x = positions.getX(index);
          const y = positions.getY(index);
          const z = positions.getZ(index);
          if (y < guideY - 0.030 || y > guideY + 0.006) continue;
          if (Math.abs(colours.getX(index) - bindingColour.r) > 1e-6
            || Math.abs(colours.getY(index) - bindingColour.g) > 1e-6
            || Math.abs(colours.getZ(index) - bindingColour.b) > 1e-6) continue;
          // Project each actual cuff vertex onto the curved shaft centreline.
          let nearestY = y;
          for (let iteration = 0; iteration < 4; iteration += 1) {
            const centreX = curvature * nearestY ** 2 * 0.5;
            const slope = curvature * nearestY;
            nearestY -= ((centreX - x) * slope + nearestY - y)
              / (slope * slope + 1 + (centreX - x) * curvature);
          }
          const centreX = curvature * nearestY ** 2 * 0.5;
          const shaftRadius = 0.020 - 0.014 * (nearestY / look.length + 0.18);
          const clearance = Math.hypot(x - centreX, y - nearestY, z) - shaftRadius;
          expect(clearance).toBeGreaterThan(-0.0001);
          expect(clearance).toBeLessThan(0.0021);
          samples += 1;
        }
        expect(samples).toBeGreaterThan(100);
      }
    }
  });

  it("has a smooth closed shaft with continuous taper and no interior section caps", () => {
    for (const { look, group } of rods) {
      const shaft = group.getObjectByName("rod-shaft") as THREE.Mesh<THREE.BufferGeometry>;
      const position = shaft.geometry.getAttribute("position");
      const normal = shaft.geometry.getAttribute("normal");
      const uv = shaft.geometry.getAttribute("uv");
      const rings = new Map<number, Map<number, { point: THREE.Vector3; normal: THREE.Vector3 }>>();
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      for (let index = 0; index < position.count; index += 1) {
        const point = new THREE.Vector3().fromBufferAttribute(position, index);
        const direction = new THREE.Vector3().fromBufferAttribute(normal, index);
        expect(point.toArray().every(Number.isFinite)).toBe(true);
        expect(direction.length()).toBeCloseTo(1, 5);
        if (Math.abs(direction.y) > 0.9) {
          const distanceFromEnd = Math.min(Math.abs(point.y + look.length * 0.18), Math.abs(point.y - look.length * 0.82));
          expect(distanceFromEnd).toBeLessThan(0.003);
        } else {
          const row = uv.getY(index);
          if (!rings.has(row)) rings.set(row, new Map());
          rings.get(row)!.set(uv.getX(index), { point, normal: direction });
        }
        if (index % 3 === 0) {
          a.fromBufferAttribute(position, index);
          b.fromBufferAttribute(position, index + 1).sub(a);
          c.fromBufferAttribute(position, index + 2).sub(a);
          const face = b.cross(c);
          expect(face.lengthSq()).toBeGreaterThan(1e-15);
          expect(face.dot(direction)).toBeGreaterThan(0);
        }
      }
      expect(rings.size).toBeGreaterThanOrEqual(32);
      let previousRadius = Infinity;
      let previousSlope = 0;
      let previousCentre: THREE.Vector3 | null = null;
      for (const [, ring] of [...rings].sort(([a], [b]) => a - b)) {
        expect(ring.size).toBeGreaterThanOrEqual(17);
        const first = ring.get(0)!;
        const opposite = ring.get(0.5)!;
        const seam = ring.get(1)!;
        expect(first.point.distanceTo(seam.point)).toBeLessThan(1e-8);
        expect(first.normal.distanceTo(seam.normal)).toBeLessThan(1e-8);
        const centre = first.point.clone().add(opposite.point).multiplyScalar(0.5);
        const radius = first.point.distanceTo(opposite.point) / 2;
        expect(radius).toBeLessThan(previousRadius);
        previousRadius = radius;
        if (centre.y <= 0) expect(Math.abs(centre.x)).toBeLessThan(1e-7);
        if (previousCentre) {
          const slope = (centre.x - previousCentre.x) / (centre.y - previousCentre.y);
          expect(Math.abs(slope - previousSlope)).toBeLessThan(0.025);
          previousSlope = slope;
        }
        previousCentre = centre;
      }
      expect(previousRadius).toBeCloseTo(0.006, 5);
      expect(previousCentre!.x).toBeCloseTo(look.bend, 5);
    }
  });

  it("keeps smooth material response and merged draw cost for the held tool", () => {
    for (const { group } of rods) {
      const meshes = group.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[];
      expect(meshes).toHaveLength(3);
      const wood = meshes.find((mesh) => mesh.name === "rod-shaft")!.material as THREE.MeshPhysicalMaterial;
      const fittings = meshes.find((mesh) => mesh.name === "rod-fittings")!.material;
      expect(wood.normalMap).toBeInstanceOf(THREE.DataTexture);
      expect(wood.clearcoat).toBeGreaterThan(0);
      expect(fittings.metalness).toBeGreaterThan(wood.metalness);
      let triangles = 0;
      for (const mesh of meshes) {
        expect(mesh.material.flatShading).toBe(false);
        expect(mesh.geometry.boundingBox?.isEmpty()).toBe(false);
        expect(mesh.geometry.boundingSphere?.radius).toBeGreaterThan(0);
        expect(mesh.geometry.getAttribute("color").count).toBe(mesh.geometry.getAttribute("position").count);
        triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count) / 3;
      }
      expect(triangles).toBeLessThan(18000);
    }
  });
});
