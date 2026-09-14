/** Original authored remainders. Formula results are supplied through explicit source references. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseValue } from '../../game/src/content/schema/core.js';
import { EnemyAssemblySourcesSchema } from '../../game/src/content/schema/enemyAssemblySources.js';
import type { LegacyMarksInput, LegacyBossInput } from '../../game/src/content/balance/enemies.js';
import type { SourceLootInput } from '../../game/src/content/schema/sourceLoot.js';
import type { M4Baseline } from './m4-baseline.js';

export const ENEMY_ASSEMBLY_SOURCE_MODULES = ['enemies', 'redWorms'] as const;
export interface EnemyAssemblySources { enemies: string; redWorms: string }
export interface EnemyAssemblyExtractionDependencies {
  legacyMarksInputs: readonly LegacyMarksInput[];
  legacyBossInputs: readonly LegacyBossInput[];
  sourceLootInputs: readonly SourceLootInput[];
}
type Properties = Map<string, string[]>;
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Enemy assembly source extraction: ${message}`); }

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
  throw new Error('Enemy assembly source extraction: Unclosed delimiter');
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

const COMBAT_FIELDS = ['maxHealth', 'attackLevel', 'defenceLevel', 'accuracy', 'armour', 'magicArmour', 'maxHit'] as const;
function authoredFields(row: Properties, excluded: readonly string[]) {
  return Object.fromEntries([...row].filter(([key]) => !excluded.includes(key)).map(([key, value]) =>
    [key, key === 'marks' ? array(value).map(number) : literal(value)]));
}

export function buildEnemyAssemblySources(baseline: M4Baseline, sources: EnemyAssemblySources,
  dependencies: EnemyAssemblyExtractionDependencies) {
  assert(Object.keys(sources).length === ENEMY_ASSEMBLY_SOURCE_MODULES.length, 'Expected both original assembly source modules');
  const files = ENEMY_ASSEMBLY_SOURCE_MODULES.map(module => {
    assert(typeof sources[module] === 'string', `Missing ${module} source`);
    const path = `.baseline/game/src/content/${module}.ts`, sha256 = createHash('sha256').update(sources[module]).digest('hex');
    const expected = baseline.source.files.filter(row => row.path === path);
    assert(expected.length === 1 && expected[0]!.sha256 === sha256, `${module} source hash does not match baseline`);
    return { module, path, sha256 };
  });
  const marksInputs = new Map(dependencies.legacyMarksInputs.map(row => [row.id, row]));
  const bossInputs = new Map(dependencies.legacyBossInputs.map(row => [row.id, row]));
  const lootInputs = new Map(dependencies.sourceLootInputs.map(row => [row.id, row]));
  assert(marksInputs.size === 28 && marksInputs.size === dependencies.legacyMarksInputs.length
    && bossInputs.size === 7 && bossInputs.size === dependencies.legacyBossInputs.length
    && new Set([...marksInputs.keys(), ...bossInputs.keys()]).size === 35, 'Expected 28 unique marks and seven unique boss inputs');
  assert(lootInputs.size === dependencies.sourceLootInputs.length, 'Duplicate source loot input id');
  const origins: { inputId: string; module: typeof ENEMY_ASSEMBLY_SOURCE_MODULES[number]; symbol: string; rowIndex: number;
    authoredFields: string[]; legacyInputId?: string; lootInputId?: string }[] = [];
  const blocks = array(declaration(tokens(sources.enemies), 'BLOCKS')).map(object);
  const ids = blocks.map(row => string(get(row, 'id')));
  assert(ids.length === 35 && new Set(ids).size === 35 && baseline.original.blocks.length === 35
    && ids.every((id, index) => id === baseline.original.blocks[index]!.id), 'Original legacy identity/count/order mismatch');
  const inputs: unknown[] = blocks.map((row, rowIndex) => {
    const enemyId = ids[rowIndex]!, legacyInputId = `legacy/${enemyId}`, id = `assembly/legacy/${enemyId}`;
    const lootInputId = legacyInputId, loot = lootInputs.get(lootInputId);
    assert(loot?.kind === 'authored', `Missing original authored loot input ${lootInputId}`);
    const drops = array(get(row, 'drops')).map(dropObject);
    assert(isDeepStrictEqual(drops, loot.drops), `Original loot arguments disagree with ${lootInputId}`);
    const originalTier = number(get(row, 'tier'));
    assert(Number.isInteger(originalTier) && originalTier > 0, `Invalid original tier ${enemyId}`);
    const marks = marksInputs.get(legacyInputId), boss = bossInputs.get(legacyInputId);
    assert(Boolean(marks) !== Boolean(boss), `Missing or ambiguous legacy dependency ${legacyInputId}`);
    let authored: ReturnType<typeof authoredFields>;
    if (marks) {
      assert(marks.enemyId === enemyId && marks.tier === originalTier, `Original marks identity/tier disagrees with ${legacyInputId}`);
      const callName = marks.profile === 'ordinary' ? 'marksFor' : 'purseMarksFor';
      const args = call(get(row, 'marks'), callName, 1);
      assert(number(args[0]!) === marks.tier, `Original marks argument disagrees with ${legacyInputId}`);
      authored = authoredFields(row, ['tier', 'marks', 'drops']);
    } else {
      assert(boss!.enemyId === enemyId, `Original boss identity disagrees with ${legacyInputId}`);
      for (const field of COMBAT_FIELDS) assert(number(get(row, field)) === boss!.seed[field], `Original boss seed ${field} disagrees with ${legacyInputId}`);
      authored = authoredFields(row, ['tier', ...COMBAT_FIELDS, 'drops']);
    }
    origins.push({ inputId: id, module: 'enemies', symbol: 'BLOCKS', rowIndex, authoredFields: Object.keys(authored), legacyInputId, lootInputId });
    return { id, kind: marks ? 'legacyMarksRemainder' : 'legacyBossRemainder', legacyInputId, lootInputId, authored };
  });
  const worms = array(declaration(tokens(sources.redWorms), 'RED_WORM_SPECIES'));
  const expectedWorms = baseline.constants.find(row => row.module === 'redWorms' && row.name === 'RED_WORM_SPECIES')?.value;
  assert(worms.length === 1 && expectedWorms?.kind === 'array' && expectedWorms.values.length === 1, 'Expected one original authored red worm');
  const species = object(worms[0]!), speciesId = string(get(species, 'id'));
  const expectedSpecies = expectedWorms.values[0]!;
  assert(expectedSpecies.kind === 'object' && expectedSpecies.entries.some(([key, value]) => key === 'id' && value.kind === 'string' && value.value === speciesId), 'Original red worm identity mismatch');
  const row = object(get(species, 'stats')), drops = array(get(row, 'drops'));
  assert(drops.length === 0, 'Original red worm drops must be explicitly empty');
  const authored = authoredFields(row, ['drops']), id = `assembly/authored/${speciesId}`;
  inputs.push({ id, kind: 'redWorm', authored, drops: [] });
  origins.push({ inputId: id, module: 'redWorms', symbol: 'RED_WORM_SPECIES', rowIndex: 0, authoredFields: Object.keys(authored) });
  return { inputs: parseValue(EnemyAssemblySourcesSchema, inputs, 'enemyAssemblySources'),
    manifest: { sources: files, rows: origins } };
}
