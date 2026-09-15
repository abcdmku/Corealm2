import type { EquipmentSetDefinition, EquipmentSetThreshold } from "../equipmentSets.js";
import { arr, enumOf, id, int, lit, obj, opt, ref, refine, str, union, type Infer, type Schema } from "./core.js";
import { EquipmentBonusesSchema } from "./items.js";

export const EquipmentSetThresholdSchema = obj({
  pieces: union([lit(2), lit(3), lit(4), lit(5)] as const, { label: "Required pieces", step: 1 }),
  bonuses: EquipmentBonusesSchema,
}) satisfies Schema<EquipmentSetThreshold>;

export const EquipmentSetSchema = obj({
  id: id(),
  name: str({ nonEmpty: true }, { label: "Name", display: true }),
  tier: int({ min: 1 }, { label: "Tier", step: 1 }),
  style: enumOf(["melee", "magic"] as const, { label: "Combat style" }),
  members: refine(obj({
    head: opt(ref("item", { role: "Worn in set" }), { label: "Head", role: "Worn in set" }),
    body: opt(ref("item", { role: "Worn in set" }), { label: "Body", role: "Worn in set" }),
    legs: opt(ref("item", { role: "Worn in set" }), { label: "Legs", role: "Worn in set" }),
    hands: opt(ref("item", { role: "Worn in set" }), { label: "Hands", role: "Worn in set" }),
    feet: opt(ref("item", { role: "Worn in set" }), { label: "Feet", role: "Worn in set" }),
  }, {}, { label: "Members", help: "Saved item ids. Only these armour slots count toward the set.", role: "Worn in set" }),
  members => Object.keys(members).length > 0 && new Set(Object.values(members)).size === Object.keys(members).length,
  "members must contain at least one item and must not repeat an item"),
  // Thresholds are cumulative and must ascend, so the array order is the ladder.
  thresholds: refine(arr(EquipmentSetThresholdSchema, { minLength: 1 }, { label: "Cumulative bonuses", help: "Each threshold adds its bonuses once enough pieces are equipped.", ordered: true }),
    rows => rows.every((row, index) => index === 0 || row.pieces > rows[index - 1]!.pieces),
    "thresholds must have unique, increasing piece counts"),
}) satisfies Schema<EquipmentSetDefinition>;

export const EquipmentSetRecordSchema = EquipmentSetSchema.extend({ acquisition: enumOf(['boss', 'crafting'] as const, { label: "Acquisition" }) });
export type EquipmentSetRecord = Infer<typeof EquipmentSetRecordSchema>;
