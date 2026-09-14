/** Loot factory operands from the original actor and item authoring modules. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseValue } from '../../game/src/content/schema/core.js';
import { ActorLootInputsSchema, ActorLootParamsSchema, RegionalFabricParamsSchema, RegionalFabricTiersSchema } from '../../game/src/content/schema/actorLoot.js';
import { buildActorEnemySources } from './enemy-actor-source-inputs.js';
import type { M4Baseline } from './m4-baseline.js';

export const ACTOR_LOOT_MODULES = ['fairyCreatures', 'fairyGardenCreatures', 'universalMinibosses',
  'universalMinibossLoot', 'regionalTierEquipment', 'encounterBalance', 'jewelry'] as const;
export type ActorLootSources = { [K in typeof ACTOR_LOOT_MODULES[number]]: string };
type Properties = Map<string, string[]>;
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Actor loot extraction: ${message}`); }

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
  throw new Error('Actor loot extraction: Unclosed delimiter');
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
  if (value[0] === '-' && value.length === 2) return -number(value.slice(1));
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

function constArray(value: readonly string[]) {
  const end = closeAt(value, 0); capture(value.slice(end + 1), 'as const', 'constant array suffix');
  return array(value.slice(0, end + 1));
}
function mappedStats(expression: string[]) {
  const indices = expression.flatMap((token, index) => token === 'stats' && expression[index + 1] === ':' ? [index + 2] : []);
  assert(indices.length === 1, 'Expected one actor stats object');
  const start = indices[0]!; return object(expression.slice(start, closeAt(expression, start) + 1));
}
function fairyParameters(drops: string[], garden: boolean) {
  const tier = garden ? 'form.tier' : 'tier', cast = garden ? '' : 'as [number, number]';
  const values = capture(drops, `[
    ...regionalFabricDrops(${tier}),
    { itemId: __earth, quantity: [__earthLow, __earthHigh] ${cast}, chance: __earthChance },
    { itemId: ${tier} === __tier ? __lowRune : __highRune, quantity: [__runeLow, __runeHigh] ${cast}, chance: __runeChance },
    { itemId: __cosmic, quantity: [__cosmicLow, __cosmicHigh] ${cast}, chance: __cosmicChance },
  ]`, garden ? 'garden drops' : 'fairy drops');
  assert(n(values, 'tier') === 30, 'Fairy rune selector must select the lower source tier');
  const roll = (prefix: string) => ({ quantity: [n(values, `${prefix}Low`), n(values, `${prefix}High`)], chance: n(values, `${prefix}Chance`) });
  return { earth: { itemId: s(values, 'earth'), roll: roll('earth') }, cosmic: { itemId: s(values, 'cosmic'), roll: roll('cosmic') },
    rune: { roll: roll('rune'), items: [{ tier: 30, itemId: s(values, 'lowRune') }, { tier: 60, itemId: s(values, 'highRune') }] } };
}

export function buildActorLootSources(baseline: M4Baseline, sources: ActorLootSources) {
  assert(Object.keys(sources).length === ACTOR_LOOT_MODULES.length, 'Expected all seven original actor loot modules');
  const files = ACTOR_LOOT_MODULES.map(module => {
    assert(typeof sources[module] === 'string', `Missing ${module} source`);
    const path = `.baseline/game/src/content/${module}.ts`, sha256 = createHash('sha256').update(sources[module]).digest('hex');
    const expected = baseline.source.files.filter(row => row.path === path);
    assert(expected.length === 1 && expected[0]!.sha256 === sha256, `${module} source hash does not match baseline`);
    return { module, path, sha256 };
  });
  const actors = buildActorEnemySources(baseline, { universalMinibosses: sources.universalMinibosses,
    fairyCreatures: sources.fairyCreatures, fairyGardenCreatures: sources.fairyGardenCreatures, encounterBalance: sources.encounterBalance });
  const fairy = fairyParameters(get(mappedStats(declaration(tokens(sources.fairyCreatures), 'FAIRY_CREATURE_SPECIES')), 'drops'), false);
  const garden = fairyParameters(get(mappedStats(declaration(tokens(sources.fairyGardenCreatures), 'FAIRY_GARDEN_SPECIES')), 'drops'), true);
  assert(isDeepStrictEqual(fairy, garden), 'Fairy and garden original shared loot operands disagree');
  const universal = tokens(sources.universalMinibosses), body = fn(universal, 'universalMinibossSpecies').body;
  const jewelryRoll = capture(get(object(declaration(body, 'stats')), 'drops'), `tier < __minimum ? [] : [
    { itemId: \`guardian_ring_t\${tier}\`, quantity: [__low, __high], chance: UNIQUE_JEWELLERY_CHANCE / __slots, exclusiveGroup: __group },
    { itemId: \`guardian_earring_t\${tier}\`, quantity: [__low, __high], chance: UNIQUE_JEWELLERY_CHANCE / __slots, exclusiveGroup: __group },
  ]`, 'guardian jewelry rolls');
  const jewelry = tokens(sources.jewelry), tiers = constArray(declaration(jewelry, 'JEWELRY_TIERS')).map(number);
  const shapes = constArray(declaration(jewelry, 'JEWELRY_SHAPES')).map(string);
  assert(isDeepStrictEqual(shapes, ['ring', 'earring']) && n(jewelryRoll, 'slots') === shapes.length,
    'Guardian jewelry split must match the two ordered authored slots');
  const items = declaration(tokens(sources.universalMinibossLoot), 'MINIBOSS_JEWELLERY');
  const itemPrefix = 'JEWELRY_TIERS.flatMap((tier, index) => JEWELRY_SHAPES.map(shape => ({ id: `guardian_${shape}_t${tier}`,';
  capture(items.slice(0, tokens(itemPrefix).length), itemPrefix, 'guardian jewelry item construction');
  const universalJewelry = { minimumTier: n(jewelryRoll, 'minimum'), totalChance: number(declaration(universal, 'UNIQUE_JEWELLERY_CHANCE')),
    exclusiveGroup: s(jewelryRoll, 'group'), quantity: [n(jewelryRoll, 'low'), n(jewelryRoll, 'high')],
    items: tiers.map(tier => ({ tier, ringItemId: `guardian_${shapes[0]}_t${tier}`, earringItemId: `guardian_${shapes[1]}_t${tier}` })) };
  const regional = tokens(sources.regionalTierEquipment), fabric = fn(regional, 'regionalFabricDrops');
  assert(fabric.args.length === 2, 'Unexpected fabric helper arguments');
  capture(fabric.args[0]!, 'tier: number', 'fabric tier argument'); capture(fabric.args[1]!, 'boss = false', 'fabric boss default');
  const fabricRolls = capture(fabric.body, `const row = REGIONAL_CRAFTING_TIERS.find(row => row.tier === tier);
    return row ? [{ itemId: row.hide, quantity: boss ? [__bossLow, __bossHigh] : [__ordinaryLow, __ordinaryHigh],
      chance: boss ? __bossChance : __ordinaryChance }] : [];`, 'regional fabric selection');
  const regionalFabric = parseValue(RegionalFabricParamsSchema, Object.fromEntries(['ordinary', 'boss'].map(profile => [profile,
    { quantity: [n(fabricRolls, `${profile}Low`), n(fabricRolls, `${profile}High`)], chance: n(fabricRolls, `${profile}Chance`) }])), 'regionalFabric');
  const regionalCraftingTiers = parseValue(RegionalFabricTiersSchema,
    constArray(declaration(regional, 'REGIONAL_CRAFTING_TIERS')).map(value => {
      const row = object(value); return { tier: number(get(row, 'tier')), hide: string(get(row, 'hide')) };
    }), 'regionalCraftingTiers');
  const params = parseValue(ActorLootParamsSchema, { fairy, universalJewelry }, 'actorLootParams');
  const inputs = parseValue(ActorLootInputsSchema, actors.inputs.map(row => ({ id: row.id,
    kind: row.kind === 'universal' ? 'universalJewelry' : 'fairy', tier: row.tier })), 'actorLootInputs');
  assert(inputs.length === 99, 'Expected 99 independent actor loot owners');
  const sourceInputJoins = actors.inputs.map(row => ({ inputId: row.id, sourceInputId: row.id,
    enemyId: row.kind === 'universal' ? `guardian_${row.number}_t${row.tier}` : row.speciesId,
    speciesIds: row.kind === 'universal' ? actors.universalSpeciesMappings.filter(mapping => mapping.sourceInputId === row.id).map(mapping => mapping.speciesId) : [row.speciesId] }));
  const ownerProposals = sourceInputJoins.flatMap(join => [
    { lootTableId: `loot_enemy_${join.enemyId}`, ownerId: join.enemyId, catalog: 'ENEMY_BLOCK_LOOT' as const, inputId: join.inputId, formula: true },
    ...join.speciesIds.map(speciesId => ({ lootTableId: `loot_species_${speciesId}`, ownerId: speciesId,
      catalog: 'CREATURE_SOURCE_LOOT' as const, inputId: join.inputId, formula: true })),
  ]).filter(proposal => baseline.records.lootTables.some(row => row.id === proposal.lootTableId && row.ownerId === proposal.ownerId && row.catalog === proposal.catalog));
  return { params, inputs, sourceInputJoins, ownerProposals,
    externalFabric: { regionalFabric, regionalCraftingTiers },
    manifest: { sources: files, rows: actors.manifest.rows, parameters: [
      { parameterPath: 'fairy', module: 'fairyCreatures', symbol: 'FAIRY_CREATURE_SPECIES' },
      { parameterPath: 'fairy', module: 'fairyGardenCreatures', symbol: 'FAIRY_GARDEN_SPECIES' },
      { parameterPath: 'universalJewelry', module: 'universalMinibosses', symbol: 'universalMinibossSpecies' },
      { parameterPath: 'universalJewelry.totalChance', module: 'universalMinibosses', symbol: 'UNIQUE_JEWELLERY_CHANCE' },
      { parameterPath: 'universalJewelry.items', module: 'universalMinibossLoot', symbol: 'MINIBOSS_JEWELLERY' },
      { parameterPath: 'universalJewelry.items', module: 'jewelry', symbol: 'JEWELRY_TIERS' },
      { parameterPath: 'universalJewelry.items', module: 'jewelry', symbol: 'JEWELRY_SHAPES' },
    ], externalParameters: [
      { parameterPath: 'regionalFabric', module: 'regionalTierEquipment', symbol: 'regionalFabricDrops' },
      { parameterPath: 'regionalCraftingTiers', module: 'regionalTierEquipment', symbol: 'REGIONAL_CRAFTING_TIERS' },
    ] } };
}
