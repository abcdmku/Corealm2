import type * as THREE from "three";
import { ARMOUR_TIER_PART_ASSETS, EQUIPMENT_DAGGER_ASSETS, FISHING_ROD_LOOKS, fishingRodAssetId } from "./proceduralGear.js";

// The model builders are reached only from here. proceduralGear.ts stays a plain id table, which the
// content compiler and the server read without loading a renderer.

/** Reserves generated ids without importing or constructing models until load requests them. */
export function registerProceduralGear(sink: {
  registerFactory(id: string, factory: () => Promise<THREE.Group>): void;
}): readonly string[] {
  const registered: string[] = [];
  for (const [itemId, look] of Object.entries(FISHING_ROD_LOOKS)) {
    const assetId = fishingRodAssetId(itemId);
    sink.registerFactory(assetId, async () => {
      const { buildFishingRod } = await import("./proceduralGearModels.js");
      return buildFishingRod(look);
    });
    registered.push(assetId);
  }
  for (const { assetId, grade } of EQUIPMENT_DAGGER_ASSETS) {
    sink.registerFactory(assetId, async () => {
      const { buildEquipmentDagger } = await import("./proceduralGearModels.js");
      return buildEquipmentDagger(grade);
    });
    registered.push(assetId);
  }
  for (const { assetId } of ARMOUR_TIER_PART_ASSETS) {
    sink.registerFactory(assetId, async () => {
      const { buildArmourTierPart } = await import("./armourTierParts.js");
      return buildArmourTierPart(assetId);
    });
    registered.push(assetId);
  }
  return registered;
}
