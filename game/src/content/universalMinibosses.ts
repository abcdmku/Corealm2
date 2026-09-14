import { creatureRows } from './creatureData.js';
import type { RegionId } from '../contracts.js';
import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { EnemyDef } from './index.js';
import { ENEMY_BALANCE } from './enemyBalanceData.js';
import { LOOT_BALANCE } from './lootBalanceData.js';
import { deriveActorEnemy, resolveUniversalActorTier } from './balance/enemyActorSources.js';
import { universalJewelryDrops } from './balance/actorLoot.js';
import { tierSilhouetteScale } from '../core/math.js';
import { FAIRY_MINIBOSS_FORMS, fairyMinibossAsset } from './fairyMinibossForms.js';

export const UNIVERSAL_MINIBOSS_RESPAWN_SECONDS = ENEMY_BALANCE.actorSourceParameters.universal.respawnSeconds;
export const UNIQUE_JEWELLERY_CHANCE = LOOT_BALANCE.actorLootParameters.universalJewelry.totalChance;
export const UNIVERSAL_MINIBOSSES_PER_REGION = 2;

/** Each source body can appear in every region. Strength and rewards follow the region. */
export const UNIVERSAL_MINIBOSS_ROSTER = [
  { number: '01', name: 'Bramblehorn', style: 'melee', unique: 'Brambleheart Ring' },
  { number: '02', name: 'Gloamwarden', style: 'magic', unique: 'Gloamwarden Pendant' },
  { number: '03', name: 'Thorn Sovereign', style: 'melee', unique: 'Thorn Sovereign Ring' },
  { number: '04', name: 'Hollow Crown', style: 'magic', unique: 'Hollow Crown Pendant' },
  { number: '05', name: 'Stonevein', style: 'melee', unique: 'Stonevein Ring' },
  { number: '06', name: 'Nightbloom', style: 'magic', unique: 'Nightbloom Pendant' },
  { number: '07', name: 'Dreadroot', style: 'melee', unique: 'Dreadroot Ring' },
  { number: '08', name: 'Veilkeeper', style: 'magic', unique: 'Veilkeeper Pendant' },
  { number: '09', name: 'Elder Thorne', style: 'melee', unique: 'Elder Thorne Ring' },
] as const;
export type UniversalMinibossNumber = typeof UNIVERSAL_MINIBOSS_ROSTER[number]['number'];

/** Older aliases retain these same source bodies and are reserved as well. */
export const RESERVED_UNIVERSAL_MINIBOSS_ASSET_IDS = new Set<string>([
  ...UNIVERSAL_MINIBOSS_ROSTER.map(row => `fantasy_monster_${row.number}`),
  ...FAIRY_MINIBOSS_FORMS.map(row => row.assetId),
  'miniboss_cinderwake', 'miniboss_galeskin', 'miniboss_mossbound', 'miniboss_tideworn',
  'creature_cinder_ravager', 'creature_basalt_maw',
  'creature_gorge_mantis', 'creature_hollow_star', 'creature_amethyst_sovereign',
]);

export function isReservedUniversalMinibossAsset(assetId: string): boolean {
  return RESERVED_UNIVERSAL_MINIBOSS_ASSET_IDS.has(assetId);
}

export function universalMinibossSpecies(number: UniversalMinibossNumber, regionId: RegionId, tierOverride?: 70): CreatureSpeciesDef {
  const row = UNIVERSAL_MINIBOSS_ROSTER.find(candidate => candidate.number === number)!;
  const params = ENEMY_BALANCE.actorSourceParameters;
  const tier = resolveUniversalActorTier(params.universal, ENEMY_BALANCE.regionCombatTiers, regionId, tierOverride);
  const stats: EnemyDef = {
    ...deriveActorEnemy(params, {
      id: `universal/guardian_${number}_t${tier}`, kind: 'universal', number, tier,
      // The original helper tunes before reading the roster fields, including on invalid calls.
      get name() { return row.name; }, get style() { return row.style; },
    }, ENEMY_BALANCE),
    drops: universalJewelryDrops(LOOT_BALANCE.actorLootParameters.universalJewelry, tier, true),
  };
  return {
    id: `guardian_${number}_${regionId}${tierOverride ? `_t${tierOverride}` : ""}`, assetId: fairyMinibossAsset(number, regionId) ?? `fantasy_monster_${number}`, regionId,
    scale: 1 / tierSilhouetteScale(tier), activity: 'patrol', stats,
    description: `Fantasy Monster ${number}. A roaming ${row.name} with a thirty-minute respawn.`,
  };
}

export const UNIVERSAL_MINIBOSS_SPECIES: readonly CreatureSpeciesDef[] = creatureRows('UNIVERSAL_MINIBOSS_SPECIES');

/** Cave and Karrowmoor share T10 stats; registration contains each canonical ID once. */
export const UNIVERSAL_MINIBOSS_ENEMIES: readonly EnemyDef[] = [...new Map(
  UNIVERSAL_MINIBOSS_SPECIES.map(species => [species.stats.id, species.stats]),
).values()];
