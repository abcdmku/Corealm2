import { arr, enumOf, id, int, lit, num, obj, ref, refine, str, tuple, union, type Infer, type Schema } from './core.js';
import { DropSchema } from './loot.js';
import { RPG_ROLES } from './enemySources.js';

export const SourceLootQuantitySchema = refine(tuple<[Schema<number>, Schema<number>]>([int({ min: 1 }), int({ min: 1 })]),
  ([low, high]) => low <= high, 'quantity minimum must not exceed maximum');
export const SourceLootRollSchema = obj({ quantity: SourceLootQuantitySchema, chance: num({ min: 0, max: 1 }) });
export const SOURCE_LOOT_RPG_REGIONS = ['fallowmarch', 'vellenwood', 'karrowmoor', 'kilnhalt'] as const;
export const SourceLootInputSchema = union([
  obj({ id: id(), kind: lit('authored'), drops: arr(DropSchema) }),
  obj({ id: id(), kind: lit('inherit'), sourceInputId: str({ nonEmpty: true }) }),
  obj({ id: id(), kind: lit('starter'), itemId: ref('item') }),
  obj({ id: id(), kind: lit('rpg'), regionId: enumOf(SOURCE_LOOT_RPG_REGIONS), tier: int({ min: 1 }), role: enumOf(RPG_ROLES) }),
  obj({ id: id(), kind: lit('variantAppend'), sourceInputId: str({ nonEmpty: true }), essenceItemId: ref('item') }),
  obj({ id: id(), kind: lit('redesignEssence'), profile: enumOf(['basic', 'forest', 'ash'] as const), essenceItemId: ref('item') }),
] as const);
export const SourceLootInputsSchema = refine(arr(SourceLootInputSchema), rows => {
  const inputs = new Map(rows.map(row => [row.id, row]));
  if (inputs.size !== rows.length) return false;
  const visiting = new Set<string>(), complete = new Set<string>();
  const visit = (id: string): boolean => {
    if (complete.has(id)) return true;
    if (visiting.has(id)) return false;
    const row = inputs.get(id);
    if (!row) return false;
    visiting.add(id);
    if ('sourceInputId' in row && !visit(row.sourceInputId)) return false;
    visiting.delete(id); complete.add(id); return true;
  };
  return rows.every(row => visit(row.id));
}, 'Source loot ids must be unique and all dependencies must exist without cycles');
export const SourceLootOwnersSchema = refine(arr(obj({
  id: ref('lootTable', { readOnly: true, identity: true }), inputId: str({ nonEmpty: true }, { readOnly: true }),
  mode: enumOf(['authored', 'formula'] as const, { readOnly: true }),
})), rows => new Set(rows.map(row => row.id)).size === rows.length, 'source loot owners must be unique');
export { SourceLootDerivationSchema } from './lootDerivation.js';
export const SourceLootParamsSchema = obj({
  starter: SourceLootRollSchema,
  rpg: refine(obj({
    essenceByRegion: obj({ fallowmarch: ref('item'), vellenwood: ref('item'), karrowmoor: ref('item'), kilnhalt: ref('item') }),
    quantityMinimum: int({ min: 1 }), quantityMaximumMinimum: int({ min: 1 }), quantityTierDivisor: num({ exclusiveMin: 0 }),
    chance: obj({ caster: num({ min: 0, max: 1 }), other: num({ min: 0, max: 1 }) }),
  }), row => row.quantityMinimum <= row.quantityMaximumMinimum, 'RPG quantity minimum must not exceed maximum minimum'),
  variantAppend: SourceLootRollSchema,
  redesignEssence: obj({ basic: SourceLootRollSchema, forest: SourceLootRollSchema, ash: SourceLootRollSchema }),
});
export type SourceLootInput = Infer<typeof SourceLootInputSchema>;
export type SourceLootParams = Infer<typeof SourceLootParamsSchema>;
export type SourceLootRoll = Infer<typeof SourceLootRollSchema>;
