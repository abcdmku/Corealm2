/** Generated held gear missing from the asset library. Each model is rooted at its grip. */
import type * as THREE from "three";

/** A held fishing tool with a continuous shaft, fittings, line and bobber. */
export interface FishingRodLook {
  shaft: number;
  binding: number;
  line: number;
  bobber: number;
  /** Hardware albedo, kept separate from the leather binding. */
  fitting?: number;
  /** Butt to tip, before the slight authored bend. */
  length: number;
  /** Sideways displacement of the tip in metres. */
  bend: number;
}

/** Authored wood, bindings and float colours for the five fishing tiers. */
const WORN_WOOD = 0x66503c;
const PALEWOOD = 0xb18b62;
const DUSKOAK = 0x604734;
const CAIRNPINE = 0x7a6046;

const CORD = 0x3f382f;
const MARCHHIDE = 0x8a6a4a;
const CORVEN = 0x5a6b7c;
const KALDITE = 0x24222a;

const QUARTZ = 0xd8d4cc;
/** The worn rod carries a duller float than the higher fishing tiers. */
const QUARTZ_DULL = 0x8f8c87;
const AMBER = 0xc98a2a;
const GARNET = 0x7a1a2c;

/**
 * Rods grow slightly with tier. The bobber repeats the tier gem color so the upgrade reads after
 * the thin wood shaft recedes against water.
 */
export const FISHING_ROD_LOOKS: Readonly<Record<string, FishingRodLook>> = {
  worn_rod: {
    shaft: WORN_WOOD, binding: CORD, line: 0x39332c, bobber: QUARTZ_DULL,
    fitting: 0x756047, length: 1.18, bend: 0.09,
  },
  palewood_rod: {
    shaft: PALEWOOD, binding: MARCHHIDE, line: 0x403a32, bobber: QUARTZ,
    fitting: 0xa28458, length: 1.30, bend: 0.11,
  },
  duskoak_rod: {
    shaft: DUSKOAK, binding: CORVEN, line: 0x302e2b, bobber: AMBER,
    fitting: 0x83939c, length: 1.42, bend: 0.13,
  },
  cairnpine_rod: {
    shaft: CAIRNPINE, binding: KALDITE, line: 0x29282a, bobber: GARNET,
    fitting: 0xb0b5b8, length: 1.54, bend: 0.15,
  },
  cinderpine_rod: {
    shaft: 0x49362c, binding: 0x382b26, line: 0x3b302b, bobber: 0xc86332,
    fitting: 0xc89570, length: 1.66, bend: 0.17,
  },
};

/** Asset id for a fishing rod, including its line and bobber. */
export function fishingRodAssetId(itemId: string): string {
  return `proc_rod_${itemId.replace(/_rod$/, "")}`;
}

export interface ProceduralGearAsset {
  /** What `AssetRegistry.load` will answer to. */
  assetId: string;
  /** The equipment or tool item that uses it. */
  itemId: string;
}

export const PROCEDURAL_FISHING_ROD_ASSETS: readonly ProceduralGearAsset[] =
  Object.keys(FISHING_ROD_LOOKS).map((itemId) => ({ assetId: fishingRodAssetId(itemId), itemId }));

/** Shared full-size dagger; its tier treatment is applied by equipmentVisuals. */
export const EQUIPMENT_DAGGER_ASSET_ID = "corealm_dagger";

/** Every generated held asset registered during boot. */
export const ALL_PROCEDURAL_GEAR_ASSETS: readonly ProceduralGearAsset[] = [
  ...PROCEDURAL_FISHING_ROD_ASSETS,
  { assetId: EQUIPMENT_DAGGER_ASSET_ID, itemId: "grithe_dagger" },
];

const PROCEDURAL_ASSET_IDS = new Set(ALL_PROCEDURAL_GEAR_ASSETS.map((asset) => asset.assetId));

/** True for an asset id that is built here, so it will never appear in the generated manifest. */
export function isProceduralGearAsset(assetId: string): boolean {
  return PROCEDURAL_ASSET_IDS.has(assetId);
}

/**
 * Picks the authored rod that matches a resource tier. The worn rod is the safe fallback when the
 * activity input has no tier yet.
 */
export function fishingRodItemForTier(tier: number | null | undefined): string {
  if (tier !== null && tier !== undefined && tier >= 20) return "cinderpine_rod";
  if (tier !== null && tier !== undefined && tier >= 10) return "cairnpine_rod";
  if (tier !== null && tier !== undefined && tier >= 5) return "duskoak_rod";
  if (tier !== null && tier !== undefined && tier >= 1) return "palewood_rod";
  return "worn_rod";
}

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
  sink.registerFactory(EQUIPMENT_DAGGER_ASSET_ID, async () => {
    const { buildEquipmentDagger } = await import("./proceduralGearModels.js");
    return buildEquipmentDagger();
  });
  registered.push(EQUIPMENT_DAGGER_ASSET_ID);
  return registered;
}
