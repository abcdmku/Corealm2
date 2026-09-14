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
  itemId: ref("item"),
  quantity: QuantityRangeSchema,
  chance: num({ min: 0, max: 1 }),
  exclusiveGroup: opt(nonempty()),
});

export const LootTableSchema = obj({ id: id(), name: str({ nonEmpty: true }), drops: arr(DropSchema) });
export type LootTableRecord = Infer<typeof LootTableSchema>;
