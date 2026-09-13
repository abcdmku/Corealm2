import type { EquipmentSetDefinition, EquipmentSetThreshold } from "../equipmentSets.js";
import { arr, enumOf, id, int, lit, obj, opt, ref, refine, str, union, type Infer, type Schema } from "./core.js";
import { EquipmentBonusesSchema } from "./items.js";

export const EquipmentSetThresholdSchema = obj({
  pieces: union([lit(2), lit(3), lit(4), lit(5)] as const, { label: "Required pieces", step: 1 }),
  bonuses: EquipmentBonusesSchema,
}) satisfies Schema<EquipmentSetThreshold>;

export const EquipmentSetSchema = obj({
  id: id(),
  name: str({ nonEmpty: true }, { label: "Name" }),
  tier: int({ min: 1 }, { label: "Tier", step: 1 }),
  style: enumOf(["melee", "magic"] as const, { label: "Combat style" }),
  members: refine(obj({
    head: opt(ref("item"), { label: "Head" }),
    body: opt(ref("item"), { label: "Body" }),
    legs: opt(ref("item"), { label: "Legs" }),
    hands: opt(ref("item"), { label: "Hands" }),
    feet: opt(ref("item"), { label: "Feet" }),
  }, {}, { label: "Members", help: "Saved item ids. Only these armour slots count toward the set." }),
  members => Object.keys(members).length > 0 && new Set(Object.values(members)).size === Object.keys(members).length,
  "members must contain at least one item and must not repeat an item"),
  thresholds: refine(arr(EquipmentSetThresholdSchema, { minLength: 1 }, { label: "Cumulative bonuses", help: "Each threshold adds its bonuses once enough pieces are equipped." }),
    rows => rows.every((row, index) => index === 0 || row.pieces > rows[index - 1]!.pieces),
    "thresholds must have unique, increasing piece counts"),
}) satisfies Schema<EquipmentSetDefinition>;

export const SET_SOURCE_CATALOGS = ["BOSS_ARMOR_SETS", "EQUIPMENT_SETS"] as const;
export type SetCatalog = typeof SET_SOURCE_CATALOGS[number];
export const EquipmentSetRecordSchema = EquipmentSetSchema.extend({
  catalog: enumOf(SET_SOURCE_CATALOGS, { hidden: true }),
  derivation: opt(obj({ kind: lit("setThresholds", { readOnly: true }) }), {
    label: "Threshold derivation", help: "Thresholds are checked against the set balance parameters using this set's tier and head membership. Remove to hand-tune.",
  }),
});
export type EquipmentSetRecord = Infer<typeof EquipmentSetRecordSchema>;
