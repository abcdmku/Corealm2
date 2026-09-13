import type { CampfireFuelDef } from "../index.js";
import { int, lit, num, obj, opt, ref, type Infer, type Schema } from "./core.js";

const buildXpSchema = obj({
  fletching: num({ min: 0 }, { label: "Fletching XP", unit: "xp" }),
  crafting: num({ min: 0 }, { label: "Crafting XP", unit: "xp" }),
}, {}, { label: "Build XP" });

/** Runtime campfire fuel fields. The log id is the collection identity. */
export const CampfireFuelSchema = obj({
  logItemId: ref("item", { label: "Fuel log", readOnly: true, identity: true }),
  tier: int({ min: 1 }, { label: "Tier", step: 1 }),
  buildTimeMs: int({ exclusiveMin: 0 }, { label: "Build time", unit: "ms", step: 1 }),
  lifetimeMs: int({ exclusiveMin: 0 }, { label: "Lifetime", unit: "ms", step: 1 }),
  buildXp: buildXpSchema,
  visualLogAssetId: ref("asset", { label: "Log asset" }),
}) satisfies Schema<CampfireFuelDef>;

/** The only current campfire derivation locks the numeric runtime fields to balance parameters. */
export const CampfireFuelDerivationSchema = obj({
  kind: lit("campfireFuel", { readOnly: true }),
});

export const CampfireFuelRecordSchema = CampfireFuelSchema.extend({
  derivation: opt(CampfireFuelDerivationSchema, {
    label: "Balance derivation",
    help: "Recomputes campfire timing and build XP from balance/campfires.json and balance/recipes.json.",
  }),
});

export type CampfireFuelRecord = Infer<typeof CampfireFuelRecordSchema>;
