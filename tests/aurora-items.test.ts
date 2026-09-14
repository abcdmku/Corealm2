import { describe, expect, it } from 'vitest';
import { BOSS_ARMOR_ITEMS, BOSS_ARMOR_SETS } from '../game/src/content/bossArmor.js';
import { ALL_ITEMS } from '../game/src/content/items.js';
import { EQUIPMENT_SETS } from '../game/src/content/equipmentSets.js';
import { WILDERNESS_LOOT_RECIPES } from '../game/src/content/wildernessLoot.js';

const members = {
  head: 'frostweave_hood', body: 'frostweave_robe', legs: 'frostweave_leggings',
  hands: 'frostweave_wraps', feet: 'frostweave_boots',
};

describe('five-piece Aurora Frostweave', () => {
  it('registers five distinct level 90 magic pieces and the complete set once', () => {
    const items = BOSS_ARMOR_ITEMS.filter(item => item.id.startsWith('frostweave_'));
    expect(items.map(item => item.id).sort()).toEqual(Object.values(members).sort());
    expect(BOSS_ARMOR_ITEMS).toHaveLength(28);
    expect(new Set(BOSS_ARMOR_ITEMS.map(item => item.id)).size).toBe(28);
    for (const [slot, id] of Object.entries(members)) {
      const item = items.find(item => item.id === id)!;
      expect(item).toMatchObject({ tier: 90, stackable: false,
        equip: { slot, requires: { magic: 90 } } });
      expect(ALL_ITEMS.filter(item => item.id === id)).toEqual([item]);
    }
    const set = BOSS_ARMOR_SETS.find(set => set.id === 'frostweave')!;
    expect(set).toMatchObject({ name: 'Aurora Frostweave', tier: 90, style: 'magic', members });
    expect(set.thresholds.map(threshold => threshold.pieces)).toEqual([2, 4, 5]);
    expect(EQUIPMENT_SETS.filter(set => set.id === 'frostweave')).toEqual([set]);
  });

  it('names the new hood correctly and keeps the established linear T90 stats', () => {
    const hood = BOSS_ARMOR_ITEMS.find(item => item.id === members.head)!;
    expect(hood?.name).toBe('Aurora Frostweave Hood');
    expect(hood?.equip?.bonuses).toEqual({ meleeAccuracy: 0, meleePower: 0,
      magicAccuracy: 28, magicPower: 14, defence: 54, health: 14 , vitality: 0 });
    expect(BOSS_ARMOR_ITEMS.find(item => item.id === 'tideweave_hood')?.name).toBe('Chitin Tideweave Headwrap');
    expect(BOSS_ARMOR_ITEMS.find(item => item.id === 'nightweave_hood')?.name).toBe('Void Nightweave Headwrap');
  });

});
