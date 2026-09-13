/** Original loot arguments and literals only. No final drop arrays are extraction inputs. */
import { createHash } from 'node:crypto';
import { parseValue } from '../../game/src/content/schema/core.js';
import { SourceLootInputsSchema, SourceLootParamsSchema } from '../../game/src/content/schema/sourceLoot.js';
import type { M4Baseline } from './m4-baseline.js';
import { buildCoreEnemySources } from './enemy-source-inputs.js';
import { buildVariantEnemySources } from './enemy-source-variant-inputs.js';

export const CORE_SOURCE_LOOT_MODULES = ['enemies', 'creatureExpansion', 'starterCreatures', 'rpgBestiary',
  'regionalCreatureVariants', 'creatureRedesign', 'forestCreatureRedesigns', 'ashCreatureRedesigns', 'stoneCreatureRedesigns'] as const;
type Module = typeof CORE_SOURCE_LOOT_MODULES[number];
export type CoreSourceLootSources = { [K in Module]: string };
interface Origin { inputId: string; module: Module; symbol: string; rowIndex: number; catalog: string }
type Properties = Map<string, string[]>;
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Core source loot extraction: ${message}`); }

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
  throw new Error('Core source loot extraction: Unclosed delimiter');
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
function returnObject(body: readonly string[]): Properties {
  const index = body.indexOf('return'); assert(index >= 0 && body[index + 1] === '{', 'Expected literal return object');
  return object(body.slice(index + 1, closeAt(body, index + 1) + 1));
}
function array(value: readonly string[]): string[][] {
  assert(value[0] === '[' && closeAt(value, 0) === value.length - 1, 'Expected literal array'); return split(value.slice(1, -1));
}
function call(value: readonly string[], name: string, min: number, max = min): string[][] {
  assert(value[0] === name && value[1] === '(' && closeAt(value, 1) === value.length - 1, `Expected ${name} literal call`);
  const args = split(value.slice(2, -1)); assert(args.length >= min && args.length <= max, `Unexpected ${name} argument count`); return args;
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
function literal(value: readonly string[]): string | number { return /^['"]/.test(value[0] ?? '') ? string(value) : number(value); }

function dropObject(value: readonly string[]) {
  const row = object(value);
  assert([...row.keys()].every(key => ['itemId', 'quantity', 'chance', 'exclusiveGroup'].includes(key)), 'Unsupported authored drop fields');
  return { itemId: string(get(row, 'itemId')), quantity: array(get(row, 'quantity')).map(number), chance: number(get(row, 'chance')),
    ...(row.has('exclusiveGroup') ? { exclusiveGroup: string(get(row, 'exclusiveGroup')) } : {}) };
}
function mappedStats(expression: string[]): Properties {
  const indices = expression.flatMap((token, index) => token === 'stats' && expression[index + 1] === ':' ? [index + 2] : []);
  assert(indices.length === 1, 'Expected one mapped stats object');
  const start = indices[0]!; return object(expression.slice(start, closeAt(expression, start) + 1));
}
function capturedRoll(values: Map<string, string>) {
  return { quantity: [n(values, 'low'), n(values, 'high')], chance: n(values, 'chance') };
}

export function buildCoreSourceLoot(baseline: M4Baseline, sources: CoreSourceLootSources) {
  assert(Object.keys(sources).length === CORE_SOURCE_LOOT_MODULES.length, 'Expected all nine original source modules');
  const files = CORE_SOURCE_LOOT_MODULES.map(module => {
    assert(typeof sources[module] === 'string', `Missing ${module} source`);
    const path = `.baseline/game/src/content/${module}.ts`, sha256 = createHash('sha256').update(sources[module]).digest('hex');
    const expected = baseline.source.files.filter(row => row.path === path);
    assert(expected.length === 1 && expected[0]!.sha256 === sha256, `${module} source hash does not match baseline`);
    return { module, path, sha256 };
  });
  const core = buildCoreEnemySources(baseline, { creatureExpansion: sources.creatureExpansion,
    starterCreatures: sources.starterCreatures, rpgBestiary: sources.rpgBestiary });
  const variants = buildVariantEnemySources(baseline, { regionalCreatureVariants: sources.regionalCreatureVariants,
    creatureRedesign: sources.creatureRedesign, forestCreatureRedesigns: sources.forestCreatureRedesigns,
    ashCreatureRedesigns: sources.ashCreatureRedesigns, stoneCreatureRedesigns: sources.stoneCreatureRedesigns, enemies: sources.enemies }, core.inputs);
  const origins: Origin[] = [];
  const inputs: unknown[] = [];
  const joins: { inputId: string; enemyId: string; speciesId?: string; sourceInputId?: string; formula: boolean }[] = [];
  const legacy = array(declaration(tokens(sources.enemies), 'BLOCKS'));
  const legacyIds = legacy.map(value => string(get(object(value), 'id')));
  assert(legacy.length === 35 && baseline.original.blocks.length === 35 && new Set(legacyIds).size === 35
    && legacyIds.every((id, index) => id === baseline.original.blocks[index]!.id), 'Legacy source identity/count/order mismatch');
  legacy.forEach((value, rowIndex) => {
    const row = object(value), enemyId = string(get(row, 'id')), inputId = `legacy/${enemyId}`;
    inputs.push({ id: inputId, kind: 'authored', drops: array(get(row, 'drops')).map(dropObject) });
    origins.push({ inputId, module: 'enemies', symbol: 'BLOCKS', rowIndex, catalog: 'LEGACY_BLOCKS' });
    joins.push({ inputId, enemyId, formula: false });
  });
  const expansion = tokens(sources.creatureExpansion);
  capture(declaration(expansion, 'drop'), `(itemId: string, min: number, max: number, chance: number): EnemyDef['drops'][number] =>
    ({ itemId, quantity: [min, max], chance })`, 'expansion drop helper');
  const expansionRows = array(declaration(expansion, 'CREATURE_EXPANSION'));
  const starter = tokens(sources.starterCreatures), small = fn(starter, 'small');
  const starterRoll = capture(get(object(get(returnObject(small.body), 'stats')), 'drops'),
    '[{ itemId: loot, quantity: [__low, __high], chance: __chance }]', 'starter drops');
  const starterRows = array(declaration(starter, 'STARTER_CREATURES'));
  const rpg = fn(tokens(sources.rpgBestiary), 'entry');
  const rpgRoll = capture(get(object(declaration(rpg.body, 'stats')), 'drops'),
    '[{ itemId: essence, quantity: [__low, Math.max(__minimum, Math.ceil(tier / __divisor))], chance: caster ? __caster : __other }]', 'RPG drops');
  const essence = capture(declaration(rpg.body, 'essence'),
    `{ fallowmarch: __air, vellenwood: __earth, karrowmoor: __water, kilnhalt: __fire }[regionId as 'fallowmarch' | 'vellenwood' | 'karrowmoor' | 'kilnhalt']`, 'RPG essence map');
  for (const source of core.inputs) {
    const origin = core.manifest.rows.find(row => row.inputId === source.id)!;
    origins.push(origin);
    const speciesId = source.kind === 'expansion' ? source.identity.family : source.speciesId;
    const enemyId = source.kind === 'expansion' ? source.identity.enemyId
      : `${speciesId}_t${source.kind === 'starter' ? core.params.starter.tier : source.tier}`;
    joins.push({ inputId: source.id, sourceInputId: source.id, enemyId, speciesId, formula: source.kind !== 'expansion' });
    if (source.kind === 'expansion') {
      const stats = object(call(expansionRows[origin.rowIndex]!, 'species', 5)[4]!);
      const drops = array(get(stats, 'drops')).map(value => {
        const args = call(value, 'drop', 4);
        return { itemId: string(args[0]!), quantity: [number(args[1]!), number(args[2]!)], chance: number(args[3]!) };
      });
      inputs.push({ id: source.id, kind: 'authored', drops });
    } else if (source.kind === 'starter') {
      const args = call(starterRows[origin.rowIndex]!, 'small', 9, 11);
      inputs.push({ id: source.id, kind: 'starter', itemId: string(args[7]!) });
    } else inputs.push({ id: source.id, kind: 'rpg', regionId: source.regionId, tier: source.tier, role: source.role });
  }
  const regional = tokens(sources.regionalCreatureVariants), regionalRows = array(declaration(regional, 'variants'));
  const variantRoll = capture(get(mappedStats(declaration(regional, 'REGIONAL_CREATURE_VARIANTS')), 'drops'),
    '[...base.stats.drops, { itemId: essence, quantity: [__low, __high], chance: __chance }]', 'variant append');
  const redesignRolls: { [K in 'basic' | 'forest' | 'ash']?: ReturnType<typeof capturedRoll> } = {};
  for (const source of variants.inputs) {
    const origin = variants.manifest.rows.find(row => row.inputId === source.id)!;
    origins.push(origin);
    const base = core.inputs.find(row => row.id === source.sourceInputId)!;
    const tier = source.kind === 'redesign' ? source.tier : base.kind === 'expansion' ? base.identity.tier
      : base.kind === 'rpg' ? base.tier : core.params.starter.tier;
    joins.push({ inputId: source.id, sourceInputId: source.id, speciesId: source.speciesId, enemyId: `${source.speciesId}_t${tier}`, formula: true });
    if (source.kind === 'variant') {
      const args = array(regionalRows[origin.rowIndex]!);
      inputs.push({ id: source.id, kind: 'variantAppend', sourceInputId: source.sourceInputId, essenceItemId: string(args[6]!) });
      continue;
    }
    if (source.profile === 'stone') {
      // The stat extractor verified the source.stats spread and absence of a drops override.
      inputs.push({ id: source.id, kind: 'inherit', sourceInputId: source.sourceInputId });
      continue;
    }
    const expression = declaration(tokens(sources[origin.module]), origin.symbol);
    const stats = mappedStats(expression), row = object(array(expression.slice(0, closeAt(expression, 0) + 1))[origin.rowIndex]!);
    const pattern = source.profile === 'basic'
      ? "[{ itemId: row.id === __match ? __yes : __no, quantity: [__low, __high], chance: __chance }]"
      : source.profile === 'forest' ? "[{ itemId: __item, quantity: [__low, __high] as const, chance: __chance }]"
      : "[{ itemId: row.regionId === __match ? __yes : __no, quantity: [__low, __high], chance: __chance }]";
    const values = capture(get(stats, 'drops'), pattern, `${source.profile} drops`);
    redesignRolls[source.profile] = capturedRoll(values);
    const essenceItemId = source.profile === 'forest' ? s(values, 'item')
      : s(values, (source.profile === 'basic' ? source.speciesId : string(get(row, 'regionId'))) === s(values, 'match') ? 'yes' : 'no');
    inputs.push({ id: source.id, kind: 'redesignEssence', profile: source.profile, essenceItemId });
  }
  const params = parseValue(SourceLootParamsSchema, {
    starter: capturedRoll(starterRoll), variantAppend: capturedRoll(variantRoll), redesignEssence: redesignRolls,
    rpg: { essenceByRegion: { fallowmarch: s(essence, 'air'), vellenwood: s(essence, 'earth'), karrowmoor: s(essence, 'water'), kilnhalt: s(essence, 'fire') },
      quantityMinimum: n(rpgRoll, 'low'), quantityMaximumMinimum: n(rpgRoll, 'minimum'), quantityTierDivisor: n(rpgRoll, 'divisor'),
      chance: { caster: n(rpgRoll, 'caster'), other: n(rpgRoll, 'other') } },
  }, 'sourceLootParams');
  const parsedInputs = parseValue(SourceLootInputsSchema, inputs, 'sourceLootInputs');
  // These are join proposals, not claims about final canonical write precedence.
  const ownerProposals = joins.flatMap(join => [
    { lootTableId: `loot_enemy_${join.enemyId}`, ownerId: join.enemyId, catalog: 'ENEMY_BLOCK_LOOT' as const, inputId: join.inputId, formula: join.formula },
    ...(join.speciesId ? [{ lootTableId: `loot_species_${join.speciesId}`, ownerId: join.speciesId, catalog: 'CREATURE_SOURCE_LOOT' as const, inputId: join.inputId, formula: join.formula }] : []),
  ]).filter(proposal => baseline.records.lootTables.some(row => row.id === proposal.lootTableId && row.catalog === proposal.catalog && row.ownerId === proposal.ownerId));
  return { params, inputs: parsedInputs, sourceInputJoins: joins, ownerProposals, manifest: { sources: files, rows: origins, parameters: [
    { parameterPath: 'starter', module: 'starterCreatures', symbol: 'small' },
    { parameterPath: 'rpg', module: 'rpgBestiary', symbol: 'entry' },
    { parameterPath: 'variantAppend', module: 'regionalCreatureVariants', symbol: 'REGIONAL_CREATURE_VARIANTS' },
    ...(['basic', 'forest', 'ash'] as const).map(profile => {
      const source = variants.manifest.rows.find(row => row.inputId.startsWith(`${profile}/`))!;
      return { parameterPath: `redesignEssence.${profile}`, module: source.module, symbol: source.symbol };
    }),
  ] } };
}
