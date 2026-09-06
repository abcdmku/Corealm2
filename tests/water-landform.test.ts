import { describe, expect, it } from "vitest";
import { Scene } from "three";
import { fishingSiteAnchors } from "../game/src/app/fishingAccess.js";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";
import { WORLD_SITES } from "../game/src/content/worldSites.js";
import { WorldScene } from "../game/src/render/scene.js";
import { organicRadiusScale } from "../game/src/world/organicFields.js";
import { SCHOOL_MIN_WATER_DEPTH, WATER_FILL_DEPTH, type WaterBasinSpec } from "../game/src/world/waterBodies.js";

function cairnFixture(fitted: boolean) {
  const spec = buildWorldTerrainSpec();
  const basin = spec.basins!.find((candidate) => candidate.id === "cairn_tarn_spots")!;
  if (!fitted) delete basin.bankFit;
  const scene = new WorldScene(new Scene());
  scene.buildWorld({
    ...spec, coast: undefined, chunkSize: 96,
    bounds: { minX: 158, maxX: 254, minZ: -136, maxZ: -40 },
  }, (prepared) => {
    prepared.buildWater({
      minX: basin.x - basin.crestRadius, maxX: basin.x + basin.crestRadius,
      minZ: basin.z - basin.crestRadius, maxZ: basin.z + basin.crestRadius,
    }, prepared.heightAt("karrowmoor", basin.x, basin.z) + WATER_FILL_DEPTH, "karrowmoor");
  });
  return { scene, basin };
}

function downhillBank(scene: WorldScene, basin: WaterBasinSpec) {
  // The north side descends from the tarn's terrace. Sampling in physical metres catches the
  // grade that radial shape compression hides when only nominal basin widths are inspected.
  let maxGrade = 0;
  let maxRaise = 0;
  const dryHeight = (scene as unknown as { preBasinHeight(x: number, z: number): number })
    .preBasinHeight.bind(scene);
  for (let spoke = 1; spoke < 36; spoke++) {
    const angle = spoke * Math.PI / 36;
    const scale = organicRadiusScale(angle, basin.shape);
    const dx = Math.cos(angle), dz = Math.sin(angle);
    for (let radius = basin.crestRadius * scale; radius < basin.outerRadius * scale; radius += 0.5) {
      const x = basin.x + dx * radius, z = basin.z + dz * radius;
      const height = scene.heightAtXZ(x, z);
      maxRaise = Math.max(maxRaise, height - dryHeight(x, z));
      maxGrade = Math.max(maxGrade, Math.abs(scene.heightAtXZ(x + dx * 0.5, z + dz * 0.5) - height) / 0.5);
    }
  }
  return { maxGrade, maxRaise };
}

describe("Cairn Tarn landform", () => {
  it("fits the closed lake into its terrace and removes most of the artificial downhill bank", () => {
    const before = cairnFixture(false);
    const after = cairnFixture(true);
    try {
      const oldBank = downhillBank(before.scene, before.basin);
      const newBank = downhillBank(after.scene, after.basin);
      expect(oldBank.maxRaise).toBeGreaterThan(10);
      expect(newBank.maxRaise).toBeLessThan(4.2);
      expect(newBank.maxGrade).toBeLessThan(1.2);
      expect(newBank.maxGrade).toBeLessThan(oldBank.maxGrade * 0.6);

      const oldWater = before.scene.getWaterBodies()[0]!;
      const water = after.scene.getWaterBodies()[0]!;
      expect(water.closed).toBe(true);
      expect(water.level).toBeLessThan(oldWater.level - 9);
      expect(water.level).toBeGreaterThanOrEqual(oldWater.level - after.basin.bankFit!.maximumInset - 1e-6);
      expect(after.basin.shape).toEqual(before.basin.shape);
      for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const radius = after.basin.outerRadius * organicRadiusScale(angle, after.basin.shape) + 1;
        const x = after.basin.x + Math.cos(angle) * radius, z = after.basin.z + Math.sin(angle) * radius;
        expect(after.scene.heightAtXZ(x, z)).toBeCloseTo(before.scene.heightAtXZ(x, z), 8);
      }
    } finally {
      before.scene.dispose();
      after.scene.dispose();
    }
  });

  it("preserves submerged school slots and dry production casting approaches", () => {
    const { scene, basin } = cairnFixture(true);
    try {
      const site = WORLD_SITES.find((candidate) => candidate.id === "cairn_tarn_ledge")!;
      const bodies = scene.getWaterBodies();
      const water = bodies[0]!;
      const anchors = fishingSiteAnchors([site], bodies, (x, z) => scene.meshHeightAt(x, z));
      for (const slot of site.resourceSlots) {
        // The authored slot no longer places the school — it picks the ray. What has to survive a
        // basin edit is the SOLVED school: still submerged, still deep enough for the drawn fish.
        const [x, , z] = anchors.schools.get(`${slot.clusterId}_${slot.index}`)!;
        expect(scene.sampleWorld(x, z).waterBodyId).toBe(basin.id);
        expect(water.level - scene.meshHeightAt(x, z)).toBeGreaterThanOrEqual(SCHOOL_MIN_WATER_DEPTH);
        const stand = anchors.banks.get(`${slot.clusterId}_${slot.index}`)!;
        expect(stand).toBeDefined();
        expect(stand[1]).toBe(scene.meshHeightAt(stand[0], stand[2]));
        const slopeX = scene.meshHeightAt(stand[0] + 0.5, stand[2]) - scene.meshHeightAt(stand[0] - 0.5, stand[2]);
        const slopeZ = scene.meshHeightAt(stand[0], stand[2] + 0.5) - scene.meshHeightAt(stand[0], stand[2] - 0.5);
        expect(Math.hypot(slopeX, slopeZ)).toBeLessThan(0.6);
        for (let sample = 0; sample < 24; sample++) {
          const angle = sample / 24 * Math.PI * 2;
          expect(scene.sampleWorld(stand[0] + Math.cos(angle) * 3, stand[2] + Math.sin(angle) * 3).waterBodyId)
            .toBeNull();
        }
      }
    } finally {
      scene.dispose();
    }
  });
});
