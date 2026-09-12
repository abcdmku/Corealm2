import type { EquipmentBonuses, ItemDef } from '../contracts.js';
import type { EnemyDef } from './index.js';
import type { ArmourSetSlot, EquipmentSetDefinition } from './equipmentSets.js';

type BossArmorTier = 50 | 70 | 90;
type Style = 'melee' | 'magic';
const SLOTS = ['head', 'body', 'legs', 'hands', 'feet'] as const;
const SUFFIXES = {
  melee: ['helm', 'plate', 'greaves', 'gauntlets', 'boots'],
  magic: ['hood', 'robe', 'leggings', 'wraps', 'boots'],
} as const;

function bonuses(partial: Partial<EquipmentBonuses> = {}): EquipmentBonuses {
  return { accuracy: 0, power: 0, armour: 0, magicAccuracy: 0, magicPower: 0,
    magicArmour: 0, vitality: 0, ...partial };
}

// Crafted T50/T70 baselines in slot order. Keep this module independent of the live registry
// so the lab can stage these items before world registration.
const BASELINES: Record<Style, readonly [EquipmentBonuses, EquipmentBonuses][]> = {
  melee: [
    [bonuses({ accuracy: 7, armour: 28, magicArmour: 9, vitality: 6 }), bonuses({ accuracy: 9, armour: 37, magicArmour: 12, vitality: 8 })],
    [bonuses({ accuracy: 10, armour: 60, magicArmour: 16, vitality: 14 }), bonuses({ accuracy: 13, armour: 79, magicArmour: 22, vitality: 19 })],
    [bonuses({ accuracy: 7, armour: 39, magicArmour: 12, vitality: 10 }), bonuses({ accuracy: 9, armour: 51, magicArmour: 16, vitality: 14 })],
    [bonuses({ accuracy: 6, armour: 16, magicArmour: 8, vitality: 5 }), bonuses({ accuracy: 8, armour: 21, magicArmour: 11, vitality: 7 })],
    [bonuses({ accuracy: 4, armour: 18, magicArmour: 8, vitality: 5 }), bonuses({ accuracy: 5, armour: 24, magicArmour: 11, vitality: 7 })],
  ],
  magic: [
    [bonuses({ armour: 5, magicAccuracy: 15, magicPower: 7, magicArmour: 27, vitality: 7 }), bonuses({ armour: 7, magicAccuracy: 20, magicPower: 10, magicArmour: 38, vitality: 10 })],
    [bonuses({ armour: 8, magicAccuracy: 23, magicPower: 11, magicArmour: 48, vitality: 13 }), bonuses({ armour: 11, magicAccuracy: 31, magicPower: 15, magicArmour: 67, vitality: 18 })],
    [bonuses({ armour: 6, magicAccuracy: 13, magicPower: 7, magicArmour: 33, vitality: 9 }), bonuses({ armour: 9, magicAccuracy: 18, magicPower: 9, magicArmour: 46, vitality: 12 })],
    [bonuses({ armour: 3, magicAccuracy: 4, magicArmour: 10, vitality: 4 }), bonuses({ armour: 4, magicAccuracy: 6, magicArmour: 15, vitality: 6 })],
    [bonuses({ armour: 3, magicAccuracy: 4, magicArmour: 10, vitality: 4 }), bonuses({ armour: 4, magicAccuracy: 6, magicArmour: 15, vitality: 6 })],
  ],
};

const SET_ROWS: readonly { id: string; name: string; style: Style; tier: BossArmorTier }[] = [
  { id: 'duskguard', name: 'Chitin Duskguard', style: 'melee', tier: 50 },
  { id: 'oathguard', name: 'Void Oathguard', style: 'melee', tier: 70 },
  { id: 'frostguard', name: 'Aurora Frostguard', style: 'melee', tier: 90 },
  { id: 'tideweave', name: 'Chitin Tideweave', style: 'magic', tier: 50 },
  { id: 'nightweave', name: 'Void Nightweave', style: 'magic', tier: 70 },
  { id: 'frostweave', name: 'Aurora Frostweave', style: 'magic', tier: 90 },
];

// These source variants are bareheaded. A set should not invent armor absent from its mesh.
const BAREHEADED = new Set(['duskguard', 'oathguard', 'frostweave']);
function setSlots(id: string): readonly ArmourSetSlot[] {
  return BAREHEADED.has(id) ? SLOTS.filter(slot => slot !== 'head') : SLOTS;
}

function pieceBonuses(style: Style, tier: BossArmorTier, index: number): EquipmentBonuses {
  const [low, high] = BASELINES[style][index]!;
  const result = bonuses();
  for (const key of Object.keys(result) as (keyof EquipmentBonuses)[]) {
    // T90 adds one linear T50-to-T70 step, then the same 10% rare premium.
    // No exponential scaling or extra damage stats. T90 has no current drop source.
    const baseline = tier === 50 ? low[key] : tier === 70 ? high[key] : high[key] + (high[key] - low[key]);
    result[key] = Math.round(baseline * 1.1);
  }
  return result;
}

export const BOSS_ARMOR_ITEMS: readonly ItemDef[] = SET_ROWS.flatMap(set => setSlots(set.id).map((slot): ItemDef => {
  const index = SLOTS.indexOf(slot);
  const suffix = SUFFIXES[set.style][index]!;
  const label = suffix === 'hood' ? 'Headwrap' : suffix.charAt(0).toUpperCase() + suffix.slice(1);
  return {
    id: `${set.id}_${suffix}`, name: `${set.name} ${label}`, tier: set.tier,
    description: `${set.name} ${label.toLowerCase()} for level ${set.tier} ${set.style === 'magic' ? 'Magic' : 'Melee'}.${set.tier === 90 ? '' : ' A rare boss reward.'}`,
    category: 'equipment', stackable: false,
    value: Math.round(set.tier * (slot === 'body' || slot === 'legs' ? 220 : 120)),
    equip: { slot, requires: { [set.style]: set.tier }, bonuses: pieceBonuses(set.style, set.tier, index) },
  };
}));

export const BOSS_ARMOR_SETS: readonly EquipmentSetDefinition[] = SET_ROWS.map(set => {
  const defence = set.tier === 50 ? 10 : set.tier === 70 ? 14 : 18;
  const vitality = set.tier === 50 ? 7 : set.tier === 70 ? 10 : 13;
  return {
    ...set,
    members: Object.fromEntries(setSlots(set.id).map(slot => [slot, `${set.id}_${SUFFIXES[set.style][SLOTS.indexOf(slot)]}`])) as Partial<Record<ArmourSetSlot, string>>,
    thresholds: [
      { pieces: 2, bonuses: bonuses(set.style === 'melee' ? { armour: defence } : { magicArmour: defence }) },
      { pieces: BAREHEADED.has(set.id) ? 3 : 4, bonuses: bonuses({ vitality }) },
      { pieces: BAREHEADED.has(set.id) ? 4 : 5, bonuses: bonuses(set.style === 'melee' ? { magicArmour: defence } : { armour: defence }) },
    ],
  };
});

/** Independent piece rolls share a 0.02 expected-piece budget, including bareheaded sets. */
export function bossArmorDrops(tier: 50 | 70): EnemyDef['drops'] {
  const items = BOSS_ARMOR_ITEMS.filter(item => item.tier === tier);
  return items.map(item => ({
    itemId: item.id, quantity: [1, 1], chance: 0.02 / items.length,
  }));
}
