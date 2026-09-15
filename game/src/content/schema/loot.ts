import { arr, id, int, num, obj, opt, ref, refine, str, tuple, type Infer, type Schema } from "./core.js";


const nonempty = () => str({ nonEmpty: true });

// EnemyDef uses mutable pairs. The explicit tuple generic preserves assignability.
// Do not reuse core.intRange, whose inferred pair is readonly.
const QuantityRangeSchema = refine(
  tuple<[Schema<number>, Schema<number>]>([int({ min: 1 }), int({ min: 1 })]),
  ([low, high]) => low <= high,
  "quantity minimum must not exceed maximum",
);

export const DropSchema = obj({
  itemId: ref("item", { label: "Item", role: "Dropped by" }),
  quantity: QuantityRangeSchema.describe({ label: "Quantity" }),
  // Each drop rolls on its own, so this is a probability, not a share of one roll.
  chance: num({ min: 0, max: 1 }, { label: "Chance", help: "Probability of this drop per kill, between zero and one." }),
  exclusiveGroup: opt(nonempty(), { label: "Exclusive group", help: "At most one drop from a group rolls." }),
});

export const LootTableSchema = obj({
  id: id(),
  name: str({ nonEmpty: true }, { label: "Name", display: true }),
  drops: arr(DropSchema, {}, { label: "Drops", role: "Dropped by", probability: "chance" }),
});
export type LootTableRecord = Infer<typeof LootTableSchema>;
