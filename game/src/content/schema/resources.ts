import { SKILL_IDS } from "../../contracts.js";
import type { ResourceDef, ResourcePresentationDef } from "../index.js";
import { arr, enumOf, id, int, num, obj, opt, ref, refine, str, tuple, type Infer, type Schema } from "./core.js";

const positiveRange = refine(tuple([num({ exclusiveMin: 0 }), num({ exclusiveMin: 0 })] as const),
  ([min, max]) => min <= max, "min must be <= max");
const yieldRange = refine(tuple([int({ min: 1 }), int({ min: 1 })] as const),
  ([min, max]) => min <= max, "min must be <= max");

export const ResourcePresentationSchema = obj({
  availableAssetIds: arr(ref("asset"), { minLength: 1 }, { label: "Available assets", help: "Selected deterministically using the entity id." }),
  depletedAssetId: opt(ref("asset"), { label: "Depleted asset", help: "When absent, the renderer may derive a spent appearance." }),
  targetWorldSize: num({ exclusiveMin: 0 }, { label: "Target world size", unit: "m", help: "Largest world-space dimension before variant scaling." }),
  variantScale: opt(positiveRange, { label: "Variant scale", help: "Minimum and maximum deterministic size multiplier." }),
  waterOffset: opt(num(), { label: "Water offset", unit: "m" }),
  materialTier: int({ min: 0 }, { label: "Material tier", step: 1 }),
}) satisfies Schema<ResourcePresentationDef>;

export const ResourceSchema = obj({
  id: id(),
  name: str({ nonEmpty: true }, { label: "Name" }),
  archetype: enumOf(["ore", "tree", "fishing_spot"] as const, { label: "Archetype" }),
  skill: enumOf(SKILL_IDS, { label: "Gathering skill", ref: "skill" }),
  tier: int({ min: 0 }, { label: "Tier", step: 1 }),
  reqLevel: int({ min: 1 }, { label: "Required level", step: 1 }),
  itemId: ref("item", { label: "Yield item" }),
  bonus: opt(arr(obj({
    itemId: ref("item", { label: "Bonus item" }),
    chance: num({ min: 0, max: 1 }, { label: "Chance", help: "Probability per successful gather, between zero and one." }),
  })), { label: "Bonus rolls", help: "Each secondary drop rolls independently." }),
  yieldRange: opt(yieldRange, { label: "Capacity range", help: "Optional inclusive minimum and maximum node capacity." }),
  respawnSeconds: opt(num({ min: 0 }), { label: "Respawn cooldown", unit: "s" }),
  presentation: ResourcePresentationSchema,
}) satisfies Schema<ResourceDef>;

/** Exclusive membership tags preserve the existing named source exports. */
export const RESOURCE_SOURCE_CATALOGS = [
  "CROWNWARD_FISH_RESOURCES", "GATHERING_PRODUCTION_RESOURCES", "ESSENCE_RESOURCES",
  "HIGH_TIER_TREE_RESOURCES", "WILDERNESS_ORE_RESOURCES", "WILDERNESS_TREE_RESOURCES",
  "FAIRY_ORE_RESOURCES", "FAIRY_TREE_RESOURCES",
] as const;
export type ResourceCatalog = typeof RESOURCE_SOURCE_CATALOGS[number];
export const ResourceRecordSchema = ResourceSchema.extend({
  catalog: enumOf(RESOURCE_SOURCE_CATALOGS, { hidden: true }),
});
export type ResourceRecord = Infer<typeof ResourceRecordSchema>;
