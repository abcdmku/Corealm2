import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildActorEnemySources, ACTOR_SOURCE_MODULES, type ActorEnemySources } from '../tools/content/enemy-actor-source-inputs.js';
import { buildM4Baseline, type M4Baseline, type Snapshot } from '../tools/content/m4-baseline.js';
import { deriveActorEnemy, type ActorTuningDependencies } from '../game/src/content/balance/enemyActorSources.js';
import { combatLevel } from '../game/src/content/balance/enemies.js';
import { ActorEnemySourceInputSchema, ActorSourceInputsSchema, ActorSourceParamsSchema } from '../game/src/content/schema/enemyActorSources.js';
import { parseValue } from '../game/src/content/schema/core.js';
import type { EnemyDef } from '../game/src/content/index.js';

// Shared arithmetic is independently pinned by the Stage 1 tests. No shipped JSON is read here.
const tuning: ActorTuningDependencies = {
  combatLevel: { rollLevelOffset: 9, bonusDivisor: 100, defenceStyleCount: 2, healthPerLevel: 3,
    offenceWeight: .5, defenceWeight: .25, healthWeight: .25, minimum: 1 },
  tuning: { minimumHealth: 3, minimumLevel: 1, minimumBonus: 0, maximumBonus: 80, maximumBonusScale: 1,
    maxHitExponent: .68, searchInitialLow: 0, searchInitialHigh: 1, searchGrowth: 2, searchIterations: 48, healthPerCombatLevel: 12 },
};
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
let baseline: M4Baseline, sources: ActorEnemySources, extracted: ReturnType<typeof buildActorEnemySources>;
function originalRows(module: string, name: string): unknown {
  return restore(baseline.constants.find(row => row.module === module && row.name === name)!.value);
}
function baselineFor(changed: ActorEnemySources): M4Baseline {
  const copy = structuredClone(baseline);
  for (const module of ACTOR_SOURCE_MODULES) copy.source.files.find(row => row.path === `.baseline/game/src/content/${module}.ts`)!.sha256
    = createHash('sha256').update(changed[module]).digest('hex');
  return copy;
}
const baselineAvailable = existsSync(new URL('../.baseline/game/src/content/enemies.ts', import.meta.url));
beforeAll(async () => {
  if (!baselineAvailable) return;
  baseline = await buildM4Baseline();
  sources = Object.fromEntries(ACTOR_SOURCE_MODULES.map(module => [module,
    readFileSync(new URL(`../.baseline/game/src/content/${module}.ts`, import.meta.url), 'utf8')])) as ActorEnemySources;
  extracted = buildActorEnemySources(baseline, sources);
});

describe.skipIf(!baselineAvailable)('original universal, fairy and garden actor factories', () => {
  it('extracts 99 distinct combat inputs with source hashes and ordered roster provenance', () => {
    expect(extracted.inputs).toHaveLength(99);
    expect(extracted.inputs.filter(input => input.kind === 'universal')).toHaveLength(63);
    expect(extracted.inputs.filter(input => input.kind === 'fairy')).toHaveLength(12);
    expect(extracted.inputs.filter(input => input.kind === 'garden')).toHaveLength(24);
    expect(extracted.manifest.rows).toHaveLength(99);
    expect(extracted.manifest.sources).toHaveLength(4);
    for (const file of extracted.manifest.sources) expect({ path: file.path, sha256: file.sha256 })
      .toEqual(baseline.source.files.find(row => row.path === file.path));
    expect(extracted.params.universal).toMatchObject({ minimumRegionTier: 10, minimumTargetLevel: 12,
      targetLevelMultiplier: 2.5, respawnSeconds: 1800, marksMinimum: [15, 30], marksPerTier: [10, 20] });
    expect(extracted.params.fairy).toMatchObject({ aggressiveLevelOffset: 8, aggroRadius: { aggressive: 8, other: 5 }, marksPerTier: [3, 7] });
    expect(extracted.params.garden).toMatchObject({ walkSpeedCap: .35, walkSpeedMultiplier: .45,
      aggroRadius: { aggressive: 7, other: 4 }, marksPerTier: [3, 7] });
  });

  it('replays every original combat output, including absent optional fields', () => {
    for (const input of extracted.inputs) {
      const origin = extracted.manifest.rows.find(row => row.inputId === input.id)!;
      const rows = originalRows(origin.module, origin.catalog) as (EnemyDef | { id: string; stats: EnemyDef })[];
      const enemyId = input.kind === 'universal' ? `guardian_${input.number}_t${input.tier}` : input.speciesId;
      const row = rows.find(row => row.id === enemyId)!;
      const { drops, ...expected } = 'stats' in row ? row.stats : row;
      expect(deriveActorEnemy(extracted.params, input, tuning), input.id).toStrictEqual(expected);
    }
  });

  it('preserves all 90 universal species mappings and first-insertion combat owner order', () => {
    const species = originalRows('universalMinibosses', 'UNIVERSAL_MINIBOSS_SPECIES') as { id: string; regionId: string; stats: EnemyDef }[];
    expect(extracted.universalSpeciesMappings).toEqual(species.map(row => ({ speciesId: row.id,
      sourceInputId: `universal/${row.stats.id}`, regionId: row.regionId, tier: row.stats.tier })));
    const universal = extracted.inputs.filter(row => row.kind === 'universal');
    expect([...new Set(universal.map(row => row.tier))]).toEqual([10, 20, 50, 70, 40, 30, 60]);
    for (const mapping of extracted.universalSpeciesMappings) expect(universal.some(input => input.id === mapping.sourceInputId)).toBe(true);
  });

  it('keeps template distinctions and post-tuning movement and behaviour patches', () => {
    const fairy = extracted.inputs.find(row => row.kind === 'fairy')!;
    const garden = extracted.inputs.find(row => row.kind === 'garden')!;
    expect(fairy.kind).toBe('fairy'); expect(garden.kind).toBe('garden');
    if (fairy.kind !== 'fairy' || garden.kind !== 'garden') throw new Error('Missing fixtures');
    for (const levelOffset of [7, 8, 9]) {
      const result = deriveActorEnemy(extracted.params, { ...fairy, levelOffset }, tuning);
      expect(combatLevel(tuning.combatLevel, result)).toBe(fairy.tier + levelOffset);
      expect(result.behaviour).toBe(levelOffset >= 8 ? 'aggressive' : 'territorial');
      expect(result.aggroRadius).toBe(levelOffset >= 8 ? 8 : 5);
      expect(result.moveSpeedMps).toBe(2.1); expect(result.walkSpeedMps).toBe(.45);
      for (const key of ['attackRangeM', 'attackStyle', 'respawnSeconds']) expect(Object.hasOwn(result, key)).toBe(false);
    }
    for (const speed of [.3, .35 / .45, 1.2]) for (const behaviour of ['passive', 'territorial', 'aggressive'] as const) {
      const result = deriveActorEnemy(extracted.params, { ...garden, speed, behaviour }, tuning);
      expect(result.moveSpeedMps).toBe(speed); expect(result.walkSpeedMps).toBe(Math.min(.35, speed * .45));
      expect(result.aggroRadius).toBe(behaviour === 'aggressive' ? 7 : 4); expect(result.behaviour).toBe(behaviour);
      expect(Object.hasOwn(result, 'attackRangeM')).toBe(false);
    }
    const universal = extracted.inputs.find(row => row.kind === 'universal')!;
    for (const tier of [1, 4, 5, 10, 70]) {
      const result = deriveActorEnemy(extracted.params, { ...universal, tier }, tuning);
      expect(combatLevel(tuning.combatLevel, result)).toBe(Math.max(12, Math.round(tier * 2.5)));
      expect(result.marks).toEqual([Math.max(15, tier * 10), Math.max(30, tier * 20)]);
      expect(result.attackRangeM).toBe(2.6); expect(result.respawnSeconds).toBe(1800);
    }
  });

  it('extracts changed operands without reading snapshot combat values and exposes formula drift', () => {
    const changed = { ...sources,
      universalMinibosses: sources.universalMinibosses.replace('tier * 2.5', 'tier * 3').replace('30 * 60', '31 * 60'),
      fairyCreatures: sources.fairyCreatures.replace('levelOffset: -4', 'levelOffset: -5').replace('maxHealth: 70', 'maxHealth: 77'),
      fairyGardenCreatures: sources.fairyGardenCreatures.replace('Math.min(.35, form.speed * .45)', 'Math.min(.4, form.speed * .5)').replace('speed: .8', 'speed: .7'),
    };
    const next = buildActorEnemySources(baselineFor(changed), changed);
    expect(next.params.universal.targetLevelMultiplier).toBe(3); expect(next.params.universal.respawnSeconds).toBe(1860);
    expect(next.params.fairy.template.maxHealth).toBe(77); expect(next.params.garden.walkSpeedCap).toBe(.4);
    expect(next.params.garden.walkSpeedMultiplier).toBe(.5);
    expect(next.inputs.find(row => row.id === 'fairy/petal_pouncer_t30')).toMatchObject({ levelOffset: -5 });
    expect(next.inputs.find(row => row.id === 'garden/garden_spriggle_t30')).toMatchObject({ speed: .7 });
    for (const id of ['universal/guardian_01_t10', 'fairy/petal_pouncer_t30', 'garden/garden_spriggle_t30']) {
      expect(deriveActorEnemy(next.params, next.inputs.find(row => row.id === id)!, tuning))
        .not.toStrictEqual(deriveActorEnemy(extracted.params, extracted.inputs.find(row => row.id === id)!, tuning));
    }
  });

  it('rejects stale hashes, changed arithmetic and extra stat overrides', () => {
    const stale = { ...sources, universalMinibosses: sources.universalMinibosses.replace('tier * 2.5', 'tier * 3') };
    expect(() => buildActorEnemySources(baseline, stale)).toThrow(/source hash/);
    for (const [module, before, after] of [
      ['universalMinibosses', 'Math.round(tier * 2.5)', 'Math.floor(tier * 2.5)'],
      ['fairyCreatures', 'tier + row.levelOffset', 'tier - row.levelOffset'],
      ['fairyGardenCreatures', 'Math.min(.35, form.speed * .45)', 'Math.max(.35, form.speed * .45)'],
      ['fairyGardenCreatures', 'behaviour: form.behaviour,', 'accuracy: 999, behaviour: form.behaviour,'],
    ] as const) {
      const changed = { ...sources, [module]: sources[module].replace(before, after) };
      expect(() => buildActorEnemySources(baselineFor(changed), changed)).toThrow(/Unsupported/);
    }
    const duplicate = { ...sources, universalMinibosses: sources.universalMinibosses.replace("number: '02'", "number: '01'") };
    expect(() => buildActorEnemySources(baselineFor(duplicate), duplicate)).toThrow(/identity\/count\/order/);
  });

  it('rejects unknown keys and absent or inappropriate fields without broad override inputs', () => {
    for (const input of extracted.inputs) {
      expect(() => parseValue(ActorEnemySourceInputSchema, { ...input, surprise: 1 }, 'input')).toThrow(/unknown/i);
      expect(() => parseValue(ActorSourceInputsSchema, [input, input], 'inputs')).toThrow(/unique/);
      expect(() => parseValue(ActorEnemySourceInputSchema, { ...input, sourceInputId: input.id }, 'input')).toThrow();
    }
    for (const kind of ['universal', 'fairy', 'garden'] as const) {
      const p = structuredClone(extracted.params);
      expect(() => parseValue(ActorSourceParamsSchema, { ...p, [kind]: { ...p[kind], surprise: 1 } }, 'params')).toThrow(/unknown/i);
      expect(() => parseValue(ActorSourceParamsSchema, { ...p,
        [kind]: { ...p[kind], template: { ...p[kind].template, marks: [1, 2] } } }, 'params')).toThrow(/unknown/i);
      Reflect.deleteProperty(p[kind].template, 'walkSpeedMps');
      expect(() => parseValue(ActorSourceParamsSchema, p, 'params')).toThrow();
    }
    const fairy = extracted.inputs.find(input => input.kind === 'fairy')!;
    expect(() => parseValue(ActorEnemySourceInputSchema, { ...fairy, tier: 40 }, 'input')).toThrow();
    expect(() => parseValue(ActorEnemySourceInputSchema, { ...fairy, levelOffset: .5 }, 'input')).toThrow();
  });

  it('does not mutate frozen source inputs, templates or shared tuning dependencies', () => {
    const deepFreeze = (value: unknown): void => {
      if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    };
    const params = structuredClone(extracted.params), inputs = structuredClone(extracted.inputs), dependencies = structuredClone(tuning);
    const before = structuredClone({ params, inputs, dependencies });
    deepFreeze(params); deepFreeze(inputs); deepFreeze(dependencies);
    for (const input of inputs) deriveActorEnemy(params, input, dependencies);
    expect({ params, inputs, dependencies }).toStrictEqual(before);
  });
});
