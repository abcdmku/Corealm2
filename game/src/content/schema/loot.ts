import { arr, id, int, num, obj, ref, refine, str, tuple, type Infer, type Schema } from './core.js';
import type { CompiledLootRoll, LootPlan } from '../../contracts.js';

const QuantityRangeSchema = refine(
  tuple<[Schema<number>, Schema<number>]>([int({ min: 1 }), int({ min: 1 })]),
  ([low, high]) => low <= high, 'quantity minimum must not exceed maximum',
);
export const DropSchema = obj({
  itemId: ref('item', { label: 'Item', role: 'Dropped by' }),
  quantity: QuantityRangeSchema.describe({ label: 'Quantity' }),
  chance: num({ min: 0, max: 1 }, { label: 'Chance per roll', help: 'Probability per roll. All items in the pool together must total at most 100%.' }),
});
const RollFields = {
  id: id(), name: str({ nonEmpty: true }, { label: 'Roll name' }),
  count: int({ min: 0, max: 100 }, { label: 'Roll count', help: 'Repeat this pool this many times. Each roll selects at most one item.' }),
  drops: arr(DropSchema, {}, { label: 'Items', role: 'Dropped by', probability: 'chance' }),
};
export const CompiledLootRollSchema = obj(RollFields) satisfies Schema<CompiledLootRoll>;
export const LootRollSchema = obj({
  ...RollFields,
  tables: arr(obj({
    tableId: ref('lootTable', { label: 'Loot table', role: 'Rolled by' }),
    rollId: str({ nonEmpty: true }, { label: 'Table roll', help: 'The pool to join. This roll uses the count above.' }),
  }), {}, { label: 'Attached tables', role: 'Rolled by' }),
});
export const LootPlanSchema = obj({ rolls: arr(LootRollSchema, {}, { label: 'Rolls' }) }) satisfies Schema<LootPlan>;
export const LootTableSchema = obj({
  id: id(), name: str({ nonEmpty: true }, { label: 'Name', display: true }),
  rolls: arr(LootRollSchema, {}, { label: 'Rolls' }),
});
export type LootTableRecord = Infer<typeof LootTableSchema>;
