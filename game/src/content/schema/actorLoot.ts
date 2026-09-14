import { arr, id, int, lit, num, obj, ref, refine, str, union, type Infer } from './core.js';
import { SourceLootQuantitySchema, SourceLootRollSchema } from './sourceLoot.js';

const fairyTier = () => union([lit(30), lit(60)] as const);
const fabricTier = () => union([lit(30), lit(40), lit(60)] as const);
export const ACTOR_JEWELRY_TIERS = [10, 20, 30, 40, 50, 60, 70] as const;
export const RegionalFabricParamsSchema = obj({ ordinary: SourceLootRollSchema, boss: SourceLootRollSchema });
export const RegionalFabricTiersSchema = refine(arr(obj({ tier: fabricTier(), hide: ref('item') })),
  rows => rows.length === 3 && new Set(rows.map(row => row.tier)).size === 3, 'regional fabric requires exactly tiers 30, 40 and 60');
export const ActorLootInputSchema = union([
  obj({ id: id(), kind: lit('fairy'), tier: fairyTier() }),
  obj({ id: id(), kind: lit('universalJewelry'), tier: int({ min: 1 }) }),
] as const);
export const ActorLootInputsSchema = refine(arr(ActorLootInputSchema),
  rows => new Set(rows.map(row => row.id)).size === rows.length, 'actor loot input ids must be unique');
const itemRoll = () => obj({ itemId: ref('item'), roll: SourceLootRollSchema });
export const ActorLootParamsSchema = obj({
  fairy: obj({ earth: itemRoll(), cosmic: itemRoll(), rune: obj({ roll: SourceLootRollSchema,
    items: refine(arr(obj({ tier: fairyTier(), itemId: ref('item') })),
      rows => rows.length === 2 && new Set(rows.map(row => row.tier)).size === 2, 'fairy runes require exactly tiers 30 and 60') }) }),
  universalJewelry: obj({ minimumTier: int({ min: 1 }), totalChance: num({ min: 0, max: 1 }),
    exclusiveGroup: str({ nonEmpty: true }), quantity: SourceLootQuantitySchema,
    items: refine(arr(obj({ tier: union([lit(10), lit(20), lit(30), lit(40), lit(50), lit(60), lit(70)] as const),
      ringItemId: ref('item'), earringItemId: ref('item') })),
      rows => rows.length === ACTOR_JEWELRY_TIERS.length && rows.every((row, index) => row.tier === ACTOR_JEWELRY_TIERS[index])
        && rows.every(row => row.ringItemId !== row.earringItemId)
        && new Set(rows.flatMap(row => [row.ringItemId, row.earringItemId])).size === rows.length * 2,
      'jewelry requires seven ordered tiers and distinct ring and earring slots') }),
});
export type ActorLootInput = Infer<typeof ActorLootInputSchema>;
export type ActorLootParams = Infer<typeof ActorLootParamsSchema>;
export type RegionalFabricParams = Infer<typeof RegionalFabricParamsSchema>;
export type RegionalFabricTiers = Infer<typeof RegionalFabricTiersSchema>;
