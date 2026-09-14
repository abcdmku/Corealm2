import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { ENEMY_BALANCE } from '../game/src/content/enemyBalanceData.js';
import { deriveActorEnemy, resolveUniversalActorTier } from '../game/src/content/balance/enemyActorSources.js';
import { combatLevel } from '../game/src/content/balance/enemies.js';
import { universalMinibossSpecies, UNIVERSAL_MINIBOSS_RESPAWN_SECONDS,
  UNIVERSAL_MINIBOSS_ROSTER, UNIVERSAL_MINIBOSS_SPECIES } from '../game/src/content/universalMinibosses.js';
import type { RegionId } from '../game/src/contracts.js';
import type { CreatureSpeciesDef } from '../game/src/content/creatureSpecies.js';

// Perturbations affect only this test module's cloned balance, never the game loader's object.
vi.mock('../game/src/content/enemyBalanceData.js', async importOriginal => {
  const original = await importOriginal<typeof import('../game/src/content/enemyBalanceData.js')>();
  return { ENEMY_BALANCE: structuredClone(original.ENEMY_BALANCE) };
});
const initial = structuredClone(ENEMY_BALANCE);
afterEach(() => { Object.assign(ENEMY_BALANCE, structuredClone(initial)); });

describe('universal helper parameter wiring', () => {
  it('uses the explicit region floor while preserving zero and nullish override choices', () => {
    const p = { minimumRegionTier: 10 }, regions = { ...initial.regionCombatTiers };
    expect(resolveUniversalActorTier(p, regions, 'fallowmarch')).toBe(10);
    expect(resolveUniversalActorTier({ minimumRegionTier: 15 }, regions, 'fallowmarch')).toBe(15);
    expect(resolveUniversalActorTier(p, { ...regions, fallowmarch: 25 }, 'fallowmarch')).toBe(25);
    for (const override of [0, -10, .5, 70, Infinity, -Infinity, NaN]) {
      expect(resolveUniversalActorTier(p, regions, 'fallowmarch', override)).toBe(override);
    }
    expect(resolveUniversalActorTier(p, regions, 'fallowmarch', null)).toBe(10);
    expect(resolveUniversalActorTier(p, regions, 'fallowmarch', undefined)).toBe(10);
  });

  it('applies floor and region changes to new public calls without changing saved canonical tiers', () => {
    const stored = structuredClone(UNIVERSAL_MINIBOSS_SPECIES);
    const sourceTiers = initial.sourceInputs.filter(row => row.kind === 'universal').map(row => [row.id, row.tier]);
    ENEMY_BALANCE.actorSourceParameters.universal.minimumRegionTier = 15;
    expect(universalMinibossSpecies('01', 'fallowmarch').stats).toMatchObject({ id: 'guardian_01_t15', tier: 15 });
    ENEMY_BALANCE.regionCombatTiers.fallowmarch = 25;
    expect(universalMinibossSpecies('01', 'fallowmarch').stats).toMatchObject({ id: 'guardian_01_t25', tier: 25 });
    expect(universalMinibossSpecies('01', 'fallowmarch', 70).stats).toMatchObject({ id: 'guardian_01_t70', tier: 70 });
    expect(UNIVERSAL_MINIBOSS_SPECIES).toStrictEqual(stored);
    expect(ENEMY_BALANCE.sourceInputs.filter(row => row.kind === 'universal').map(row => [row.id, row.tier])).toEqual(sourceTiers);
  });

  it('reads actor target, template, marks and respawn parameters on each call', () => {
    const base = universalMinibossSpecies('01', 'crownward');
    const p = ENEMY_BALANCE.actorSourceParameters.universal;
    expect(UNIVERSAL_MINIBOSS_RESPAWN_SECONDS).toBe(p.respawnSeconds);
    p.targetLevelMultiplier = 3;
    p.template.accuracy = 50;
    p.marksPerTier = [11, 22];
    p.respawnSeconds = 2100.5;
    const changed = universalMinibossSpecies('01', 'crownward');
    expect(combatLevel(ENEMY_BALANCE.combatLevel, changed.stats)).toBe(120);
    expect(changed.stats).toMatchObject({ accuracy: 50, marks: [440, 880], respawnSeconds: 2100.5 });
    expect(changed.stats.maxHealth).not.toBe(base.stats.maxHealth);
    expect(changed.stats.drops).toStrictEqual(base.stats.drops);
    p.minimumTargetLevel = 35;
    expect(combatLevel(ENEMY_BALANCE.combatLevel, universalMinibossSpecies('01', 'fallowmarch').stats)).toBe(35);
  });

  it('passes the shared combat-level and tuning parameters to the pure actor formula', () => {
    const base = universalMinibossSpecies('02', 'wilderness', 70);
    ENEMY_BALANCE.combatLevel.bonusDivisor = 120;
    ENEMY_BALANCE.tuning.maximumBonus = 12;
    ENEMY_BALANCE.tuning.maxHitExponent = .8;
    const result = universalMinibossSpecies('02', 'wilderness', 70);
    const row = UNIVERSAL_MINIBOSS_ROSTER.find(row => row.number === '02')!;
    const expected = deriveActorEnemy(ENEMY_BALANCE.actorSourceParameters, {
      id: 'universal/guardian_02_t70', kind: 'universal', number: '02', name: row.name, style: row.style, tier: 70,
    }, ENEMY_BALANCE);
    const { drops, ...stats } = result.stats;
    expect(stats).toStrictEqual(expected);
    expect(result.stats.accuracy).toBe(12);
    expect(result.stats.maxHit).not.toBe(base.stats.maxHit);
    expect(combatLevel(ENEMY_BALANCE.combatLevel, result.stats)).toBe(175);
  });

  it('leaves frozen pure helper arguments unchanged', () => {
    const p = structuredClone(initial.actorSourceParameters), regions = structuredClone(initial.regionCombatTiers);
    const dependencies = { combatLevel: structuredClone(initial.combatLevel), tuning: structuredClone(initial.tuning) };
    const source = initial.sourceInputs.find(row => row.kind === 'universal')!;
    if (source.kind !== 'universal') throw new Error('Missing universal source');
    const input = structuredClone(source), before = structuredClone({ p, regions, dependencies, input });
    const freeze = (value: unknown): void => {
      if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    };
    freeze(p); freeze(regions); freeze(dependencies); freeze(input);
    resolveUniversalActorTier(p.universal, regions, 'wilderness', 70);
    deriveActorEnemy(p, input, dependencies);
    expect({ p, regions, dependencies, input }).toStrictEqual(before);
  });
});

const originalFiles = ['content/index', 'content/encounterBalance', 'content/universalMinibosses',
  'content/fairyMinibossForms', 'core/math'];
const originalUrl = (module: string) => new URL(`../.baseline/game/src/${module}.ts`, import.meta.url);
const hasOriginal = originalFiles.every(module => existsSync(originalUrl(module)));
type RuntimeHelper = (number: unknown, region: unknown, override?: unknown) => CreatureSpeciesDef;
let original: RuntimeHelper;

describe.skipIf(!hasOriginal)('universal public helper against immutable original source', () => {
  beforeAll(async () => {
    const read = (module: string) => readFileSync(originalUrl(module), 'utf8');
    const functionSource = (source: string, name: string) => {
      const start = source.indexOf(`export function ${name}(`);
      const end = /\r?\n}(?=\r?\n|$)/.exec(source.slice(start));
      if (start < 0 || !end) throw new Error(`Missing original ${name} function`);
      return source.slice(start, start + end.index + end[0].length);
    };
    const content = read('content/index');
    const health = content.match(/^export const PLAYER_HEALTH_PER_LEVEL = [^;]+;/m)?.[0];
    if (!health) throw new Error('Missing original health-per-level parameter');
    // Trusted original code runs in memory with only its original local dependencies.
    // No game module is imported and no readonly source file is rewritten.
    const source = [health, functionSource(content, 'enemyCombatLevel'),
      functionSource(read('core/math'), 'tierSilhouetteScale'), read('content/encounterBalance'),
      read('content/fairyMinibossForms'), read('content/universalMinibosses')].join('\n')
      .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
    const compiled = await transform(`${source}\nreturn universalMinibossSpecies;`, { loader: 'ts', target: 'es2022' });
    original = new Function(compiled.code)() as RuntimeHelper;
  });

  it('matches all roster numbers across all nine regions, including every explicit deep override', () => {
    for (const region of Object.keys(initial.regionCombatTiers) as RegionId[]) for (const row of UNIVERSAL_MINIBOSS_ROSTER) {
      for (const override of [undefined, 70] as const) {
        expect(universalMinibossSpecies(row.number, region, override), `${row.number}/${region}/${override}`)
          .toStrictEqual(original(row.number, region, override));
      }
    }
  });

  it('preserves original runtime edge results and error evaluation order', () => {
    const invoke = universalMinibossSpecies as RuntimeHelper;
    const outcome = (fn: RuntimeHelper, args: [unknown, unknown, unknown?]) => {
      try { return { kind: 'return', value: fn(...args) }; }
      catch (error) { return { kind: 'throw', name: (error as Error).name, message: (error as Error).message }; }
    };
    for (const number of ['01', 'missing', 1, null]) for (const region of ['fallowmarch', 'missing', null]) {
      for (const override of [undefined, null, 0, -1, .5, 5, 70, 99, NaN, -Infinity]) {
        const args: [unknown, unknown, unknown?] = [number, region, override];
        expect(outcome(invoke, args), `${number}/${region}/${override}`).toStrictEqual(outcome(original, args));
      }
    }
    const zero = invoke('01', 'fallowmarch', 0);
    expect(zero.id).toBe('guardian_01_fallowmarch');
    expect(zero.stats).toMatchObject({ id: 'guardian_01_t0', tier: 0, drops: [], marks: [15, 30] });
  });

  it('retains the shared tuning guard against nonfinite targets', () => {
    // Stage 1 deliberately rejects nonfinite targets. The old source overflowed its
    // combat-level result to Infinity and then considered that target satisfied.
    expect(original('01', 'fallowmarch', Infinity).stats.maxHealth).toBe(Infinity);
    expect(() => (universalMinibossSpecies as RuntimeHelper)('01', 'fallowmarch', Infinity))
      .toThrow('Cannot tune universal_guardian to combat level Infinity');
  });
});
