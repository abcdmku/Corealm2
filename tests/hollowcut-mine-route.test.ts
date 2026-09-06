import { readFileSync } from "node:fs";
import { Scene } from "three";
import { describe, expect, it } from "vitest";
import type { Vec3 } from "../game/src/contracts.js";
import { buildWorldTerrainSpec } from "../game/src/app/worldSpec.js";
import { WORLD_SITES, worldSitePoint } from "../game/src/content/worldSites.js";
import { WorldScene } from "../game/src/render/scene.js";
import { Solids } from "../game/src/systems/solids.js";
import { buildWorld } from "../game/src/world/regionBuilder.js";

const manifest = JSON.parse(readFileSync(new URL("../game/public/assets/manifest.json", import.meta.url), "utf8")) as {
  assets: { id: string; size: { x: number; y: number; z: number }; base: { x: number; y: number; z: number } }[];
};
const models = new Map(manifest.assets.map((asset) => [asset.id, asset]));

describe("Hollowcut approach beside Rootfall", () => {
  it("keeps the raised settlement approach graded and the retained nav route clear of tunnel dressing", () => {
    const scene = new WorldScene(new Scene());
    try {
      scene.buildWorld({ ...buildWorldTerrainSpec(),
        bounds: { minX: 60, maxX: 124, minZ: 116, maxZ: 180 }, chunkSize: 64 });
      const site = WORLD_SITES.find((candidate) => candidate.id === "hollowcut_workings")!;
      const heightAt = (_region: unknown, x: number, z: number) => scene.meshHeightAt(x, z);
      const world = buildWorld(1337, heightAt, {
        heightAt, baseY: (id) => models.get(id)?.base.y ?? 0,
        assetSize: (id) => models.get(id)?.size ?? null,
        assetCenterXZ: (id) => {
          const asset = models.get(id);
          return asset ? { x: asset.base.x + asset.size.x / 2, z: asset.base.z + asset.size.z / 2 } : null;
        },
      });
      const solids = new Solids(world.solids);
      // These are unmodified nav-path samples from the failed production world probe.
      // Root Tunnel's partly buried left decorative rock caused a 0.64 m body correction.
      const samples: Vec3[] = [
        [85.01168, 8.267, 136.22288], [85.45292, 8.243, 135.83072],
        [85.7536585366, 8.2057317073, 135.5792682927], [86.2146341463, 8.1179268293, 135.2170731707],
      ];
      for (const point of samples) {
        const resolved = solids.resolve(point, point, 0.35);
        expect(Math.hypot(resolved[0] - point[0], resolved[2] - point[2]), `route at ${point}`)
          .toBeLessThanOrEqual(0.02);
      }
      let maximumGrade = 0;
      for (let along = 2.25; along <= 13.5; along += 0.25) {
        const a = worldSitePoint(site, 0, along - 0.25), b = worldSitePoint(site, 0, along);
        maximumGrade = Math.max(maximumGrade,
          Math.abs(scene.heightAtXZ(...a) - scene.heightAtXZ(...b)) / 0.25);
      }
      expect(maximumGrade).toBeLessThan(0.65);
    } finally { scene.dispose(); }
  });
});
