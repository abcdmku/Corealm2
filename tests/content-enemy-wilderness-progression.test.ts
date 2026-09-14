import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildM4Baseline, type M4Baseline, type Snapshot } from '../tools/content/m4-baseline.js';
import { buildWildernessProgressionInputs, WILDERNESS_PROGRESSION_MODULES, type WildernessProgressionSources } from '../tools/content/enemy-wilderness-progression-inputs.js';
import { buildWildernessProgression, wildernessLevelAt, wildernessMarks, wildernessTierAt,
  type WildernessProgressionDependencies, type WildernessProgressionParams, type WildernessGroupInput,
  type WildernessSpeciesInput, type WildernessLootRequest } from '../game/src/content/balance/enemyWildernessProgression.js';
import { WildernessGroupInputsSchema, WildernessProgressionParamsSchema, WildernessSpeciesInputsSchema,
  WildernessLootRequestSchema } from '../game/src/content/schema/enemyWildernessProgression.js';
import { WildernessKeeperRowsSchema } from '../game/src/content/schema/enemyWildernessSources.js';
import { parseValue } from '../game/src/content/schema/core.js';
import { combatLevel, tuneCombat } from '../game/src/content/balance/enemies.js';
import type { EnemyFieldsWithoutDrops } from '../game/src/content/balance/enemySources.js';
import type { EnemyDef } from '../game/src/content/index.js';

const sourceUrl = (module: string) => new URL(`../.baseline/game/src/content/${module}.ts`, import.meta.url);
const read = (module: string) => readFileSync(sourceUrl(module), 'utf8');
const baselineAvailable = [...WILDERNESS_PROGRESSION_MODULES, 'enemies', 'wildernessLoot'].every(module => existsSync(sourceUrl(module)));
const params: WildernessProgressionParams = {
  depth: { south: 460, divide: 700, north: 940 },
  bands: [{ tier: 50, legacyBase: 48, fallbackFloor: 48, fallbackCeiling: 57 },
    { tier: 70, legacyBase: 69, fallbackFloor: 69, fallbackCeiling: 77 }],
  legacyProgressLevels: 8, nativeProgressLevels: 4, legacySourceTierThreshold: 50,
  fallbackTiers: [50, 70, 20, 10, 5, 1],
  marks: { defaultMinimumPerSourceTier: 1, defaultMaximumPerSourceTier: 3, minimumPerTargetTier: 1, maximumPerTargetTier: 2 },
};
const shared: WildernessProgressionDependencies = {
  combatLevel: { rollLevelOffset: 9, bonusDivisor: 100, defenceStyleCount: 2, healthPerLevel: 3,
    offenceWeight: .5, defenceWeight: .25, healthWeight: .25, minimum: 1 },
  tuning: { minimumHealth: 3, minimumLevel: 1, minimumBonus: 0, maximumBonus: 80, maximumBonusScale: 1,
    maxHitExponent: .68, searchInitialLow: 0, searchInitialHigh: 1, searchGrowth: 2, searchIterations: 48, healthPerCombatLevel: 12 },
  keepers: [
    { id: 'ashseal_warden', name: 'Ashseal Warden', tier: 50, multiplier: 3 },
    { id: 'furnace_regent', name: 'Furnace Regent', tier: 50, multiplier: 4 },
    { id: 'chainbound_archon', name: 'Chainbound Archon', tier: 70, multiplier: 3 },
    { id: 'nightforge_marshal', name: 'Nightforge Marshal', tier: 70, multiplier: 4 },
    { id: 'hollow_star', name: 'The Hollow Star', tier: 70, multiplier: 5 },
  ],
  resolveWildernessLoot: () => [],
};
const base = (changes: Partial<EnemyFieldsWithoutDrops> = {}): EnemyFieldsWithoutDrops => ({
  id: 'frog_t5', family: 'frog', name: 'Frog', tier: 5, maxHealth: 15, attackLevel: 5, defenceLevel: 5,
  accuracy: 0, armour: 0, magicArmour: 0, maxHit: 2, attackSpeedMs: 2200, aggroRadius: 5,
  behaviour: 'passive', ...changes,
});
const group = (changes: Partial<WildernessGroupInput> = {}): WildernessGroupInput => ({
  id: 'frog_pack', family: 'frog', name: 'Frog pack', tier: 50, centre: [0, 460], count: 3, ...changes,
});
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
function stripDrops(enemy: EnemyDef): EnemyFieldsWithoutDrops { const { drops, ...stats } = enemy; return stats; }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); for (const entry of Object.values(value)) deepFreeze(entry); }
  return value;
}
function project(groups = [group()], pre = [base()], refs: WildernessSpeciesInput[] = [],
  sources: [string, EnemyFieldsWithoutDrops][] = [], dependencies = shared, p = params) {
  return buildWildernessProgression(p, groups, new Map(pre.map(row => [row.id, row])), refs, new Map(sources), dependencies);
}

describe('pure Wilderness progression and strict inputs', () => {
  it('rejects unknown keys, invalid bands, fractional counts/rewards and duplicate identities', () => {
    expect(parseValue(WildernessProgressionParamsSchema, params, 'params')).toStrictEqual(params);
    expect(() => parseValue(WildernessProgressionParamsSchema, { ...params, groups: [] }, 'params')).toThrow(/unknown/i);
    for (const mutate of [
      (p: WildernessProgressionParams) => { p.depth.divide = p.depth.south; },
      (p: WildernessProgressionParams) => { p.bands[0].fallbackFloor = 58; },
      (p: WildernessProgressionParams) => { p.nativeProgressLevels = .5; },
      (p: WildernessProgressionParams) => { p.marks.minimumPerTargetTier = .5; },
      (p: WildernessProgressionParams) => { p.fallbackTiers = [50, 70, 50, 10, 5, 1]; },
    ]) { const p = structuredClone(params); mutate(p); expect(() => parseValue(WildernessProgressionParamsSchema, p, 'params')).toThrow(); }
    expect(() => parseValue(WildernessGroupInputsSchema, [{ ...group(), radius: 3 }], 'groups')).toThrow(/unknown/i);
    expect(() => parseValue(WildernessGroupInputsSchema, [group({ count: .5 })], 'groups')).toThrow(/integer/);
    expect(() => parseValue(WildernessGroupInputsSchema, [group(), group()], 'groups')).toThrow(/unique/);
    expect(() => parseValue(WildernessSpeciesInputsSchema, [{ id: 'frog', assetId: 'frog', sourceInputId: 'source', stats: {} }], 'refs')).toThrow(/unknown/i);
    expect(parseValue(WildernessLootRequestSchema, { speciesId: 'frog', tier: 50 }, 'request')).toStrictEqual({ speciesId: 'frog', tier: 50 });
    expect(() => parseValue(WildernessLootRequestSchema, { speciesId: 'frog', tier: '50' }, 'request')).toThrow();
    expect(() => parseValue(WildernessLootRequestSchema, { speciesId: 'frog', tier: 50, structureId: 'site' }, 'request')).toThrow(/unknown/i);
  });

  it('clamps depth progress, changes at the divide and preserves native level 78', () => {
    expect([459, 460, 475, 699, 700, 940, 941].map(z => wildernessLevelAt(params, base(), z, shared)))
      .toEqual([48, 48, 49, 56, 69, 77, 77]);
    expect([699, 700, NaN].map(z => wildernessTierAt(params, z))).toEqual([50, 70, 70]);
    const dragon = base({ family: 'purple_dragon', tier: 70, maxHealth: 234, attackLevel: 78, defenceLevel: 78 });
    expect(combatLevel(shared.combatLevel, dragon)).toBe(78);
    expect(wildernessLevelAt(params, dragon, 700, shared)).toBe(78);
    expect(wildernessLevelAt(params, dragon, 940, shared)).toBe(82);
    expect(wildernessLevelAt(params, { ...dragon, tier: 50 }, 700, shared)).toBe(77);
    expect(wildernessLevelAt(params, { ...dragon, family: 'hollow_star' }, 700, shared)).toBe(77);
    expect(() => wildernessLevelAt(params, base(), Infinity, shared)).toThrow(/Invalid Wilderness encounter depth/);
  });

  it('scales marks from source defaults, floors, authored ranges and half ties', () => {
    expect(wildernessMarks(params, base(), 50)).toEqual([50, 150]);
    expect(wildernessMarks(params, base({ tier: 20, marks: [21, 41] }), 50)).toEqual([53, 103]);
    expect(wildernessMarks(params, base({ marks: [0, 1] }), 70)).toEqual([70, 140]);
    expect(wildernessMarks(params, base({ marks: [40, 1] }), 50)).toEqual([400, 400]);
  });

  it('uses matching-asset species for canonical rows and exact group history for aliases', () => {
    const exact = base({ id: 'frog_pack', moveSpeedMps: .2, behaviour: 'aggressive' });
    const ordinary = base({ name: 'First Frog', moveSpeedMps: 1 });
    const matching = base({ name: 'Asset Frog', moveSpeedMps: undefined, respawnSeconds: 123 });
    const requests: WildernessLootRequest[] = [], drops: EnemyDef['drops'] = [{ itemId: 'proof', quantity: [1, 1], chance: 1 }];
    const deps = { ...shared, resolveWildernessLoot: (request: Readonly<WildernessLootRequest>) => { requests.push(request); return drops; } };
    const refs = [{ id: 'z_frog', assetId: 'matching', sourceInputId: 'match' }, { id: 'a_frog', assetId: 'first', sourceInputId: 'ordinary' }];
    const output = project([group({ assetId: 'matching' })], [exact], refs, [['match', matching], ['ordinary', ordinary]], deps);
    expect(output.map(row => row.id)).toEqual(['frog_t50', 'frog_t70', 'frog_pack']);
    expect(output[0]).toMatchObject({ name: 'Asset Frog', respawnSeconds: 123, moveSpeedMps: undefined });
    expect(Object.hasOwn(output[0]!, 'moveSpeedMps')).toBe(true);
    expect(output[2]).toMatchObject({ name: 'Frog pack', moveSpeedMps: .2, behaviour: 'aggressive' });
    expect(Object.hasOwn(output[2]!, 'respawnSeconds')).toBe(false);
    expect(output.every(row => row.drops === drops)).toBe(true);
    expect(requests).toEqual([{ speciesId: 'z_frog', tier: 50 }, { speciesId: 'z_frog', tier: 70 },
      { speciesId: 'z_frog', tier: 50, groupId: 'frog_pack' }]);
    expect(project([group()], [], refs, [['match', matching], ['ordinary', ordinary]])[0]!.name).toBe('First Frog');
  });

  it('preserves family order, southmost representative, id tie breaks and original alias order', () => {
    const groups = [group({ id: 'z_pack', family: 'zebra', name: 'Zebra', centre: [0, 900] }),
      group({ id: 'b_pack', name: 'B', centre: [0, 500] }), group({ id: 'a_pack', name: 'A', centre: [0, 500] })];
    const output = project(groups, [base(), base({ id: 'zebra_t1', family: 'zebra', tier: 1 })]);
    expect(output.map(row => row.id)).toEqual(['frog_t50', 'frog_t70', 'zebra_t50', 'zebra_t70', 'z_pack', 'b_pack', 'a_pack']);
    expect(output[0]!.name).toBe('A');
  });

  it('tries supplied and fallback family tiers in their original order and skips wrong-family entries', () => {
    const wrong = base({ id: 'frog_pack', family: 'wrong', moveSpeedMps: 99 });
    const legacy = base({ id: 'frog_t20', tier: 20, moveSpeedMps: 20 });
    const supplied = base({ id: 'frog_t50', tier: 50, moveSpeedMps: 50 });
    expect(project([group()], [wrong, legacy, supplied])[2]!.moveSpeedMps).toBe(50);
    expect(project([group({ tier: 40 })], [wrong, legacy, supplied])[2]!.moveSpeedMps).toBe(50);
    expect(project([group({ tier: 40 })], [legacy, { ...supplied, family: 'wrong' }])[2]!.moveSpeedMps).toBe(20);
    const p = structuredClone(params); p.fallbackTiers = [50, 70, 5, 10, 20, 1];
    expect(project([group({ tier: 40 })], [legacy, base({ moveSpeedMps: 5 })], [], [], shared, p)[2]!.moveSpeedMps).toBe(5);
  });

  it('rejects missing dependencies, duplicate aliases, canonical collisions and unusable bases', () => {
    expect(() => project([group()], [], [{ id: 'frog', assetId: 'frog', sourceInputId: 'missing' }])).toThrow(/Missing Wilderness species source missing/);
    expect(() => project([group()], [])).toThrow(/Missing Wilderness source for frog_pack/);
    expect(() => project([group(), group()])).toThrow(/Duplicate Wilderness encounter/);
    expect(() => project([group({ id: 'frog_t50' })])).toThrow(/Conflicting Wilderness block id/);
    expect(() => project([group({ centre: [0, NaN] })])).toThrow(/invalid Wilderness family or depth/);
    expect(() => project([group({ family: '' })])).toThrow(/invalid Wilderness family or depth/);
    for (const changes of [{ accuracy: NaN }, { armour: -1 }, { maxHit: Infinity }])
      expect(() => project([group()], [base(changes)])).toThrow(/invalid source/);
    for (const changes of [{ maxHealth: 0 }, { attackLevel: 0 }, { defenceLevel: 0 }, { tier: 0 }])
      expect(() => project([group()], [base(changes)])).toThrow(/needs positive/);
  });

  it('uses shared keeper rows, exact singleton identities and unrounded keeper products', () => {
    const keeper = shared.keepers[0]!, keeperGroup = group({ id: keeper.id, family: keeper.id, count: 1, miniBoss: true });
    const keeperBase = base({ id: `${keeper.id}_t50`, family: keeper.id, tier: 50 });
    const requests: WildernessLootRequest[] = [];
    const deps = { ...shared, keepers: shared.keepers.map(row => row.id === keeper.id ? { ...row, multiplier: 3.01 } : row),
      resolveWildernessLoot: (request: Readonly<WildernessLootRequest>) => { requests.push(request); return []; } };
    const output = project([keeperGroup], [keeperBase], [], [], deps);
    expect(output.map(row => row.id)).toEqual([`${keeper.id}_t50`, keeper.id]);
    expect(output[1]).toMatchObject(tuneCombat(shared.tuning, shared.combatLevel, keeperBase, 50 * 3.01, 50, keeperBase.id));
    expect(requests).toEqual([{ speciesId: keeper.id, tier: 50, keeperId: keeper.id },
      { speciesId: keeper.id, tier: 50, keeperId: keeper.id, groupId: keeper.id }]);
    const pack = project([{ ...keeperGroup, id: 'ordinary_pack', count: 3, miniBoss: false }], [keeperBase]);
    expect(pack).toHaveLength(3);
    expect(combatLevel(shared.combatLevel, pack[2]!)).toBe(48);
    expect(() => project([{ ...keeperGroup, centre: [0, 700] }], [keeperBase])).toThrow(/outside its 50 depth band/);
    expect(() => project([{ ...keeperGroup, count: 2 }], [keeperBase])).toThrow(/one boss or miniboss/);
    expect(() => project([{ ...keeperGroup, miniBoss: false }], [keeperBase])).toThrow(/one boss or miniboss/);
  });

  it('responds to parameters and current authored groups without mutating any dependency', () => {
    const p = deepFreeze(structuredClone(params)), groups = deepFreeze([group({ centre: [0, 580] })]);
    const seed = deepFreeze(base({ marks: [9, 20] })), dependencies = deepFreeze(structuredClone({ ...shared, resolveWildernessLoot: undefined }));
    const deps = { ...dependencies, resolveWildernessLoot: shared.resolveWildernessLoot };
    const first = project(groups, [seed], [], [], deps, p), changed = structuredClone(p);
    changed.legacyProgressLevels = 12; changed.marks.minimumPerTargetTier = 4;
    const next = project(groups, [seed], [], [], deps, changed);
    expect(next[2]!.maxHealth).not.toBe(first[2]!.maxHealth);
    expect(next[2]!.marks![0]).toBe(200);
    expect(project([group({ centre: [0, 900] })], [seed])[2]!.tier).toBe(70);
    expect(seed).toStrictEqual(base({ marks: [9, 20] }));
  });
});

let baseline: M4Baseline, sources: WildernessProgressionSources, extracted: ReturnType<typeof buildWildernessProgressionInputs>;
let originalLoot: (request: Readonly<WildernessLootRequest>) => EnemyDef['drops'];
beforeAll(async () => {
  if (!baselineAvailable) return;
  baseline = await buildM4Baseline();
  sources = Object.fromEntries(WILDERNESS_PROGRESSION_MODULES.map(module => [module, read(module)])) as WildernessProgressionSources;
  extracted = buildWildernessProgressionInputs(baseline, sources);
  // Test-only original loot execution; no loot arrays are inferred from expected progression output.
  const bundle = await build({ stdin: { contents: `import './enemies.ts'; export { wildernessDrops } from './wildernessLoot.ts';
    export { wildernessStructureLootForGroup } from './wildernessEnemyProgression.ts';`,
    resolveDir: fileURLToPath(new URL('../.baseline/game/src/content', import.meta.url)), loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false });
  const original = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`);
  originalLoot = request => original.wildernessDrops(request.speciesId, request.tier, request.keeperId,
    request.groupId === undefined ? undefined : original.wildernessStructureLootForGroup(request.groupId));
});
function baselineFor(changed: WildernessProgressionSources): M4Baseline {
  const copy = structuredClone(baseline);
  for (const module of WILDERNESS_PROGRESSION_MODULES) copy.source.files.find(row => row.path === `.baseline/game/src/content/${module}.ts`)!.sha256
    = createHash('sha256').update(changed[module]).digest('hex');
  return copy;
}

describe.skipIf(!baselineAvailable)('original Wilderness progression extraction and parity', () => {
  it('extracts only formula operands and a source manifest, with no spatial or output seeds', () => {
    expect(extracted.params).toStrictEqual(params);
    expect(Object.keys(extracted)).toEqual(['params', 'manifest']);
    expect(extracted.manifest.sources).toHaveLength(2);
    expect(extracted.manifest.parameters.map(row => row.parameterPath)).toContain('marks');
    expect(JSON.stringify(extracted)).not.toMatch(/preWilderness|attackLevel|centre|footprint|resource|stats/);
  });

  it('matches all 130 ordered original outputs, 57 canonical rows, 73 aliases and 18 overwrites', () => {
    const probe = baseline.functions.find(row => row.module === 'wildernessEnemyProgression' && row.name === 'buildWildernessEnemyProgression')!.probes[0]!;
    const [originalGroups, lookup, originalSpecies] = restore(probe.args) as [
      (WildernessGroupInput & Record<string, unknown>)[], { rows: EnemyDef[] }, { id: string; assetId: string; stats: EnemyDef }[]];
    // These are independent baseline acceptance inputs, never persisted migration data.
    const groups = originalGroups.map(({ id, family, name, tier, centre, count, assetId, boss, miniBoss }) =>
      ({ id, family, name, tier, centre, count, ...(assetId === undefined ? {} : { assetId }),
        ...(boss === undefined ? {} : { boss }), ...(miniBoss === undefined ? {} : { miniBoss }) }));
    const pre = new Map(lookup.rows.map(row => [row.id, stripDrops(row)]));
    const refs = originalSpecies.map((row, index) => ({ id: row.id, assetId: row.assetId, sourceInputId: `oracle/source/${index}` }));
    const resolvedSources = new Map(originalSpecies.map((row, index) => [`oracle/source/${index}`, stripDrops(row.stats)]));
    const originalKeepers = restore(baseline.constants.find(row => row.module === 'wildernessDepth' && row.name === 'WILDERNESS_RUNE_KEEPERS')!.value) as (typeof shared.keepers[number] & { rune: string })[];
    const keepers = parseValue(WildernessKeeperRowsSchema, originalKeepers.map(({ rune, ...row }) => row), 'keepers');
    parseValue(WildernessGroupInputsSchema, groups, 'groups'); parseValue(WildernessSpeciesInputsSchema, refs, 'refs');
    const result = buildWildernessProgression(extracted.params, groups, pre, refs, resolvedSources,
      { ...shared, keepers, resolveWildernessLoot: originalLoot });
    expect(probe.result.kind).toBe('return');
    if (probe.result.kind !== 'return') throw new Error('Expected original progression result');
    expect(result).toStrictEqual(restore(probe.result.value));
    expect(result).toStrictEqual(baseline.original.wildernessBlocks);
    expect(result).toHaveLength(130); expect(groups).toHaveLength(73);
    const canonical = result.filter(row => row.id === `${row.family}_t${row.tier}`);
    expect(canonical).toHaveLength(57); expect(canonical.filter(row => pre.has(row.id))).toHaveLength(18);
    expect(result.slice(57).map(row => row.id)).toEqual(groups.map(row => row.id));
  });

  it('matches every original depth helper probe, including dragons and keeper-family reuse', () => {
    const probes = baseline.functions.find(row => row.module === 'wildernessEnemyProgression' && row.name === 'wildernessEnemyLevelAt')!.probes;
    expect(probes.length).toBeGreaterThanOrEqual(42);
    for (const probe of probes) {
      const [seed, z] = restore(probe.args) as [EnemyDef, number];
      if (probe.result.kind !== 'return') throw new Error('Expected original level result');
      expect(wildernessLevelAt(extracted.params, seed, z, shared), probe.label).toBe(restore(probe.result.value));
    }
  });

  it('rejects stale sources and unsupported arithmetic, lookup, or ordering changes', () => {
    const stale = { ...sources, wildernessEnemyProgression: sources.wildernessEnemyProgression.replace('progress * 8', 'progress * 9') };
    expect(() => buildWildernessProgressionInputs(baseline, stale)).toThrow(/source hash/);
    for (const [from, to] of [['Math.round(progress * 8)', 'Math.floor(progress * 8)'],
      ['supplied : species?.stats', 'species?.stats : supplied'], ['a.id.localeCompare(b.id)', 'b.id.localeCompare(a.id)']]) {
      const changed = { ...sources, wildernessEnemyProgression: sources.wildernessEnemyProgression.replace(from!, to!) };
      expect(changed.wildernessEnemyProgression).not.toBe(sources.wildernessEnemyProgression);
      expect(() => buildWildernessProgressionInputs(baselineFor(changed), changed)).toThrow(/Unsupported/);
    }
  });

  it('extracts changed literal operands independently of recorded output values', () => {
    const changed = { ...sources, wildernessDepth: sources.wildernessDepth.replace('south: 460', 'south: 450'),
      wildernessEnemyProgression: sources.wildernessEnemyProgression.replace('progress * 8', 'progress * 10')
        .replace('progress * 4', 'progress * 6').replace('tier * 2,', 'tier * 4,').replace('[20, 10, 5, 1]', '[10, 20, 5, 1]') };
    const next = buildWildernessProgressionInputs(baselineFor(changed), changed);
    expect(next.params.depth.south).toBe(450); expect(next.params.legacyProgressLevels).toBe(10);
    expect(next.params.nativeProgressLevels).toBe(6); expect(next.params.marks.maximumPerTargetTier).toBe(4);
    expect(next.params.fallbackTiers).toEqual([50, 70, 10, 20, 5, 1]);
    expect(wildernessMarks(next.params, base(), 50)).toEqual([50, 200]);
  });
});
