import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { EnemyDef } from './index.js';
import { tuneEnemyCombatLevel } from './encounterBalance.js';
import { tierSilhouetteScale } from '../core/math.js';

export {
  UNIVERSAL_MINIBOSS_RESPAWN_SECONDS, UNIQUE_JEWELLERY_CHANCE, UNIVERSAL_MINIBOSS_ROSTER,
  UNIVERSAL_MINIBOSS_SPECIES,
} from './universalMinibosses.js';
export { MINIBOSS_JEWELLERY } from './universalMinibossLoot.js';

/** Increasing body size and danger place the last two creatures in the remote clearings. */
export const FAIRY_CREATURE_ROSTER = [
  { number: '11', id: 'petal_pouncer', name: 'Petal Pouncer', levelOffset: -4, nativeScale: .7 },
  { number: '14', id: 'moss_nibbler', name: 'Moss Nibbler', levelOffset: -2, nativeScale: .65 },
  { number: '16', id: 'bloom_hopper', name: 'Bloom Hopper', levelOffset: 0, nativeScale: .8 },
  { number: '21', id: 'thicket_spirit', name: 'Thicket Spirit', levelOffset: 3, nativeScale: .9 },
  { number: '27', id: 'bramble_prowler', name: 'Bramble Prowler', levelOffset: 8, nativeScale: 1.1 },
  { number: '30', id: 'elder_grovebeast', name: 'Elder Grovebeast', levelOffset: 14, nativeScale: 1.2 },
] as const;

const template: EnemyDef = {
  id: 'fairy_creature', family: 'fairy_creature', name: 'Fairy Creature', tier: 30,
  maxHealth: 70, attackLevel: 8, defenceLevel: 7, accuracy: 18, armour: 20, magicArmour: 12,
  maxHit: 6, attackSpeedMs: 2400, aggroRadius: 6, moveSpeedMps: 2.1, walkSpeedMps: .45,
  behaviour: 'territorial', drops: [],
};

export const FAIRY_CREATURE_SPECIES: readonly CreatureSpeciesDef[] = ([
  { regionId: 'gloamgarden', tier: 30 }, { regionId: 'faeholme', tier: 60 },
] as const).flatMap(({ regionId, tier }) => FAIRY_CREATURE_ROSTER.map((row): CreatureSpeciesDef => ({
  id: `${row.id}_t${tier}`, assetId: `fairy_monster_${row.number}`, regionId,
  scale: row.nativeScale / tierSilhouetteScale(tier), activity: row.levelOffset >= 8 ? 'prowl' : 'forage',
  description: `A T${tier} fairy grove inhabitant from Stylized Fantasy Vol 01 model ${row.number}.`,
  stats: {
    ...tuneEnemyCombatLevel(template, tier + row.levelOffset, tier),
    id: `${row.id}_t${tier}`, family: row.id, name: row.name,
    behaviour: row.levelOffset >= 8 ? 'aggressive' : 'territorial',
    aggroRadius: row.levelOffset >= 8 ? 8 : 5,
    drops: [
      { itemId: 'earth_essence', quantity: [1, 3] as [number, number], chance: .55 },
      { itemId: tier === 30 ? 'chaos_rune' : 'blood_rune', quantity: [1, 2] as [number, number], chance: .18 },
      { itemId: 'cosmic_rune', quantity: [1, 1] as [number, number], chance: .14 },
    ],
    marks: [tier * 3, tier * 7] as [number, number],
  },
})));
