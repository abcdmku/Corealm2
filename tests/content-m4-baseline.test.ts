import { beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildM4Baseline, M4_MODULES, snapshot, writeM4BaselineReport, type M4Baseline } from '../tools/content/m4-baseline.js';
import { repoRoot } from '../tools/lib/paths.js';

describe.skipIf(!existsSync(path.join(repoRoot, '.baseline/game/src/content/enemies.ts')))('original M4 baseline inventory', () => {
  let baseline: M4Baseline;
  beforeAll(async () => { baseline = await buildM4Baseline(); });

  it('captures every named constant exactly as directly imported from the original source', async () => {
    for (const name of M4_MODULES) {
      const module = await import(pathToFileURL(path.join(repoRoot, '.baseline/game/src/content', `${name}.ts`)).href) as Record<string, unknown>;
      const constants = Object.entries(module).filter(([, value]) => typeof value !== 'function');
      expect(baseline.constants.filter(row => row.module === name).map(row => row.name).sort()).toEqual(constants.map(([key]) => key).sort());
      for (const [key, value] of constants) expect(baseline.constants.find(row => row.module === name && row.name === key)!.value, `${name}.${key}`).toEqual(snapshot(value));
    }
  });

  it('preserves source-only loot, extended RPG variants, all order indices and function evidence', () => {
    expect(baseline.records.lootTables.filter(row => row.catalog === 'CREATURE_SOURCE_LOOT')).toHaveLength(18);
    expect(baseline.records.lootTables.filter(row => row.catalog === 'ENEMY_ALIAS_LOOT')).toHaveLength(6);
    expect(baseline.records.creatures.filter(row => row.catalog === 'REGIONAL_CREATURE_VARIANTS' && row.presentationKind === 'rpg').map(row => row.id)).toEqual(['moonweave_spider', 'amethyst_spider']);
    expect([...baseline.records.enemies.filter(row => row.stage === 'registered'), ...baseline.records.aliases]
      .map(row => row.registrationOrder).sort((a, b) => a! - b!)).toEqual(Array.from({ length: 472 }, (_, index) => index));
    expect(baseline.records.enemies.filter(row => row.fantasyTierOrder !== undefined)).toHaveLength(60);
    expect(baseline.functions.every(row => row.probes.length > 0)).toBe(true);
    expect(baseline.functions.find(row => row.name === 'buildWildernessEnemyProgression')!.probes[0]!.result.kind).toBe('return');
    expect(baseline.source.files.every(row => row.path.startsWith('.baseline/') && /^[0-9a-f]{64}$/.test(row.sha256))).toBe(true);
    expect(baseline.sharedExportReferences).toContainEqual(['wildernessDragons.WILDERNESS_DRAGON_CANDIDATES', 'wildernessDragons.WILDERNESS_DRAGONS'].sort());
  });

  it('keeps value kinds, map order, and absence distinguishable without function placeholders', () => {
    expect(snapshot(new Map([['b', undefined], ['a', 1]]))).toEqual({ kind: 'map', entries: [
      [{ kind: 'string', value: 'b' }, { kind: 'undefined' }],
      [{ kind: 'string', value: 'a' }, { kind: 'number', value: 1 }],
    ] });
    expect(snapshot({ key: undefined })).not.toEqual(snapshot({}));
    expect(() => snapshot(() => 1)).toThrow('Unsupported snapshot value');
  });

  it('rejects production and escaping output paths before writing', async () => {
    await expect(writeM4BaselineReport(baseline, 'game/content/data/enemies.json')).rejects.toThrow('--out');
    await expect(writeM4BaselineReport(baseline, 'test-results/../../outside.json')).rejects.toThrow('--out');
  });
});
