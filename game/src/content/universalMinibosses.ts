import type { RegionId } from '../contracts.js';
import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { EnemyDef } from './index.js';
import { REGION_COMBAT_TIERS, tuneEnemyCombatLevel } from './encounterBalance.js';
import { tierSilhouetteScale } from '../core/math.js';
import { FAIRY_MINIBOSS_FORMS, fairyMinibossAsset } from './fairyMinibossForms.js';

export const UNIVERSAL_MINIBOSS_RESPAWN_SECONDS = 30 * 60;
export const UNIQUE_JEWELLERY_CHANCE = .30;
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

const template: EnemyDef = {
  id: 'universal_guardian', family: 'guardian', name: 'Guardian', tier: 30,
  maxHealth: 180, attackLevel: 14, defenceLevel: 12, accuracy: 22, armour: 32, magicArmour: 24,
  maxHit: 8, attackSpeedMs: 2600, aggroRadius: 9, attackRangeM: 2.6,
  moveSpeedMps: 2.6, walkSpeedMps: .55, behaviour: 'territorial', drops: [],
};

export function universalMinibossSpecies(number: UniversalMinibossNumber, regionId: RegionId, tierOverride?: 70): CreatureSpeciesDef {
  const row = UNIVERSAL_MINIBOSS_ROSTER.find(candidate => candidate.number === number)!;
  const tier = tierOverride ?? Math.max(10, REGION_COMBAT_TIERS[regionId]);
  const targetLevel = Math.max(12, Math.round(tier * 2.5));
  const stats: EnemyDef = {
    ...tuneEnemyCombatLevel(template, targetLevel, tier),
    id: `guardian_${number}_t${tier}`, family: `guardian_${number}`, name: row.name,
    attackStyle: row.style, respawnSeconds: UNIVERSAL_MINIBOSS_RESPAWN_SECONDS,
    drops: tier < 10 ? [] : [
      { itemId: `guardian_ring_t${tier}`, quantity: [1, 1], chance: UNIQUE_JEWELLERY_CHANCE / 2, exclusiveGroup: 'jewelry' },
      { itemId: `guardian_earring_t${tier}`, quantity: [1, 1], chance: UNIQUE_JEWELLERY_CHANCE / 2, exclusiveGroup: 'jewelry' },
    ],
    marks: [Math.max(15, tier * 10), Math.max(30, tier * 20)],
  };
  return {
    id: `guardian_${number}_${regionId}${tierOverride ? `_t${tierOverride}` : ""}`, assetId: fairyMinibossAsset(number, regionId) ?? `fantasy_monster_${number}`, regionId,
    scale: 1 / tierSilhouetteScale(tier), activity: 'patrol', stats,
    description: `Fantasy Monster ${number}. A roaming ${row.name} with a thirty-minute respawn.`,
  };
}

export const UNIVERSAL_MINIBOSS_SPECIES: readonly CreatureSpeciesDef[] =
  (Object.keys(REGION_COMBAT_TIERS) as RegionId[]).flatMap(regionId =>
    UNIVERSAL_MINIBOSS_ROSTER.flatMap(row => [universalMinibossSpecies(row.number, regionId),
      ...(regionId === 'wilderness' ? [universalMinibossSpecies(row.number, regionId, 70)] : [])]));

/** Cave and Karrowmoor share T10 stats; registration contains each canonical ID once. */
export const UNIVERSAL_MINIBOSS_ENEMIES: readonly EnemyDef[] = [...new Map(
  UNIVERSAL_MINIBOSS_SPECIES.map(species => [species.stats.id, species.stats]),
).values()];
