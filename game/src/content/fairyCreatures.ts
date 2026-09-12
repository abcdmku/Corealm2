import type { EquipmentBonuses, ItemDef } from '../contracts.js';
import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { EnemyDef } from './index.js';
import { tuneEnemyCombatLevel } from './encounterBalance.js';
import { tierSilhouetteScale } from '../core/math.js';

export const UNIVERSAL_MINIBOSS_RESPAWN_SECONDS = 30 * 60;
export const UNIQUE_JEWELLERY_CHANCE = 0.02;
const bonuses = (values: Partial<EquipmentBonuses>): EquipmentBonuses => ({
  accuracy: 0, power: 0, armour: 0, magicAccuracy: 0, magicPower: 0, magicArmour: 0, vitality: 0, ...values,
});

/** Source numbering is retained so a new region can select any of the nine bodies. */
export const UNIVERSAL_MINIBOSS_ROSTER = [
  { number: '01', name: 'Bramblehorn', tier: 5, style: 'melee', unique: 'Brambleheart Ring' },
  { number: '02', name: 'Gloamwarden', tier: 10, style: 'magic', unique: 'Gloamwarden Pendant' },
  { number: '03', name: 'Thorn Sovereign', tier: 20, style: 'melee', unique: 'Thorn Sovereign Ring' },
  { number: '04', name: 'Hollow Crown', tier: 30, style: 'magic', unique: 'Hollow Crown Pendant' },
  { number: '05', name: 'Stonevein', tier: 40, style: 'melee', unique: 'Stonevein Ring' },
  { number: '06', name: 'Nightbloom', tier: 50, style: 'magic', unique: 'Nightbloom Pendant' },
  { number: '07', name: 'Dreadroot', tier: 60, style: 'melee', unique: 'Dreadroot Ring' },
  { number: '08', name: 'Veilkeeper', tier: 70, style: 'magic', unique: 'Veilkeeper Pendant' },
  { number: '09', name: 'Elder Thorne', tier: 90, style: 'melee', unique: 'Elder Thorne Ring' },
] as const;

export const MINIBOSS_JEWELLERY: readonly ItemDef[] = UNIVERSAL_MINIBOSS_ROSTER.flatMap(row => {
  const magic = row.style === 'magic';
  const slot = magic ? 'accessory2' : 'accessory1';
  const standard: ItemDef = {
    id: `warden_jewellery_${row.number}`, name: `Warden's ${magic ? 'Pendant' : 'Ring'} ${row.tier}`,
    tier: row.tier, category: 'equipment', stackable: false, value: row.tier * 60,
    description: 'Jewellery recovered from a roaming guardian.',
    equip: { slot, requires: { [row.style]: row.tier }, bonuses: bonuses({
      armour: Math.ceil(row.tier * .11), magicArmour: Math.ceil(row.tier * .11), vitality: Math.ceil(row.tier * .07),
      ...(magic ? { magicPower: Math.ceil(row.tier * .07) } : { power: Math.ceil(row.tier * .07) }),
    }) },
  };
  const unique: ItemDef = {
    id: `unique_jewellery_${row.number}`, name: row.unique, tier: row.tier,
    category: 'equipment', stackable: false, value: row.tier * 360,
    description: `A rare reward from ${row.name}. Grants defence, maximum health and ${magic ? 'magic' : 'melee'} strength.`,
    equip: { slot, requires: { [row.style]: row.tier }, bonuses: bonuses({
      armour: Math.ceil(row.tier * .25) + 2, magicArmour: Math.ceil(row.tier * .25) + 2,
      vitality: Math.ceil(row.tier * .2) + 3,
      ...(magic ? { magicPower: Math.ceil(row.tier * .18) + 2, magicAccuracy: Math.ceil(row.tier * .12) }
        : { power: Math.ceil(row.tier * .18) + 2, accuracy: Math.ceil(row.tier * .12) }),
    }) },
  };
  return [standard, unique];
});

const template: EnemyDef = {
  id: 'fairy_guardian', family: 'fairy_guardian', name: 'Guardian', tier: 5,
  maxHealth: 90, attackLevel: 8, defenceLevel: 7, accuracy: 18, armour: 20, magicArmour: 12,
  maxHit: 6, attackSpeedMs: 2400, aggroRadius: 9, moveSpeedMps: 3.2, walkSpeedMps: .7,
  behaviour: 'territorial', drops: [],
};

export const UNIVERSAL_MINIBOSS_SPECIES: readonly CreatureSpeciesDef[] = UNIVERSAL_MINIBOSS_ROSTER.map(row => ({
  id: `guardian_${row.number}`, assetId: `fantasy_monster_${row.number}`, regionId: 'vellenwood',
  scale: 1 / tierSilhouetteScale(row.tier), activity: 'patrol',
  description: `Fantasy Monster ${row.number}. A roaming miniboss with a thirty-minute respawn.`,
  stats: {
    ...tuneEnemyCombatLevel(template, row.tier * 3, row.tier),
    id: `guardian_${row.number}_t${row.tier}`, family: `guardian_${row.number}`, name: row.name,
    attackStyle: row.style === 'magic' ? 'magic' : 'melee',
    respawnSeconds: UNIVERSAL_MINIBOSS_RESPAWN_SECONDS,
    drops: [
      { itemId: `warden_jewellery_${row.number}`, quantity: [1, 1], chance: 1 },
      { itemId: `unique_jewellery_${row.number}`, quantity: [1, 1], chance: UNIQUE_JEWELLERY_CHANCE },
    ],
    marks: [row.tier * 10, row.tier * 20],
  },
}));

/** The supplied free-trial volume contains thirty distinct source bodies. */
export const FAIRY_CREATURE_ROSTER = [
  { number: '11', id: 'petal_pouncer', name: 'Petal Pouncer', level: 7 },
  { number: '14', id: 'moss_nibbler', name: 'Moss Nibbler', level: 9 },
  { number: '16', id: 'bloom_hopper', name: 'Bloom Hopper', level: 11 },
  { number: '21', id: 'thicket_spirit', name: 'Thicket Spirit', level: 13 },
  { number: '27', id: 'bramble_prowler', name: 'Bramble Prowler', level: 17 },
  { number: '30', id: 'elder_grovebeast', name: 'Elder Grovebeast', level: 22 },
] as const;
export const FAIRY_CREATURE_SPECIES: readonly CreatureSpeciesDef[] = FAIRY_CREATURE_ROSTER.map(row => ({
  id: row.id, assetId: `fairy_monster_${row.number}`, regionId: 'vellenwood',
  scale: 1 / tierSilhouetteScale(5), activity: 'forage',
  description: `An inhabitant of the fairy groves, from Stylized Fantasy Vol 01 model ${row.number}.`,
  stats: { ...tuneEnemyCombatLevel(template, row.level, 5), id: `${row.id}_t5`, family: row.id,
    name: row.name, drops: [], marks: [8, 22], behaviour: row.level >= 17 ? 'aggressive' : 'territorial' },
}));
