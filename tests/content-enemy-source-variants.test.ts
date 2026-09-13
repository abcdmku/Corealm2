import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { transform } from 'esbuild';
import { buildVariantEnemySources, VARIANT_SOURCE_MODULES, type VariantEnemySources } from '../tools/content/enemy-source-variant-inputs.js';
import { buildCoreEnemySources, type CoreEnemySources } from '../tools/content/enemy-source-inputs.js';
import { buildM4Baseline, type M4Baseline, type Snapshot } from '../tools/content/m4-baseline.js';
import { deriveCoreEnemy, type EnemyFieldsWithoutDrops } from '../game/src/content/balance/enemySources.js';
import { deriveVariantEnemy, scaleFantasy } from '../game/src/content/balance/enemySourceVariants.js';
import { FantasyParamsSchema, VariantEnemySourceInputSchema, VariantParamsSchema, VariantSourceInputsSchema } from '../game/src/content/schema/enemySourceVariants.js';
import { parseValue } from '../game/src/content/schema/core.js';
import type { EnemyDef } from '../game/src/content/index.js';

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
const read = (module: string) => readFileSync(new URL(`../.baseline/game/src/content/${module}.ts`, import.meta.url), 'utf8');
let baseline: M4Baseline, sources: VariantEnemySources, core: ReturnType<typeof buildCoreEnemySources>;
let extracted: ReturnType<typeof buildVariantEnemySources>;
const bases = new Map<string, EnemyFieldsWithoutDrops>();
let originalScale: (source: EnemyDef, tier: number) => EnemyDef;
function originalRows(module: string, name: string): { id: string; stats: EnemyDef }[] {
  const value = baseline.constants.find(row => row.module === module && row.name === name)!.value;
  return restore(value) as { id: string; stats: EnemyDef }[];
}
function baselineFor(changed: VariantEnemySources): M4Baseline {
  const copy = structuredClone(baseline);
  for (const module of VARIANT_SOURCE_MODULES) copy.source.files.find(row => row.path === `.baseline/game/src/content/${module}.ts`)!.sha256
    = createHash('sha256').update(changed[module]).digest('hex');
  return copy;
}
const baselineAvailable = existsSync(new URL('../.baseline/game/src/content/enemies.ts', import.meta.url));
beforeAll(async () => {
  if (!baselineAvailable) return;
  baseline = await buildM4Baseline();
  sources = Object.fromEntries(VARIANT_SOURCE_MODULES.map(module => [module, read(module)])) as unknown as VariantEnemySources;
  const coreSources: CoreEnemySources = { creatureExpansion: read('creatureExpansion'), starterCreatures: read('starterCreatures'), rpgBestiary: read('rpgBestiary') };
  core = buildCoreEnemySources(baseline, coreSources);
  for (const input of core.inputs) bases.set(input.id, deriveCoreEnemy(core.params, input));
  extracted = buildVariantEnemySources(baseline, sources, core.inputs);
  // The expected helper is the actual original map callback, compiled in memory for edge probes.
  const start = sources.enemies.indexOf('    const base = species.stats;', sources.enemies.indexOf('export const FANTASY_TIER_BLOCKS'));
  const end = sources.enemies.indexOf('  }));', start);
  const identityStart = sources.enemies.indexOf('export function enemyIdFor(');
  const identityEnd = sources.enemies.indexOf('\n}', identityStart) + 2;
  const code = sources.enemies.slice(identityStart, identityEnd).replace('export ', '')
    + '\nfunction scale(species, tier) {\n' + sources.enemies.slice(start, end) + '\n}\nreturn scale;';
  const compiled = await transform(code, { loader: 'ts' });
  const reference = new Function(compiled.code)() as (species: { stats: EnemyDef }, tier: number) => EnemyDef;
  originalScale = (source, tier) => reference({ stats: source }, tier);
});

describe.skipIf(!baselineAvailable)('variant and redesign source extraction', () => {
  it('extracts 23 original inputs and 15 ordered fantasy dependencies with hash provenance', () => {
    expect(extracted.inputs).toHaveLength(23);
    expect(extracted.inputs.filter(input => input.kind === 'variant')).toHaveLength(5);
    expect(extracted.inputs.filter(input => input.kind === 'redesign')).toHaveLength(18);
    expect(extracted.sourceInputIds).toEqual([
      'forest/briar_harrow', 'forest/fen_crawler', 'forest/reed_strider', 'forest/thorn_maw', 'forest/heath_jack',
      'stone/cairn_treader', 'stone/flint_mandible', 'stone/vault_custodian', 'stone/blind_cave_weaver', 'stone/scree_watcher',
      'ash/kiln_marrow', 'ash/slag_crawler', 'ash/cinder_penitent', 'ash/grave_lantern', 'ash/veil_reaper',
    ]);
    expect(extracted.params).toEqual({ variant: { magicArmourBonus: 12 }, redesign: { ash: { attackStyle: 'melee' } } });
    expect(extracted.fantasy).toEqual({ tiers: [1, 5, 10, 20], minimums: {
      maxHealth: 1, attackLevel: 1, defenceLevel: 1, accuracy: 0, armour: 0, magicArmour: 0, maxHit: 1, marks: 0,
    } });
    expect(extracted.manifest.rows).toHaveLength(23);
    expect(extracted.manifest.sources).toHaveLength(6);
    for (const file of extracted.manifest.sources) expect({ path: file.path, sha256: file.sha256 })
      .toEqual(baseline.source.files.find(row => row.path === file.path));
  });

  it('replays all 23 original public source outputs from the core input graph', () => {
    for (const input of extracted.inputs) {
      const origin = extracted.manifest.rows.find(row => row.inputId === input.id)!;
      const { drops, ...expected } = originalRows(origin.module, origin.catalog).find(row => row.id === input.speciesId)!.stats;
      const base = bases.get(input.sourceInputId)!;
      expect(deriveVariantEnemy(extracted.params, input, base), input.id).toStrictEqual(expected);
    }
  });

  it('preserves original forced choices and native source levels without retuning', () => {
    const byId = new Map(extracted.inputs.map(input => [input.id, input]));
    expect(byId.get('basic/chalk_warden')).toMatchObject({ tier: 10, behaviour: 'territorial', sourceInputId: 'rpg/shale_elemental' });
    expect(byId.get('basic/hollow_bough')).toMatchObject({ tier: 10, behaviour: 'aggressive' });
    expect(byId.get('stone/vault_custodian')).toMatchObject({ tier: 10, behaviour: 'aggressive', sourceInputId: 'rpg/iron_golem' });
    expect(byId.get('ash/kiln_marrow')).toMatchObject({ tier: 20, behaviour: 'territorial', attackRangeM: 2.1 });
    expect(byId.get('ash/slag_crawler')).toMatchObject({ tier: 10, behaviour: 'aggressive', attackRangeM: 1.8 });
    const input = byId.get('forest/heath_jack')!, base = bases.get(input.sourceInputId)!;
    const output = deriveVariantEnemy(extracted.params, input, base);
    expect(base.tier).toBe(1); expect(output.tier).toBe(10);
    expect(output.attackLevel).toBe(base.attackLevel); expect(output.marks).toBe(base.marks);
  });

  it('preserves missing inherited optional fields and leaves frozen dependencies unchanged', () => {
    const base = { ...bases.get('rpg/webweaver_spider')! };
    for (const key of ['marks', 'attackStyle', 'attackRangeM', 'moveSpeedMps', 'walkSpeedMps', 'respawnSeconds'] as const) delete base[key];
    const saved = structuredClone(base); Object.freeze(base);
    for (const id of ['variant/moonweave_spider', 'forest/fen_crawler', 'ash/slag_crawler']) {
      const input = extracted.inputs.find(row => row.id === id)!;
      const output = deriveVariantEnemy(extracted.params, Object.freeze(input), base);
      for (const key of ['marks', 'moveSpeedMps', 'walkSpeedMps', 'respawnSeconds']) expect(Object.hasOwn(output, key)).toBe(false);
      if (input.kind === 'redesign' && input.profile === 'ash') expect(output).toMatchObject({ attackStyle: 'melee', attackRangeM: 1.8 });
      else {
        expect(Object.hasOwn(output, 'attackStyle')).toBe(false);
        expect(Object.hasOwn(output, 'attackRangeM')).toBe(false);
      }
    }
    expect(base).toStrictEqual(saved);
  });

  it('rejects missing, ambiguous and duplicate source dependencies', () => {
    expect(() => buildVariantEnemySources(baseline, sources, core.inputs.filter(row => row.id !== 'rpg/beetle_golem'))).toThrow(/Missing source dependency beetle_golem/);
    expect(() => buildVariantEnemySources(baseline, sources, [...core.inputs, core.inputs[0]!])).toThrow(/Duplicate core dependency/);
    const input = extracted.inputs[0]!;
    expect(() => deriveVariantEnemy(extracted.params, input, undefined as unknown as EnemyFieldsWithoutDrops)).toThrow(input.sourceInputId);
  });

  it('rejects stale hashes and unsupported formula changes even with updated hashes', () => {
    const stale = { ...sources, regionalCreatureVariants: sources.regionalCreatureVariants.replace('+ 12', '+ 13') };
    expect(() => buildVariantEnemySources(baseline, stale, core.inputs)).toThrow(/source hash/);
    const changed = { ...sources, regionalCreatureVariants: sources.regionalCreatureVariants.replace('+ 12', '* 12') };
    expect(() => buildVariantEnemySources(baselineFor(changed), changed, core.inputs)).toThrow(/variant magic armour/);
    const fantasyChanged = { ...sources, enemies: sources.enemies.replace('Math.round(value * ratio)', 'Math.floor(value * ratio)') };
    expect(() => buildVariantEnemySources(baselineFor(fantasyChanged), fantasyChanged, core.inputs)).toThrow(/fantasy scaling/);
    const overridden = { ...sources, stoneCreatureRedesigns: sources.stoneCreatureRedesigns.replace('maxHealth: row.health,', 'accuracy: 999, maxHealth: row.health,') };
    expect(() => buildVariantEnemySources(baselineFor(overridden), overridden, core.inputs)).toThrow(/stone stats fields/);
  });

  it('extracts changed source literals and parameters without consulting stored stats', () => {
    const changed = { ...sources, regionalCreatureVariants: sources.regionalCreatureVariants.replace('+ 12', '+ 20'),
      forestCreatureRedesigns: sources.forestCreatureRedesigns.replace('health: 64', 'health: 71'),
      ashCreatureRedesigns: sources.ashCreatureRedesigns.replace('? 2.1 : 1.8', '? 2.6 : 1.9'),
      enemies: sources.enemies.replace('maxHealth: scaled(base.maxHealth, 1)', 'maxHealth: scaled(base.maxHealth, 3)') };
    const next = buildVariantEnemySources(baselineFor(changed), changed, core.inputs);
    expect(next.params.variant.magicArmourBonus).toBe(20);
    expect(next.inputs.find(row => row.id === 'forest/briar_harrow')).toMatchObject({ health: 71 });
    expect(next.inputs.find(row => row.id === 'ash/kiln_marrow')).toMatchObject({ attackRangeM: 2.6 });
    expect(next.fantasy.minimums.maxHealth).toBe(3);
    const input = extracted.inputs[0]!, base = bases.get(input.sourceInputId)!;
    expect(deriveVariantEnemy(next.params, input, base).magicArmour - deriveVariantEnemy(extracted.params, input, base).magicArmour).toBe(8);
  });

  it('rejects unknown keys, absent ash ranges, extra non-ash overrides and fractional minima', () => {
    for (const input of extracted.inputs) {
      expect(() => parseValue(VariantEnemySourceInputSchema, { ...input, surprise: 1 }, 'input')).toThrow(/unknown/i);
      expect(() => parseValue(VariantSourceInputsSchema, [input, input], 'inputs')).toThrow(/unique/);
      if (input.kind === 'redesign' && input.profile !== 'ash') {
        expect(() => parseValue(VariantEnemySourceInputSchema, { ...input, attackRangeM: 2 }, 'input')).toThrow();
      }
    }
    const ash = { ...extracted.inputs.find(row => row.kind === 'redesign' && row.profile === 'ash')! };
    Reflect.deleteProperty(ash, 'attackRangeM');
    expect(() => parseValue(VariantEnemySourceInputSchema, ash, 'input')).toThrow();
    expect(() => parseValue(VariantParamsSchema, { ...extracted.params, override: 1 }, 'params')).toThrow(/unknown/i);
    expect(() => parseValue(VariantParamsSchema, { ...extracted.params, variant: { magicArmourBonus: .5 } }, 'params')).toThrow(/integer/);
    for (const key of Object.keys(extracted.fantasy.minimums)) {
      expect(() => parseValue(FantasyParamsSchema, { ...extracted.fantasy, minimums: { ...extracted.fantasy.minimums, [key]: .5 } }, 'fantasy')).toThrow(/integer/);
    }
  });
});

describe.skipIf(!baselineAvailable)('fantasy scaling from original redesign dependencies', () => {
  it('replays all 60 original fantasy rows and preserves the 15 native identities', () => {
    const outputSnapshot = baseline.constants.find(row => row.module === 'enemies' && row.name === 'FANTASY_TIER_BLOCKS')!;
    const expected = restore(outputSnapshot.value) as EnemyDef[];
    const outputs: EnemyDef[] = []; let native = 0;
    for (const id of extracted.sourceInputIds) {
      const input = extracted.inputs.find(row => row.id === id)!;
      const origin = extracted.manifest.rows.find(row => row.inputId === id)!;
      const original = originalRows(origin.module, origin.catalog).find(row => row.id === input.speciesId)!;
      const source = { ...deriveVariantEnemy(extracted.params, input, bases.get(input.sourceInputId)!), drops: original.stats.drops };
      for (const tier of extracted.fantasy.tiers) {
        const output = scaleFantasy(extracted.fantasy, source, tier); outputs.push(output);
        expect(output.drops).toBe(source.drops);
        if (tier === source.tier) { native++; expect(output).toBe(source); }
      }
    }
    expect(native).toBe(15); expect(outputs).toHaveLength(60); expect(outputs).toStrictEqual(expected);
  });

  it('matches the original callback for rounding, minima, unusual tiers and missing marks', () => {
    const source: EnemyDef = { id: 'probe_t10', family: 'probe', name: 'Probe', tier: 10,
      maxHealth: 25, attackLevel: 5, defenceLevel: 1, accuracy: 1, armour: 5, magicArmour: 0,
      maxHit: 5, attackSpeedMs: 2400, aggroRadius: 5, behaviour: 'passive', drops: [], marks: [5, 15],
      attackStyle: 'magic', attackRangeM: 8, moveSpeedMps: 1.5, walkSpeedMps: .3, respawnSeconds: 0 };
    for (const marks of [[5, 15] as [number, number], [0, 0] as [number, number], undefined]) {
      const probe = { ...source, marks }; if (marks === undefined) delete probe.marks;
      for (const tier of [-1, 0, .5, 1, 5, 10, 20, 30]) {
        const output = scaleFantasy(extracted.fantasy, probe, tier);
        expect(output, `tier ${tier}`).toStrictEqual(originalScale(probe, tier));
        expect(output.drops).toBe(probe.drops);
        if (tier === probe.tier) expect(output).toBe(probe);
        else { expect(output).not.toBe(probe); expect(Object.hasOwn(output, 'marks')).toBe(true); }
      }
    }
    expect(scaleFantasy(extracted.fantasy, source, 1)).toMatchObject({ maxHealth: 3, attackLevel: 1, armour: 1, marks: [1, 2] });
  });

  it('applies changed minima after rounding while leaving native results and inputs intact', () => {
    const source: EnemyDef = { ...bases.get('rpg/goblin_scout')!, drops: [] };
    const copy = structuredClone(source), p = structuredClone(extracted.fantasy);
    p.minimums.maxHealth = 50; p.minimums.accuracy = 30; p.minimums.marks = 20;
    expect(scaleFantasy(p, source, source.tier)).toBe(source);
    expect(scaleFantasy(p, source, 5)).toMatchObject({ maxHealth: 50, accuracy: 60, marks: [20, 20] });
    expect(source).toStrictEqual(copy);
  });
});
