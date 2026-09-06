import * as THREE from "three";
import { describe, expect, it } from "vitest";
import RUNTIME_ASSET_MANIFEST from "../game/public/assets/manifest.json";
import { GATHERING_PRODUCTION_TIERS } from "../game/src/content/gatheringProductionTiers.js";
import { tierSilhouetteScale } from "../game/src/core/math.js";
import { EntityViews } from "../game/src/render/entityViews.js";
import { MaterialLibrary } from "../game/src/render/materials.js";
import { SCHOOL_MIN_WATER_DEPTH, WATER_FILL_DEPTH } from "../game/src/world/waterBodies.js";

interface TestPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
  triangles: number;
  resourceDetail?: { kind: string; [key: string]: unknown };
}

interface FishDetail {
  kind: "fish";
  schoolIndex: number;
  depthJitter: number;
  scale: number;
  [key: string]: unknown;
}

const EXPECTED_FISH_PRESENTATION: Readonly<Record<number, {
  targetWorldSize: number;
  waterOffset: number;
}>> = {
  1: { targetWorldSize: 0.42, waterOffset: -0.32 },
  5: { targetWorldSize: 0.72, waterOffset: -0.23 },
  10: { targetWorldSize: 0.92, waterOffset: -0.22 },
  // Ashfin reuses the cragfin mesh under the tier-20 material treatment, with the tarn row's
  // exact draw numbers: the basin clearance margin has no room for a larger fish.
  20: { targetWorldSize: 0.92, waterOffset: -0.22 },
};

const MIN_BASIN_FLOOR_CLEARANCE = 0.018;
const MIN_SURFACE_SUBMERSION = 0.02;

interface FishingViewInternals {
  buildFishingSchool(assetId: string, tier: number, parts: readonly TestPart[]): TestPart[];
  fishingMarkerGeometry(
    assetId: string,
    tier: number,
    span: number,
  ): { ripple: THREE.BufferGeometry; bubbles: THREE.BufferGeometry };
  seamGeometry(
    assetId: string,
    tier: number,
    parts: readonly TestPart[],
  ): THREE.BufferGeometry | null;
  resourceMaterial(
    kind: "water-live" | "water-recovery" | "fire-rock" | "ore-scar" | "ore-dust",
    tier: number,
  ): THREE.MeshStandardMaterial;
  batchFor(part: TestPart, cell: string): { mesh: THREE.BatchedMesh } | null;
  submergedFishMaterials: Map<THREE.Material, THREE.Material>;
}

function createViews(): {
  views: EntityViews;
  materials: MaterialLibrary;
  internals: FishingViewInternals;
} {
  const materials = new MaterialLibrary();
  const scene = {
    entityGroup: new THREE.Group(),
    overlayGroup: new THREE.Group(),
  };
  const views = new EntityViews(scene as never, {} as never, materials);
  return {
    views,
    materials,
    internals: views as unknown as FishingViewInternals,
  };
}

describe("fishing resource visibility", () => {
  it("shares one texture-preserving submerged material across a four-fish school", () => {
    const { views, materials, internals } = createViews();
    const texture = new THREE.DataTexture(new Uint8Array([120, 170, 190, 255]), 1, 1);
    texture.name = "test-fish-map";
    const source = new THREE.MeshStandardMaterial({
      color: 0x87a9b4,
      map: texture,
      roughness: 0.63,
      metalness: 0.04,
    });
    source.name = "test-fish";
    const geometry = new THREE.BoxGeometry(0.8, 0.25, 0.3);
    const part: TestPart = {
      geometry,
      material: source,
      matrix: new THREE.Matrix4(),
      triangles: 12,
    };

    const first = internals.buildFishingSchool("test-fish", 1, [part]);
    const second = internals.buildFishingSchool("test-fish", 1, [part]);
    const fish = first.filter((candidate) => candidate.resourceDetail?.kind === "fish");
    const secondFish = second.find((candidate) => candidate.resourceDetail?.kind === "fish");
    const treated = fish[0]!.material as THREE.MeshStandardMaterial;

    expect(fish).toHaveLength(4);
    expect(new Set(fish.map((candidate) => candidate.material))).toEqual(new Set([treated]));
    expect(secondFish?.material).toBe(treated);
    expect(internals.submergedFishMaterials.size).toBe(1);
    expect(treated).not.toBe(source);
    expect(treated.map).toBe(texture);
    expect(treated.color.getHex()).toBe(source.color.getHex());
    expect(treated.roughness).toBe(source.roughness);
    expect(treated.metalness).toBe(source.metalness);
    expect(treated.transparent).toBe(true);
    expect(treated.opacity).toBeCloseTo(0.64);
    expect(treated.depthWrite).toBe(false);
    expect(source.transparent).toBe(false);
    expect(source.opacity).toBe(1);

    views.dispose();
    materials.dispose();
    source.dispose();
    texture.dispose();
    geometry.dispose();
  });

  it("draws fish and distinct live/recovery markers after water order 2", () => {
    const { views, materials, internals } = createViews();
    const source = new THREE.MeshStandardMaterial();
    const geometry = new THREE.BoxGeometry(0.8, 0.25, 0.3);
    const school = internals.buildFishingSchool("test-fish-order", 5, [{
      geometry,
      material: source,
      matrix: new THREE.Matrix4(),
      triangles: 12,
    }]);
    const fish = school.find((part) => part.resourceDetail?.kind === "fish")!;
    const liveRipple = school.find((part) => part.resourceDetail?.kind === "ripple")!;
    const recoveryMaterial = internals.resourceMaterial("water-recovery", 5);
    const recoveryRipple: TestPart = {
      ...liveRipple,
      material: recoveryMaterial,
      resourceDetail: { kind: "ripple", recovery: true },
    };

    const fishBatch = internals.batchFor(fish, "0_0");
    const liveBatch = internals.batchFor(liveRipple, "0_0");
    const recoveryBatch = internals.batchFor(recoveryRipple, "0_0");
    const liveMaterial = liveRipple.material as THREE.MeshStandardMaterial;

    expect(fishBatch?.mesh.renderOrder).toBe(3);
    expect(liveBatch?.mesh.renderOrder).toBe(4);
    expect(recoveryBatch?.mesh.renderOrder).toBe(4);
    expect(fishBatch?.mesh.renderOrder).toBeGreaterThan(2);
    expect(liveBatch?.mesh.renderOrder).toBeGreaterThan(2);
    expect(recoveryMaterial.opacity).toBeLessThan(liveMaterial.opacity * 0.35);
    expect(liveMaterial.opacity).toBe(0.32);
    expect(recoveryMaterial.opacity).toBe(0.1);

    views.dispose();
    materials.dispose();
    source.dispose();
    geometry.dispose();
  });

  it("keeps a starter-school ripple readable and a low-contrast seam on the sampled rock surface", () => {
    const { views, materials, internals } = createViews();
    const starterMarker = internals.fishingMarkerGeometry("starter-fish", 1, 0.1);
    starterMarker.ripple.computeBoundingSphere();
    expect(starterMarker.ripple.boundingSphere?.radius).toBeGreaterThanOrEqual(0.093);

    const rockGeometry = new THREE.BoxGeometry(2, 1.4, 1.6);
    const rockPart: TestPart = {
      geometry: rockGeometry,
      material: new THREE.MeshStandardMaterial(),
      matrix: new THREE.Matrix4().makeTranslation(0, 0.7, 0),
      triangles: 12,
    };
    const kaldite = internals.seamGeometry("readability-rock", 10, [rockPart]);
    const cachedKaldite = internals.seamGeometry("readability-rock", 10, [rockPart]);
    const corven = internals.seamGeometry("readability-rock", 5, [rockPart]);
    expect(kaldite).not.toBeNull();
    expect(cachedKaldite).toBe(kaldite);
    expect(corven).not.toBe(kaldite);

    kaldite!.computeBoundingBox();
    corven!.computeBoundingBox();
    const kalditeSize = kaldite!.boundingBox!.getSize(new THREE.Vector3());
    const corvenSize = corven!.boundingBox!.getSize(new THREE.Vector3());
    expect(kaldite!.boundingBox!.min.y).toBeGreaterThan(1.36);
    expect(kaldite!.boundingBox!.max.y).toBeGreaterThan(1.4);
    expect(kalditeSize.x).toBeGreaterThanOrEqual(corvenSize.x);
    expect(kalditeSize.z).toBeGreaterThanOrEqual(corvenSize.z);
    expect(kalditeSize.x + kalditeSize.z).toBeGreaterThan(corvenSize.x + corvenSize.z + 0.005);

    views.dispose();
    materials.dispose();
    rockPart.material.dispose();
    rockGeometry.dispose();
  });

  it("keeps every authored fish above the basin floor through its full deterministic bob", () => {
    const { views, materials, internals } = createViews();

    for (const tier of GATHERING_PRODUCTION_TIERS) {
      const resource = tier.resourceDefs.find((candidate) => candidate.skill === "fishing")!;
      const expected = EXPECTED_FISH_PRESENTATION[tier.tier]!;
      const assetId = resource.presentation.availableAssetIds[0]!;
      const asset = RUNTIME_ASSET_MANIFEST.assets.find((candidate) => candidate.id === assetId)!;
      const waterOffset = resource.presentation.waterOffset;
      if (waterOffset === undefined) throw new Error(`${resource.id} has no water offset`);

      expect(resource.presentation.targetWorldSize).toBe(expected.targetWorldSize);
      expect(waterOffset).toBe(expected.waterOffset);

      const geometry = new THREE.BoxGeometry(asset.size.x, asset.size.y, asset.size.z);
      const material = new THREE.MeshStandardMaterial();
      const school = internals.buildFishingSchool(assetId, tier.tier, [{
        geometry,
        material,
        matrix: new THREE.Matrix4(),
        triangles: 12,
      }]);
      const fish = school.filter((part): part is TestPart & { resourceDetail: FishDetail } =>
        part.resourceDetail?.kind === "fish");
      expect(fish).toHaveLength(4);

      const largestAssetDimension = Math.max(asset.size.x, asset.size.y, asset.size.z);
      const targetScale = resource.presentation.targetWorldSize / largestAssetDimension;
      const silhouette = tierSilhouetteScale(tier.tier);
      const storedViewScale = Math.round((targetScale / silhouette) * 10_000) / 10_000;
      const drawnScale = storedViewScale * silhouette;

      let lowestPoint = Number.POSITIVE_INFINITY;
      let highestPoint = Number.NEGATIVE_INFINITY;
      for (const part of fish) {
        part.geometry.computeBoundingBox();
        const localBounds = part.geometry.boundingBox!.clone().applyMatrix4(part.matrix);
        const detail = part.resourceDetail;
        const bob = Math.abs(detail.depthJitter) * 0.16;
        const bottom = waterOffset + drawnScale * (
          detail.depthJitter - bob + localBounds.min.y * detail.scale
        );
        const top = waterOffset + drawnScale * (
          detail.depthJitter + bob + localBounds.max.y * detail.scale
        );
        lowestPoint = Math.min(lowestPoint, bottom);
        highestPoint = Math.max(highestPoint, top);
      }

      const floorClearance = WATER_FILL_DEPTH + lowestPoint;
      expect(
        floorClearance,
        `${resource.id} clears the basin floor by ${(floorClearance * 1_000).toFixed(1)} mm`,
      ).toBeGreaterThanOrEqual(MIN_BASIN_FLOOR_CLEARANCE);
      // Schools are solved against depth near the waterline, not against the flat floor, so the
      // authored minimum has to cover the deepest-drawing fish or `fishingAccess` would place one
      // where its belly is through the bed. Measured worst case is 476.2 mm at the tarn tiers.
      const schoolClearance = SCHOOL_MIN_WATER_DEPTH + lowestPoint;
      expect(
        schoolClearance,
        `${resource.id} clears a minimum-depth school position by ${(schoolClearance * 1_000).toFixed(1)} mm`,
      ).toBeGreaterThanOrEqual(MIN_BASIN_FLOOR_CLEARANCE);
      expect(
        -highestPoint,
        `${resource.id} highest point is ${(-highestPoint * 1_000).toFixed(1)} mm underwater`,
      ).toBeGreaterThanOrEqual(MIN_SURFACE_SUBMERSION);

      material.dispose();
      geometry.dispose();
    }

    views.dispose();
    materials.dispose();
  });
});
