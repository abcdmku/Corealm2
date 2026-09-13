/** Extract actor factory arguments and constants from immutable original source text. */
import { createHash } from 'node:crypto';
import { parseValue } from '../../game/src/content/schema/core.js';
import { ActorSourceInputsSchema, ActorSourceParamsSchema } from '../../game/src/content/schema/enemyActorSources.js';
import type { M4Baseline } from './m4-baseline.js';

export const ACTOR_SOURCE_MODULES = ['universalMinibosses', 'fairyCreatures', 'fairyGardenCreatures', 'encounterBalance'] as const;
type Module = typeof ACTOR_SOURCE_MODULES[number];
export type ActorEnemySources = { [K in Module]: string };
interface Origin { inputId: string; module: Module; symbol: string; rowIndex: number; catalog: string; tier: number }
type Properties = Map<string, string[]>;
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Actor enemy source extraction: ${message}`); }

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
  throw new Error('Actor enemy source extraction: Unclosed delimiter');
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

function literal(value: readonly string[]): string | number {
  return /^['"]/.test(value[0] ?? '') ? string(value) : number(value);
}
function constArray(values: readonly string[]): string[][] {
  assert(values[0] === '[', 'Expected const array');
  const end = closeAt(values, 0); capture(values.slice(end + 1), 'as const', 'const array suffix');
  return array(values.slice(0, end + 1));
}
function template(values: string[], range: boolean): { [key: string]: string | number } {
  const row = object(declaration(values, 'template'));
  fields(row, ['id', 'family', 'name', 'tier', 'maxHealth', 'attackLevel', 'defenceLevel', 'accuracy',
    'armour', 'magicArmour', 'maxHit', 'attackSpeedMs', 'aggroRadius', ...(range ? ['attackRangeM'] : []),
    'moveSpeedMps', 'walkSpeedMps', 'behaviour', 'drops'], 'actor template');
  capture(get(row, 'drops'), '[]', 'actor template empty drops');
  return Object.fromEntries([...row].filter(([key]) => key !== 'drops').map(([key, value]) => [key, literal(value)]));
}

export function buildActorEnemySources(baseline: M4Baseline, sources: ActorEnemySources) {
  assert(Object.keys(sources).length === ACTOR_SOURCE_MODULES.length, 'Expected all four original actor source modules');
  const files = ACTOR_SOURCE_MODULES.map(module => {
    const path = `.baseline/game/src/content/${module}.ts`, source = sources[module];
    assert(typeof source === 'string', `Missing ${module} source`);
    const sha256 = createHash('sha256').update(source).digest('hex');
    const expected = baseline.source.files.filter(file => file.path === path);
    assert(expected.length === 1 && expected[0]!.sha256 === sha256, `${module} source hash does not match baseline`);
    return { module, path, sha256 };
  });
  const origins: Origin[] = [];
  const universal = tokens(sources.universalMinibosses), fairy = tokens(sources.fairyCreatures), garden = tokens(sources.fairyGardenCreatures);
  const universalFn = fn(universal, 'universalMinibossSpecies');
  capture(declaration(universalFn.body, 'row'),
    'UNIVERSAL_MINIBOSS_ROSTER.find(candidate => candidate.number === number)!', 'universal roster lookup');
  const tierRule = capture(declaration(universalFn.body, 'tier'),
    'tierOverride ?? Math.max(__minimum, REGION_COMBAT_TIERS[regionId])', 'universal tier');
  const levelRule = capture(declaration(universalFn.body, 'targetLevel'),
    'Math.max(__minimum, Math.round(tier * __multiplier))', 'universal target level');
  const universalStats = object(declaration(universalFn.body, 'stats'));
  fields(universalStats, ['...tuneEnemyCombatLevel(template,targetLevel,tier)', 'id', 'family', 'name',
    'attackStyle', 'respawnSeconds', 'drops', 'marks'], 'universal stats');
  capture(get(universalStats, 'id'), '`guardian_${number}_t${tier}`', 'universal identity');
  capture(get(universalStats, 'family'), '`guardian_${number}`', 'universal family');
  capture(get(universalStats, 'name'), 'row.name', 'universal name');
  capture(get(universalStats, 'attackStyle'), 'row.style', 'universal style');
  capture(get(universalStats, 'respawnSeconds'), 'UNIVERSAL_MINIBOSS_RESPAWN_SECONDS', 'universal respawn reference');
  const returnIndex = universalFn.body.indexOf('return');
  assert(returnIndex >= 0 && universalFn.body[returnIndex + 1] === '{', 'Missing universal species return');
  const universalSpecies = object(universalFn.body.slice(returnIndex + 1, closeAt(universalFn.body, returnIndex + 1) + 1));
  capture(get(universalSpecies, 'id'), '`guardian_${number}_${regionId}${tierOverride ? `_t${tierOverride}` : ""}`', 'universal species identity');
  capture(get(universalSpecies, 'regionId'), 'regionId', 'universal species region');
  capture(get(universalSpecies, 'stats'), 'stats', 'universal species stats');
  const universalMarks = capture(get(universalStats, 'marks'),
    '[Math.max(__lowMinimum, tier * __lowPerTier), Math.max(__highMinimum, tier * __highPerTier)]', 'universal marks');
  const respawn = capture(declaration(universal, 'UNIVERSAL_MINIBOSS_RESPAWN_SECONDS'), '__minutes * __seconds', 'universal respawn');
  const universalAssembly = capture(declaration(universal, 'UNIVERSAL_MINIBOSS_SPECIES'),
    `(Object.keys(REGION_COMBAT_TIERS) as RegionId[]).flatMap(regionId =>
      UNIVERSAL_MINIBOSS_ROSTER.flatMap(row => [universalMinibossSpecies(row.number, regionId),
        ...(regionId === __deepRegion ? [universalMinibossSpecies(row.number, regionId, __deepTier)] : [])]))`, 'universal assembly');
  capture(declaration(universal, 'UNIVERSAL_MINIBOSS_ENEMIES'),
    '[...new Map(UNIVERSAL_MINIBOSS_SPECIES.map(species => [species.stats.id, species.stats]),).values()]', 'universal owner deduplication');
  const universalRoster = constArray(declaration(universal, 'UNIVERSAL_MINIBOSS_ROSTER')).map((value, rowIndex) => {
    const row = object(value); fields(row, ['number', 'name', 'style', 'unique'], 'universal roster');
    return { number: string(get(row, 'number')), name: string(get(row, 'name')), style: string(get(row, 'style')), rowIndex };
  });
  const regions = [...object(declaration(tokens(sources.encounterBalance), 'REGION_COMBAT_TIERS'))]
    .map(([regionId, tier]) => ({ regionId, tier: number(tier) }));
  assert(regions.some(row => row.regionId === s(universalAssembly, 'deepRegion')), 'Missing universal deep region');
  const universalSpeciesMappings: { speciesId: string; sourceInputId: string; regionId: string; tier: number }[] = [];
  const owners = new Map<string, { id: string; kind: 'universal'; number: string; name: string; style: string; tier: number }>();
  for (const region of regions) for (const row of universalRoster) {
    const tiers = [Math.max(n(tierRule, 'minimum'), region.tier),
      ...(region.regionId === s(universalAssembly, 'deepRegion') ? [n(universalAssembly, 'deepTier')] : [])];
    tiers.forEach((tier, tierIndex) => {
      const enemyId = `guardian_${row.number}_t${tier}`, id = `universal/${enemyId}`;
      universalSpeciesMappings.push({ speciesId: `guardian_${row.number}_${region.regionId}${tierIndex ? `_t${tier}` : ''}`,
        sourceInputId: id, regionId: region.regionId, tier });
      if (!owners.has(id)) origins.push({ inputId: id, module: 'universalMinibosses', symbol: 'UNIVERSAL_MINIBOSS_ROSTER',
        rowIndex: row.rowIndex, catalog: 'UNIVERSAL_MINIBOSS_ENEMIES', tier });
      owners.set(id, { id, kind: 'universal', number: row.number, name: row.name, style: row.style, tier });
    });
  }
  verifyIds(baseline, 'universalMinibosses', 'UNIVERSAL_MINIBOSS_SPECIES', universalSpeciesMappings.map(row => row.speciesId), 90);
  verifyIds(baseline, 'universalMinibosses', 'UNIVERSAL_MINIBOSS_ENEMIES', [...owners.values()].map(row => `guardian_${row.number}_t${row.tier}`), 63);

  const fairyExpression = declaration(fairy, 'FAIRY_CREATURE_SPECIES');
  const fairyRegionEnd = closeAt(fairyExpression, 1);
  capture(fairyExpression.slice(0, 2), '([', 'fairy region array');
  const fairyRegions = array(fairyExpression.slice(1, fairyRegionEnd + 1)).map(value => {
    const row = object(value); fields(row, ['regionId', 'tier'], 'fairy region');
    return { regionId: string(get(row, 'regionId')), tier: number(get(row, 'tier')) };
  });
  capture(fairyExpression.slice(fairyRegionEnd + 1, fairyRegionEnd + 1 + tokens('as const).flatMap(({ regionId, tier }) => FAIRY_CREATURE_ROSTER.map((row): CreatureSpeciesDef => ({').length),
    'as const).flatMap(({ regionId, tier }) => FAIRY_CREATURE_ROSTER.map((row): CreatureSpeciesDef => ({', 'fairy mapping');
  const fairyStats = mappedStats(fairyExpression, 'fairy');
  fields(fairyStats, ['...tuneEnemyCombatLevel(template,tier+row.levelOffset,tier)', 'id', 'family', 'name',
    'behaviour', 'aggroRadius', 'drops', 'marks'], 'fairy stats');
  capture(get(fairyStats, 'id'), '`${row.id}_t${tier}`', 'fairy identity');
  capture(get(fairyStats, 'family'), 'row.id', 'fairy family');
  capture(get(fairyStats, 'name'), 'row.name', 'fairy name');
  const fairyBehaviour = capture(get(fairyStats, 'behaviour'),
    'row.levelOffset >= __threshold ? "aggressive" : "territorial"', 'fairy behaviour');
  const fairyAggro = capture(get(fairyStats, 'aggroRadius'),
    'row.levelOffset >= __threshold ? __aggressive : __other', 'fairy aggro');
  assert(n(fairyBehaviour, 'threshold') === n(fairyAggro, 'threshold'), 'Fairy behaviour and aggro thresholds disagree');
  const fairyMarks = capture(get(fairyStats, 'marks'), '[tier * __low, tier * __high] as [number, number]', 'fairy marks');
  const fairyRoster = constArray(declaration(fairy, 'FAIRY_CREATURE_ROSTER')).map(value => {
    const row = object(value); fields(row, ['number', 'id', 'name', 'levelOffset', 'nativeScale'], 'fairy roster');
    return { family: string(get(row, 'id')), name: string(get(row, 'name')), levelOffset: number(get(row, 'levelOffset')) };
  });
  const fairyInputs = fairyRegions.flatMap(({ tier }) => fairyRoster.map((row, rowIndex) => {
    const speciesId = `${row.family}_t${tier}`, id = `fairy/${speciesId}`;
    origins.push({ inputId: id, module: 'fairyCreatures', symbol: 'FAIRY_CREATURE_ROSTER', rowIndex, catalog: 'FAIRY_CREATURE_SPECIES', tier });
    return { id, kind: 'fairy', ...row, speciesId, tier };
  }));
  verifyIds(baseline, 'fairyCreatures', 'FAIRY_CREATURE_SPECIES', fairyInputs.map(row => row.speciesId), 12);

  const gardenAssembly = declaration(garden, 'FAIRY_GARDEN_VARIANTS'), gardenRegionsEnd = closeAt(gardenAssembly, 1);
  capture(gardenAssembly.slice(0, 2), '([', 'garden region array');
  const gardenRegions = array(gardenAssembly.slice(1, gardenRegionsEnd + 1)).map(value => {
    const row = object(value); fields(row, ['regionId', 'tier'], 'garden region');
    return { regionId: string(get(row, 'regionId')), tier: number(get(row, 'tier')) };
  });
  capture(gardenAssembly.slice(gardenRegionsEnd + 1), `as const)
    .flatMap(({ regionId, tier }, index) => FAIRY_GARDEN_FORMS.map(form => ({
      ...form, regionId, tier, name: form.names[index]!, family: \`garden_\${form.id}\`, id: \`garden_\${form.id}_t\${tier}\`,
      assetId: \`fairy_garden_\${form.id}_\${regionId}\`, })))`, 'garden variant mapping');
  const gardenExpression = declaration(garden, 'FAIRY_GARDEN_SPECIES');
  capture(gardenExpression.slice(0, tokens('FAIRY_GARDEN_VARIANTS.map(form => ({').length),
    'FAIRY_GARDEN_VARIANTS.map(form => ({', 'garden species mapping');
  const gardenStats = mappedStats(gardenExpression, 'garden');
  fields(gardenStats, ['...tuneEnemyCombatLevel(template,form.tier+form.level,form.tier)', 'id', 'family', 'name',
    'behaviour', 'moveSpeedMps', 'walkSpeedMps', 'aggroRadius', 'drops', 'marks'], 'garden stats');
  for (const key of ['id', 'family', 'name', 'behaviour']) capture(get(gardenStats, key), `form.${key}`, `garden ${key}`);
  capture(get(gardenStats, 'moveSpeedMps'), 'form.speed', 'garden speed');
  const gardenWalk = capture(get(gardenStats, 'walkSpeedMps'), 'Math.min(__cap, form.speed * __multiplier)', 'garden walk speed');
  const gardenAggro = capture(get(gardenStats, 'aggroRadius'), 'form.behaviour === "aggressive" ? __aggressive : __other', 'garden aggro');
  const gardenMarks = capture(get(gardenStats, 'marks'), '[form.tier * __low, form.tier * __high]', 'garden marks');
  const gardenRoster = constArray(declaration(garden, 'FAIRY_GARDEN_FORMS')).map(value => {
    const row = object(value); fields(row, ['id', 'source', 'names', 'scale', 'level', 'speed', 'activity', 'behaviour', 'look', 'description'], 'garden roster');
    const names = array(get(row, 'names')).map(string); assert(names.length === gardenRegions.length, 'Garden names must match region count');
    return { family: `garden_${string(get(row, 'id'))}`, names, levelOffset: number(get(row, 'level')),
      speed: number(get(row, 'speed')), behaviour: string(get(row, 'behaviour')) };
  });
  const gardenInputs = gardenRegions.flatMap(({ tier }, index) => gardenRoster.map(({ names, ...row }, rowIndex) => {
    const speciesId = `${row.family}_t${tier}`, id = `garden/${speciesId}`;
    origins.push({ inputId: id, module: 'fairyGardenCreatures', symbol: 'FAIRY_GARDEN_FORMS', rowIndex, catalog: 'FAIRY_GARDEN_SPECIES', tier });
    return { id, kind: 'garden', ...row, speciesId, name: names[index]!, tier };
  }));
  verifyIds(baseline, 'fairyGardenCreatures', 'FAIRY_GARDEN_SPECIES', gardenInputs.map(row => row.speciesId), 24);
  const params = parseValue(ActorSourceParamsSchema, {
    universal: { template: template(universal, true), minimumRegionTier: n(tierRule, 'minimum'),
      minimumTargetLevel: n(levelRule, 'minimum'), targetLevelMultiplier: n(levelRule, 'multiplier'),
      respawnSeconds: n(respawn, 'minutes') * n(respawn, 'seconds'),
      marksMinimum: [n(universalMarks, 'lowMinimum'), n(universalMarks, 'highMinimum')],
      marksPerTier: [n(universalMarks, 'lowPerTier'), n(universalMarks, 'highPerTier')] },
    fairy: { template: template(fairy, false), aggressiveLevelOffset: n(fairyBehaviour, 'threshold'),
      aggroRadius: { aggressive: n(fairyAggro, 'aggressive'), other: n(fairyAggro, 'other') },
      marksPerTier: [n(fairyMarks, 'low'), n(fairyMarks, 'high')] },
    garden: { template: template(garden, false), walkSpeedCap: n(gardenWalk, 'cap'), walkSpeedMultiplier: n(gardenWalk, 'multiplier'),
      aggroRadius: { aggressive: n(gardenAggro, 'aggressive'), other: n(gardenAggro, 'other') },
      marksPerTier: [n(gardenMarks, 'low'), n(gardenMarks, 'high')] },
  }, 'actorParams');
  const inputs = parseValue(ActorSourceInputsSchema, [...owners.values(), ...fairyInputs, ...gardenInputs], 'actorSourceInputs');
  return { params, inputs, universalSpeciesMappings, manifest: { sources: files, rows: origins, parameters: [
    { parameterPath: 'universal', module: 'universalMinibosses', symbol: 'universalMinibossSpecies', templateSymbol: 'template' },
    { parameterPath: 'regionCombatTiers', module: 'encounterBalance', symbol: 'REGION_COMBAT_TIERS' },
    { parameterPath: 'fairy', module: 'fairyCreatures', symbol: 'FAIRY_CREATURE_SPECIES', templateSymbol: 'template' },
    { parameterPath: 'garden', module: 'fairyGardenCreatures', symbol: 'FAIRY_GARDEN_SPECIES', templateSymbol: 'template' },
  ] } };
}


