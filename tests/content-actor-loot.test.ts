import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildM4Baseline, type M4Baseline, type Snapshot } from '../tools/content/m4-baseline.js';
import { ACTOR_LOOT_MODULES, buildActorLootSources, type ActorLootSources } from '../tools/content/actor-loot-inputs.js';
import { deriveActorLoot, regionalFabricDrops } from '../game/src/content/balance/actorLoot.js';
import { ActorLootInputSchema, ActorLootInputsSchema, ActorLootParamsSchema, RegionalFabricParamsSchema, RegionalFabricTiersSchema } from '../game/src/content/schema/actorLoot.js';
import { arr, parseValue } from '../game/src/content/schema/core.js';
import { DropSchema } from '../game/src/content/schema/loot.js';
import type { EnemyDef } from '../game/src/content/index.js';

function restore(value: Snapshot): unknown {
  switch (value.kind) {
    case 'number': case 'string': case 'boolean': return value.value;
    case 'null': return null;
    case 'undefined': return undefined;
    case 'array': return value.values.map(restore);
    case 'object': return Object.fromEntries(value.entries.map(([key, entry]) => [key, restore(entry)]));
    default: throw new Error(`Unexpected snapshot ${value.kind}`);
  }
}
const sourcePath = (module: string) => new URL(`../.baseline/game/src/content/${module}.ts`, import.meta.url);
describe('actor loot provenance guard', () => {
  it('rejects absent source evidence', () => {
    expect(() => buildActorLootSources({ source: { files: [] } } as unknown as M4Baseline,
      Object.fromEntries(ACTOR_LOOT_MODULES.map(module => [module, ''])) as ActorLootSources)).toThrow(/source hash/);
  });
});
describe.skipIf(!ACTOR_LOOT_MODULES.every(module => existsSync(sourcePath(module))))('original actor loot extraction', () => {
  let baseline: M4Baseline, sources: ActorLootSources, extracted: ReturnType<typeof buildActorLootSources>;
  beforeAll(async () => {
    baseline = await buildM4Baseline();
    sources = Object.fromEntries(ACTOR_LOOT_MODULES.map(module => [module, readFileSync(sourcePath(module), 'utf8')])) as ActorLootSources;
    extracted = buildActorLootSources(baseline, sources);
  });
  function changed(edits: [keyof ActorLootSources, string, string][]) {
    const next = { ...sources }, evidence = structuredClone(baseline);
    for (const [module, original, replacement] of edits) {
      const before = next[module]; next[module] = next[module].replace(original, replacement);
      expect(next[module]).not.toBe(before);
      evidence.source.files.find(row => row.path === `.baseline/game/src/content/${module}.ts`)!.sha256 = createHash('sha256').update(next[module]).digest('hex');
    }
    return { next, evidence };
  }

  it('reproduces 99 original ordered drop tables backing 126 separately named species', () => {
    expect(extracted.inputs).toHaveLength(99);
    expect(extracted.inputs.filter(row => row.kind === 'fairy')).toHaveLength(36);
    expect(extracted.inputs.filter(row => row.kind === 'universalJewelry')).toHaveLength(63);
    expect(extracted.sourceInputJoins.flatMap(row => row.speciesIds)).toHaveLength(126);
    expect(extracted.ownerProposals).toHaveLength(99);
    const byModule = (module: string, symbol: string) => restore(baseline.constants.find(row => row.module === module && row.name === symbol)!.value) as { id: string; stats?: EnemyDef; drops?: EnemyDef['drops'] }[];
    for (const input of extracted.inputs) {
      const origin = extracted.manifest.rows.find(row => row.inputId === input.id)!;
      const join = extracted.sourceInputJoins.find(row => row.inputId === input.id)!;
      const original = byModule(origin.module, origin.catalog).find(row => row.id === (input.kind === 'fairy' ? join.speciesIds[0] : join.enemyId))!;
      const expected = original.stats?.drops ?? original.drops!;
      const actual = deriveActorLoot(extracted.params, input, extracted.externalFabric);
      expect(actual, input.id).toStrictEqual(expected);
      expect(parseValue(arr(DropSchema), actual, input.id)).toStrictEqual(expected);
      if (input.kind === 'fairy') {
        expect(actual.map(row => row.itemId)).toEqual([input.tier === 30 ? 'mistweave' : 'faesilk', 'earth_essence', input.tier === 30 ? 'chaos_rune' : 'blood_rune', 'cosmic_rune']);
        actual.forEach(row => expect(Object.hasOwn(row, 'exclusiveGroup')).toBe(false));
      } else {
        expect(actual.map(row => row.itemId)).toEqual([`guardian_ring_t${input.tier}`, `guardian_earring_t${input.tier}`]);
        expect(actual.reduce((sum, row) => sum + row.chance, 0)).toBe(.3);
        expect(actual.every(row => row.exclusiveGroup === 'jewelry')).toBe(true);
      }
    }
    expect(extracted.manifest.sources).toHaveLength(7);
    expect(new Set(extracted.inputs.map(row => row.id)).size).toBe(99);
  });

  it('replays every original regional fabric helper probe and unknown-tier behavior', () => {
    const { regionalFabric: p, regionalCraftingTiers: tiers } = extracted.externalFabric;
    const probes = baseline.functions.find(row => row.module === 'regionalTierEquipment' && row.name === 'regionalFabricDrops')!.probes;
    expect(probes).toHaveLength(18);
    for (const probe of probes) {
      const [tier, boss] = restore(probe.args) as [number, boolean];
      expect(probe.result.kind).toBe('return');
      if (probe.result.kind === 'return') expect(regionalFabricDrops(p, tiers, tier, boss), probe.label).toStrictEqual(restore(probe.result.value));
    }
    expect(regionalFabricDrops(p, tiers, 30)).toEqual([{ itemId: 'mistweave', quantity: [1, 3], chance: .75 }]);
    for (const tier of [-1, 0, 29.9, 31, NaN, Infinity]) expect(regionalFabricDrops(p, tiers, tier)).toEqual([]);
    expect(regionalFabricDrops(p, [], 30, true)).toEqual([]);
  });

  it('extracts actual source operands without consulting final stats, drops or generated items', () => {
    const evidence = structuredClone(baseline);
    evidence.records.enemies.length = 0;
    evidence.records.lootTables.forEach(row => { row.drops = []; });
    for (const row of evidence.constants) {
      if (!ACTOR_LOOT_MODULES.includes(row.module as keyof ActorLootSources) || row.value.kind !== 'array') continue;
      row.value.values.forEach(value => { if (value.kind === 'object') value.entries = value.entries.filter(([key]) => key === 'id'); });
    }
    expect(buildActorLootSources(evidence, sources)).toStrictEqual(extracted);
    const fairy = changed([
      ['fairyCreatures', "'earth_essence'", "'air_essence'"], ['fairyGardenCreatures', "'earth_essence'", "'air_essence'"],
      ['fairyCreatures', 'chance: .55', 'chance: .4'], ['fairyGardenCreatures', 'chance: .55', 'chance: .4'],
    ]);
    expect(buildActorLootSources(fairy.evidence, fairy.next).params.fairy.earth).toEqual({ itemId: 'air_essence', roll: { quantity: [1, 3], chance: .4 } });
    const universal = changed([['universalMinibosses', 'UNIQUE_JEWELLERY_CHANCE = .30', 'UNIQUE_JEWELLERY_CHANCE = .40']]);
    expect(buildActorLootSources(universal.evidence, universal.next).params.universalJewelry.totalChance).toBe(.4);
    const fabric = changed([['regionalTierEquipment', "hide: 'mistweave'", "hide: 'alternate_fabric'"],
      ['regionalTierEquipment', 'boss ? 1 : .75', 'boss ? .9 : .65']]);
    expect(buildActorLootSources(fabric.evidence, fabric.next).externalFabric).toMatchObject({
      regionalFabric: { ordinary: { chance: .65 }, boss: { chance: .9 } }, regionalCraftingTiers: [{ hide: 'alternate_fabric' }, {}, {}] });
  });

  it('responds to every fairy roll, item mapping and external fabric dependency', () => {
    const p = structuredClone(extracted.params), dependencies = structuredClone(extracted.externalFabric);
    p.fairy.earth = { itemId: 'earth_probe', roll: { quantity: [2, 4], chance: .2 } };
    p.fairy.cosmic = { itemId: 'cosmic_probe', roll: { quantity: [3, 5], chance: .3 } };
    p.fairy.rune.roll = { quantity: [4, 6], chance: .4 };
    p.fairy.rune.items = [{ tier: 30, itemId: 'rune30' }, { tier: 60, itemId: 'rune60' }];
    dependencies.regionalFabric.ordinary = { quantity: [5, 7], chance: .5 };
    dependencies.regionalFabric.boss = { quantity: [6, 8], chance: .6 };
    dependencies.regionalCraftingTiers.forEach(row => { row.hide = `fabric${row.tier}`; });
    for (const tier of [30, 60] as const) expect(deriveActorLoot(p, { id: 'fairy/probe', kind: 'fairy', tier }, dependencies)).toEqual([
      { itemId: `fabric${tier}`, quantity: [5, 7], chance: .5 }, { itemId: 'earth_probe', quantity: [2, 4], chance: .2 },
      { itemId: `rune${tier}`, quantity: [4, 6], chance: .4 }, { itemId: 'cosmic_probe', quantity: [3, 5], chance: .3 },
    ]);
    for (const tier of [30, 40, 60]) expect(regionalFabricDrops(dependencies.regionalFabric, dependencies.regionalCraftingTiers, tier, true))
      .toEqual([{ itemId: `fabric${tier}`, quantity: [6, 8], chance: .6 }]);
  });

  it('uses guardian minimum eligibility, ordered slots and the total exclusive chance budget', () => {
    const p = structuredClone(extracted.params), deps = extracted.externalFabric;
    p.universalJewelry.totalChance = 1; p.universalJewelry.quantity = [2, 3]; p.universalJewelry.exclusiveGroup = 'probe';
    p.universalJewelry.items.forEach(row => { row.ringItemId = `ring${row.tier}`; row.earringItemId = `earring${row.tier}`; });
    for (const tier of [10, 20, 30, 40, 50, 60, 70]) {
      const actual = deriveActorLoot(p, { id: 'universal/probe', kind: 'universalJewelry', tier }, deps);
      expect(actual).toEqual([{ itemId: `ring${tier}`, quantity: [2, 3], chance: .5, exclusiveGroup: 'probe' },
        { itemId: `earring${tier}`, quantity: [2, 3], chance: .5, exclusiveGroup: 'probe' }]);
      expect(actual.reduce((sum, row) => sum + row.chance, 0)).toBe(1);
    }
    expect(deriveActorLoot(p, { id: 'u', kind: 'universalJewelry', tier: 9 }, deps)).toEqual([]);
    p.universalJewelry.minimumTier = 20;
    expect(deriveActorLoot(p, { id: 'u', kind: 'universalJewelry', tier: 10 }, deps)).toEqual([]);
    expect(deriveActorLoot(p, { id: 'u', kind: 'universalJewelry', tier: 20 }, deps)).toHaveLength(2);
    expect(() => deriveActorLoot(p, { id: 'u', kind: 'universalJewelry', tier: 21 }, deps)).toThrow(/Missing guardian jewelry tier/);
  });

  it('keeps generated arrays independent and rejects invalid schemas', () => {
    const p = structuredClone(extracted.params), deps = structuredClone(extracted.externalFabric), saved = structuredClone({ p, deps });
    for (const input of extracted.inputs) {
      const first = deriveActorLoot(p, input, deps), original = structuredClone(first);
      const second = deriveActorLoot(p, input, deps);
      second[0]!.quantity[0] = 999; second[0]!.chance = 0; second.pop();
      expect(first).toStrictEqual(original);
      expect(() => parseValue(ActorLootInputSchema, { ...input, surprise: 1 }, 'input')).toThrow(/unknown/i);
    }
    expect({ p, deps }).toStrictEqual(saved);
    expect(() => parseValue(ActorLootInputsSchema, [extracted.inputs[0], extracted.inputs[0]], 'inputs')).toThrow(/unique/);
    expect(() => parseValue(ActorLootInputSchema, { id: 'f', kind: 'fairy', tier: 40 }, 'input')).toThrow();
    for (const edit of [
      (p: typeof extracted.params) => { p.universalJewelry.totalChance = 1.1; },
      (p: typeof extracted.params) => { p.universalJewelry.items.pop(); },
      (p: typeof extracted.params) => { p.universalJewelry.items[0]!.earringItemId = p.universalJewelry.items[0]!.ringItemId; },
      (p: typeof extracted.params) => { p.universalJewelry.items.reverse(); },
      (p: typeof extracted.params) => { p.fairy.rune.items[1]!.tier = 30; },
      (p: typeof extracted.params) => { p.fairy.earth.roll.quantity = [3, 2]; },
    ]) {
      const changed = structuredClone(p); edit(changed); expect(() => parseValue(ActorLootParamsSchema, changed, 'params')).toThrow();
    }
    expect(() => parseValue(ActorLootParamsSchema, { ...p, regionalFabric: deps.regionalFabric }, 'params')).toThrow(/unknown/i);
    expect(() => parseValue(RegionalFabricTiersSchema, [deps.regionalCraftingTiers[0], deps.regionalCraftingTiers[0], deps.regionalCraftingTiers[2]], 'tiers')).toThrow();
    expect(() => parseValue(RegionalFabricParamsSchema, { ...deps.regionalFabric, surprise: 1 }, 'fabric')).toThrow(/unknown/i);
  });

  it('rejects mismatched shared factories, item slot construction and source hashes', () => {
    for (const [module, original, replacement] of [
      ['fairyCreatures', 'chance: .55', 'chance: .4'],
      ['fairyGardenCreatures', '...regionalFabricDrops(form.tier),', ''],
      ['universalMinibosses', 'UNIQUE_JEWELLERY_CHANCE / 2', 'UNIQUE_JEWELLERY_CHANCE / 3'],
      ['jewelry', "['ring', 'earring']", "['earring', 'ring']"],
      ['universalMinibossLoot', 'id: `guardian_${shape}_t${tier}`', 'id: `other_${shape}_t${tier}`'],
      ['regionalTierEquipment', 'row.tier === tier', 'row.tier <= tier'],
    ] as const) {
      const edit = changed([[module, original, replacement]]);
      expect(() => buildActorLootSources(edit.evidence, edit.next)).toThrow();
    }
    for (const module of ACTOR_LOOT_MODULES) expect(() => buildActorLootSources(baseline, { ...sources, [module]: sources[module] + '\n' })).toThrow(/source hash/);
  });
});
