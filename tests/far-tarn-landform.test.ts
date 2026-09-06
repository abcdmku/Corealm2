import { expect, it } from "vitest";
import { Scene } from "three";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";
import { fishingAccessPositions } from "../game/src/app/fishingAccess.js";
import { WORLD_SITES, worldSitePoint } from "../game/src/content/worldSites.js";
import { WorldScene } from "../game/src/render/scene.js";
import { organicRadiusScale } from "../game/src/world/organicFields.js";
import { WATER_FILL_DEPTH } from "../game/src/world/waterBodies.js";

function measure(fitted: boolean) {
  const spec = buildWorldTerrainSpec();
  const basin = spec.basins!.find((b) => b.id === "far_tarn_spots")!;
  if (fitted) basin.bankFit = { maximumInset: 10, maximumRimFill: 0.8 };
  else delete basin.bankFit;
  const scene = new WorldScene(new Scene());
  scene.buildWorld({ ...spec, coast: undefined, chunkSize: 96,
    bounds: { minX: 236, maxX: 348, minZ: -188, maxZ: -60 },
  }, (prepared) => {
    prepared.buildWater({ minX: basin.x - basin.crestRadius, maxX: basin.x + basin.crestRadius,
      minZ: basin.z - basin.crestRadius, maxZ: basin.z + basin.crestRadius },
    prepared.heightAt("karrowmoor", basin.x, basin.z) + WATER_FILL_DEPTH, "karrowmoor");
  });
  try {
    const dry = (scene as unknown as { preBasinHeight(x: number, z: number): number }).preBasinHeight.bind(scene);
    let maxRaise = 0, maxGrade = 0, maxCut = 0;
    for (let spoke = 0; spoke < 72; spoke++) {
      const angle = spoke / 72 * Math.PI * 2;
      const scale = organicRadiusScale(angle, basin.shape);
      const dx = Math.cos(angle), dz = Math.sin(angle);
      for (let r = basin.crestRadius * scale; r < basin.outerRadius * scale; r += 0.5) {
        const x = basin.x + dx * r, z = basin.z + dz * r;
        const y = scene.heightAtXZ(x, z);
        maxRaise = Math.max(maxRaise, y - dry(x, z));
        maxCut = Math.max(maxCut, dry(x, z) - y);
        maxGrade = Math.max(maxGrade, Math.abs(scene.heightAtXZ(x + dx * 0.5, z + dz * 0.5) - y) / 0.5);
      }
    }
    const body = scene.getWaterBodies()[0]!;
    const site = WORLD_SITES.find((s) => s.id === "far_tarn_cove")!;
    const stands = fishingAccessPositions([site], [body], (x, z) => scene.meshHeightAt(x, z));
    const stanceFacts = [...stands].map(([id, [x, y, z]]) => ({ id, x, y, z,
      grade: Math.hypot(scene.meshHeightAt(x + 0.5, z) - scene.meshHeightAt(x - 0.5, z),
        scene.meshHeightAt(x, z + 0.5) - scene.meshHeightAt(x, z - 0.5)),
      wet: scene.sampleWorld(x, z).waterBodyId,
    }));
    const stand = stands.get("far_tarn")!;
    // These direct endpoint transects identify terrain changes, not Detour route feasibility.
    // The cache transect crosses the lake even before fitting and is not a playable route.
    const endpointTransects = [[300, -80], [328, -176]].map(([x, z]) => {
      const length = Math.hypot(stand[0] - x!, stand[2] - z!);
      let grade = 0, wetSamples = 0;
      let previous = scene.meshHeightAt(x!, z!);
      const steps = Math.ceil(length / 0.5);
      for (let i = 1; i <= steps; i++) {
        const px = x! + (stand[0] - x!) * i / steps, pz = z! + (stand[2] - z!) * i / steps;
        const y = scene.meshHeightAt(px, pz);
        grade = Math.max(grade, Math.abs(y - previous) / (length / steps));
        wetSamples += scene.sampleWorld(px, pz).waterBodyId ? 1 : 0;
        previous = y;
      }
      return { from: [x, z], grade, wetSamples };
    });
    const fishDepths = site.resourceSlots.map((slot) => {
      const [x, z] = worldSitePoint(site, slot.x, slot.z);
      return body.level - scene.meshHeightAt(x, z);
    });
    return { maxRaise, maxGrade, maxCut, level: body.level, closed: body.closed, stanceFacts, endpointTransects, fishDepths };
  } finally { scene.dispose(); }
}

it("shows why Far Tarn cannot adopt Cairn's fit without also solving its casting approach", () => {
  const before = measure(false), after = measure(true);
  if (process.env.FAR_TARN_DIAGNOSTIC === "1") process.stdout.write(JSON.stringify({ before, after }, null, 2) + "\n");
  expect(before.closed).toBe(true);
  expect(after.closed).toBe(true);
  expect(after.maxRaise).toBeLessThan(before.maxRaise);
  for (const depth of after.fishDepths) expect(depth).toBeGreaterThan(0.4);
  // The fitted lake remains closed and reduces fill, but its production casting positions
  // exceed the 0.6 ground-grade criterion used by the existing Cairn acceptance test.
  for (const stance of before.stanceFacts) expect(stance.grade).toBeLessThan(0.6);
  for (const stance of after.stanceFacts) {
    expect(stance.wet).toBeNull();
    expect(stance.grade).toBeGreaterThan(0.6);
  }
  expect(after.maxCut).toBeGreaterThan(before.maxCut);
});
