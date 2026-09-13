import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildCoreEnemySources, type CoreEnemySources } from '../tools/content/enemy-source-inputs.js';
import { buildM4Baseline, type M4Baseline, type Snapshot } from '../tools/content/m4-baseline.js';
import { deriveCoreEnemy } from '../game/src/content/balance/enemySources.js';
import { repoRoot } from '../tools/lib/paths.js';

const moduleNames = ['creatureExpansion', 'starterCreatures', 'rpgBestiary'] as const;
function baselineFor(baseline: M4Baseline, sources: CoreEnemySources): M4Baseline {
  const result = structuredClone(baseline);
  for (const module of moduleNames) result.source.files.find(row => row.path === `.baseline/game/src/content/${module}.ts`)!.sha256
    = createHash('sha256').update(sources[module]).digest('hex');
  return result;
}
function plain(snapshot: Snapshot): unknown {
  switch (snapshot.kind) {
    case 'number': case 'string': case 'boolean': return snapshot.value;
    case 'null': return null;
    case 'undefined': return undefined;
    case 'array': return snapshot.values.map(plain);
    case 'object': return Object.fromEntries(snapshot.entries.map(([key, value]) => [key, plain(value)]));
    default: throw new Error(`Unexpected source snapshot ${snapshot.kind}`);
  }
}

describe('core enemy extraction source requirements', () => {
  it('rejects missing baseline source provenance before parsing any source', () => {
    const baseline = { source: { root: '.baseline', files: [] } } as unknown as M4Baseline;
    expect(() => buildCoreEnemySources(baseline, { creatureExpansion: '', starterCreatures: '', rpgBestiary: '' })).toThrow('source hash');
  });
});

describe.skipIf(!moduleNames.every(module => existsSync(path.join(repoRoot, `.baseline/game/src/content/${module}.ts`))))('original core enemy source extraction', () => {
  let baseline: M4Baseline, sources: CoreEnemySources;
  beforeAll(async () => {
    baseline = await buildM4Baseline();
    sources = Object.fromEntries(moduleNames.map(module => [module, readFileSync(path.join(repoRoot, `.baseline/game/src/content/${module}.ts`), 'utf8')])) as unknown as CoreEnemySources;
  });

  it('extracts 24 expansion, seven starter, and 25 active or staged RPG inputs with original identity and order', () => {
    const { inputs, manifest } = buildCoreEnemySources(baseline, sources);
    expect(inputs.filter(row => row.kind === 'expansion')).toHaveLength(24);
    expect(inputs.filter(row => row.kind === 'starter')).toHaveLength(7);
    expect(inputs.filter(row => row.kind === 'rpg')).toHaveLength(25);
    expect(new Set(inputs.map(row => row.id)).size).toBe(56);
    expect(inputs.filter(row => row.kind === 'rpg').slice(-8).map(row => row.speciesId)).toEqual([
      'shale_elemental', 'lava_golem', 'mossback_sentinel', 'beetle_golem', 'giant_rat', 'wild_goblin', 'troll_mauler', 'cave_roach',
    ]);
    expect(inputs.some(row => row.id === 'rpg/orc_warrior')).toBe(false);
    expect(manifest.rows).toHaveLength(56);
    expect(manifest.rows.filter(row => row.catalog === 'RPG_BESTIARY')).toHaveLength(21);
    expect(manifest.rows.filter(row => row.symbol === 'acceptedCompleteSources').map(row => row.rowIndex)).toEqual([0, 1, 2, 3]);
    expect(manifest.rows.filter(row => row.symbol === 'RPG_BESTIARY_STAGED').map(row => row.rowIndex)).toEqual([0, 1, 2, 3]);
    expect(manifest.rows.find(row => row.inputId === 'rpg/skeleton_soldier')).toMatchObject({ symbol: 'rows', rowIndex: 8 });
    for (const file of manifest.sources) expect({ path: file.path, sha256: file.sha256 }).toEqual(baseline.source.files.find(row => row.path === file.path));
  });

  it('independently reproduces every original source stat field except drops through the pure factory', () => {
    const { inputs, params, manifest } = buildCoreEnemySources(baseline, sources);
    for (const input of inputs) {
      const origin = manifest.rows.find(row => row.inputId === input.id)!;
      const exportSnapshot = baseline.constants.find(row => row.module === origin.module && row.name === origin.catalog)!;
      const sourceRows = plain(exportSnapshot.value) as { id: string; stats: Record<string, unknown> }[];
      const speciesId = input.kind === 'expansion' ? input.identity.family : input.speciesId;
      const { drops: _drops, ...expected } = sourceRows.find(row => row.id === speciesId)!.stats;
      expect(deriveCoreEnemy(params, input), input.id).toEqual(expected);
    }
  });

  it('materializes original starter defaults and the complete role ternaries', () => {
    const { inputs, params } = buildCoreEnemySources(baseline, sources);
    expect(params.expansion).toEqual({ marksPerTier: [2, 6] });
    expect(inputs.find(row => row.id === 'starter/grass_viper')).toEqual({
      id: 'starter/grass_viper', kind: 'starter', speciesId: 'grass_viper', name: 'Grass Viper', health: 8,
      behaviour: 'territorial', armour: 0, moveSpeedMps: 1.6,
    });
    expect(inputs.find(row => row.id === 'starter/creek_crab')).toMatchObject({ armour: 25, moveSpeedMps: .6 });
    expect(inputs.find(row => row.id === 'starter/briar_spider')).toMatchObject({ armour: 0, moveSpeedMps: .95 });
    expect(params.rpg.roles).toEqual({
      skirmisher: { healthMultiplier: 1, attackLevelOffset: 2, defenceLevelOffset: 0, accuracy: 12, armour: 10, maxHitOffset: 1, attackSpeedMs: 2000, aggroRadius: 10, moveSpeedMps: 1.6 },
      fighter: { healthMultiplier: 1, attackLevelOffset: 2, defenceLevelOffset: 0, accuracy: 6, armour: 10, maxHitOffset: 1, attackSpeedMs: 2400, aggroRadius: 7, moveSpeedMps: 1.6 },
      brute: { healthMultiplier: 1.4, attackLevelOffset: 6, defenceLevelOffset: 0, accuracy: 6, armour: 16, maxHitOffset: 4, attackSpeedMs: 3400, aggroRadius: 7, moveSpeedMps: 1.2 },
      caster: { healthMultiplier: .8, attackLevelOffset: 2, defenceLevelOffset: 0, accuracy: 16, armour: 3, maxHitOffset: 1, attackSpeedMs: 2800, aggroRadius: 7, moveSpeedMps: 1.6 },
      guard: { healthMultiplier: 1.2, attackLevelOffset: 2, defenceLevelOffset: 4, accuracy: 6, armour: 45, maxHitOffset: 1, attackSpeedMs: 3000, aggroRadius: 7, moveSpeedMps: 1.3 },
    });
    expect(params.rpg.rangedActions).toEqual(['bow shot']); expect(params.rpg.magicActions).toEqual(['staff curse', 'lament']);
    expect(params.rpg.marksMinimum).toEqual([1, 3]); expect(params.rpg.marksPerTier).toEqual([1, 3]);
  });

  it('uses changed source literals and defaults without deriving inputs from unchanged source outputs', () => {
    const changed = { ...sources,
      starterCreatures: sources.starterCreatures.replace('armour = 0, moveSpeedMps = 1.6', 'armour = 2, moveSpeedMps = 1.7'),
      rpgBestiary: sources.rpgBestiary.replace('(8 + tier * 2.2)', '(9 + tier * 2.3)'),
    };
    const result = buildCoreEnemySources(baselineFor(baseline, changed), changed);
    expect(result.params.rpg.healthBase).toBe(9); expect(result.params.rpg.healthPerTier).toBe(2.3);
    expect(result.inputs.find(row => row.id === 'starter/grass_viper')).toMatchObject({ armour: 2, moveSpeedMps: 1.7 });
    expect(result.inputs.find(row => row.id === 'starter/briar_spider')).toMatchObject({ armour: 0, moveSpeedMps: .95 });
  });

  it('never reads captured final stats or canonical records, and does not mutate caller evidence', () => {
    const altered = structuredClone(baseline), before = structuredClone(baseline);
    altered.records.enemies.length = 0;
    for (const row of altered.constants.filter(row => moduleNames.includes(row.module as typeof moduleNames[number]))) {
      if (row.value.kind !== 'array') continue;
      for (const entry of row.value.values) if (entry.kind === 'object') entry.entries = entry.entries.filter(([key]) => key === 'id');
    }
    expect(buildCoreEnemySources(altered, sources)).toEqual(buildCoreEnemySources(baseline, sources));
    expect(baseline).toEqual(before);
  });

  it.each(moduleNames)('rejects mismatched %s source hash', module => {
    const changed = { ...sources, [module]: sources[module] + '\n' };
    expect(() => buildCoreEnemySources(baseline, changed)).toThrow(`${module} source hash`);
  });

  it.each([
    ['creatureExpansion', 'name: "Red Fox", tier: 1', 'name: "Red Fox", tier: 1 + 0', 'numeric literal'],
    ['creatureExpansion', 'species("redbrush_fox"', 'species("duskoak_lynx"', 'identity/count/order mismatch'],
    ['creatureExpansion', 'marks: [2 * stats.tier, 6 * stats.tier]', 'marks: [2 + stats.tier, 6 * stats.tier]', 'Unsupported expansion marks'],
    ['starterCreatures', 'armour = 0, moveSpeedMps = 1.6', 'armour = 0, moveSpeedMps = defaultSpeed', 'numeric literal'],
    ['starterCreatures', 'name: string, assetId: string', 'assetId: string, name: string', 'Unsupported starter argument'],
    ['starterCreatures', 'Math.min(0.4, moveSpeedMps / 3)', 'Math.max(0.4, moveSpeedMps / 3)', 'Unsupported starter walk speed'],
    ['rpgBestiary', 'tier * 2.2', 'tier + 2.2', 'Unsupported RPG health'],
    ['rpgBestiary', 'caster ? 55 : bodyFamily', 'guard ? 55 : bodyFamily', 'Unsupported RPG magic armour'],
    ['rpgBestiary', "'goblin', 'skeleton', 'zombie'", "'orc', 'skeleton', 'zombie'", 'identity/count/order mismatch'],
    ['rpgBestiary', 'retainedFamilies.has(row[2])', 'retainedFamilies.has(row[1])', 'Unsupported RPG active assembly'],
    ['rpgBestiary', "entry(['giant_rat'", "entry(['wild_goblin'", 'identity/count/order mismatch'],
  ] as const)('rejects unsupported or malformed %s source: %s', (module, original, replacement, error) => {
    const changed = { ...sources, [module]: sources[module].replace(original, replacement) };
    expect(changed[module]).not.toBe(sources[module]);
    expect(() => buildCoreEnemySources(baselineFor(baseline, changed), changed)).toThrow(error);
  });
});
