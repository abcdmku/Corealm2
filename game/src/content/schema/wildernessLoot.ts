import { arr, enumOf, int, num, obj, opt, ref, refine, str, type Infer } from './core.js';
import { WILDERNESS_KEEPER_IDS } from './enemyWildernessSources.js';

export const WILDERNESS_STRUCTURE_LOOT_IDS = ['cinder_chain_foundry', 'nightforge_bastion', 'hollow_star_sanctum'] as const;
const names = () => refine(arr(str({ nonEmpty: true }), { minLength: 1 }), rows => new Set(rows).size === rows.length, 'values must be unique');
const ranks = () => refine(arr(int({ min: 1, max: 5 }), { minLength: 1 }), rows => new Set(rows).size === rows.length, 'ranks must be unique');
export const WildernessLootParamsSchema = refine(obj({
  dragonTokens: names(), stoneTokens: names(), stoneSpeciesIds: names(), cosmicRuneId: ref('item'),
  runesByRank: refine(arr(obj({ rank: int({ min: 1, max: 5 }), itemId: ref('item') })),
    rows => rows.length === 5 && new Set(rows.map(row => row.rank)).size === 5, 'all five rune ranks must occur once'),
  ordinaryRanks: obj({ shallow: ranks(), deep: ranks() }),
  keeperRewards: refine(arr(obj({ keeperId: enumOf(WILDERNESS_KEEPER_IDS), rune: ref('item'), component: ref('item') })),
    rows => rows.length === 5 && new Set(rows.map(row => row.keeperId)).size === 5, 'all five keepers must occur once'),
  structureComponents: refine(arr(obj({ structureId: enumOf(WILDERNESS_STRUCTURE_LOOT_IDS), itemId: ref('item') })),
    rows => rows.length === 3 && new Set(rows.map(row => row.structureId)).size === 3, 'all three structures must occur once'),
  groupSuffixes: names(),
}), params => [...params.ordinaryRanks.shallow, ...params.ordinaryRanks.deep].every(rank => params.runesByRank.some(row => row.rank === rank)),
'ordinary rune ranks must reference listed runes');
export const WildernessLootRequestSchema = obj({ speciesId: str({ nonEmpty: true }), tier: num(),
  keeperId: opt(enumOf(WILDERNESS_KEEPER_IDS)), groupId: opt(str({ nonEmpty: true })) });
export type WildernessLootParams = Infer<typeof WildernessLootParamsSchema>;
export type WildernessLootRequest = Infer<typeof WildernessLootRequestSchema>;
export type WildernessStructureLootId = typeof WILDERNESS_STRUCTURE_LOOT_IDS[number];
