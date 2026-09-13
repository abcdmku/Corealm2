import { discriminated, enumOf, lit, obj, opt, ref, type Infer } from "./core.js";

/** The baseline id names independent authored parameters in balance/gear.json. */
export const GearDerivationSchema = discriminated("variant", {
  base: obj({
    kind: lit("gear"),
    variant: lit("base"),
    baselineId: ref("item", { label: "Baseline item" }),
    attackKind: opt(enumOf(["melee", "wand", "staff"] as const), { label: "Attack cadence" }),
  }),
  rare: obj({
    kind: lit("gear"),
    variant: lit("rare"),
    baselineId: ref("item", { label: "Base weapon" }),
    attackKind: enumOf(["melee", "staff"] as const, { label: "Weapon style" }),
  }),
});

export type GearDerivation = Infer<typeof GearDerivationSchema>;
