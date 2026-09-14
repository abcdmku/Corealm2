import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { LOOT_BALANCE } from '../game/src/content/lootBalanceData.js';
import { REGIONAL_CRAFTING_TIER_DATA } from '../game/src/content/craftingTierData.js';
import { regionalFabricDrops as publicFabricDrops, REGIONAL_CRAFTING_TIERS } from '../game/src/content/regionalTierEquipment.js';
import { universalMinibossSpecies, UNIQUE_JEWELLERY_CHANCE } from '../game/src/content/universalMinibosses.js';
import { deriveActorLoot, regionalFabricDrops, universalJewelryDrops } from '../game/src/content/balance/actorLoot.js';
import type { EnemyDef } from '../game/src/content/index.js';

vi.mock('../game/src/content/lootBalanceData.js', async importOriginal => {
  const original = await importOriginal<typeof import('../game/src/content/lootBalanceData.js')>();
  return { LOOT_BALANCE: structuredClone(original.LOOT_BALANCE) };
});
vi.mock('../game/src/content/craftingTierData.js', async importOriginal => {
  const original = await importOriginal<typeof import('../game/src/content/craftingTierData.js')>();
  return { ...original, REGIONAL_CRAFTING_TIER_DATA: structuredClone(original.REGIONAL_CRAFTING_TIER_DATA) };
});
const initialLoot = structuredClone(LOOT_BALANCE), initialTiers = structuredClone(REGIONAL_CRAFTING_TIER_DATA);
afterEach(() => {
  Object.assign(LOOT_BALANCE, structuredClone(initialLoot));
  REGIONAL_CRAFTING_TIER_DATA.splice(0, REGIONAL_CRAFTING_TIER_DATA.length, ...structuredClone(initialTiers));
});

describe('actor loot public helper parameters', () => {
  it('reads regional fabric rolls and actual crafting tier item references', () => {
    expect(REGIONAL_CRAFTING_TIERS).toBe(REGIONAL_CRAFTING_TIER_DATA);
    const p = LOOT_BALANCE.regionalFabric;
    p.ordinary = { quantity: [2, 5], chance: .4 };
    p.boss = { quantity: [6, 9], chance: .8 };
    REGIONAL_CRAFTING_TIER_DATA.forEach(row => { row.hide = `edited_fabric_t${row.tier}`; });
    for (const tier of [30, 40, 60]) {
      expect(publicFabricDrops(tier)).toEqual([{ itemId: `edited_fabric_t${tier}`, quantity: [2, 5], chance: .4 }]);
      expect(publicFabricDrops(tier, true)).toEqual([{ itemId: `edited_fabric_t${tier}`, quantity: [6, 9], chance: .8 }]);
    }
    for (const tier of [-1, 0, .5, 10, 30.5, 50, 70, 99, NaN, Infinity, -Infinity]) expect(publicFabricDrops(tier)).toEqual([]);
  });

  it('uses editable guardian slots and every jewelry roll parameter in the public helper', () => {
    const p = LOOT_BALANCE.actorLootParameters.universalJewelry;
    expect(UNIQUE_JEWELLERY_CHANCE).toBe(p.totalChance);
    p.totalChance = .8; p.quantity = [2, 4]; p.exclusiveGroup = 'edited_jewelry';
    const tier30 = p.items.find(row => row.tier === 30)!;
    tier30.ringItemId = 'edited_ring'; tier30.earringItemId = 'edited_earring';
    const expected = [
      { itemId: 'edited_ring', quantity: [2, 4], chance: .4, exclusiveGroup: 'edited_jewelry' },
      { itemId: 'edited_earring', quantity: [2, 4], chance: .4, exclusiveGroup: 'edited_jewelry' },
    ];
    expect(universalMinibossSpecies('01', 'gloamgarden').stats.drops).toEqual(expected);
    p.minimumTier = 40;
    expect(universalMinibossSpecies('01', 'gloamgarden').stats.drops).toEqual([]);
    expect(universalMinibossSpecies('01', 'crownward').stats.drops).toHaveLength(2);
  });

  it('keeps strict source derivation closed while allowing explicit custom-tier helper calls', () => {
    const p = LOOT_BALANCE.actorLootParameters, dependencies = {
      regionalFabric: LOOT_BALANCE.regionalFabric, regionalCraftingTiers: REGIONAL_CRAFTING_TIERS,
    };
    for (const tier of [11, 15, 30.5, 99]) {
      expect(() => universalJewelryDrops(p.universalJewelry, tier)).toThrow(`Missing guardian jewelry tier ${tier}`);
      expect(() => deriveActorLoot(p, { id: 'custom', kind: 'universalJewelry', tier }, dependencies))
        .toThrow(`Missing guardian jewelry tier ${tier}`);
      const drops = universalJewelryDrops(p.universalJewelry, tier, true);
      expect(drops.map(row => row.itemId)).toEqual([`guardian_ring_t${tier}`, `guardian_earring_t${tier}`]);
      expect(universalMinibossSpecies('01', 'fallowmarch', tier as 70).stats.drops).toEqual(drops);
    }
    p.universalJewelry.minimumTier = 1;
    p.universalJewelry.totalChance = .6; p.universalJewelry.quantity = [3, 5]; p.universalJewelry.exclusiveGroup = 'custom';
    expect(universalMinibossSpecies('01', 'fallowmarch', 5 as 70).stats.drops).toEqual([
      { itemId: 'guardian_ring_t5', quantity: [3, 5], chance: .3, exclusiveGroup: 'custom' },
      { itemId: 'guardian_earring_t5', quantity: [3, 5], chance: .3, exclusiveGroup: 'custom' },
    ]);
  });

  it('returns fresh arrays without mutating frozen parameters or shared item rows', () => {
    const p = structuredClone(initialLoot.actorLootParameters.universalJewelry);
    const fabric = structuredClone(initialLoot.regionalFabric), tiers = structuredClone(initialTiers);
    const before = structuredClone({ p, fabric, tiers });
    const freeze = (value: unknown): void => {
      if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    };
    freeze(p); freeze(fabric); freeze(tiers);
    const factories = [() => universalJewelryDrops(p, 30), () => universalJewelryDrops(p, 31, true),
      () => regionalFabricDrops(fabric, tiers, 30), () => regionalFabricDrops(fabric, tiers, 40, true)];
    for (const factory of factories) {
      const first = factory(), expected = structuredClone(first), second = factory();
      second[0]!.quantity[0] = 999; second[0]!.chance = 0; second.pop();
      expect(first).toStrictEqual(expected); expect(factory()).toStrictEqual(expected);
    }
    expect({ p, fabric, tiers }).toStrictEqual(before);
  });
});

const originalPath = new URL('../.baseline/game/src/content/regionalTierEquipment.ts', import.meta.url);
describe.skipIf(!existsSync(originalPath))('original regional fabric helper', () => {
  let original: (tier: unknown, boss?: unknown) => EnemyDef['drops'];
  beforeAll(async () => {
    const source = readFileSync(originalPath, 'utf8');
    const tiersStart = source.indexOf('export const REGIONAL_CRAFTING_TIERS =');
    const tiersEnd = source.indexOf('] as const;', tiersStart) + '] as const;'.length;
    const helperStart = source.indexOf('export function regionalFabricDrops(');
    const helperEnd = /\r?\n}(?=\r?\n|$)/.exec(source.slice(helperStart));
    if (tiersStart < 0 || tiersEnd <= tiersStart || helperStart < 0 || !helperEnd) throw new Error('Missing original regional fabric declarations');
    const isolated = [source.slice(tiersStart, tiersEnd),
      source.slice(helperStart, helperStart + helperEnd.index + helperEnd[0].length)].join('\n').replace(/^export /gm, '');
    const compiled = await transform(`${isolated}\nreturn regionalFabricDrops;`, { loader: 'ts', target: 'es2022' });
    original = new Function(compiled.code)() as typeof original;
  });

  it('matches original item order, default rolls, unsupported tiers and runtime truthiness', () => {
    const current = publicFabricDrops as typeof original;
    for (const tier of [-1, 0, .5, 10, 30, 30.5, 40, 50, 60, 70, 99, NaN, Infinity, -Infinity, null, undefined, '30']) {
      for (const boss of [undefined, false, true, null, 0, 1, 'false']) {
        expect(current(tier, boss), `${tier}/${boss}`).toStrictEqual(original(tier, boss));
      }
    }
  });
});
