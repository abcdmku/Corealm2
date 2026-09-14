/** Original descendant/body loot inputs and owner-ledger references. */
import { createHash } from 'node:crypto';
import { parseValue } from '../../game/src/content/schema/core.js';
import { DescendantLootInputSchema, DescendantLootParamsSchema, type DescendantLootInput } from '../../game/src/content/schema/descendantLoot.js';
import { SourceLootInputSchema, type SourceLootInput } from '../../game/src/content/schema/sourceLoot.js';
import { RegionalFabricParamsSchema, RegionalFabricTiersSchema } from '../../game/src/content/schema/actorLoot.js';
import type { EnemySourceInput } from '../../game/src/content/schema/enemySources.js';
import { buildWildernessEnemySources } from './enemy-wilderness-source-inputs.js';
import { buildDescendantEnemySources, type DescendantAvailableInput } from './enemy-descendant-source-inputs.js';
import type { M4Baseline } from './m4-baseline.js';

export const DESCENDANT_LOOT_MODULES = ['fairyCrownCreatures', 'crownwardDragons', 'wildernessDragons',
  'wildernessCreatureSpecies', 'regionalBossBodies', 'wildernessDepth', 'regionalTierEquipment'] as const;
export type DescendantLootSources = { [K in typeof DESCENDANT_LOOT_MODULES[number]]: string };
type Properties = Map<string, string[]>;
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Descendant loot extraction: ${message}`); }

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
  throw new Error('Descendant loot extraction: Unclosed delimiter');
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

function dropArray(expression: string[]) {
  const positions = expression.flatMap((token, index) => token === 'drops' && expression[index + 1] === ':' ? [index + 2] : []);
  assert(positions.length === 1, 'Expected one original drops array');
  const start = positions[0]!; assert(expression[start] === '[', 'Expected literal source drop array');
  return expression.slice(start, closeAt(expression, start) + 1);
}
const capturedRoll = (values: Map<string, string>, prefix: string) => ({
  quantity: [n(values, `${prefix}Low`), n(values, `${prefix}High`)], chance: n(values, `${prefix}Chance`),
});
const capturedProfiles = (values: Map<string, string>, prefix: string) => ({
  ordinary: capturedRoll(values, `${prefix}Ordinary`), boss: capturedRoll(values, `${prefix}Boss`),
});

export function buildDescendantLootSources(baseline: M4Baseline, sources: DescendantLootSources,
  availableInputs: readonly DescendantAvailableInput[]) {
  assert(Object.keys(sources).length === DESCENDANT_LOOT_MODULES.length, 'Expected all seven original descendant loot modules');
  const files = DESCENDANT_LOOT_MODULES.map(module => {
    assert(typeof sources[module] === 'string', `Missing ${module} source`);
    const path = `.baseline/game/src/content/${module}.ts`, sha256 = createHash('sha256').update(sources[module]).digest('hex');
    const expected = baseline.source.files.filter(row => row.path === path);
    assert(expected.length === 1 && expected[0]!.sha256 === sha256, `${module} source hash does not match baseline`);
    return { module, path, sha256 };
  });
  assert(new Set(availableInputs.map(row => row.id)).size === availableInputs.length, 'Duplicate available source input id');
  const core = availableInputs.filter((row): row is EnemySourceInput => row.kind === 'expansion' || row.kind === 'starter' || row.kind === 'rpg');
  const wilderness = buildWildernessEnemySources(baseline, { wildernessCreatureSpecies: sources.wildernessCreatureSpecies,
    wildernessDragons: sources.wildernessDragons, regionalBossBodies: sources.regionalBossBodies, wildernessDepth: sources.wildernessDepth }, core);
  const wildernessIds = new Set(wilderness.inputs.map(row => row.id));
  const descendants = buildDescendantEnemySources(baseline, { fairyCrownCreatures: sources.fairyCrownCreatures,
    crownwardDragons: sources.crownwardDragons }, [...availableInputs.filter(row => !wildernessIds.has(row.id)), ...wilderness.inputs]);
  const fairy = tokens(sources.fairyCrownCreatures), fairyFn = fn(fairy, 'dropsFor');
  capture(fairyFn.args[0]!, 'form: RegionalForm', 'fairy crown loot argument');
  assert(fairyFn.args.length === 1, 'Unexpected fairy crown loot arguments');
  const fv = capture(fairyFn.body, `
    const fairy = form.regionId !== 'crownward';
    const essence = fairy ? __fairyEssence : __crownwardEssence;
    const rune = form.tier === __tier30 ? __rune30 : form.tier === __tier40 ? __rune40 : __rune60;
    return [
      ...regionalFabricDrops(form.tier, form.boss),
      { itemId: essence, quantity: form.boss ? [__essenceBossLow, __essenceBossHigh] : [__essenceOrdinaryLow, __essenceOrdinaryHigh], chance: form.boss ? __essenceBossChance : __essenceOrdinaryChance },
      { itemId: rune, quantity: form.boss ? [__runeBossLow, __runeBossHigh] : [__runeOrdinaryLow, __runeOrdinaryHigh], chance: form.boss ? __runeBossChance : __runeOrdinaryChance },
      ...(fairy ? [{ itemId: __cosmic, quantity: (form.boss ? [__cosmicBossLow, __cosmicBossHigh] : [__cosmicOrdinaryLow, __cosmicOrdinaryHigh]) as [number, number], chance: form.boss ? __cosmicBossChance : __cosmicOrdinaryChance }] : []),
      ...(form.id === __venisonSpecies ? [{ itemId: __venisonItem, quantity: [__venisonLow, __venisonHigh] as [number, number], chance: __venisonChance }] : []),
    ];`, 'fairy crown drops');
  assert(n(fv, 'tier30') === 30 && n(fv, 'tier40') === 40, 'Fairy crown rune tier selectors changed');
  const crownward = tokens(sources.crownwardDragons);
  const cv = capture(dropArray(declaration(crownward, 'CROWNWARD_DRAGON_SPECIES')), `[
    ...regionalFabricDrops(__tier, boss),
    { itemId: __scales, quantity: boss ? [__scalesBossLow, __scalesBossHigh] : [__scalesOrdinaryLow, __scalesOrdinaryHigh], chance: __scalesChance },
    { itemId: __fire, quantity: boss ? [__fireBossLow, __fireBossHigh] : [__fireOrdinaryLow, __fireOrdinaryHigh], chance: __fireChance },
    { itemId: __rune, quantity: boss ? [__runeBossLow, __runeBossHigh] : [__runeOrdinaryLow, __runeOrdinaryHigh], chance: boss ? __runeBossChance : __runeOrdinaryChance },
  ]`, 'Crownward dragon drops');
  for (const prefix of ['scales', 'fire']) for (const profile of ['Boss', 'Ordinary']) cv.set(`__${prefix}${profile}Chance`, cv.get(`__${prefix}Chance`)!);
  const dv = capture(dropArray(declaration(tokens(sources.wildernessDragons), 'DRAGON_SPECIES')), `[
    { itemId: __scales, quantity: [__scalesLow, row.tier === __shallowTier ? __shallowHigh : __deepHigh], chance: __scalesChance },
    { itemId: __fire, quantity: [__fireLow, __fireHigh], chance: __fireChance }
  ]`, 'pre-progression dragon drops');
  // The Wilderness source extractor checks the original empty body array and the complete boss stats spread.
  capture(dropArray(fn(tokens(sources.wildernessCreatureSpecies), 'bodyStats').body), '[]', 'authored body drops');
  const regional = tokens(sources.regionalTierEquipment), fabricFn = fn(regional, 'regionalFabricDrops');
  assert(fabricFn.args.length === 2, 'Unexpected fabric arguments');
  capture(fabricFn.args[0]!, 'tier: number', 'fabric tier'); capture(fabricFn.args[1]!, 'boss = false', 'fabric default');
  const fabric = capture(fabricFn.body, `const row = REGIONAL_CRAFTING_TIERS.find(row => row.tier === tier);
    return row ? [{ itemId: row.hide, quantity: boss ? [__bossLow, __bossHigh] : [__ordinaryLow, __ordinaryHigh], chance: boss ? __bossChance : __ordinaryChance }] : [];`, 'regional fabric');
  const externalFabric = {
    regionalFabric: parseValue(RegionalFabricParamsSchema, { ordinary: capturedRoll(fabric, 'ordinary'), boss: capturedRoll(fabric, 'boss') }, 'regionalFabric'),
    regionalCraftingTiers: parseValue(RegionalFabricTiersSchema, constArray(declaration(regional, 'REGIONAL_CRAFTING_TIERS')).map(value => {
      const row = object(value); return { tier: number(get(row, 'tier')), hide: string(get(row, 'hide')) };
    }), 'regionalCraftingTiers'),
  };
  const params = parseValue(DescendantLootParamsSchema, {
    fairyCrown: { essence: { crownwardItemId: s(fv, 'crownwardEssence'), fairyItemId: s(fv, 'fairyEssence'), ...capturedProfiles(fv, 'essence') },
      rune: { ...capturedProfiles(fv, 'rune'), items: [{ tier: n(fv, 'tier30'), itemId: s(fv, 'rune30') }, { tier: n(fv, 'tier40'), itemId: s(fv, 'rune40') }, { tier: 60, itemId: s(fv, 'rune60') }] },
      cosmic: { itemId: s(fv, 'cosmic'), ...capturedProfiles(fv, 'cosmic') },
      venison: { speciesId: s(fv, 'venisonSpecies'), itemId: s(fv, 'venisonItem'), roll: capturedRoll(fv, 'venison') } },
    crownwardDragon: { tier: n(cv, 'tier'), scales: { itemId: s(cv, 'scales'), ...capturedProfiles(cv, 'scales') },
      fireEssence: { itemId: s(cv, 'fire'), ...capturedProfiles(cv, 'fire') }, rune: { itemId: s(cv, 'rune'), ...capturedProfiles(cv, 'rune') } },
    wildernessDragonSource: { shallowTier: n(dv, 'shallowTier'), scales: { itemId: s(dv, 'scales'), chance: n(dv, 'scalesChance'),
      quantity: { shallow: [n(dv, 'scalesLow'), n(dv, 'shallowHigh')], deep: [n(dv, 'scalesLow'), n(dv, 'deepHigh')] } },
      fireEssence: { itemId: s(dv, 'fire'), roll: capturedRoll(dv, 'fire') } },
  }, 'descendantLootParams');
  const inputs: (SourceLootInput | DescendantLootInput)[] = wilderness.inputs.map(row => row.kind === 'wildernessDragon'
    ? parseValue(DescendantLootInputSchema, { id: row.id, kind: 'wildernessDragonSource', tier: row.tier }, row.id)
    : parseValue(SourceLootInputSchema, row.kind === 'wildernessBody' ? { id: row.id, kind: 'authored', drops: [] }
      : { id: row.id, kind: 'inherit', sourceInputId: row.sourceInputId }, row.id));
  const forms = array(declaration(fairy, 'FAIRY_CROWN_FORMS')).map(object);
  for (const row of descendants.inputs) {
    if (row.kind === 'crownwardDragon') inputs.push(parseValue(DescendantLootInputSchema, { id: row.id, kind: 'crownwardDragon', boss: row.rank === 'boss' }, row.id));
    else {
      const form = forms.find(form => string(get(form, 'id')) === row.speciesId)!;
      inputs.push(parseValue(DescendantLootInputSchema, { id: row.id, kind: 'fairyCrown', speciesId: row.speciesId,
        tier: row.tier, regionId: string(get(form, 'regionId')), boss: row.boss }, row.id));
    }
  }
  assert(inputs.length === 40 && new Set(inputs.map(row => row.id)).size === 40, 'Expected 40 unique source loot inputs');
  const origins = [...wilderness.manifest.rows, ...descendants.manifest.rows.map(row => ({ ...row, catalogModule: row.module }))];
  const sourceInputJoins = inputs.map(input => {
    const origin = origins.find(row => row.inputId === input.id)!;
    const owner = baseline.records.creatures.find(row => row.id === origin.speciesId && row.catalog === origin.catalog);
    assert(owner, `Missing original source owner ${origin.speciesId}`);
    return { inputId: input.id, sourceInputId: input.id, speciesId: origin.speciesId, enemyId: owner.blockId, lootTableId: owner.lootTableId };
  });
  const ownerProposals = sourceInputJoins.map(join => {
    const input = inputs.find(row => row.id === join.inputId)!;
    const alternative = input.kind === 'authored' || input.kind === 'wildernessDragonSource';
    const catalog = alternative ? 'CREATURE_SOURCE_LOOT' as const : 'ENEMY_BLOCK_LOOT' as const;
    const ownerId = alternative ? join.speciesId : join.enemyId;
    const expectedId = `${alternative ? 'loot_species_' : 'loot_enemy_'}${ownerId}`;
    assert(join.lootTableId === expectedId && baseline.records.lootTables.some(row => row.id === expectedId && row.catalog === catalog && row.ownerId === ownerId),
      `Original source loot owner mismatch ${join.inputId}`);
    return { lootTableId: expectedId, ownerId, catalog, inputId: join.inputId, formula: input.kind !== 'authored' };
  });
  assert(new Set(ownerProposals.map(row => row.lootTableId)).size === 40 && ownerProposals.filter(row => row.catalog === 'CREATURE_SOURCE_LOOT').length === 18,
    'Expected 40 independent owners including 18 pre-progression alternatives');
  return { params, inputs, sourceInputJoins, ownerProposals, externalFabric,
    manifest: { sources: files, rows: origins, parameters: [
      { parameterPath: 'fairyCrown', module: 'fairyCrownCreatures', symbol: 'dropsFor' },
      { parameterPath: 'crownwardDragon', module: 'crownwardDragons', symbol: 'CROWNWARD_DRAGON_SPECIES' },
      { parameterPath: 'wildernessDragonSource', module: 'wildernessDragons', symbol: 'DRAGON_SPECIES' },
    ], externalParameters: [
      { parameterPath: 'regionalFabric', module: 'regionalTierEquipment', symbol: 'regionalFabricDrops' },
      { parameterPath: 'regionalCraftingTiers', module: 'regionalTierEquipment', symbol: 'REGIONAL_CRAFTING_TIERS' },
    ] } };
}
