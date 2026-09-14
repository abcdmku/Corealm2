import type { EnemyDef } from '../index.js';
import type { LootBalance } from '../schema/balance.js';
import type { WildernessCraftingTier } from '../schema/craftingTiers.js';
import type { WildernessKeeperRow } from '../schema/enemyWildernessSources.js';
import type { WildernessLootParams, WildernessStructureLootId } from '../schema/wildernessLoot.js';
export type { WildernessLootParams, WildernessLootRequest, WildernessStructureLootId } from '../schema/wildernessLoot.js';

export interface WildernessLootDependencies {
  craftingTiers: readonly WildernessCraftingTier[];
  keepers: readonly WildernessKeeperRow[];
  rolls: Pick<LootBalance, 'wilderness' | 'bossArmorExpectedPieces'>;
  armorEligibility: readonly { tier: 50 | 70; itemIds: readonly string[] }[];
}
type Request = { speciesId: string; tier: number; keeperId?: string };
function one<T>(rows: readonly T[], predicate: (row: T) => boolean, label: string): T {
  const matches = rows.filter(predicate);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label}`);
  return matches[0]!;
}
const drop = (itemId: string, roll: { quantity: readonly [number, number]; chance: number }): EnemyDef['drops'][number] =>
  ({ itemId, quantity: [roll.quantity[0], roll.quantity[1]], chance: roll.chance });

/** Explicit helper keeps the original arbitrary numeric tier and direct structure argument semantics. */
export function wildernessDropsForStructure(params: WildernessLootParams,
  request: Request & { structureId?: WildernessStructureLootId }, deps: WildernessLootDependencies): EnemyDef['drops'] {
  const keeper = request.keeperId ? deps.keepers.find(row => row.id === request.keeperId) : undefined;
  if (request.keeperId && !keeper) throw new Error(`Unknown Wilderness rune keeper: ${request.keeperId}`);
  if (keeper) one(deps.keepers, row => row.id === keeper.id, `keeper ${keeper.id}`);
  const deep = (keeper?.tier ?? request.tier) >= deps.rolls.wilderness.deepTier;
  const materials = one(deps.craftingTiers, row => row.tier === (deep ? 70 : 50), `Wilderness crafting tier ${deep ? 70 : 50}`);
  const species = keeper?.id ?? request.speciesId;
  const draconic = params.dragonTokens.some(token => species.includes(token));
  const stony = params.stoneSpeciesIds.includes(species) || params.stoneTokens.some(token => species.includes(token));
  const material = draconic ? materials.hide : stony ? materials.flux : materials.thread;
  if (keeper) {
    const reward = one(params.keeperRewards, row => row.keeperId === keeper.id, `keeper reward ${keeper.id}`);
    const armor = one(deps.armorEligibility, row => row.tier === keeper.tier, `boss armor tier ${keeper.tier}`).itemIds;
    if (new Set(armor).size !== armor.length) throw new Error(`Duplicate boss armor item at tier ${keeper.tier}`);
    const rolls = deps.rolls.wilderness.keeper;
    return [drop(material, rolls.material), drop(reward.component, rolls.component), drop(reward.rune, rolls.rune),
      drop(params.cosmicRuneId, rolls.cosmicRune), drop(materials.ore, rolls.ore), drop(materials.gem, rolls.gem),
      ...armor.map(itemId => drop(itemId, { quantity: [1, 1], chance: deps.rolls.bossArmorExpectedPieces / armor.length }))];
  }
  const rolls = deps.rolls.wilderness.ordinary;
  const runes = params.ordinaryRanks[deep ? 'deep' : 'shallow'].map(rank => drop(
    one(params.runesByRank, row => row.rank === rank, `rune rank ${rank}`).itemId,
    one(rolls.runes, row => row.rank === rank, `rune roll rank ${rank}`)));
  return [drop(material, rolls.material), drop(params.cosmicRuneId, rolls.cosmicRune), ...runes,
    ...(stony ? [drop(materials.ore, rolls.ore)] : []), drop(materials.gem, rolls.gem),
    ...(request.structureId ? [drop(one(params.structureComponents, row => row.structureId === request.structureId,
      `structure ${request.structureId}`).itemId, rolls.structureComponent)] : [])];
}

/** Canonical rows omit groupId; only exact authored conclave suffixes earn structure components. */
export function deriveWildernessLoot(params: WildernessLootParams, request: Request & { groupId?: string },
  deps: WildernessLootDependencies): EnemyDef['drops'] {
  const structure = params.structureComponents.find(row => params.groupSuffixes.some(suffix => request.groupId === `${row.structureId}${suffix}`));
  return wildernessDropsForStructure(params, { ...request, structureId: structure?.structureId }, deps);
}
