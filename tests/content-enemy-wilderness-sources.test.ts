import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { transform } from 'esbuild';
import { buildM4Baseline, type M4Baseline, type Snapshot } from '../tools/content/m4-baseline.js';
import { buildCoreEnemySources, type CoreEnemySources } from '../tools/content/enemy-source-inputs.js';
import { buildWildernessEnemySources, WILDERNESS_SOURCE_MODULES, type WildernessEnemySources } from '../tools/content/enemy-wilderness-source-inputs.js';
import { deriveCoreEnemy, type EnemyFieldsWithoutDrops } from '../game/src/content/balance/enemySources.js';
import { deriveWildernessSourceEnemy, type WildernessSourceDependencies } from '../game/src/content/balance/enemyWildernessSources.js';
import { combatLevel } from '../game/src/content/balance/enemies.js';
import { WildernessBaseSourceInputSchema, WildernessBaseSourceInputsSchema, WildernessKeeperRowsSchema,
  WildernessSourceParamsSchema } from '../game/src/content/schema/enemyWildernessSources.js';
import { parseValue } from '../game/src/content/schema/core.js';
import type { EnemyDef } from '../game/src/content/index.js';

const sourceUrl = (module: string) => new URL(`../.baseline/game/src/content/${module}.ts`, import.meta.url);
const read = (module: string) => readFileSync(sourceUrl(module), 'utf8');
const baselineAvailable = [...WILDERNESS_SOURCE_MODULES, 'enemies', 'creatureExpansion', 'starterCreatures', 'rpgBestiary']
  .every(module => existsSync(sourceUrl(module)));
function restore(snapshot: Snapshot): unknown {
  switch (snapshot.kind) {
    case 'number': case 'string': case 'boolean': return snapshot.value;
    case 'null': return null;
    case 'undefined': return undefined;
    case 'array': return snapshot.values.map(restore);
    case 'object': return Object.fromEntries(snapshot.entries.map(([key, value]) => [key, restore(value)]));
    default: throw new Error(`Unexpected source snapshot ${snapshot.kind}`);
  }
}
// Literal shared operands are pinned independently by Stage 1 tests. No shipped JSON is read.
const shared = {
  combatLevel: { rollLevelOffset: 9, bonusDivisor: 100, defenceStyleCount: 2, healthPerLevel: 3,
    offenceWeight: .5, defenceWeight: .25, healthWeight: .25, minimum: 1 },
  tuning: { minimumHealth: 3, minimumLevel: 1, minimumBonus: 0, maximumBonus: 80, maximumBonusScale: 1,
    maxHitExponent: .68, searchInitialLow: 0, searchInitialHigh: 1, searchGrowth: 2, searchIterations: 48, healthPerCombatLevel: 12 },
  regionalBossLevels: { galeskin: { tier: 1, multiplier: 11 }, tempest_roc: { tier: 1, multiplier: 13 },
    mossbound: { tier: 5, multiplier: 3 }, rootheart: { tier: 5, multiplier: 5 }, tideworn: { tier: 10, multiplier: 4 },
    ordrun: { tier: 10, multiplier: 5 }, cinderwake: { tier: 20, multiplier: 4 } },
};
let baseline: M4Baseline, sources: WildernessEnemySources, core: ReturnType<typeof buildCoreEnemySources>;
let extracted: ReturnType<typeof buildWildernessEnemySources>, dependencies: WildernessSourceDependencies;
const sourceResults = new Map<string, EnemyFieldsWithoutDrops>();
interface BodyProbe { id: string; name: string; tier: number; level: number; role: string }
let original: { bodyStats: (body: BodyProbe) => EnemyDef; tuneEnemyCombatLevel: (source: EnemyDef, level: number, tier?: number) => EnemyDef };
function originalFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing original ${name}`);
  const match = /\r?\n\}(?:\r?\n|$)/g; match.lastIndex = start;
  const end = match.exec(source); if (!end) throw new Error(`Missing original ${name} end`);
  return source.slice(start, end.index + end[0].length);
}
function originalRows(module: string, catalog: string): { id: string; stats: EnemyDef }[] {
  return restore(baseline.constants.find(row => row.module === module && row.name === catalog)!.value) as { id: string; stats: EnemyDef }[];
}
function baselineFor(changed: WildernessEnemySources): M4Baseline {
  const copy = structuredClone(baseline);
  for (const module of WILDERNESS_SOURCE_MODULES) copy.source.files.find(row => row.path === `.baseline/game/src/content/${module}.ts`)!.sha256
    = createHash('sha256').update(changed[module]).digest('hex');
  return copy;
}
beforeAll(async () => {
  if (!baselineAvailable) return;
  baseline = await buildM4Baseline();
  sources = Object.fromEntries(WILDERNESS_SOURCE_MODULES.map(module => [module, read(module)])) as WildernessEnemySources;
  const coreSources: CoreEnemySources = { creatureExpansion: read('creatureExpansion'), starterCreatures: read('starterCreatures'), rpgBestiary: read('rpgBestiary') };
  core = buildCoreEnemySources(baseline, coreSources);
  for (const input of core.inputs) sourceResults.set(input.id, deriveCoreEnemy(core.params, input));
  extracted = buildWildernessEnemySources(baseline, sources, core.inputs);
  dependencies = { ...shared, keepers: extracted.keepers, resolveSource: id => sourceResults.get(id) };
  const index = read('index'), healthConstant = index.match(/^export const PLAYER_HEALTH_PER_LEVEL = .*;$/m)?.[0];
  if (!healthConstant) throw new Error('Missing original health constant');
  const oracleCode = healthConstant.replace('export ', '') + '\n' + originalFunction(index, 'enemyCombatLevel')
    + '\n' + originalFunction(read('encounterBalance'), 'tuneEnemyCombatLevel')
    + '\n' + originalFunction(sources.wildernessCreatureSpecies, 'bodyStats')
    + '\nreturn {bodyStats,tuneEnemyCombatLevel};';
  original = new Function((await transform(oracleCode, { loader: 'ts' })).code)() as typeof original;
});

describe('closed Wilderness source inputs', () => {
  it('admits keeper references without copied identity and rejects mixed branches', () => {
    const input = { id: 'wildernessBody/hollow_star', kind: 'wildernessBody', role: 'keeper', keeperId: 'hollow_star' };
    expect(parseValue(WildernessBaseSourceInputSchema, input, 'input')).toEqual(input);
    for (const field of ['speciesId', 'name', 'tier', 'targetLevel']) expect(() => parseValue(WildernessBaseSourceInputSchema,
      { ...input, [field]: field === 'tier' ? 70 : 'copied' }, 'input')).toThrow();
    expect(() => parseValue(WildernessBaseSourceInputSchema, { ...input, keeperId: 'invented' }, 'input')).toThrow();
    expect(() => parseValue(WildernessBaseSourceInputSchema, { ...input, role: 'heavy' }, 'input')).toThrow();
    expect(() => parseValue(WildernessBaseSourceInputsSchema, [input, input], 'inputs')).toThrow(/unique/);
    expect(() => parseValue(WildernessBaseSourceInputSchema, { id: 'boss/probe', kind: 'regionalBossBody',
      speciesId: 'boss_cinderwake', name: 'Wrong owner', bossId: 'ordrun', sourceInputId: 'rpg/iron_golem' }, 'input')).toThrow(/boss id/);
  });
});

describe.skipIf(!baselineAvailable)('original Wilderness and regional boss source factories', () => {
  it('extracts 25 inputs and five shared keepers with exact original ordering and source hashes', () => {
    expect(extracted.inputs).toHaveLength(25);
    expect(extracted.inputs.filter(row => row.kind === 'wildernessBody')).toHaveLength(11);
    expect(extracted.inputs.filter(row => row.kind === 'wildernessDragon')).toHaveLength(7);
    expect(extracted.inputs.filter(row => row.kind === 'regionalBossBody').map(row => row.speciesId)).toEqual([
      'boss_tempest_roc', 'boss_galeskin', 'boss_rootheart', 'boss_mossbound', 'boss_tideworn', 'boss_ordrun', 'boss_cinderwake',
    ]);
    expect(extracted.keepers).toEqual([
      { id: 'ashseal_warden', name: 'Ashseal Warden', tier: 50, multiplier: 3 },
      { id: 'furnace_regent', name: 'Furnace Regent', tier: 50, multiplier: 4 },
      { id: 'chainbound_archon', name: 'Chainbound Archon', tier: 70, multiplier: 3 },
      { id: 'nightforge_marshal', name: 'Nightforge Marshal', tier: 70, multiplier: 4 },
      { id: 'hollow_star', name: 'The Hollow Star', tier: 70, multiplier: 5 },
    ]);
    expect(extracted.manifest.rows).toHaveLength(25);
    for (const file of extracted.manifest.sources) expect({ path: file.path, sha256: file.sha256 })
      .toEqual(baseline.source.files.find(row => row.path === file.path));
    const keeperOrigin = extracted.manifest.rows.find(row => row.inputId === 'wildernessBody/hollow_star')!;
    expect(keeperOrigin).toMatchObject({ module: 'wildernessDepth', symbol: 'WILDERNESS_RUNE_KEEPERS', rowIndex: 4, catalogModule: 'wildernessCreatureSpecies' });
  });

  it('matches all 25 complete original source combat outputs before progression overwrites', () => {
    for (const input of extracted.inputs) {
      const origin = extracted.manifest.rows.find(row => row.inputId === input.id)!;
      const { drops, ...expected } = originalRows(origin.catalogModule, origin.catalog).find(row => row.id === origin.speciesId)!.stats;
      expect(deriveWildernessSourceEnemy(extracted.params, input, dependencies), input.id).toStrictEqual(expected);
    }
    const dragons = extracted.inputs.filter(input => input.kind === 'wildernessDragon');
    expect(dragons.slice(-2).map(input => input.targetLevel)).toEqual([78, 78]);
    expect(dragons.slice(-2).map(input => combatLevel(shared.combatLevel, deriveWildernessSourceEnemy(extracted.params, input, dependencies)))).toEqual([78, 78]);
  });

  it('extracts all original arithmetic operands and profile selectors', () => {
    expect(extracted.params.wildernessBody).toEqual({
      heavyRoles: ['heavy', 'keeper'], magicRoles: ['ghost'], magicSpeciesIds: ['chainbound_archon', 'hollow_star'], deepTier: 70,
      attackLevelMultiplier: { magic: .83, heavy: .74, other: .87 }, defenceLevelMultiplier: { heavy: .77, other: .62 },
      healthPerLevel: { heavy: 5, other: 3 }, accuracy: { magic: 20, predator: 15, other: 8 },
      armour: { magic: 10, heavy: 35, other: 20 }, magicArmour: { magic: 40, deep: 25, other: 10 },
      maxHitPerTier: { keeper: .76, heavy: .49, other: .4 }, attackRangeM: { magic: 8, heavy: 2.6, other: 1.9 },
      attackSpeedMs: { keeper: 3800, heavy: 3400, magic: 2900, other: 2500 }, aggroRadius: { keeper: 15, magic: 10, other: 8 },
      moveSpeedMps: { magic: 1.6, heavy: 1.1, other: 1.5 }, walkSpeedMps: { heavy: .32, other: .42 },
      marks: { minimumPerTier: 1, maximumPerTier: { keeper: 12, other: 3 } },
    });
    expect(extracted.params.wildernessDragon).toEqual({ shallowTier: 50, healthPerTier: 3, attackLevelOffset: -3, defenceLevelOffset: -5,
      accuracy: 12, armour: 24, magicArmour: 32, maxHitPerTier: .32, marksPerTier: [2, 6],
      shallow: { attackSpeedMs: 2800, attackRangeM: 2.3, aggroRadius: 8, moveSpeedMps: 1.4, walkSpeedMps: .65 },
      deep: { attackSpeedMs: 3600, attackRangeM: 3.5, aggroRadius: 11, moveSpeedMps: 1.8, walkSpeedMps: .8 },
    });
  });

  it('preserves magic/heavy/keeper branch priorities and configurable selectors', () => {
    const keeper = extracted.inputs.find(input => input.id === 'wildernessBody/chainbound_archon')!;
    expect(deriveWildernessSourceEnemy(extracted.params, keeper, dependencies)).toMatchObject({ attackStyle: 'magic', attackRangeM: 8,
      attackSpeedMs: 3800, aggroRadius: 15, moveSpeedMps: 1.6, walkSpeedMps: .32, behaviour: 'territorial', marks: [70, 840] });
    const ghost = extracted.inputs.find(input => input.id === 'wildernessBody/gloam_wraith')!;
    const p = structuredClone(extracted.params); p.wildernessBody.heavyRoles.push('ghost');
    expect(deriveWildernessSourceEnemy(p, ghost, dependencies)).toMatchObject({ attackStyle: 'magic', attackRangeM: 8,
      attackSpeedMs: 3400, aggroRadius: 10, moveSpeedMps: 1.6, walkSpeedMps: .32, behaviour: 'territorial' });
    p.wildernessBody.heavyRoles = [];
    expect(deriveWildernessSourceEnemy(p, keeper, dependencies)).toMatchObject({ attackSpeedMs: 3800, aggroRadius: 15, walkSpeedMps: .42, behaviour: 'aggressive' });
    p.wildernessDragon.shallowTier = 70;
    const dragon = extracted.inputs.find(input => input.id === 'wildernessDragon/red_wilderness_dragon')!;
    expect(deriveWildernessSourceEnemy(p, dragon, dependencies)).toMatchObject({ attackSpeedMs: 2800, attackRangeM: 2.3 });
  });

  it('uses shared keeper identity and unrounded target products with original seed arithmetic', () => {
    const input = extracted.inputs.find(input => input.id === 'wildernessBody/ashseal_warden')!;
    const keepers = structuredClone(extracted.keepers), keeper = keepers.find(row => row.id === 'ashseal_warden')!;
    keeper.name = 'Revised Ashseal'; keeper.tier = 70; keeper.multiplier = 3.01;
    const output = deriveWildernessSourceEnemy(extracted.params, input, { ...dependencies, keepers });
    const { drops, ...expected } = original.bodyStats({ id: keeper.id, name: keeper.name, tier: keeper.tier,
      level: keeper.tier * keeper.multiplier, role: 'keeper' });
    expect(output).toStrictEqual(expected);
    expect(output).toMatchObject({ id: 'ashseal_warden_t70', name: 'Revised Ashseal', tier: 70, marks: [70, 840] });
    expect(combatLevel(shared.combatLevel, output)).toBe(Math.round(keeper.tier * keeper.multiplier));
    expect(extracted.keepers[0]).toMatchObject({ name: 'Ashseal Warden', tier: 50, multiplier: 3 });
  });

  it('matches independent original body helper probes beyond the authored target levels', () => {
    const inputs = extracted.inputs.filter(input => input.kind === 'wildernessBody' && input.role !== 'keeper');
    for (const input of inputs) {
      for (const targetLevel of [25, 50, 75, 101]) {
        const { drops, ...expected } = original.bodyStats({ id: input.speciesId, name: input.name,
          tier: input.tier, level: targetLevel, role: input.role });
        expect(deriveWildernessSourceEnemy(extracted.params, { ...input, targetLevel }, dependencies), `${input.id}/${targetLevel}`).toStrictEqual(expected);
      }
    }
  });

  it('keeps fractional keeper targets until the original tuning boundary', () => {
    const input = extracted.inputs.find(input => input.id === 'wildernessBody/ashseal_warden')!;
    let distinguishesEarlyRounding = false;
    for (const multiplier of [3.005, 3.01, 3.015, 3.025]) {
      const keepers = structuredClone(extracted.keepers), keeper = keepers[0]!;
      keeper.multiplier = multiplier;
      const body = { id: keeper.id, name: keeper.name, tier: keeper.tier, level: keeper.tier * multiplier, role: 'keeper' };
      const raw = original.bodyStats(body), prematurelyRounded = original.bodyStats({ ...body, level: Math.round(body.level) });
      distinguishesEarlyRounding ||= !isDeepStrictEqual(raw, prematurelyRounded);
      const { drops, ...expected } = raw;
      expect(deriveWildernessSourceEnemy(extracted.params, input, { ...dependencies, keepers }), `multiplier ${multiplier}`).toStrictEqual(expected);
    }
    expect(distinguishesEarlyRounding).toBe(true);
  });

  it('tunes regional RPG sources before replacing identity and preserves their optional fields and marks', () => {
    const input = extracted.inputs.find(input => input.id === 'regionalBossBody/boss_ordrun')!;
    if (input.kind !== 'regionalBossBody') throw new Error('Missing boss fixture');
    const source = { ...sourceResults.get(input.sourceInputId)! };
    for (const field of ['marks', 'attackStyle', 'attackRangeM', 'moveSpeedMps', 'walkSpeedMps', 'respawnSeconds'] as const) delete source[field];
    Object.freeze(source);
    const output = deriveWildernessSourceEnemy(extracted.params, input, { ...dependencies, resolveSource: () => source });
    for (const field of ['marks', 'attackStyle', 'attackRangeM', 'moveSpeedMps', 'walkSpeedMps', 'respawnSeconds', 'drops']) expect(Object.hasOwn(output, field)).toBe(false);
    expect(output).toMatchObject({ id: 'boss_ordrun_t10', family: 'boss_ordrun', behaviour: 'territorial' });
    const native = sourceResults.get(input.sourceInputId)!;
    expect(native.tier).toBe(20);
    expect(deriveWildernessSourceEnemy(extracted.params, input, dependencies).marks).toBe(native.marks);
    const badTargets = structuredClone(shared.regionalBossLevels); badTargets.ordrun.multiplier = .01;
    expect(() => deriveWildernessSourceEnemy(extracted.params, input, { ...dependencies, regionalBossLevels: badTargets,
      tuning: { ...shared.tuning, minimumHealth: 36 } })).toThrow(/iron_golem_t20/);
  });

  it('rejects missing or duplicated dependencies and unknown input or parameter fields', () => {
    const boss = extracted.inputs.find(input => input.kind === 'regionalBossBody')!;
    expect(() => deriveWildernessSourceEnemy(extracted.params, boss, { ...dependencies, resolveSource: () => undefined })).toThrow(/Missing source dependency/);
    const keeper = extracted.inputs.find(input => input.kind === 'wildernessBody' && input.role === 'keeper')!;
    expect(() => deriveWildernessSourceEnemy(extracted.params, keeper, { ...dependencies, keepers: [] })).toThrow(/keeper dependency/);
    expect(() => deriveWildernessSourceEnemy(extracted.params, keeper, { ...dependencies, keepers: [...extracted.keepers, extracted.keepers[0]!] })).toThrow(/keeper dependency/);
    expect(() => parseValue(WildernessKeeperRowsSchema, extracted.keepers.slice(1), 'keepers')).toThrow(/five/);
    expect(() => parseValue(WildernessKeeperRowsSchema, [...extracted.keepers.slice(1), extracted.keepers[1]], 'keepers')).toThrow(/five/);
    for (const input of extracted.inputs) expect(() => parseValue(WildernessBaseSourceInputSchema, { ...input, override: {} }, 'input')).toThrow();
    expect(() => parseValue(WildernessSourceParamsSchema, { ...extracted.params, override: {} }, 'params')).toThrow(/unknown/i);
    const p = structuredClone(extracted.params); p.wildernessBody.attackSpeedMs.keeper = 3800.5;
    expect(() => parseValue(WildernessSourceParamsSchema, p, 'params')).toThrow(/integer/);
    p.wildernessBody.attackSpeedMs.keeper = 3800; p.wildernessDragon.marksPerTier[0] = .5;
    expect(() => parseValue(WildernessSourceParamsSchema, p, 'params')).toThrow(/integer/);
    const lowMarks = structuredClone(extracted.params); lowMarks.wildernessBody.marks.maximumPerTier.other = 0;
    expect(() => parseValue(WildernessSourceParamsSchema, lowMarks, 'params')).toThrow(/marks/);
  });

  it('rejects stale hashes, changed generator shapes and missing RPG extraction dependencies', () => {
    const changed = { ...sources, wildernessCreatureSpecies: sources.wildernessCreatureSpecies.replace('magic ? .83', 'magic ? .84') };
    expect(() => buildWildernessEnemySources(baseline, changed, core.inputs)).toThrow(/source hash/);
    const wrong = { ...sources, wildernessCreatureSpecies: sources.wildernessCreatureSpecies.replace('Math.round(body.level *', 'Math.floor(body.level *') };
    expect(() => buildWildernessEnemySources(baselineFor(wrong), wrong, core.inputs)).toThrow(/bodyStats arithmetic/);
    const roundedKeeper = { ...sources, wildernessCreatureSpecies: sources.wildernessCreatureSpecies.replace('level: keeper.tier * keeper.multiplier', 'level: Math.round(keeper.tier * keeper.multiplier)') };
    expect(() => buildWildernessEnemySources(baselineFor(roundedKeeper), roundedKeeper, core.inputs)).toThrow(/keeper target/);
    const retunedIdentity = { ...sources, regionalBossBodies: sources.regionalBossBodies.replace('tuneEnemyCombatLevel(source.stats,', 'tuneEnemyCombatLevel({ ...source.stats, id: id },') };
    expect(() => buildWildernessEnemySources(baselineFor(retunedIdentity), retunedIdentity, core.inputs)).toThrow(/regional boss source mapping/);
    expect(() => buildWildernessEnemySources(baseline, sources, core.inputs.filter(row => row.id !== 'rpg/iron_golem'))).toThrow(/Missing RPG source dependency/);
  });

  it('extracts changed literal parameters, body targets and keeper rows without using output stats as inputs', () => {
    const changed = { ...sources,
      wildernessCreatureSpecies: sources.wildernessCreatureSpecies.replace('level: 48', 'level: 49').replace('magic ? .83', 'magic ? .84'),
      wildernessDragons: sources.wildernessDragons.replace('accuracy:12', 'accuracy:18'),
      wildernessDepth: sources.wildernessDepth.replace("name: 'Ashseal Warden'", "name: 'Renamed Ashseal'").replace('multiplier: 3,', 'multiplier: 3.1,'),
    };
    const next = buildWildernessEnemySources(baselineFor(changed), changed, core.inputs);
    expect(next.params.wildernessBody.attackLevelMultiplier.magic).toBe(.84);
    expect(next.params.wildernessDragon.accuracy).toBe(18);
    expect(next.inputs[0]).toMatchObject({ targetLevel: 49 });
    expect(next.keepers[0]).toMatchObject({ name: 'Renamed Ashseal', multiplier: 3.1 });
    const keeper = next.inputs.find(input => input.id === 'wildernessBody/ashseal_warden')!;
    expect(keeper).toEqual(extracted.inputs.find(input => input.id === keeper.id));
    expect(deriveWildernessSourceEnemy(next.params, keeper, { ...dependencies, keepers: next.keepers }).name).toBe('Renamed Ashseal');
    const dragon = next.inputs.find(input => input.kind === 'wildernessDragon')!;
    expect(deriveWildernessSourceEnemy(next.params, dragon, dependencies)).not.toStrictEqual(deriveWildernessSourceEnemy(extracted.params, dragon, dependencies));
  });
});
