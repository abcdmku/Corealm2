import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { transform } from 'esbuild';
import { buildM4Baseline, type M4Baseline, type Snapshot } from '../tools/content/m4-baseline.js';
import { buildCoreEnemySources } from '../tools/content/enemy-source-inputs.js';
import { buildVariantEnemySources, VARIANT_SOURCE_MODULES, type VariantEnemySources } from '../tools/content/enemy-source-variant-inputs.js';
import { buildWildernessEnemySources, WILDERNESS_SOURCE_MODULES, type WildernessEnemySources } from '../tools/content/enemy-wilderness-source-inputs.js';
import { buildDescendantEnemySources, DESCENDANT_SOURCE_MODULES, type DescendantAvailableInput, type DescendantEnemySources } from '../tools/content/enemy-descendant-source-inputs.js';
import { deriveCoreEnemy, type EnemyFieldsWithoutDrops } from '../game/src/content/balance/enemySources.js';
import { deriveVariantEnemy } from '../game/src/content/balance/enemySourceVariants.js';
import { deriveWildernessSourceEnemy } from '../game/src/content/balance/enemyWildernessSources.js';
import { deriveDescendantEnemy, type DescendantSourceInput, type DescendantSourceDependencies, type FairyCrownSourceInput } from '../game/src/content/balance/enemyDescendantSources.js';
import { DescendantSourceInputSchema, DescendantSourceInputsSchema, DescendantSourceParamsSchema } from '../game/src/content/schema/enemyDescendantSources.js';
import { parseValue } from '../game/src/content/schema/core.js';
import { combatLevel } from '../game/src/content/balance/enemies.js';
import type { EnemyDef } from '../game/src/content/index.js';

const sourceUrl = (module: string) => new URL(`../.baseline/game/src/content/${module}.ts`, import.meta.url);
const read = (module: string) => readFileSync(sourceUrl(module), 'utf8');
const baselineAvailable = [...DESCENDANT_SOURCE_MODULES, ...VARIANT_SOURCE_MODULES, ...WILDERNESS_SOURCE_MODULES,
  'creatureExpansion', 'starterCreatures', 'rpgBestiary', 'index', 'encounterBalance'].every(module => existsSync(sourceUrl(module)));
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
// The original shared tuning operands are independently covered by the Stage 1 suite.
const shared = {
  combatLevel: { rollLevelOffset: 9, bonusDivisor: 100, defenceStyleCount: 2, healthPerLevel: 3,
    offenceWeight: .5, defenceWeight: .25, healthWeight: .25, minimum: 1 },
  tuning: { minimumHealth: 3, minimumLevel: 1, minimumBonus: 0, maximumBonus: 80, maximumBonusScale: 1,
    maxHitExponent: .68, searchInitialLow: 0, searchInitialHigh: 1, searchGrowth: 2, searchIterations: 48, healthPerCombatLevel: 12 },
  regionalBossLevels: { galeskin: { tier: 1, multiplier: 11 }, tempest_roc: { tier: 1, multiplier: 13 },
    mossbound: { tier: 5, multiplier: 3 }, rootheart: { tier: 5, multiplier: 5 }, tideworn: { tier: 10, multiplier: 4 },
    ordrun: { tier: 10, multiplier: 5 }, cinderwake: { tier: 20, multiplier: 4 } },
};
let baseline: M4Baseline, sources: DescendantEnemySources, availableInputs: DescendantAvailableInput[];
let extracted: ReturnType<typeof buildDescendantEnemySources>, dependencies: DescendantSourceDependencies;
const sourceResults = new Map<string, EnemyFieldsWithoutDrops>();
let originalFairy: (input: FairyCrownSourceInput, source: EnemyFieldsWithoutDrops) => EnemyFieldsWithoutDrops;
let originalCrownward: (input: DescendantSourceInput, source: EnemyFieldsWithoutDrops) => EnemyFieldsWithoutDrops;
function originalFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`); if (start < 0) throw new Error(`Missing original ${name}`);
  const pattern = /\r?\n\}(?:\r?\n|$)/g; pattern.lastIndex = start;
  const end = pattern.exec(source); if (!end) throw new Error(`Missing original ${name} end`);
  return source.slice(start, end.index + end[0].length);
}
function originalMapping(source: string, name: string): string {
  const start = source.indexOf(`export const ${name}:`), end = source.indexOf('\n});', start);
  if (start < 0 || end < 0) throw new Error(`Missing original ${name} mapping`);
  return source.slice(start, end + 4).replace('export ', '') + `\nreturn ${name}[0].stats;`;
}
function baselineFor(changed: DescendantEnemySources): M4Baseline {
  const copy = structuredClone(baseline);
  for (const module of DESCENDANT_SOURCE_MODULES) copy.source.files.find(row => row.path === `.baseline/game/src/content/${module}.ts`)!.sha256
    = createHash('sha256').update(changed[module]).digest('hex');
  return copy;
}
beforeAll(async () => {
  if (!baselineAvailable) return;
  baseline = await buildM4Baseline();
  sources = Object.fromEntries(DESCENDANT_SOURCE_MODULES.map(module => [module, read(module)])) as DescendantEnemySources;
  const core = buildCoreEnemySources(baseline, { creatureExpansion: read('creatureExpansion'), starterCreatures: read('starterCreatures'), rpgBestiary: read('rpgBestiary') });
  for (const input of core.inputs) sourceResults.set(input.id, deriveCoreEnemy(core.params, input));
  const variants = buildVariantEnemySources(baseline, Object.fromEntries(VARIANT_SOURCE_MODULES.map(module => [module, read(module)])) as unknown as VariantEnemySources, core.inputs);
  for (const input of variants.inputs) sourceResults.set(input.id, deriveVariantEnemy(variants.params, input, sourceResults.get(input.sourceInputId)!));
  const wilderness = buildWildernessEnemySources(baseline, Object.fromEntries(WILDERNESS_SOURCE_MODULES.map(module => [module, read(module)])) as WildernessEnemySources, core.inputs);
  for (const input of wilderness.inputs) sourceResults.set(input.id, deriveWildernessSourceEnemy(wilderness.params, input,
    { ...shared, keepers: wilderness.keepers, resolveSource: id => sourceResults.get(id) }));
  availableInputs = [...core.inputs, ...variants.inputs, ...wilderness.inputs];
  extracted = buildDescendantEnemySources(baseline, sources, availableInputs);
  dependencies = { ...shared, resolveSource: id => sourceResults.get(id) };
  const index = read('index'), healthConstant = index.match(/^export const PLAYER_HEALTH_PER_LEVEL = .*;$/m)?.[0];
  if (!healthConstant) throw new Error('Missing original health constant');
  const tuningCode = healthConstant.replace('export ', '') + '\n' + originalFunction(index, 'enemyCombatLevel')
    + '\n' + originalFunction(read('encounterBalance'), 'tuneEnemyCombatLevel') + '\nreturn tuneEnemyCombatLevel;';
  const originalTune = new Function((await transform(tuningCode, { loader: 'ts' })).code)();
  const fairyCode = (await transform(originalMapping(sources.fairyCrownCreatures, 'FAIRY_CROWN_SPECIES'), { loader: 'ts' })).code;
  const fairy = new Function('FAIRY_CROWN_FORMS', 'sourceSpecies', 'tuneEnemyCombatLevel', 'tierSilhouetteScale', 'dropsFor', fairyCode);
  originalFairy = (input, source) => {
    const form = { ...input, id: input.speciesId, sourceSpeciesId: 'oracle', level: input.targetLevel };
    const { drops, ...output } = fairy([form], new Map([['oracle', { stats: source }]]), originalTune, () => 1, () => []);
    return output;
  };
  const crownwardCode = (await transform(originalMapping(sources.crownwardDragons, 'CROWNWARD_DRAGON_SPECIES'), { loader: 'ts' })).code;
  const crownward = new Function('CROWNWARD_DRAGON_FORMS', 'WILDERNESS_DRAGONS', 'tuneEnemyCombatLevel', 'tierSilhouetteScale', 'regionalFabricDrops', crownwardCode);
  originalCrownward = (input, source) => {
    const form = { ...input, id: input.speciesId, sourceSpeciesId: 'oracle', level: input.targetLevel, nativeScale: 1.1 };
    const { drops, ...output } = crownward([form], [{ id: 'oracle', stats: source }], originalTune, () => 1, () => []);
    return output;
  };
});

describe('strict descendant input branches', () => {
  it('requires explicit boss state and rejects unknown fields, kinds and duplicate ids', () => {
    const fairy = { id: 'fairyCrown/probe', kind: 'fairyCrown', speciesId: 'probe', name: 'Probe',
      sourceInputId: 'rpg/marsh_wasp', targetLevel: 28, tier: 30, nativeScale: .58, behaviour: 'territorial', boss: false };
    expect(parseValue(DescendantSourceInputSchema, fairy, 'input')).toEqual(fairy);
    const absentBoss = { ...fairy }; Reflect.deleteProperty(absentBoss, 'boss');
    expect(() => parseValue(DescendantSourceInputSchema, absentBoss, 'input')).toThrow();
    expect(() => parseValue(DescendantSourceInputSchema, { ...fairy, override: {} }, 'input')).toThrow();
    expect(() => parseValue(DescendantSourceInputSchema, { ...fairy, tier: 50 }, 'input')).toThrow();
    expect(() => parseValue(DescendantSourceInputsSchema, [fairy, fairy], 'inputs')).toThrow(/unique/);
  });
});

describe.skipIf(!baselineAvailable)('original fairy crown and Crownward dragon descendants', () => {
  it('extracts all 15 original dependencies in source order with exact source hashes', () => {
    expect(extracted.inputs.map(input => [input.id, input.sourceInputId])).toEqual([
      ['fairyCrown/pearl_knight', 'wildernessBody/nightforge_marshal'], ['fairyCrown/ivory_castellan', 'wildernessBody/nightforge_marshal'],
      ['fairyCrown/crown_hart', 'expansion/marchwild_horse'], ['fairyCrown/silverthorn_harrow', 'forest/briar_harrow'],
      ['fairyCrown/lantern_sprite', 'rpg/marsh_wasp'], ['fairyCrown/moonpetal_stalker', 'forest/heath_jack'],
      ['fairyCrown/dewglass_weaver', 'forest/fen_crawler'], ['fairyCrown/bloomheart_matriarch', 'regionalBossBody/boss_rootheart'],
      ['fairyCrown/prismatic_sprite', 'rpg/marsh_wasp'], ['fairyCrown/orchid_reaper', 'ash/veil_reaper'],
      ['fairyCrown/starroot_guardian', 'forest/briar_harrow'], ['fairyCrown/amethyst_sovereign', 'wildernessBody/hollow_star'],
      ['crownwardDragon/crownward_red_hatchling', 'wildernessDragon/baby_red_dragon'],
      ['crownwardDragon/crownward_black_hatchling', 'wildernessDragon/baby_black_dragon'],
      ['crownwardDragon/crownward_red_dragon', 'wildernessDragon/red_wilderness_dragon'],
    ]);
    expect(extracted.inputs.filter(input => input.kind === 'fairyCrown' && input.boss)).toHaveLength(3);
    expect(extracted.inputs.filter(input => input.kind === 'fairyCrown' && !input.boss)).toHaveLength(9);
    expect(extracted.manifest.rows).toHaveLength(15);
    for (const file of extracted.manifest.sources) expect({ path: file.path, sha256: file.sha256 })
      .toEqual(baseline.source.files.find(row => row.path === file.path));
  });

  it('extracts every original shared operand', () => {
    expect(extracted.params).toEqual({ fairyCrown: { movementScaleCap: 1,
      attackRangeM: { boss: { minimum: 2.4, fallback: 2 }, ordinary: { maximum: 2, fallback: 1.8 } },
      aggroRadius: { boss: 12, passive: 4, territorial: 5, aggressive: 8 }, marksPerTier: { ordinary: [3, 7], boss: [12, 24] } },
    crownwardDragon: { tier: 40, behaviour: 'territorial', aggroRadius: { miniboss: 7, boss: 11 }, marks: { miniboss: [220, 380], boss: [600, 1000] } } });
  });

  it('matches all 15 complete original combat outputs from the generated source graph', () => {
    for (const input of extracted.inputs) {
      const origin = extracted.manifest.rows.find(row => row.inputId === input.id)!;
      const rows = restore(baseline.constants.find(row => row.module === origin.module && row.name === origin.catalog)!.value) as { id: string; stats: EnemyDef }[];
      const { drops, ...expected } = rows.find(row => row.id === input.speciesId)!.stats;
      const output = deriveDescendantEnemy(extracted.params, input, dependencies);
      expect(output, input.id).toStrictEqual(expected);
      expect(combatLevel(shared.combatLevel, output)).toBe(input.targetLevel);
    }
  });

  it('matches original fairy callback probes for scale caps, range fallback, behaviours and optional motion', () => {
    const fixture = extracted.inputs.find(input => input.kind === 'fairyCrown')!;
    const base = sourceResults.get(fixture.sourceInputId)!;
    for (const boss of [false, true]) for (const behaviour of ['passive', 'territorial', 'aggressive'] as const)
      for (const nativeScale of [.4, 1, 1.4]) for (const motion of ['absent', 'undefined', 'present'] as const) {
        const source = { ...base }, input = { ...fixture, boss, behaviour, nativeScale };
        if (motion === 'absent') { delete source.moveSpeedMps; delete source.walkSpeedMps; delete source.attackRangeM; }
        if (motion === 'undefined') { source.moveSpeedMps = undefined; source.walkSpeedMps = undefined; source.attackRangeM = undefined; }
        const output = deriveDescendantEnemy(extracted.params, input, { ...dependencies, resolveSource: () => source });
        expect(output, `${boss}/${behaviour}/${nativeScale}/${motion}`).toStrictEqual(originalFairy(input, source));
        expect(Object.hasOwn(output, 'moveSpeedMps')).toBe(motion !== 'absent');
        expect(Object.hasOwn(output, 'walkSpeedMps')).toBe(motion !== 'absent');
        if (motion === 'undefined') { expect(output.moveSpeedMps).toBeUndefined(); expect(output.walkSpeedMps).toBeUndefined(); }
      }
  });

  it('uses nullish range fallback and preserves Crownward source cadence and motion', () => {
    const fairy = extracted.inputs.find(input => input.kind === 'fairyCrown')!;
    for (const attackRangeM of [0, 1.2, 8, undefined]) for (const boss of [false, true]) {
      const source = { ...sourceResults.get(fairy.sourceInputId)!, attackRangeM }, input = { ...fairy, boss };
      expect(deriveDescendantEnemy(extracted.params, input, { ...dependencies, resolveSource: () => source })).toStrictEqual(originalFairy(input, source));
    }
    for (const input of extracted.inputs.filter(input => input.kind === 'crownwardDragon')) {
      for (const optional of ['absent', 'undefined', 'present']) {
        const source = { ...sourceResults.get(input.sourceInputId)! };
        if (optional === 'absent') { delete source.moveSpeedMps; delete source.walkSpeedMps; delete source.attackRangeM; }
        if (optional === 'undefined') { source.moveSpeedMps = undefined; source.walkSpeedMps = undefined; source.attackRangeM = undefined; }
        const output = deriveDescendantEnemy(extracted.params, input, { ...dependencies, resolveSource: () => source });
        expect(output).toStrictEqual(originalCrownward(input, source));
        expect(output.attackSpeedMs).toBe(source.attackSpeedMs); expect(output.moveSpeedMps).toBe(source.moveSpeedMps);
        expect(output.walkSpeedMps).toBe(source.walkSpeedMps); expect(output.attackRangeM).toBe(source.attackRangeM);
      }
    }
  });

  it('patches descendant identity before tuning and reports missing source dependencies', () => {
    for (const input of extracted.inputs) {
      expect(() => deriveDescendantEnemy(extracted.params, input, { ...dependencies, resolveSource: () => undefined })).toThrow(input.sourceInputId);
      const tier = input.kind === 'fairyCrown' ? input.tier : extracted.params.crownwardDragon.tier;
      expect(() => deriveDescendantEnemy(extracted.params, { ...input, targetLevel: 1 }, {
        ...dependencies, tuning: { ...shared.tuning, minimumHealth: 36 },
      })).toThrow(`${input.speciesId}_t${tier}`);
    }
  });

  it('responds to source and parameter edits without changing source objects or previous results', () => {
    const input = extracted.inputs.find(input => input.kind === 'fairyCrown')!, source = { ...sourceResults.get(input.sourceInputId)! };
    const frozen = Object.freeze(source), p = structuredClone(extracted.params);
    const before = deriveDescendantEnemy(p, input, { ...dependencies, resolveSource: () => frozen });
    p.fairyCrown.movementScaleCap = .2; p.fairyCrown.marksPerTier.ordinary = [4, 8]; p.fairyCrown.attackRangeM.ordinary.maximum = 1;
    const after = deriveDescendantEnemy(p, input, { ...dependencies, resolveSource: () => frozen });
    expect(after.moveSpeedMps).toBe(source.moveSpeedMps! * .2); expect(after.marks).toEqual([input.tier * 4, input.tier * 8]); expect(after.attackRangeM).toBe(1);
    const stronger = { ...source, maxHit: source.maxHit * 2 };
    expect(deriveDescendantEnemy(extracted.params, input, { ...dependencies, resolveSource: () => stronger }).maxHit).toBeGreaterThan(before.maxHit);
    expect(deriveDescendantEnemy(extracted.params, input, dependencies)).toStrictEqual(before);
    const crownward = extracted.inputs.find(input => input.kind === 'crownwardDragon')!;
    p.crownwardDragon.tier = 30; p.crownwardDragon.marks.miniboss = [300, 400]; p.crownwardDragon.aggroRadius.miniboss = 9;
    expect(deriveDescendantEnemy(p, crownward, dependencies)).toMatchObject({ tier: 30, id: `${crownward.speciesId}_t30`, marks: [300, 400], aggroRadius: 9 });
  });

  it('rejects unavailable, duplicated and wrongly typed sources without accepting staged RPG fallbacks', () => {
    expect(() => buildDescendantEnemySources(baseline, sources, availableInputs.filter(input => input.id !== 'wildernessBody/nightforge_marshal'))).toThrow(/Missing source dependency/);
    expect(() => buildDescendantEnemySources(baseline, sources, [...availableInputs, availableInputs[0]!])).toThrow(/Duplicate available/);
    const staged = { ...sources, fairyCrownCreatures: sources.fairyCrownCreatures.replace("sourceSpeciesId: 'marsh_wasp'", "sourceSpeciesId: 'wild_goblin'") };
    expect(() => buildDescendantEnemySources(baselineFor(staged), staged, availableInputs)).toThrow(/Missing original fairy crown source species wild_goblin/);
    const wrong = availableInputs.map(input => input.id === 'rpg/marsh_wasp' ? { ...input, kind: 'starter' } : input) as DescendantAvailableInput[];
    expect(() => buildDescendantEnemySources(baseline, sources, wrong)).toThrow(/Wrong source dependency kind/);
  });

  it('rejects stale hashes, changed tuning or movement shapes, and inconsistent region/tier pairs', () => {
    const stale = { ...sources, fairyCrownCreatures: sources.fairyCrownCreatures.replace('Math.max(2.4', 'Math.max(2.5') };
    expect(() => buildDescendantEnemySources(baseline, stale, availableInputs)).toThrow(/source hash/);
    const motion = { ...sources, fairyCrownCreatures: sources.fairyCrownCreatures.replace('base.moveSpeedMps === undefined', '!base.moveSpeedMps') };
    expect(() => buildDescendantEnemySources(baselineFor(motion), motion, availableInputs)).toThrow(/fairy crown source generation/);
    const target = { ...sources, crownwardDragons: sources.crownwardDragons.replace('}, form.level, 40)', '}, Math.round(form.level), 40)') };
    expect(() => buildDescendantEnemySources(baselineFor(target), target, availableInputs)).toThrow(/Crownward dragon source generation/);
    const region = { ...sources, fairyCrownCreatures: sources.fairyCrownCreatures.replace("regionId: 'crownward', tier: 40", "regionId: 'gloamgarden', tier: 40") };
    expect(() => buildDescendantEnemySources(baselineFor(region), region, availableInputs)).toThrow(/region\/tier mismatch/);
  });

  it('extracts edited source operands and literal inputs while retaining original numeric output oracles', () => {
    const changed = { ...sources,
      fairyCrownCreatures: sources.fairyCrownCreatures.replaceAll('Math.min(1, form.nativeScale)', 'Math.min(.8, form.nativeScale)').replace('level: 40, nativeScale: .66', 'level: 42, nativeScale: .7'),
      crownwardDragons: sources.crownwardDragons.replace('[600, 1000] : [220, 380]', '[650, 1050] : [230, 390]'),
    };
    const next = buildDescendantEnemySources(baselineFor(changed), changed, availableInputs);
    expect(next.params.fairyCrown.movementScaleCap).toBe(.8);
    expect(next.inputs[0]).toMatchObject({ targetLevel: 42, nativeScale: .7 });
    expect(next.params.crownwardDragon.marks).toEqual({ boss: [650, 1050], miniboss: [230, 390] });
    expect(deriveDescendantEnemy(next.params, next.inputs[0]!, dependencies)).not.toStrictEqual(deriveDescendantEnemy(extracted.params, extracted.inputs[0]!, dependencies));
  });

  it('rejects extra parameter fields, fractional rewards, nonpositive scale caps and incomplete profiles', () => {
    expect(() => parseValue(DescendantSourceParamsSchema, { ...extracted.params, overrides: {} }, 'params')).toThrow(/unknown/i);
    const p = structuredClone(extracted.params); p.fairyCrown.marksPerTier.boss[0] = .5;
    expect(() => parseValue(DescendantSourceParamsSchema, p, 'params')).toThrow(/integer/);
    p.fairyCrown.marksPerTier.boss[0] = 12; p.crownwardDragon.marks.boss[1] = 600.5;
    expect(() => parseValue(DescendantSourceParamsSchema, p, 'params')).toThrow(/integer/);
    p.crownwardDragon.marks.boss[1] = 1000; p.fairyCrown.movementScaleCap = 0;
    expect(() => parseValue(DescendantSourceParamsSchema, p, 'params')).toThrow();
    const incomplete = structuredClone(extracted.params); Reflect.deleteProperty(incomplete.fairyCrown.aggroRadius, 'territorial');
    expect(() => parseValue(DescendantSourceParamsSchema, incomplete, 'params')).toThrow();
  });
});
