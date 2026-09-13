import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { deriveCoreEnemy, type EnemySourceParams, type EnemySourceInput, type RpgSourceInput } from '../game/src/content/balance/enemySources.js';
import { SourceInputSchema, SourceInputsSchema, SourceParamsSchema } from '../game/src/content/schema/enemySources.js';
import { parseValue } from '../game/src/content/schema/core.js';
import type { EnemyDef } from '../game/src/content/index.js';

// Literal arithmetic operands from the three original factory bodies, independent of mutable JSON.
const params: EnemySourceParams = {
  expansion: { marksPerTier: [2, 6] },
  starter: { tier: 1, attackLevel: 2, defenceLevel: 1, accuracy: 4, magicArmour: 0, maxHit: 2,
    attackSpeedMs: 2400, aggroRadius: { aggressive: 5, other: 3 }, walkSpeedCap: .4,
    walkSpeedDivisor: 3, marks: [1, 3] },
  rpg: {
    healthBase: 8, healthPerTier: 2.2, maxHitMinimum: 2, maxHitPerTier: .45,
    roles: {
      skirmisher: { healthMultiplier: 1, attackLevelOffset: 2, defenceLevelOffset: 0, accuracy: 12,
        armour: 10, maxHitOffset: 1, attackSpeedMs: 2000, aggroRadius: 10, moveSpeedMps: 1.6 },
      fighter: { healthMultiplier: 1, attackLevelOffset: 2, defenceLevelOffset: 0, accuracy: 6,
        armour: 10, maxHitOffset: 1, attackSpeedMs: 2400, aggroRadius: 7, moveSpeedMps: 1.6 },
      brute: { healthMultiplier: 1.4, attackLevelOffset: 6, defenceLevelOffset: 0, accuracy: 6,
        armour: 16, maxHitOffset: 4, attackSpeedMs: 3400, aggroRadius: 7, moveSpeedMps: 1.2 },
      caster: { healthMultiplier: .8, attackLevelOffset: 2, defenceLevelOffset: 0, accuracy: 16,
        armour: 3, maxHitOffset: 1, attackSpeedMs: 2800, aggroRadius: 7, moveSpeedMps: 1.6 },
      guard: { healthMultiplier: 1.2, attackLevelOffset: 2, defenceLevelOffset: 4, accuracy: 6,
        armour: 45, maxHitOffset: 1, attackSpeedMs: 3000, aggroRadius: 7, moveSpeedMps: 1.3 },
    },
    magicArmour: { caster: 55, golem: 5, other: 15 }, attackRangeM: { melee: 1.8, ranged: 10, magic: 8 },
    rangedActions: ['bow shot'], magicActions: ['staff curse', 'lament'], territorialFamilies: ['golem', 'gargoyle'],
    walkSpeedMps: .4, marksMinimum: [1, 3], marksPerTier: [1, 3],
  },
};

interface PublicSource { id: string; stats: EnemyDef }
interface Fixture { kind: EnemySourceInput['kind']; inputs: EnemySourceInput[]; outputs: PublicSource[] }
const fixtures: Fixture[] = [];

// Execute the immutable, trusted original module in memory. Its only runtime import is
// enemyCombatLevel, referenced by an uncalled reporting helper. No game loader is involved.
async function evaluate<T>(source: string, expression: string): Promise<T> {
  const isolated = source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  const result = await transform(`${isolated}\nreturn ${expression};`, { loader: 'ts', target: 'es2022' });
  return new Function(result.code)() as T;
}
function replaceFactory(source: string, name: string, endMarker: string, replacement: string): string {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`Original ${name} factory boundaries changed`);
  return source.slice(0, start) + replacement + '\n' + source.slice(end);
}
const captureExpansion = `function species(speciesId, regionId, activity, description, stats) {
  const {name,tier,drops,...authored}=stats;
  return {id:speciesId, input:{id:'expansion/'+speciesId,kind:'expansion',
    identity:{enemyId:speciesId+'_t'+tier,family:speciesId,name,tier},authored}};
}`;
const captureStarter = `function small(speciesId,name,assetId,scale,health,behaviour,activity,loot,description,armour=0,moveSpeedMps=1.6) {
  return {id:speciesId,input:{id:'starter/'+speciesId,kind:'starter',speciesId,name,health,behaviour,armour,moveSpeedMps}};
}`;
const captureRpg = `function entry([speciesId,name,bodyFamily,regionId,tier,role,action,habitat]) {
  return {id:speciesId,input:{id:'rpg/'+speciesId,kind:'rpg',speciesId,name,bodyFamily,regionId,tier,role,action}};
}`;

beforeAll(async () => {
  for (const [kind, file, factory, end, capture, expression] of [
    ['expansion', 'creatureExpansion', 'species', '/**', captureExpansion, 'CREATURE_EXPANSION'],
    ['starter', 'starterCreatures', 'small', 'export const', captureStarter, 'STARTER_CREATURES'],
    ['rpg', 'rpgBestiary', 'entry', '/** Staged', captureRpg, '[...RPG_BESTIARY,...RPG_BESTIARY_STAGED]'],
  ] as const) {
    const original = await readFile(new URL(`../.baseline/game/src/content/${file}.ts`, import.meta.url), 'utf8');
    const outputs = await evaluate<PublicSource[]>(original, expression);
    const calls = await evaluate<{ input: EnemySourceInput }[]>(replaceFactory(original, factory, end, capture), expression);
    const inputs = parseValue(SourceInputsSchema, calls.map(row => row.input), `sourceInputs.${kind}`);
    fixtures.push({ kind, inputs, outputs });
  }
});

describe('original expansion, starter and RPG enemy sources', () => {
  it('validates the original explicit arithmetic parameters', () => {
    expect(parseValue(SourceParamsSchema, params, 'sourceParams')).toEqual(params);
  });

  it('matches all 56 original public factory outputs from independently captured arguments', () => {
    expect(fixtures.map(f => [f.kind, f.inputs.length])).toEqual([['expansion', 24], ['starter', 7], ['rpg', 25]]);
    for (const fixture of fixtures) {
      expect(fixture.outputs).toHaveLength(fixture.inputs.length);
      fixture.inputs.forEach((input, index) => {
        const { drops, ...expected } = fixture.outputs[index]!.stats;
        expect(deriveCoreEnemy(params, input), input.id).toStrictEqual(expected);
      });
    }
  });

  it('preserves absent optional fields and authored optional values', () => {
    const starter = fixtures[1]!.inputs[0]!;
    const generated = deriveCoreEnemy(params, starter);
    for (const field of ['drops', 'respawnSeconds', 'attackStyle', 'attackRangeM']) expect(Object.hasOwn(generated, field)).toBe(false);
    const expansion = fixtures[0]!.inputs[0]!;
    if (expansion.kind !== 'expansion') throw new Error('wrong fixture');
    const authored = { ...expansion.authored, attackStyle: 'magic' as const, attackRangeM: 8, respawnSeconds: 0 };
    expect(deriveCoreEnemy(params, { ...expansion, authored })).toMatchObject({ attackStyle: 'magic', attackRangeM: 8, respawnSeconds: 0 });
  });

  it('retains caster armour priority, action priority and role-independent behaviour', () => {
    const input: RpgSourceInput = { id: 'rpg/probe', kind: 'rpg', speciesId: 'probe', name: 'Probe',
      bodyFamily: 'golem', regionId: 'vellenwood', tier: 5, role: 'caster', action: 'bow shot' };
    const p = structuredClone(params);
    p.rpg.magicActions.push('bow shot');
    expect(deriveCoreEnemy(p, input)).toMatchObject({ magicArmour: 55, behaviour: 'territorial', attackStyle: 'ranged', attackRangeM: 10 });
    expect(deriveCoreEnemy(p, { ...input, role: 'fighter' })).toMatchObject({ magicArmour: 5 });
    expect(deriveCoreEnemy(p, { ...input, bodyFamily: 'gargoyle', role: 'fighter', action: 'lament' }))
      .toMatchObject({ magicArmour: 15, behaviour: 'territorial', attackStyle: 'magic', attackRangeM: 8 });
  });

  it('responds to source and parameter changes without mutating inputs or previous results', () => {
    const saved = structuredClone(params);
    for (const fixture of fixtures) {
      const input = structuredClone(fixture.inputs[0]!);
      const before = deriveCoreEnemy(params, input);
      const p = structuredClone(params);
      if (input.kind === 'expansion') { p.expansion.marksPerTier = [4, 12]; input.authored.maxHealth += 3; }
      if (input.kind === 'starter') { p.starter.walkSpeedCap = .1; p.starter.marks = [2, 4]; input.health += 3; }
      if (input.kind === 'rpg') { p.rpg.roles[input.role].healthMultiplier *= 2; p.rpg.marksPerTier = [2, 6]; }
      const after = deriveCoreEnemy(p, input);
      expect(after.maxHealth).toBeGreaterThan(before.maxHealth);
      expect(after.marks).not.toEqual(before.marks);
      expect(deriveCoreEnemy(params, fixture.inputs[0]!)).toStrictEqual(before);
    }
    expect(params).toStrictEqual(saved);
  });

  it('uses Math.round half ties and configurable minimums and walk division', () => {
    const input: RpgSourceInput = { id: 'rpg/probe', kind: 'rpg', speciesId: 'probe', name: 'Probe',
      bodyFamily: 'goblin', regionId: 'fallowmarch', tier: 1, role: 'fighter', action: 'strike' };
    const p = structuredClone(params);
    p.rpg.healthBase = 1; p.rpg.healthPerTier = 1.5; p.rpg.maxHitPerTier = 1.5;
    p.rpg.marksMinimum = [4, 8];
    expect(deriveCoreEnemy(p, input)).toMatchObject({ maxHealth: 3, maxHit: 3, marks: [4, 8] });
    p.starter.walkSpeedDivisor = 6;
    const crab = fixtures[1]!.inputs.find(row => row.id === 'starter/creek_crab')!;
    expect(deriveCoreEnemy(p, crab).walkSpeedMps).toBe(.6 / 6);
  });

  it('rejects unknown fields, missing operands, invalid values and duplicate input ids', () => {
    for (const fixture of fixtures) {
      const input = fixture.inputs[0]!;
      expect(() => parseValue(SourceInputSchema, { ...input, override: {} }, 'input')).toThrow(/unknown/i);
      expect(() => parseValue(SourceInputsSchema, [input, input], 'inputs')).toThrow(/unique/);
    }
    const expansion = fixtures[0]!.inputs[0]!;
    if (expansion.kind !== 'expansion') throw new Error('wrong fixture');
    for (const field of ['id', 'name', 'family', 'tier', 'marks', 'drops']) {
      expect(() => parseValue(SourceInputSchema, { ...expansion, authored: { ...expansion.authored, [field]: 1 } }, 'input')).toThrow(/unknown/i);
    }
    expect(() => parseValue(SourceParamsSchema, { ...params, unknown: 1 }, 'params')).toThrow(/unknown/i);
    const badRole = structuredClone(params);
    Object.assign(badRole.rpg.roles.guard, { surprise: 2 });
    expect(() => parseValue(SourceParamsSchema, badRole, 'params')).toThrow(/unknown/i);
    const missingRole = structuredClone(params);
    Reflect.deleteProperty(missingRole.rpg.roles, 'guard');
    expect(() => parseValue(SourceParamsSchema, missingRole, 'params')).toThrow();
    const badDivisor = structuredClone(params); badDivisor.starter.walkSpeedDivisor = 0;
    expect(() => parseValue(SourceParamsSchema, badDivisor, 'params')).toThrow();
    const duplicate = structuredClone(params); duplicate.rpg.rangedActions.push('bow shot');
    expect(() => parseValue(SourceParamsSchema, duplicate, 'params')).toThrow(/unique/);
    expect(() => parseValue(SourceInputSchema, { ...fixtures[2]!.inputs[0], regionId: 'invented' }, 'input')).toThrow();
  });

  it('rejects fractional bonuses copied directly into integer enemy fields', () => {
    const starter = fixtures[1]!.inputs[0]!;
    expect(() => parseValue(SourceInputSchema, { ...starter, armour: .5 }, 'input')).toThrow(/integer/);
    for (const field of ['accuracy', 'magicArmour'] as const) {
      const p = structuredClone(params); p.starter[field] = .5;
      expect(() => parseValue(SourceParamsSchema, p, 'params'), `starter.${field}`).toThrow(/integer/);
    }
    for (const role of ['skirmisher', 'fighter', 'brute', 'caster', 'guard'] as const) {
      for (const field of ['accuracy', 'armour'] as const) {
        const p = structuredClone(params); p.rpg.roles[role][field] = .5;
        expect(() => parseValue(SourceParamsSchema, p, 'params'), `rpg.roles.${role}.${field}`).toThrow(/integer/);
      }
    }
    for (const profile of ['caster', 'golem', 'other'] as const) {
      const p = structuredClone(params); p.rpg.magicArmour[profile] = .5;
      expect(() => parseValue(SourceParamsSchema, p, 'params'), `rpg.magicArmour.${profile}`).toThrow(/integer/);
    }
    const roundedOperand = structuredClone(params); roundedOperand.rpg.roles.fighter.maxHitOffset = .5;
    expect(parseValue(SourceParamsSchema, roundedOperand, 'params')).toStrictEqual(roundedOperand);
  });

  it('requires every RPG role to round to positive health at the minimum input tier', () => {
    for (const role of ['skirmisher', 'fighter', 'brute', 'caster', 'guard'] as const) {
      const p = structuredClone(params); p.rpg.roles[role].healthMultiplier = .01;
      expect(() => parseValue(SourceParamsSchema, p, 'params'), role).toThrow(/positive health at tier 1/);
    }
    const p = structuredClone(params); p.rpg.healthBase = .25; p.rpg.healthPerTier = .25;
    for (const role of Object.values(p.rpg.roles)) role.healthMultiplier = 1;
    expect(parseValue(SourceParamsSchema, p, 'params')).toStrictEqual(p);
    const input: RpgSourceInput = { id: 'rpg/probe', kind: 'rpg', speciesId: 'probe', name: 'Probe',
      bodyFamily: 'goblin', regionId: 'fallowmarch', tier: 1, role: 'fighter', action: 'strike' };
    expect(deriveCoreEnemy(p, input).maxHealth).toBe(1);
    p.rpg.healthBase = .24;
    expect(() => parseValue(SourceParamsSchema, p, 'params')).toThrow(/positive health at tier 1/);
  });
});
