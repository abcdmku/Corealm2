import { describe, expect, it } from "vitest";
import rawLootTables from "../game/content/data/lootTables.json";
import { LOOT_RECORDS, lootTableById } from "../game/src/content/lootData.js";
import { LootTableSchema } from "../game/src/content/schema/loot.js";
import { parseCollection } from "../game/src/content/schema/core.js";
import { parseValue } from "../game/src/content/schema/core.js";
import { LootPlanSchema } from "../game/src/content/schema/loot.js";
import { createLootCompiler, referencedLootTables } from "../game/src/content/lootCompiler.js";
import { rollItemDrops } from "../game/src/systems/equipmentCombat.js";
import type { LootDrop, LootRoll } from "../game/src/contracts.js";

describe("JSON loot loader", () => {
  it("reads the authored table in order and validates every row", () => {
    const parsed = parseCollection(LootTableSchema, rawLootTables, { name: "lootTables" });
    expect(LOOT_RECORDS).toEqual(parsed);
    expect(LOOT_RECORDS.length).toBeGreaterThan(0);
    expect(new Set(LOOT_RECORDS.map((row) => row.id)).size).toBe(LOOT_RECORDS.length);
    for (const row of LOOT_RECORDS) {
      expect(row.rolls).toBeInstanceOf(Array);
    }
  });

  it("returns the parsed record by id by id", () => {
    const first = LOOT_RECORDS[0]!;
    expect(lootTableById(first.id)).toBe(first);
    expect(lootTableById(LOOT_RECORDS.at(-1)!.id)).toBe(LOOT_RECORDS.at(-1));
  });

  it("throws for an unknown id", () => {
    expect(() => lootTableById("loot_enemy_missing_t1")).toThrow("Unknown loot table");
  });

});

const item = (itemId: string, chance: number): LootDrop => ({ itemId, chance, quantity: [1, 1] });
const roll = (id: string, drops: LootDrop[], count = 1, tables: LootRoll['tables'] = []): LootRoll => ({ id, name: id, count, drops, tables });
const compile = (rolls: LootRoll[]) => createLootCompiler([])({ rolls }, 'test');
function random(samples: number[]) {
  let draws = 0;
  return { next: () => { if (draws >= samples.length) throw new Error('Too many rolls'); return samples[draws++]!; }, int: (low: number) => low, draws: () => draws };
}

describe('explicit loot rolls', () => {
  it('selects one item per roll at exact probability boundaries, including no drop', () => {
    const pool = compile([roll('items', [item('ore', .25), item('hide', .5)])]);
    for (const [sample, expected] of [[0, 'ore'], [.24999, 'ore'], [.25, 'hide'], [.74999, 'hide'], [.75, null], [.99999, null]] as const) {
      expect(rollItemDrops(pool, random([sample]))).toEqual(expected ? [{ itemId: expected, quantity: 1 }] : []);
    }
  });

  it('uses the declared count, permits repeats, merges stacks and skips disabled rolls', () => {
    const rng = random([.1, .1, .9]);
    const result = rollItemDrops(compile([roll('items', [item('ore', .5)], 3), roll('disabled', [item('hide', 1)], 0)]), rng);
    expect(result).toEqual([{ itemId: 'ore', quantity: 2 }]);
    expect(rng.draws()).toBe(3);
  });

  it('keeps quantities independent from selection and does not redistribute suppressed items', () => {
    const pool = compile([roll('items', [{ ...item('ore', .5), quantity: [2, 5] }, item('orb', .5)], 2)]);
    const rng = { ...random([0, .5]), int: (low: number, high: number) => { expect([low, high]).toEqual([2, 5]); return 5; } };
    expect(rollItemDrops(pool, rng, id => id !== 'orb')).toEqual([{ itemId: 'ore', quantity: 5 }]);
  });

  it('joins table entries at their original chances without executing the source count', () => {
    const tables = [{ id: 'materials', name: 'Materials', rolls: [roll('items', [item('hide', .5)], 9)] }];
    const resolved = createLootCompiler(tables)({ rolls: [roll('main', [item('ore', .25)], 2, [{ tableId: 'materials', rollId: 'items' }])] }, 'creature');
    expect(resolved[0]!.drops.map(drop => drop.chance)).toEqual([.25, .5]);
    const rng = random([.25, .75]);
    expect(rollItemDrops(resolved, rng)).toEqual([{ itemId: 'hide', quantity: 1 }]);
    expect(rng.draws()).toBe(2);
  });

  it('runs separate table pools independently and resolves nested pool references', () => {
    const tables = [
      { id: 'materials', name: 'Materials', rolls: [roll('items', [item('ore', 1)])] },
      { id: 'nested', name: 'Nested', rolls: [roll('items', [], 1, [{ tableId: 'materials', rollId: 'items' }])] },
    ];
    const resolved = createLootCompiler(tables)({ rolls: [roll('main', [], 2, [{ tableId: 'nested', rollId: 'items' }]), roll('bonus', [item('gem', 1)])] }, 'creature');
    expect(rollItemDrops(resolved, random([.3, .8, .5]))).toEqual([{ itemId: 'ore', quantity: 2 }, { itemId: 'gem', quantity: 1 }]);
  });

  it('rejects overfull pools including attached entries, unknown rolls, cycles and duplicate ids', () => {
    const table = { id: 'materials', name: 'Materials', rolls: [roll('items', [item('ore', .6)])] };
    expect(() => createLootCompiler([table])({ rolls: [roll('main', [item('gem', .5)], 1, [{ tableId: 'materials', rollId: 'items' }])] }, 'creature')).toThrow('exceeding 100%');
    expect(() => createLootCompiler([table])({ rolls: [roll('main', [], 1, [{ tableId: 'missing', rollId: 'items' }])] }, 'creature')).toThrow('unknown loot table');
    expect(() => createLootCompiler([table])({ rolls: [roll('main', [], 1, [{ tableId: 'materials', rollId: 'missing' }])] }, 'creature')).toThrow('unknown roll');
    expect(() => createLootCompiler([{ ...table, rolls: [roll('items', [], 1, [{ tableId: 'materials', rollId: 'items' }])] }])).toThrow('cyclic');
    expect(() => compile([roll('items', []), roll('items', [])])).toThrow('duplicate');
  });

  it('rejects fractional, negative and excessive counts and the retired independent-drop shape', () => {
    for (const count of [-1, .5, 101]) expect(() => parseValue(LootPlanSchema, { rolls: [roll('items', [], count)] }, 'test')).toThrow();
    expect(() => parseValue(LootPlanSchema, { drops: [item('ore', .5)] }, 'test')).toThrow();
  });
});


describe('shared pool references', () => {
  it('finds transitive users through different pools of the same table', () => {
    const inner = { id: 'inner', name: 'Inner', rolls: [roll('items', [item('ore', .2)])] };
    const outer = { id: 'outer', name: 'Outer', rolls: [roll('first', []), roll('second', [], 1, [{ tableId: 'inner', rollId: 'items' }])] };
    const plan = { rolls: [roll('main', [], 1, [{ tableId: 'outer', rollId: 'first' }, { tableId: 'outer', rollId: 'second' }])] };
    expect([...referencedLootTables(plan, new Map([[inner.id, inner], [outer.id, outer]]))]).toEqual(['outer', 'inner']);
  });
  it('lets singleton eligibility see earlier results in the same kill', () => {
    const drops = compile([roll('orb', [item('orb', 1)], 3)]);
    const rng = random([0, 0, 0]);
    expect(rollItemDrops(drops, rng, (_, quantity) => quantity === 0)).toEqual([{ itemId: 'orb', quantity: 1 }]);
    expect(rng.draws()).toBe(3);
  });
});
