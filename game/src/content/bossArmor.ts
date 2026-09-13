import type { EquipmentBonuses, ItemDef } from '../contracts.js';
import type { EnemyDef } from './index.js';
import type { ArmourSetSlot, EquipmentSetDefinition } from './equipmentSets.js';
type BossArmorTier = 50 | 70 | 90;
type Style = 'melee' | 'magic';
const SLOTS = ['head', 'body', 'legs', 'hands', 'feet'] as const;
const SUFFIXES = {
    melee: ['helm', 'plate', 'greaves', 'gauntlets', 'boots'],
    magic: ['hood', 'robe', 'leggings', 'wraps', 'boots']
} as const;
function bonuses(partial: Partial<EquipmentBonuses> = {}): EquipmentBonuses {
    return { meleeAccuracy: 0, meleePower: 0, defence: Math.max(0, 0), magicAccuracy: 0, magicPower: 0,
        health: 0, ...partial, vitality: 0 };
}
// Crafted T50/T70 baselines in slot order. Keep this module independent of the live registry
// so the lab can stage these items before world registration.
const BASELINES: Record<Style, readonly [
    EquipmentBonuses,
    EquipmentBonuses
][]> = {
    melee: [
        [bonuses({ meleeAccuracy: 7, defence: Math.max(28, 9), health: 6 }), bonuses({ meleeAccuracy: 9, defence: Math.max(37, 12), health: 8 })],
        [bonuses({ meleeAccuracy: 10, defence: Math.max(60, 16), health: 14 }), bonuses({ meleeAccuracy: 13, defence: Math.max(79, 22), health: 19 })],
        [bonuses({ meleeAccuracy: 7, defence: Math.max(39, 12), health: 10 }), bonuses({ meleeAccuracy: 9, defence: Math.max(51, 16), health: 14 })],
        [bonuses({ meleeAccuracy: 6, defence: Math.max(16, 8), health: 5 }), bonuses({ meleeAccuracy: 8, defence: Math.max(21, 11), health: 7 })],
        [bonuses({ meleeAccuracy: 4, defence: Math.max(18, 8), health: 5 }), bonuses({ meleeAccuracy: 5, defence: Math.max(24, 11), health: 7 })],
    ],
    magic: [
        [bonuses({ defence: Math.max(5, 27), magicAccuracy: 15, magicPower: 7, health: 7, vitality: 0 }), bonuses({ defence: Math.max(7, 38), magicAccuracy: 20, magicPower: 10, health: 10, vitality: 0 })],
        [bonuses({ defence: Math.max(8, 48), magicAccuracy: 23, magicPower: 11, health: 13, vitality: 0 }), bonuses({ defence: Math.max(11, 67), magicAccuracy: 31, magicPower: 15, health: 18, vitality: 0 })],
        [bonuses({ defence: Math.max(6, 33), magicAccuracy: 13, magicPower: 7, health: 9, vitality: 0 }), bonuses({ defence: Math.max(9, 46), magicAccuracy: 18, magicPower: 9, health: 12, vitality: 0 })],
        [bonuses({ defence: Math.max(3, 10), magicAccuracy: 4, health: 4, vitality: 0 }), bonuses({ defence: Math.max(4, 15), magicAccuracy: 6, health: 6, vitality: 0 })],
        [bonuses({ defence: Math.max(3, 10), magicAccuracy: 4, health: 4, vitality: 0 }), bonuses({ defence: Math.max(4, 15), magicAccuracy: 6, health: 6, vitality: 0 })],
    ]
};
const SET_ROWS: readonly {
    id: string;
    name: string;
    style: Style;
    tier: BossArmorTier;
}[] = [
    { id: 'duskguard', name: 'Chitin Duskguard', style: 'melee', tier: 50 },
    { id: 'oathguard', name: 'Void Oathguard', style: 'melee', tier: 70 },
    { id: 'frostguard', name: 'Aurora Frostguard', style: 'melee', tier: 90 },
    { id: 'tideweave', name: 'Chitin Tideweave', style: 'magic', tier: 50 },
    { id: 'nightweave', name: 'Void Nightweave', style: 'magic', tier: 70 },
    { id: 'frostweave', name: 'Aurora Frostweave', style: 'magic', tier: 90 },
];
// Aurora now has an authored hood. The remaining imported variants are bareheaded.
const BAREHEADED = new Set(['duskguard', 'oathguard']);
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
    const label = suffix === 'hood' ? (set.id === 'frostweave' ? 'Hood' : 'Headwrap') : suffix.charAt(0).toUpperCase() + suffix.slice(1);
    return {
        id: `${set.id}_${suffix}`, name: `${set.name} ${label}`, tier: set.tier,
        description: `${set.name} ${label.toLowerCase()} for level ${set.tier} ${set.style === 'magic' ? 'Magic' : 'Melee'}.${set.tier === 90 ? '' : ' A rare boss reward.'}`,
        category: 'equipment', stackable: false,
        value: Math.round(set.tier * (slot === 'body' || slot === 'legs' ? 220 : 120)),
        equip: { slot, requires: { [set.style]: set.tier }, bonuses: pieceBonuses(set.style, set.tier, index) }
    };
}));
export const BOSS_ARMOR_SETS: readonly EquipmentSetDefinition[] = SET_ROWS.map(set => {
    const defence = set.tier === 50 ? 10 : set.tier === 70 ? 14 : 18;
    const health = set.tier === 50 ? 7 : set.tier === 70 ? 10 : 13;
    return {
        ...set,
        members: Object.fromEntries(setSlots(set.id).map(slot => [slot, `${set.id}_${SUFFIXES[set.style][SLOTS.indexOf(slot)]}`])) as Partial<Record<ArmourSetSlot, string>>,
        thresholds: [
            { pieces: 2, bonuses: bonuses(set.style === 'melee' ? { defence: defence } : { defence: defence }) },
            { pieces: BAREHEADED.has(set.id) ? 3 : 4, bonuses: bonuses({ health }) },
            { pieces: BAREHEADED.has(set.id) ? 4 : 5, bonuses: bonuses(set.style === 'melee' ? { defence: defence } : { defence: defence }) },
        ]
    };
});
/** Independent piece rolls share a 0.02 expected-piece budget, including bareheaded sets. */
export function bossArmorDrops(tier: 50 | 70): EnemyDef['drops'] {
    const items = BOSS_ARMOR_ITEMS.filter(item => item.tier === tier);
    return items.map(item => ({
        itemId: item.id, quantity: [1, 1], chance: 0.02 / items.length
    }));
}
