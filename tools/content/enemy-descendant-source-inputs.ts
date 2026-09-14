/** Extract fairy crown and Crownward dragon source arguments from immutable originals. */
import { createHash } from 'node:crypto';
import { parseValue } from '../../game/src/content/schema/core.js';
import { DescendantSourceInputsSchema, DescendantSourceParamsSchema } from '../../game/src/content/schema/enemyDescendantSources.js';
import type { EnemySourceGraphInput } from '../../game/src/content/schema/enemySourceGraph.js';
import type { WildernessBaseSourceInput } from '../../game/src/content/schema/enemyWildernessSources.js';
import type { M4Baseline } from './m4-baseline.js';

export const DESCENDANT_SOURCE_MODULES = ['fairyCrownCreatures', 'crownwardDragons'] as const;
type Module = typeof DESCENDANT_SOURCE_MODULES[number];
export type DescendantEnemySources = { [K in Module]: string };
export type DescendantAvailableInput = EnemySourceGraphInput | WildernessBaseSourceInput;
interface Origin { inputId: string; module: Module; symbol: string; rowIndex: number; catalog: string; speciesId: string }
type Properties = Map<string, string[]>;
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Descendant enemy source extraction: ${message}`); }

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
  throw new Error('Descendant enemy source extraction: Unclosed delimiter');
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

function originalIds(baseline: M4Baseline, module: string, catalog: string): string[] {
  const exports = baseline.constants.filter(row => row.module === module && row.name === catalog);
  assert(exports.length === 1 && exports[0]!.value.kind === 'array', `Missing ${module}.${catalog} original identities`);
  return exports[0]!.value.values.map(row => {
    assert(row.kind === 'object', `Invalid original ${catalog} row`);
    const id = row.entries.find(([key]) => key === 'id')?.[1]; assert(id?.kind === 'string', `Missing original ${catalog} identity`);
    return id.value;
  });
}
function verifyIds(baseline: M4Baseline, module: string, catalog: string, actual: string[], count: number): void {
  const expected = originalIds(baseline, module, catalog);
  assert(actual.length === count && expected.length === count && new Set(actual).size === count
    && actual.every((id, index) => id === expected[index]), `${catalog} source identity/count/order mismatch`);
}
function sourceSpeciesId(input: DescendantAvailableInput): string | undefined {
  if (input.kind === 'expansion') return input.identity.family;
  if (input.kind === 'wildernessBody' && input.role === 'keeper') return input.keeperId;
  return 'speciesId' in input ? input.speciesId : undefined;
}

/** Combat projection excludes this complete loot expression; its separate owner extracts the rolls. */
function hideCrownwardLoot(expression: string[]): string[] {
  const indices = expression.flatMap((value, index) => value === 'drops' && expression[index + 1] === ':' ? [index + 2] : []);
  assert(indices.length === 1 && expression[indices[0]!] === '[', 'Expected one Crownward source loot array');
  const start = indices[0]!;
  return [...expression.slice(0, start), 'ORIGINAL_SOURCE_LOOT', ...expression.slice(closeAt(expression, start) + 1)];
}

export function buildDescendantEnemySources(baseline: M4Baseline, sources: DescendantEnemySources,
  availableInputs: readonly DescendantAvailableInput[]) {
  assert(Object.keys(sources).length === DESCENDANT_SOURCE_MODULES.length, 'Expected both original descendant source modules');
  const files = DESCENDANT_SOURCE_MODULES.map(module => {
    const path = `.baseline/game/src/content/${module}.ts`, source = sources[module];
    assert(typeof source === 'string', `Missing ${module} source`);
    const sha256 = createHash('sha256').update(source).digest('hex'), matches = baseline.source.files.filter(file => file.path === path);
    assert(matches.length === 1 && matches[0]!.sha256 === sha256, `${module} source hash does not match baseline`);
    return { module, path, sha256 };
  });
  const byInputId = new Map(availableInputs.map(input => [input.id, input]));
  assert(byInputId.size === availableInputs.length, 'Duplicate available source input id');
  // These identities establish membership in the original lookup, never numeric seeds.
  const sourceCatalogs = [
    ['creatureExpansion', 'CREATURE_EXPANSION', 'expansion'], ['rpgBestiary', 'RPG_BESTIARY', 'rpg'],
    ['forestCreatureRedesigns', 'FOREST_CREATURE_REDESIGNS', 'forest'], ['ashCreatureRedesigns', 'ASH_CREATURE_REDESIGNS', 'ash'],
    ['regionalBossBodies', 'REGIONAL_BOSS_SPECIES', 'regionalBossBody'], ['wildernessCreatureSpecies', 'WILDERNESS_CREATURE_SPECIES', 'wildernessBody'],
  ] as const;
  const fairyLookup = new Map<string, string>();
  for (const [module, catalog, prefix] of sourceCatalogs) for (const speciesId of originalIds(baseline, module, catalog)) fairyLookup.set(speciesId, `${prefix}/${speciesId}`);
  const dragonLookup = new Map(originalIds(baseline, 'wildernessDragons', 'WILDERNESS_DRAGONS').map(speciesId => [speciesId, `wildernessDragon/${speciesId}`]));
  function dependency(speciesId: string, dragon: boolean): string {
    const inputId = (dragon ? dragonLookup : fairyLookup).get(speciesId);
    assert(inputId, `Missing original ${dragon ? 'dragon' : 'fairy crown'} source species ${speciesId}`);
    const input = byInputId.get(inputId);
    assert(input && sourceSpeciesId(input) === speciesId, `Missing source dependency ${inputId}`);
    const prefix = inputId.slice(0, inputId.indexOf('/'));
    assert(prefix === 'forest' || prefix === 'ash' ? input.kind === 'redesign' && input.profile === prefix : input.kind === prefix,
      `Wrong source dependency kind for ${inputId}`);
    return inputId;
  }
  const origins: Origin[] = [];
  const fairy = tokens(sources.fairyCrownCreatures);
  capture(declaration(fairy, 'sourceSpecies'), `new Map([
    ...CREATURE_EXPANSION, ...RPG_BESTIARY, ...FOREST_CREATURE_REDESIGNS,
    ...ASH_CREATURE_REDESIGNS, ...REGIONAL_BOSS_SPECIES, ...WILDERNESS_CREATURE_SPECIES,
  ].map(species => [species.id, species]))`, 'fairy crown source lookup order');
  const fairyValues = capture(declaration(fairy, 'FAIRY_CROWN_SPECIES'), `FAIRY_CROWN_FORMS.map(form => {
    const source = sourceSpecies.get(form.sourceSpeciesId);
    if (!source) throw new Error(\`Missing source creature \${form.sourceSpeciesId} for \${form.id}\`);
    const base = source.stats;
    const stats = tuneEnemyCombatLevel({
      ...base, id: \`\${form.id}_t\${form.tier}\`, family: form.id, name: form.name,
      tier: form.tier, behaviour: form.behaviour,
      ...(base.moveSpeedMps === undefined ? {} : { moveSpeedMps: base.moveSpeedMps * Math.min(__movementCap, form.nativeScale) }),
      ...(base.walkSpeedMps === undefined ? {} : { walkSpeedMps: base.walkSpeedMps * Math.min(__movementCap, form.nativeScale) }),
      attackRangeM: form.boss ? Math.max(__bossRangeMinimum, base.attackRangeM ?? __bossRangeFallback) : Math.min(__ordinaryRangeMaximum, base.attackRangeM ?? __ordinaryRangeFallback),
      aggroRadius: form.boss ? __aggroBoss : form.behaviour === 'passive' ? __aggroPassive : form.behaviour === 'territorial' ? __aggroTerritorial : __aggroAggressive,
      marks: form.boss ? [form.tier * __marksBossLow, form.tier * __marksBossHigh] : [form.tier * __marksOrdinaryLow, form.tier * __marksOrdinaryHigh],
      drops: dropsFor(form),
    }, form.level, form.tier);
    return {
      id: form.id, assetId: \`creature_\${form.id}\`, regionId: form.regionId,
      scale: form.nativeScale / tierSilhouetteScale(form.tier),
      activity: form.activity, description: form.description, stats,
    };
  })`, 'fairy crown source generation');
  const fairyInputs = array(declaration(fairy, 'FAIRY_CROWN_FORMS')).map((value, rowIndex) => {
    const row = object(value), boss = row.has('boss');
    fields(row, ['id', 'sourceSpeciesId', 'sourceAssetId', 'name', 'regionId', 'tier', 'level', 'nativeScale', 'activity', 'behaviour', 'description',
      ...(boss ? ['boss'] : [])], 'fairy crown form');
    if (boss) capture(get(row, 'boss'), 'true', 'fairy crown boss flag');
    const speciesId = string(get(row, 'id')), id = `fairyCrown/${speciesId}`, tier = number(get(row, 'tier'));
    const regionId = string(get(row, 'regionId'));
    assert((regionId === 'crownward' && tier === 40) || (regionId === 'gloamgarden' && tier === 30) || (regionId === 'faeholme' && tier === 60),
      `Fairy crown region/tier mismatch for ${speciesId}`);
    origins.push({ inputId: id, module: 'fairyCrownCreatures', symbol: 'FAIRY_CROWN_FORMS', rowIndex, catalog: 'FAIRY_CROWN_SPECIES', speciesId });
    return { id, kind: 'fairyCrown', speciesId, name: string(get(row, 'name')), sourceInputId: dependency(string(get(row, 'sourceSpeciesId')), false),
      tier, targetLevel: number(get(row, 'level')), nativeScale: number(get(row, 'nativeScale')), behaviour: string(get(row, 'behaviour')), boss };
  });
  verifyIds(baseline, 'fairyCrownCreatures', 'FAIRY_CROWN_SPECIES', fairyInputs.map(input => input.speciesId), 12);
  const crownward = tokens(sources.crownwardDragons), crownwardExpression = declaration(crownward, 'CROWNWARD_DRAGON_SPECIES');
  const tierEntries = crownwardExpression.flatMap((value, index) => value === 'tier' && crownwardExpression[index + 1] === ':' ? [index + 2] : []);
  assert(tierEntries.length === 1, 'Expected one Crownward combat tier');
  const crownwardTier = number([crownwardExpression[tierEntries[0]!]!]);
  const identityExpression = '`' + '${form.id}_t' + crownwardTier + '`';
  const crownwardValues = capture(hideCrownwardLoot(crownwardExpression), `CROWNWARD_DRAGON_FORMS.map(form => {
    const source = WILDERNESS_DRAGONS.find(species => species.id === form.sourceSpeciesId);
    if (!source) throw new Error(\`Missing accepted source dragon \${form.sourceSpeciesId}\`);
    const boss = form.rank === 'boss';
    return {
      id: form.id, assetId: source.assetId, regionId: 'crownward', activity: source.activity,
      scale: form.nativeScale / tierSilhouetteScale(__tier), description: form.description,
      stats: tuneEnemyCombatLevel({
        ...source.stats, id: ${identityExpression}, family: form.id, name: form.name, tier: __tier,
        behaviour: __behaviour, aggroRadius: boss ? __aggroBoss : __aggroMiniboss,
        marks: boss ? [__marksBossLow, __marksBossHigh] : [__marksMinibossLow, __marksMinibossHigh],
        drops: ORIGINAL_SOURCE_LOOT,
      }, form.level, __tier),
    };
  })`, 'Crownward dragon source generation');
  assert(n(crownwardValues, 'tier') === crownwardTier, 'Crownward tier literals must agree');
  const crownwardForms = declaration(crownward, 'CROWNWARD_DRAGON_FORMS'), formsEnd = closeAt(crownwardForms, 0);
  capture(crownwardForms.slice(formsEnd + 1), 'as const', 'Crownward forms suffix');
  const crownwardInputs = array(crownwardForms.slice(0, formsEnd + 1)).map((value, rowIndex) => {
    const row = object(value); fields(row, ['id', 'sourceSpeciesId', 'name', 'rank', 'level', 'nativeScale', 'description'], 'Crownward form');
    const speciesId = string(get(row, 'id')), id = `crownwardDragon/${speciesId}`;
    origins.push({ inputId: id, module: 'crownwardDragons', symbol: 'CROWNWARD_DRAGON_FORMS', rowIndex, catalog: 'CROWNWARD_DRAGON_SPECIES', speciesId });
    return { id, kind: 'crownwardDragon', speciesId, name: string(get(row, 'name')), sourceInputId: dependency(string(get(row, 'sourceSpeciesId')), true),
      targetLevel: number(get(row, 'level')), rank: string(get(row, 'rank')) };
  });
  verifyIds(baseline, 'crownwardDragons', 'CROWNWARD_DRAGON_SPECIES', crownwardInputs.map(input => input.speciesId), 3);
  const params = parseValue(DescendantSourceParamsSchema, {
    fairyCrown: { movementScaleCap: n(fairyValues, 'movementCap'),
      attackRangeM: { boss: { minimum: n(fairyValues, 'bossRangeMinimum'), fallback: n(fairyValues, 'bossRangeFallback') },
        ordinary: { maximum: n(fairyValues, 'ordinaryRangeMaximum'), fallback: n(fairyValues, 'ordinaryRangeFallback') } },
      aggroRadius: { boss: n(fairyValues, 'aggroBoss'), passive: n(fairyValues, 'aggroPassive'), territorial: n(fairyValues, 'aggroTerritorial'), aggressive: n(fairyValues, 'aggroAggressive') },
      marksPerTier: { ordinary: [n(fairyValues, 'marksOrdinaryLow'), n(fairyValues, 'marksOrdinaryHigh')],
        boss: [n(fairyValues, 'marksBossLow'), n(fairyValues, 'marksBossHigh')] } },
    crownwardDragon: { tier: crownwardTier, behaviour: s(crownwardValues, 'behaviour'),
      aggroRadius: { miniboss: n(crownwardValues, 'aggroMiniboss'), boss: n(crownwardValues, 'aggroBoss') },
      marks: { miniboss: [n(crownwardValues, 'marksMinibossLow'), n(crownwardValues, 'marksMinibossHigh')],
        boss: [n(crownwardValues, 'marksBossLow'), n(crownwardValues, 'marksBossHigh')] } },
  }, 'descendantSourceParams');
  const inputs = parseValue(DescendantSourceInputsSchema, [...fairyInputs, ...crownwardInputs], 'descendantSourceInputs');
  return { params, inputs, manifest: { sources: files, rows: origins, parameters: [
    { parameterPath: 'fairyCrown', module: 'fairyCrownCreatures', symbol: 'FAIRY_CROWN_SPECIES' },
    { parameterPath: 'crownwardDragon', module: 'crownwardDragons', symbol: 'CROWNWARD_DRAGON_SPECIES' },
  ] } };
}
