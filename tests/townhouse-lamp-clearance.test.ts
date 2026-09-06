import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPrefab, KIT_IDS, BUILDING_KITS, variantSeed } from "../game/src/render/buildings.js";
import { structureVariantCount } from "../game/src/render/structures/catalog.js";

const manifest = JSON.parse(readFileSync("game/public/assets/manifest.json", "utf8"));
const lampAsset = manifest.assets.find((asset: any) => asset.id === "lamp_wall");
const floorAsset = manifest.assets.find((asset: any) => asset.id === "floor_wood");

describe("townhouse entrance lantern headroom", () => {
  it("keeps the whole native hanging assembly above a walking avatar and below the balcony in every variant", () => {
    let checked = 0;
    for (const kit of KIT_IDS) {
      const count = structureVariantCount("townhouse", [6, 4], BUILDING_KITS[kit]);
      for (const seed of [variantSeed("rootfall_house_7"), ...Array.from({length:count}, (_, index) => index)]) {
        const parts = buildPrefab("townhouse", [6, 4], seed, kit);
        const floors = parts.filter(part => part.tag.startsWith("balcony_floor_"));
        const underside = Math.min(...floors.map(part => part.dy + floorAsset.base.y * part.scale));
        for (const lamp of parts.filter(part => part.assetId === "lamp_wall")) {
          const bottom = lamp.dy + lampAsset.base.y * lamp.scale;
          const top = bottom + lampAsset.size.y * lamp.scale;
          expect(bottom).toBeGreaterThanOrEqual(2.05);
          expect(top).toBeLessThan(underside - 0.04);
          expect(lamp.scaleAxes).toBeUndefined();
          // Keep the native mounting plate seated on the façade, with no independent chain edit.
          const plateZ = lamp.dz + Math.cos(lamp.rotationY) * lampAsset.base.z * lamp.scale;
          expect(Math.abs(plateZ - (-2 - 0.12))).toBeLessThan(0.025);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});
