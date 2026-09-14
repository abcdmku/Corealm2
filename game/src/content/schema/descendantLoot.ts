import { arr, bool, enumOf, id, lit, num, obj, ref, refine, str, union, type Infer } from './core.js';
import { SourceLootQuantitySchema, SourceLootRollSchema } from './sourceLoot.js';

const crownTier = () => union([lit(30), lit(40), lit(60)] as const);
export const FairyCrownLootInputSchema = refine(obj({ id: id(), kind: lit('fairyCrown'),
  speciesId: str({ nonEmpty: true }), regionId: enumOf(['crownward', 'gloamgarden', 'faeholme'] as const),
  tier: crownTier(), boss: bool() }), row => row.tier === ({ crownward: 40, gloamgarden: 30, faeholme: 60 } as const)[row.regionId],
  'fairy crown region must match its tier');
export const DescendantLootInputSchema = union([
  FairyCrownLootInputSchema,
  obj({ id: id(), kind: lit('crownwardDragon'), boss: bool() }),
  obj({ id: id(), kind: lit('wildernessDragonSource'), tier: union([lit(50), lit(70)] as const) }),
] as const);
export const DescendantLootInputsSchema = refine(arr(DescendantLootInputSchema),
  rows => new Set(rows.map(row => row.id)).size === rows.length, 'descendant loot input ids must be unique');
const rolls = { ordinary: SourceLootRollSchema, boss: SourceLootRollSchema };
const itemRolls = () => obj({ itemId: ref('item'), ...rolls });
export const DescendantLootParamsSchema = obj({
  fairyCrown: obj({
    essence: obj({ crownwardItemId: ref('item'), fairyItemId: ref('item'), ...rolls }),
    rune: obj({ ...rolls, items: refine(arr(obj({ tier: crownTier(), itemId: ref('item') })),
      rows => rows.length === 3 && new Set(rows.map(row => row.tier)).size === 3, 'crown runes require each of tiers 30, 40 and 60') }),
    cosmic: itemRolls(), venison: obj({ speciesId: str({ nonEmpty: true }), itemId: ref('item'), roll: SourceLootRollSchema }),
  }),
  crownwardDragon: obj({ tier: lit(40), scales: itemRolls(), fireEssence: itemRolls(), rune: itemRolls() }),
  wildernessDragonSource: obj({ shallowTier: lit(50), scales: obj({ itemId: ref('item'),
    quantity: obj({ shallow: SourceLootQuantitySchema, deep: SourceLootQuantitySchema }), chance: num({ min: 0, max: 1 }) }),
    fireEssence: obj({ itemId: ref('item'), roll: SourceLootRollSchema }) }),
});
export type DescendantLootInput = Infer<typeof DescendantLootInputSchema>;
export type DescendantLootParams = Infer<typeof DescendantLootParamsSchema>;
