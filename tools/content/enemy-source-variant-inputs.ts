/** Extract original variant, redesign and fantasy literals without executing game source. */
import { createHash } from 'node:crypto';
import { parseValue } from '../../game/src/content/schema/core.js';
import { FantasyParamsSchema, VariantParamsSchema, VariantSourceInputsSchema } from '../../game/src/content/schema/enemySourceVariants.js';
import type { EnemySourceInput } from '../../game/src/content/schema/enemySources.js';
import type { M4Baseline } from './m4-baseline.js';

export interface VariantEnemySources {
  regionalCreatureVariants: string; creatureRedesign: string; forestCreatureRedesigns: string;
  ashCreatureRedesigns: string; stoneCreatureRedesigns: string; enemies: string;
}
export const VARIANT_SOURCE_MODULES = ['regionalCreatureVariants', 'creatureRedesign', 'forestCreatureRedesigns',
  'ashCreatureRedesigns', 'stoneCreatureRedesigns', 'enemies'] as const;
type Module = typeof VARIANT_SOURCE_MODULES[number];
interface Origin { inputId: string; module: Module; symbol: string; rowIndex: number; catalog: string }
type Properties = Map<string, string[]>;
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Variant enemy source extraction: ${message}`); }

// TypeScript 7 does not expose the former compiler AST API. This constrained lexer keeps
// strings opaque and verifies every supported arithmetic shape before taking its literals.
function tokens(source: string): string[] {
  const pattern = /\s+|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_$][\w$]*|[^\s]/gy;
  const result: string[] = []; let offset = 0;
  for (const match of source.matchAll(pattern)) {
    assert(match.index === offset, 'Unrecognized source token'); offset += match[0].length;
    if (!/^\s|^\/\/|^\/\*/.test(match[0])) result.push(match[0]);
  }
  assert(offset === source.length, 'Unterminated source token'); return result;
}
const closes: { [key: string]: string | undefined } = { ')': '(', ']': '[', '}': '{' };
function split(values: readonly string[], separator = ','): string[][] {
  const result: string[][] = [], stack: string[] = []; let row: string[] = [];
  for (const token of values) {
    if (!stack.length && token === separator) { assert(row.length, 'Empty literal entry'); result.push(row); row = []; continue; }
    if (['(', '[', '{'].includes(token)) stack.push(token);
    if (closes[token]) assert(stack.pop() === closes[token], 'Unbalanced expression');
    row.push(token);
  }
  assert(!stack.length, 'Unclosed expression'); if (row.length) result.push(row); return result;
}
function closeAt(values: readonly string[], start: number): number {
  const opening = values[start], closing = Object.keys(closes).find(key => closes[key] === opening);
  assert(closing, 'Expected opening delimiter'); let depth = 0;
  for (let i = start; i < values.length; i++) {
    if (values[i] === opening) depth++;
    if (values[i] === closing && --depth === 0) return i;
  }
  throw new Error('Variant enemy source extraction: Unclosed delimiter');
}
function declaration(values: readonly string[], name: string): string[] {
  const indices = values.flatMap((value, index) => value === 'const' && values[index + 1] === name ? [index] : []);
  assert(indices.length === 1, `Expected one ${name} declaration`);
  let start = indices[0]! + 2;
  while (start < values.length && values[start] !== '=' && values[start] !== ';') start++;
  assert(values[start] === '=', `Missing ${name} initializer`); start++;
  let end = start;
  for (; end < values.length && values[end] !== ';'; end++) if (['(', '[', '{'].includes(values[end]!)) end = closeAt(values, end);
  assert(end < values.length, `Unterminated ${name} initializer`); return values.slice(start, end);
}
function fn(values: readonly string[], name: string): { args: string[][]; body: string[] } {
  const indices = values.flatMap((value, index) => value === 'function' && values[index + 1] === name ? [index] : []);
  assert(indices.length === 1, `Expected one ${name} function`);
  const start = indices[0]! + 2; assert(values[start] === '(', `Unexpected ${name} signature`);
  const end = closeAt(values, start); let bodyStart = end + 1;
  while (bodyStart < values.length && values[bodyStart] !== '{') bodyStart++;
  assert(bodyStart < values.length, `Missing ${name} body`);
  return { args: split(values.slice(start + 1, end)), body: values.slice(bodyStart + 1, closeAt(values, bodyStart)) };
}
function object(value: readonly string[]): Properties {
  assert(value[0] === '{' && value.at(-1) === '}', 'Expected literal object');
  const result: Properties = new Map();
  for (const prop of split(value.slice(1, -1))) {
    const key = prop[0] === '.' ? prop.join('') : prop[0]!;
    assert(!result.has(key), `Duplicate property ${key}`);
    if (prop.length === 1 || prop.slice(0, 3).join('') === '...') result.set(key, prop);
    else { assert(/^[A-Za-z_$][\w$]*$/.test(key) && prop[1] === ':', 'Expected explicit property'); result.set(key, prop.slice(2)); }
  }
  return result;
}
function array(value: readonly string[]): string[][] {
  assert(value[0] === '[' && closeAt(value, 0) === value.length - 1, 'Expected literal array'); return split(value.slice(1, -1));
}
function get(row: Properties, name: string): string[] { const value = row.get(name); assert(value, `Missing property ${name}`); return value; }
function string(value: readonly string[]): string {
  assert(value.length === 1 && /^(?:"[^"\\]*"|'[^'\\]*')$/.test(value[0]!), 'Expected unescaped string literal'); return value[0]!.slice(1, -1);
}
function number(value: readonly string[]): number {
  assert(value.length === 1 && /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value[0]!), 'Expected numeric literal');
  const result = Number(value[0]); assert(Number.isFinite(result), 'Expected finite literal'); return result;
}
function canonical(token: string): string { return /^['"]/.test(token) ? JSON.stringify(string([token])) : token; }
function capture(actual: readonly string[], expected: string, label: string): Map<string, string> {
  const pattern = tokens(expected), result = new Map<string, string>();
  assert(pattern.length === actual.length, `Unsupported ${label} expression`);
  pattern.forEach((token, index) => {
    const value = actual[index]!;
    if (token.startsWith('__')) {
      assert(!result.has(token) || canonical(result.get(token)!) === canonical(value), `Inconsistent ${label} literal`); result.set(token, value);
    } else assert(canonical(token) === canonical(value), `Unsupported ${label} expression`);
  });
  return result;
}
function n(captures: Map<string, string>, name: string): number { const value = captures.get(`__${name}`); assert(value, `Missing ${name} numeric capture`); return number([value]); }
function s(captures: Map<string, string>, name: string): string { const value = captures.get(`__${name}`); assert(value, `Missing ${name} string capture`); return string([value]); }
function fields(row: Properties, names: readonly string[], label: string): void {
  assert(row.size === names.length && names.every(key => row.has(key)), `Unsupported ${label} fields`);
}

function verifyIds(baseline: M4Baseline, module: Module, catalog: string, ids: string[], count: number): void {
  const original = baseline.constants.filter(row => row.module === module && row.name === catalog);
  assert(original.length === 1 && original[0]!.value.kind === 'array', `Missing ${catalog} original identities`);
  const expected = original[0]!.value.values.map(row => {
    assert(row.kind === 'object', `Invalid ${catalog} original row`);
    const id = row.entries.find(([key]) => key === 'id')?.[1];
    assert(id?.kind === 'string', `Missing ${catalog} original identity`); return id.value;
  });
  assert(ids.length === count && expected.length === count && new Set(ids).size === count
    && ids.every((id, index) => id === expected[index]), `${catalog} source identity/count/order mismatch`);
}
function mappedStats(expression: string[], label: string): Properties {
  const indices = expression.flatMap((token, index) => token === 'stats' && expression[index + 1] === ':' ? [index + 2] : []);
  assert(indices.length === 1, `Expected one ${label} stats object`);
  const start = indices[0]!; return object(expression.slice(start, closeAt(expression, start) + 1));
}

export function buildVariantEnemySources(baseline: M4Baseline, sources: VariantEnemySources,
  coreInputs: readonly EnemySourceInput[]) {
  assert(Object.keys(sources).length === VARIANT_SOURCE_MODULES.length, 'Expected all six original variant source modules');
  const files = VARIANT_SOURCE_MODULES.map(module => {
    const path = `.baseline/game/src/content/${module}.ts`, source = sources[module];
    assert(typeof source === 'string', `Missing ${module} source`);
    const sha256 = createHash('sha256').update(source).digest('hex');
    const expected = baseline.source.files.filter(file => file.path === path);
    assert(expected.length === 1 && expected[0]!.sha256 === sha256, `${module} source hash does not match baseline`);
    return { module, path, sha256 };
  });
  assert(new Set(coreInputs.map(row => row.id)).size === coreInputs.length, 'Duplicate core dependency id');
  const coreSpecies = new Map<string, EnemySourceInput>();
  for (const row of coreInputs) {
    const speciesId = row.kind === 'expansion' ? row.identity.family : row.speciesId;
    assert(!coreSpecies.has(speciesId), `Ambiguous core dependency ${speciesId}`); coreSpecies.set(speciesId, row);
  }
  function dependency(speciesId: string, rpgOnly: boolean): string {
    const row = coreSpecies.get(speciesId);
    assert(row && (rpgOnly ? row.kind === 'rpg' : row.kind === 'rpg' || row.kind === 'expansion'),
      `Missing source dependency ${speciesId}`);
    assert(row.id === `${row.kind}/${speciesId}`, `Unexpected source input identity ${row.id}`);
    return row.id;
  }
  const origins: Origin[] = [];
  const variants = tokens(sources.regionalCreatureVariants);
  const variantExpression = declaration(variants, 'REGIONAL_CREATURE_VARIANTS');
  const variantSignature = 'variants.map(([id, baseId, name, regionId, scale, health, essence, description]) => {';
  capture(variantExpression.slice(0, tokens(variantSignature).length), variantSignature, 'variant mapping arguments');
  capture(declaration(variantExpression, 'base'),
    '[...CREATURE_EXPANSION, ...RPG_BESTIARY].find(row => row.id === baseId)!', 'variant source lookup');
  const variantStats = mappedStats(variantExpression, 'variant');
  fields(variantStats, ['...base.stats', 'id', 'family', 'name', 'maxHealth', 'magicArmour', 'drops'], 'variant stats');
  capture(get(variantStats, '...base.stats'), '...base.stats', 'variant inherited stats');
  capture(get(variantStats, 'id'), '`${id}_t${base.stats.tier}`', 'variant identity');
  capture(get(variantStats, 'family'), 'id', 'variant family');
  capture(get(variantStats, 'name'), 'name', 'variant name');
  capture(get(variantStats, 'maxHealth'), 'health', 'variant health');
  const variantBonus = capture(get(variantStats, 'magicArmour'), 'base.stats.magicArmour + __bonus', 'variant magic armour');
  const variantInputs = array(declaration(variants, 'variants')).map((value, rowIndex) => {
    const row = array(value); assert(row.length === 8, 'Expected eight variant row arguments');
    const speciesId = string(row[0]!), id = `variant/${speciesId}`;
    origins.push({ inputId: id, module: 'regionalCreatureVariants', symbol: 'variants', rowIndex, catalog: 'REGIONAL_CREATURE_VARIANTS' });
    return { id, kind: 'variant', speciesId, sourceInputId: dependency(string(row[1]!), false),
      name: string(row[2]!), health: number(row[5]!) };
  });
  verifyIds(baseline, 'regionalCreatureVariants', 'REGIONAL_CREATURE_VARIANTS', variantInputs.map(row => row.speciesId), 5);
  const profiles = [
    ['basic', 'creatureRedesign', 'CREATURE_REDESIGNS', 3],
    ['forest', 'forestCreatureRedesigns', 'FOREST_CREATURE_REDESIGNS', 5],
    ['ash', 'ashCreatureRedesigns', 'ASH_CREATURE_REDESIGNS', 5],
    ['stone', 'stoneCreatureRedesigns', 'STONE_CREATURE_REDESIGNS', 5],
  ] as const;
  let ashAttackStyle = '';
  const redesignInputs = profiles.flatMap(([profile, module, symbol, count]) => {
    const expression = declaration(tokens(sources[module]), symbol), endRows = closeAt(expression, 0);
    const rows = array(expression.slice(0, endRows + 1));
    capture(expression.slice(endRows + 1, endRows + 8), '.map(row => {', `${profile} mapping arguments`);
    const baseName = profile === 'stone' ? 'source' : 'base';
    capture(declaration(expression.slice(endRows + 1), baseName), 'RPG_BESTIARY_BY_ID.get(row.source)!', `${profile} dependency`);
    const stats = mappedStats(expression.slice(endRows + 1), profile);
    const inherited = `...${baseName}.stats`;
    fields(stats, [inherited, 'id', 'family', 'name', 'tier', 'maxHealth', 'behaviour',
      ...(profile === 'ash' ? ['attackStyle', 'attackRangeM'] : []), ...(profile !== 'stone' ? ['drops'] : [])], `${profile} stats`);
    capture(get(stats, inherited), inherited, `${profile} inherited stats`);
    capture(get(stats, 'family'), 'row.id', `${profile} family`);
    capture(get(stats, 'name'), 'row.name', `${profile} name`);
    capture(get(stats, 'maxHealth'), 'row.health', `${profile} health`);
    let tier: number | undefined;
    if (profile === 'basic' || profile === 'forest') {
      tier = number(get(stats, 'tier'));
      capture(get(stats, 'id'), '`' + '${row.id}_t' + tier + '`', `${profile} identity`);
    } else {
      capture(get(stats, 'tier'), 'row.tier', `${profile} tier`);
      capture(get(stats, 'id'), '`${row.id}_t${row.tier}`', `${profile} identity`);
    }
    const choice = profile === 'forest' ? undefined : capture(get(stats, 'behaviour'),
      profile === 'stone' ? 'row.regionId === __match ? __yes : __no' : 'row.id === __match ? __yes : __no', `${profile} behaviour`);
    if (profile === 'forest') capture(get(stats, 'behaviour'), "row.behaviour as CreatureSpeciesDef['stats']['behaviour']", 'forest behaviour');
    const range = profile === 'ash' ? capture(get(stats, 'attackRangeM'), 'row.id === __match ? __yes : __no', 'ash range') : undefined;
    if (profile === 'ash') ashAttackStyle = string(get(stats, 'attackStyle'));
    const result = rows.map((value, rowIndex) => {
      const row = object(value), speciesId = string(get(row, 'id')), id = `${profile}/${speciesId}`;
      const behaviour = choice ? s(choice, (profile === 'stone' ? string(get(row, 'regionId')) : speciesId) === s(choice, 'match') ? 'yes' : 'no')
        : string(get(row, 'behaviour'));
      origins.push({ inputId: id, module, symbol, rowIndex, catalog: symbol });
      return { id, kind: 'redesign', profile, speciesId, name: string(get(row, 'name')),
        sourceInputId: dependency(string(get(row, 'source')), true), health: number(get(row, 'health')),
        tier: tier ?? number(get(row, 'tier')), behaviour,
        ...(range ? { attackRangeM: n(range, speciesId === s(range, 'match') ? 'yes' : 'no') } : {}) };
    });
    verifyIds(baseline, module, symbol, result.map(row => row.speciesId), count);
    return result;
  });
  const enemies = tokens(sources.enemies);
  capture(declaration(enemies, 'FANTASY_SPECIES'),
    '[...FOREST_CREATURE_REDESIGNS, ...STONE_CREATURE_REDESIGNS, ...ASH_CREATURE_REDESIGNS]', 'fantasy source order');
  capture(fn(enemies, 'enemyIdFor').body, 'return `${family}_t${tier}`;', 'fantasy identity helper');
  const fantasyValues = capture(declaration(enemies, 'FANTASY_TIER_BLOCKS'), `FANTASY_SPECIES.flatMap(species =>
    [__tier1, __tier2, __tier3, __tier4].map(tier => {
      const base = species.stats;
      if (tier === base.tier) return base;
      const ratio = tier / base.tier;
      const scaled = (value: number, minimum = __default) => Math.max(minimum, Math.round(value * ratio));
      return { ...base, id: enemyIdFor(base.family, tier), tier,
        maxHealth: scaled(base.maxHealth, __health), attackLevel: scaled(base.attackLevel, __attack),
        defenceLevel: scaled(base.defenceLevel, __defence), accuracy: scaled(base.accuracy),
        armour: scaled(base.armour), magicArmour: scaled(base.magicArmour), maxHit: scaled(base.maxHit, __hit),
        marks: base.marks ? [scaled(base.marks[0]), scaled(base.marks[1])] as [number, number] : undefined };
    }))`, 'fantasy scaling');
  const fantasy = parseValue(FantasyParamsSchema, {
    tiers: ['tier1', 'tier2', 'tier3', 'tier4'].map(key => n(fantasyValues, key)),
    minimums: { maxHealth: n(fantasyValues, 'health'), attackLevel: n(fantasyValues, 'attack'),
      defenceLevel: n(fantasyValues, 'defence'), maxHit: n(fantasyValues, 'hit'),
      accuracy: n(fantasyValues, 'default'), armour: n(fantasyValues, 'default'),
      magicArmour: n(fantasyValues, 'default'), marks: n(fantasyValues, 'default') },
  }, 'fantasyParams');
  const sourceInputIds = ['forest', 'stone', 'ash'].flatMap(profile => redesignInputs.filter(row => row.profile === profile).map(row => row.id));
  const params = parseValue(VariantParamsSchema, { variant: { magicArmourBonus: n(variantBonus, 'bonus') },
    redesign: { ash: { attackStyle: ashAttackStyle } } }, 'variantParams');
  const inputs = parseValue(VariantSourceInputsSchema, [...variantInputs, ...redesignInputs], 'variantSourceInputs');
  return { params, inputs, fantasy, sourceInputIds, manifest: { sources: files, rows: origins, parameters: [
    { parameterPath: 'variant.magicArmourBonus', module: 'regionalCreatureVariants', symbol: 'REGIONAL_CREATURE_VARIANTS' },
    { parameterPath: 'redesign.ash.attackStyle', module: 'ashCreatureRedesigns', symbol: 'ASH_CREATURE_REDESIGNS' },
    { parameterPath: 'fantasy', module: 'enemies', symbol: 'FANTASY_TIER_BLOCKS' },
    { parameterPath: 'sourceInputIds', module: 'enemies', symbol: 'FANTASY_SPECIES' },
  ] } };
}

