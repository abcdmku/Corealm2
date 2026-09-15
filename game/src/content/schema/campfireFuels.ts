import type { CampfireFuelDef } from "../index.js";
import { int, num, obj, ref, type Infer, type Schema } from "./core.js";

const buildXpSchema = obj({
  fletching: num({ min: 0 }, { label: "Fletching XP", unit: "xp", group: "xp" }),
  crafting: num({ min: 0 }, { label: "Crafting XP", unit: "xp", group: "xp" }),
}, {}, { label: "Build XP" });

/** Runtime campfire fuel fields. The log id is the collection identity. */
export const CampfireFuelSchema = obj({
  logItemId: ref("item", { label: "Fuel log", readOnly: true, identity: true, display: true, role: "Burns as" }),
  tier: int({ min: 1 }, { label: "Tier", step: 1 }),
  buildTimeMs: int({ exclusiveMin: 0 }, { label: "Build time", unit: "ms", step: 1 }),
  lifetimeMs: int({ exclusiveMin: 0 }, { label: "Lifetime", unit: "ms", step: 1 }),
  buildXp: buildXpSchema,
  visualLogAssetId: ref("asset", { label: "Log asset", role: "Log model for" }),
}) satisfies Schema<CampfireFuelDef>;

export const CampfireFuelRecordSchema = CampfireFuelSchema;

export type CampfireFuelRecord = Infer<typeof CampfireFuelRecordSchema>;
