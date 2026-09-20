import { describe, expect, it } from 'vitest';
import { BOSS_ARMOR_ITEMS, BOSS_ARMOR_SETS, bossArmorDrops } from '../game/src/content/bossArmor.js';
import { ALL_ITEMS } from '../game/src/content/items.js';
import { EQUIPMENT_SETS } from '../game/src/content/equipmentSets.js';

describe('rare boss armor', () => {
  it('defines complete boss sets without replacing crafted armor', () => {
    expect(BOSS_ARMOR_SETS.length).toBeGreaterThan(0);
    expect(BOSS_ARMOR_ITEMS.length).toBeGreaterThan(0);
    const ids = new Set(BOSS_ARMOR_ITEMS.map(item => item.id));
    expect(ids.size).toBe(BOSS_ARMOR_ITEMS.length);
    for (const tier of [50, 70, 90]) {
      expect(BOSS_ARMOR_SETS.filter(set => set.tier === tier).map(set => set.style).sort()).toEqual(['magic', 'melee']);
    }
    for (const set of BOSS_ARMOR_SETS) {
      const bareheaded = ['duskguard', 'oathguard'].includes(set.id);
      expect(Object.keys(set.members).sort()).toEqual(bareheaded
        ? ['body', 'feet', 'hands', 'legs'] : ['body', 'feet', 'hands', 'head', 'legs']);
      if (bareheaded) expect(BOSS_ARMOR_ITEMS.some(item => item.id === `${set.id}_${set.style === 'melee' ? 'helm' : 'hood'}`)).toBe(false);
      for (const [slot, id] of Object.entries(set.members)) {
        const item = BOSS_ARMOR_ITEMS.find(item => item.id === id)!;
        expect(item.equip?.slot).toBe(slot);
        expect(item.equip?.requires).toEqual({ [set.style]: set.tier });
        expect(item.tier).toBe(set.tier);
        expect(item.stackable).toBe(false);
      }
    }
  });

  it('registers each rare item and set once without granting a crafting recipe', () => {
    for (const item of BOSS_ARMOR_ITEMS) {
      expect(ALL_ITEMS.filter(row => row.id === item.id)).toEqual([item]);
    }
    for (const set of BOSS_ARMOR_SETS) {
      expect(EQUIPMENT_SETS.filter(row => row.id === set.id)).toEqual([set]);
    }
  });

  it.each([50, 70] as const)('drops only tier %i armor with per-roll piece probabilities', tier => {
    const drops = bossArmorDrops(tier);
    expect(drops).toHaveLength(BOSS_ARMOR_ITEMS.filter(item => item.tier === tier).length);
    expect(new Set(drops.map(drop => drop.itemId)).size).toBe(drops.length);
    for (const drop of drops) {
      expect(BOSS_ARMOR_ITEMS.find(item => item.id === drop.itemId)?.tier).toBe(tier);
      expect(drop.quantity).toEqual([1, 1]);
      expect(drop.chance).toBe(0.02 / drops.length);
    }
    expect(drops.reduce((sum, drop) => sum + drop.chance, 0)).toBeCloseTo(0.02);
    drops[0]!.quantity[0] = 99;
    expect(bossArmorDrops(tier)[0]!.quantity).toEqual([1, 1]);
  });
});
