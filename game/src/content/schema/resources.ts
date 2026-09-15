import { SKILL_IDS } from "../../contracts.js";
import type { ResourceDef, ResourcePresentationDef } from "../index.js";
import { arr, enumOf, id, int, num, obj, opt, ref, refine, str, tuple, type Infer, type Schema } from "./core.js";

const positiveRange = refine(tuple([num({ exclusiveMin: 0 }), num({ exclusiveMin: 0 })] as const),
  ([min, max]) => min <= max, "min must be <= max");
const yieldRange = refine(tuple([int({ min: 1 }), int({ min: 1 })] as const),
  ([min, max]) => min <= max, "min must be <= max");

export const ResourcePresentationSchema = obj({
  availableAssetIds: arr(ref("asset", { label: "Asset", role: "Model for" }), { minLength: 1 }, { label: "Available assets", help: "Selected deterministically using the entity id.", role: "Model for" }),
  depletedAssetId: opt(ref("asset", { role: "Spent model for" }), { label: "Depleted asset", help: "When absent, the renderer may derive a spent appearance.", role: "Spent model for" }),
  targetWorldSize: num({ exclusiveMin: 0 }, { label: "Target world size", unit: "m", help: "Largest world-space dimension before variant scaling.", group: "presentation" }),
  variantScale: opt(positiveRange, { label: "Variant scale", help: "Minimum and maximum deterministic size multiplier.", group: "presentation" }),
  waterOffset: opt(num(), { label: "Water offset", unit: "m", group: "presentation" }),
  materialTier: int({ min: 0 }, { label: "Material tier", step: 1, group: "presentation" }),
}) satisfies Schema<ResourcePresentationDef>;

export const ResourceSchema = obj({
  id: id(),
  name: str({ nonEmpty: true }, { label: "Name", display: true }),
  archetype: enumOf(["ore", "tree", "fishing_spot"] as const, { label: "Archetype" }),
  skill: enumOf(SKILL_IDS, { label: "Gathering skill", ref: "skill", role: "Uses skill" }),
  tier: int({ min: 0 }, { label: "Tier", step: 1 }),
  reqLevel: int({ min: 1 }, { label: "Required level", step: 1 }),
  itemId: ref("item", { label: "Yield item", role: "Gathered from" }),
  bonus: opt(arr(obj({
    itemId: ref("item", { label: "Bonus item", role: "Bonus from" }),
    chance: num({ min: 0, max: 1 }, { label: "Chance", help: "Probability per successful gather, between zero and one." }),
  }), {}, { label: "Bonus rolls", role: "Bonus from", probability: "chance" }), { label: "Bonus rolls", help: "Each secondary drop rolls independently.", role: "Bonus from", probability: "chance" }),
  yieldRange: opt(yieldRange, { label: "Capacity range", help: "Optional inclusive minimum and maximum node capacity." }),
  respawnSeconds: opt(num({ min: 0 }), { label: "Respawn cooldown", unit: "s" }),
  presentation: ResourcePresentationSchema,
}) satisfies Schema<ResourceDef>;

export const ResourceRecordSchema = ResourceSchema;
export type ResourceRecord = ResourceDef;
