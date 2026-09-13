import { describe, expect, it } from 'vitest';
import type { EquipmentBonuses } from '../game/src/contracts.js';
import { BOSS_ARMOR_ITEMS, BOSS_ARMOR_SETS, bossArmorDrops } from '../game/src/content/bossArmor.js';
import { WILDERNESS_LOOT_ITEMS, WILDERNESS_LOOT_RECIPES, wildernessDrops } from '../game/src/content/wildernessLoot.js';
import { WILDERNESS_RUNE_KEEPERS } from '../game/src/content/wildernessDepth.js';
import { ALL_ITEMS } from '../game/src/content/items.js';
import { EQUIPMENT_SETS } from '../game/src/content/equipmentSets.js';

describe('rare boss armor', () => {
  it('defines six separate complete sets without replacing crafted armor', () => {
    expect(BOSS_ARMOR_SETS).toHaveLength(6);
    expect(BOSS_ARMOR_ITEMS).toHaveLength(28);
    const ids = new Set(BOSS_ARMOR_ITEMS.map(item => item.id));
    expect(ids.size).toBe(28);
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
        expect(WILDERNESS_LOOT_ITEMS.some(crafted => crafted.id === id)).toBe(false);
        expect(WILDERNESS_LOOT_RECIPES.some(recipe => recipe.output.itemId === id)).toBe(false);
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

  it('adds rare armor only to matching keeper tiers and leaves T90 without a source', () => {
    const rareIds = new Set(BOSS_ARMOR_ITEMS.map(item => item.id));
    const keeperRewardIds = new Set<string>();
    for (const keeper of WILDERNESS_RUNE_KEEPERS) {
      const actual = wildernessDrops(keeper.id, keeper.tier, keeper.id).filter(drop => rareIds.has(drop.itemId));
      expect(actual).toEqual(bossArmorDrops(keeper.tier));
      actual.forEach(drop => keeperRewardIds.add(drop.itemId));
    }
    for (const tier of [50, 70]) {
      for (const species of ['dragon', 'stone_golem', 'gloam_wraith']) {
        expect(wildernessDrops(species, tier).some(drop => rareIds.has(drop.itemId))).toBe(false);
      }
      expect(wildernessDrops('nightforge_guard', tier, undefined, 'nightforge_bastion').some(drop => rareIds.has(drop.itemId))).toBe(false);
    }
    for (const item of BOSS_ARMOR_ITEMS) expect(keeperRewardIds.has(item.id)).toBe(item.tier !== 90);
  });

  it('keeps a rounded 10% premium over every same-tier crafted armor stat', () => {
    for (const set of BOSS_ARMOR_SETS.filter(set => set.tier !== 90)) {
      const prefix = set.style === 'melee' ? (set.tier === 50 ? 'cindersteel' : 'nightglass')
        : (set.tier === 50 ? 'dragonhide' : 'starhide');
      for (const id of Object.values(set.members)) {
        const item = BOSS_ARMOR_ITEMS.find(item => item.id === id)!;
        const crafted = WILDERNESS_LOOT_ITEMS.find(item => item.id === id.replace(set.id, prefix))!;
        expect(crafted).toBeDefined();
        for (const [key, value] of Object.entries(crafted.equip!.bonuses)) {
          expect(item.equip!.bonuses[key as keyof EquipmentBonuses]).toBe(Math.round(value * 1.1));
        }
      }
    }
  });

  it('uses linear T90 growth and peer-scale defensive set bonuses', () => {
    for (const set of BOSS_ARMOR_SETS) {
      expect(set.thresholds.map(row => row.pieces)).toEqual(Object.keys(set.members).length === 4 ? [2, 3, 4] : [2, 4, 5]);
      const defence = set.tier === 50 ? 10 : set.tier === 70 ? 14 : 18;
      expect(set.thresholds[0]!.bonuses[set.style === 'melee' ? 'defence' : 'defence']).toBe(defence);
      expect(set.thresholds[2]!.bonuses[set.style === 'melee' ? 'defence' : 'defence']).toBe(defence);
      for (const threshold of set.thresholds) {
        expect(threshold.bonuses.meleePower + threshold.bonuses.magicPower + threshold.bonuses.meleeAccuracy + threshold.bonuses.magicAccuracy).toBe(0);
      }
      if (set.tier !== 90) continue;
      const lowPrefix = set.style === 'melee' ? 'cindersteel' : 'dragonhide';
      const highPrefix = set.style === 'melee' ? 'nightglass' : 'starhide';
      for (const id of Object.values(set.members)) {
        const item = BOSS_ARMOR_ITEMS.find(item => item.id === id)!;
        const low = WILDERNESS_LOOT_ITEMS.find(item => item.id === id.replace(set.id, lowPrefix))!.equip!.bonuses;
        const high = WILDERNESS_LOOT_ITEMS.find(item => item.id === id.replace(set.id, highPrefix))!.equip!.bonuses;
        for (const key of Object.keys(low) as (keyof EquipmentBonuses)[]) {
          expect(item.equip!.bonuses[key]).toBe(Math.round((2 * high[key] - low[key]) * 1.1));
        }
      }
    }
  });

  it.each([50, 70] as const)('drops only tier %i armor with independent piece probabilities', tier => {
    const drops = bossArmorDrops(tier);
    expect(drops).toHaveLength(9);
    expect(new Set(drops.map(drop => drop.itemId)).size).toBe(9);
    for (const drop of drops) {
      expect(BOSS_ARMOR_ITEMS.find(item => item.id === drop.itemId)?.tier).toBe(tier);
      expect(drop.quantity).toEqual([1, 1]);
      expect(drop.chance).toBe(0.02 / 9);
    }
    expect(drops.reduce((sum, drop) => sum + drop.chance, 0)).toBeCloseTo(0.02);
    expect(1 - drops.reduce((none, drop) => none * (1 - drop.chance), 1)).toBeCloseTo(1 - (1 - 0.02 / 9) ** 9);
    drops[0]!.quantity[0] = 99;
    expect(bossArmorDrops(tier)[0]!.quantity).toEqual([1, 1]);
  });
});
