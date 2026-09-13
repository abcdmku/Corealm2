import { beforeAll, describe, expect, it } from 'vitest';
import { isDeepStrictEqual } from 'node:util';
import rawCreatures from '../game/content/data/creatures.json';
import { CREATURE_DATA, CREATURE_RECORDS, creatureById, creatureRows, rpgCreatureRows } from '../game/src/content/creatureData.js';
import { enemyBlockById, enemyWithLoot } from '../game/src/content/enemyData.js';
import { lootDrops } from '../game/src/content/lootData.js';
import { buildCreatureRecords } from '../tools/content/export-creatures.js';
import { buildM4Baseline, SPECIES_SOURCES, type M4Baseline, type Snapshot } from '../tools/content/m4-baseline.js';

function restore(value: Snapshot): unknown {
  switch (value.kind) {
    case 'undefined': return undefined;
    case 'null': return null;
    case 'array': return value.values.map(restore);
    case 'set': return new Set(value.values.map(restore));
    case 'map': return new Map(value.entries.map(([key, entry]) => [restore(key), restore(entry)]));
    case 'object': return Object.fromEntries(value.entries.map(([key, entry]) => [key, restore(entry)]));
    default: return value.value;
  }
}

let baseline: M4Baseline;
const modules: Record<string, Record<string, unknown>> = {};
beforeAll(async () => {
  baseline = await buildM4Baseline();
  for (const name of new Set(['creatureSpecies', ...SPECIES_SOURCES.map(([name]) => name)])) {
    modules[name] = await import(`../game/src/content/${name}.ts`);
  }
});

describe('JSON creature source views', () => {
  it('exports 246 complete records only after exact baseline source parity', () => {
    expect(buildCreatureRecords(baseline)).toEqual(rawCreatures);
    expect(CREATURE_RECORDS).toHaveLength(246);
    expect(CREATURE_RECORDS.filter(row => row.presentationKind === 'basic')).toHaveLength(219);
    expect(CREATURE_RECORDS.filter(row => row.presentationKind === 'rpg')).toHaveLength(27);
    expect(CREATURE_RECORDS.filter(row => row.stage === 'labOnly')).toHaveLength(11);
    expect(new Set(CREATURE_DATA.map(row => row.id)).size).toBe(246);
  });

  it('preserves every affected public constant including array, map and set insertion order', () => {
    for (const entry of baseline.constants.filter(entry => modules[entry.module])) {
      const actual = modules[entry.module]![entry.name];
      const expected = restore(entry.value);
      const label = `${entry.module}.${entry.name}`;
      expect(isDeepStrictEqual(actual, expected), label).toBe(true);
      if (actual instanceof Map && expected instanceof Map) expect([...actual], label).toEqual([...expected]);
      if (actual instanceof Set && expected instanceof Set) expect([...actual], label).toEqual([...expected]);
    }
  });

  it('preserves every recorded affected helper return and error', () => {
    for (const evidence of baseline.functions.filter(entry => modules[entry.module])) {
      const helper = modules[evidence.module]![evidence.name];
      expect(typeof helper, `${evidence.module}.${evidence.name}`).toBe('function');
      for (const probe of evidence.probes) {
        const args = restore(probe.args);
        if (!Array.isArray(args)) throw new Error('Invalid baseline probe arguments');
        const call = () => (helper as (...args: unknown[]) => unknown)(...args);
        if (probe.result.kind === 'throw') {
          let error: unknown;
          try { call(); } catch (caught) { error = caught; }
          expect(error, probe.label).toBeInstanceOf(Error);
          expect((error as Error).name, probe.label).toBe(probe.result.name);
          expect((error as Error).message, probe.label).toBe(probe.result.message);
        } else {
          expect(isDeepStrictEqual(call(), restore(probe.result.value)), `${evidence.name}: ${probe.label}`).toBe(true);
        }
      }
    }
  });

  it('shares cached species and stats across source arrays, maps and aliases', () => {
    for (const [module, catalog] of SPECIES_SOURCES) {
      const rows = modules[module]![catalog] as readonly { id: string }[];
      expect(rows).toEqual(creatureRows(catalog));
      for (const row of rows) expect(row, `${catalog}.${row.id}`).toBe(creatureById(row.id));
    }
    for (const references of baseline.sharedExportReferences) {
      const relevant = references.filter(reference => modules[reference.slice(0, reference.indexOf('.'))]);
      const values = relevant.map(reference => {
        const dot = reference.indexOf('.');
        return modules[reference.slice(0, dot)]![reference.slice(dot + 1)];
      });
      for (const value of values) expect(value, relevant.join(', ')).toBe(values[0]);
    }
    for (const row of CREATURE_RECORDS) {
      const species = creatureById(row.id);
      expect(species.stats).toBe(enemyWithLoot(row.blockId, row.lootTableId));
      expect(species.stats.drops).toBe(lootDrops(row.lootTableId));
    }
    for (const row of rpgCreatureRows('RPG_BESTIARY')) {
      expect((modules.rpgBestiary!.RPG_BESTIARY_BY_ID as ReadonlyMap<string, unknown>).get(row.id)).toBe(row);
    }
  });

  it('retains the 18 distinct Wilderness source loot tables and complete regional RPG fields', () => {
    const alternatives = CREATURE_RECORDS.filter(row => row.lootTableId.startsWith('loot_species_'));
    expect(alternatives).toHaveLength(18);
    for (const row of alternatives) {
      const species = creatureById(row.id);
      expect(species.stats).not.toBe(enemyBlockById(row.blockId));
      expect(species.stats.drops).not.toEqual(enemyBlockById(row.blockId).drops);
      if (row.catalog === 'WILDERNESS_CREATURE_SPECIES') expect(species.stats.drops).toEqual([]);
    }
    for (const id of ['moonweave_spider', 'amethyst_spider']) {
      const species = creatureById(id);
      expect(species).toHaveProperty('nativeBase');
      expect(species).toHaveProperty('attack.proposedMechanic');
      expect(species).toHaveProperty('source.license');
      expect(species).toHaveProperty('acceptance', 'candidate');
    }
    for (const species of CREATURE_DATA) {
      for (const key of ['catalog', 'stage', 'presentationKind', 'blockId', 'lootTableId']) expect(species).not.toHaveProperty(key);
      expect(Object.values(species)).not.toContain(undefined);
      expect(Object.values(species.stats)).not.toContain(undefined);
    }
  });

  it('filters in source order and throws on unknown creature identities', () => {
    expect(creatureRows(['RPG_BESTIARY_STAGED', 'CREATURE_EXPANSION']))
      .toEqual(creatureRows(['CREATURE_EXPANSION', 'RPG_BESTIARY_STAGED']));
    expect(() => creatureById('__missing')).toThrow('Unknown creature __missing');
  });

  it('rejects malformed, unresolved and changed source records before export', () => {
    const changed = structuredClone(baseline);
    changed.records.creatures[0] = { ...changed.records.creatures[0]!, description: changed.records.creatures[0]!.description + ' changed' };
    expect(() => buildCreatureRecords(changed)).toThrow('Creature source parity failed');
    const missing = structuredClone(baseline);
    missing.records.creatures[0]!.blockId = '__missing';
    expect(() => buildCreatureRecords(missing)).toThrow('unknown block');
    const duplicate = structuredClone(baseline);
    duplicate.records.creatures.push(duplicate.records.creatures[0]!);
    expect(() => buildCreatureRecords(duplicate)).toThrow();
    const extended = structuredClone(baseline);
    const rpg = extended.records.creatures.find(row => row.presentationKind === 'rpg')!;
    Reflect.deleteProperty(rpg, 'nativeBase');
    expect(() => buildCreatureRecords(extended)).toThrow();
  });
});
