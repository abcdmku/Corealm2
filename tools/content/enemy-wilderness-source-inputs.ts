/** Extract pre-progression Wilderness bodies, dragons and regional boss sources. */
import { createHash } from 'node:crypto';
import { parseValue } from '../../game/src/content/schema/core.js';
import { WildernessBaseSourceInputsSchema, WildernessKeeperRowsSchema, WildernessSourceParamsSchema } from '../../game/src/content/schema/enemyWildernessSources.js';
import type { EnemySourceInput } from '../../game/src/content/schema/enemySources.js';
import type { M4Baseline } from './m4-baseline.js';

export const WILDERNESS_SOURCE_MODULES = ['wildernessCreatureSpecies', 'wildernessDragons', 'regionalBossBodies', 'wildernessDepth'] as const;
type Module = typeof WILDERNESS_SOURCE_MODULES[number];
export type WildernessEnemySources = { [K in Module]: string };
interface Origin { inputId: string; module: Module; symbol: string; rowIndex: number; catalog: string; catalogModule: Module; speciesId: string }
type Properties = Map<string, string[]>;
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Wilderness enemy source extraction: ${message}`); }

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
  throw new Error('Wilderness enemy source extraction: Unclosed delimiter');
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

function verifyIds(baseline: M4Baseline, module: Module, catalog: string, actual: string[], count: number): void {
  const original = baseline.constants.filter(row => row.module === module && row.name === catalog);
  assert(original.length === 1 && original[0]!.value.kind === 'array', `Missing ${catalog} original identities`);
  const expected = original[0]!.value.values.map(row => {
    assert(row.kind === 'object', `Invalid ${catalog} original row`);
    const id = row.entries.find(([key]) => key === 'id')?.[1]; assert(id?.kind === 'string', `Missing ${catalog} original id`);
    return id.value;
  });
  assert(actual.length === count && expected.length === count && new Set(actual).size === count
    && actual.every((id, index) => id === expected[index]), `${catalog} source identity/count/order mismatch`);
}
function call(value: readonly string[], name: string, arity: number): string[][] {
  assert(value[0] === name && value[1] === '(' && closeAt(value, 1) === value.length - 1, `Expected ${name} call`);
  const args = split(value.slice(2, -1)); assert(args.length === arity, `Unexpected ${name} argument count`); return args;
}
function constantObject(values: string[]): Properties {
  const end = closeAt(values, 0); capture(values.slice(end + 1), 'as const', 'constant object suffix');
  return object(values.slice(0, end + 1));
}

export function buildWildernessEnemySources(baseline: M4Baseline, sources: WildernessEnemySources,
  coreInputs: readonly EnemySourceInput[]) {
  assert(Object.keys(sources).length === WILDERNESS_SOURCE_MODULES.length, 'Expected all four original source modules');
  const files = WILDERNESS_SOURCE_MODULES.map(module => {
    const path = `.baseline/game/src/content/${module}.ts`, source = sources[module];
    assert(typeof source === 'string', `Missing ${module} source`);
    const sha256 = createHash('sha256').update(source).digest('hex'), matches = baseline.source.files.filter(file => file.path === path);
    assert(matches.length === 1 && matches[0]!.sha256 === sha256, `${module} source hash does not match baseline`);
    return { module, path, sha256 };
  });
  assert(new Set(coreInputs.map(row => row.id)).size === coreInputs.length, 'Duplicate core source input id');
  const origins: Origin[] = [];
  const depth = tokens(sources.wildernessDepth), keeperDeclaration = declaration(depth, 'WILDERNESS_RUNE_KEEPERS');
  const keeperEnd = closeAt(keeperDeclaration, 0);
  capture(keeperDeclaration.slice(keeperEnd + 1), 'as const', 'keeper rows suffix');
  const keepers = parseValue(WildernessKeeperRowsSchema, array(keeperDeclaration.slice(0, keeperEnd + 1)).map(value => {
    const row = object(value); fields(row, ['id', 'name', 'tier', 'multiplier', 'rune'], 'keeper row');
    return { id: string(get(row, 'id')), name: string(get(row, 'name')), tier: number(get(row, 'tier')), multiplier: number(get(row, 'multiplier')) };
  }), 'wildernessKeepers');
  verifyIds(baseline, 'wildernessDepth', 'WILDERNESS_RUNE_KEEPERS', keepers.map(row => row.id), 5);

  const bodyModule = tokens(sources.wildernessCreatureSpecies), bodyRows = array(declaration(bodyModule, 'bodies'));
  assert(bodyRows.length === 7, 'Expected six literal bodies followed by one keeper expansion');
  const ordinary = bodyRows.slice(0, 6).map((value, rowIndex) => {
    const row = object(value); fields(row, ['id', 'name', 'tier', 'level', 'role', 'description'], 'ordinary body row');
    const speciesId = string(get(row, 'id')), id = `wildernessBody/${speciesId}`;
    origins.push({ inputId: id, module: 'wildernessCreatureSpecies', symbol: 'bodies', rowIndex, catalog: 'WILDERNESS_CREATURE_SPECIES', catalogModule: 'wildernessCreatureSpecies', speciesId });
    return { id, kind: 'wildernessBody', speciesId, name: string(get(row, 'name')), tier: number(get(row, 'tier')),
      targetLevel: number(get(row, 'level')), role: string(get(row, 'role')) };
  });
  const keeperExpansion = bodyRows[6]!, keeperPrefix = '...WILDERNESS_RUNE_KEEPERS.map(keeper => (';
  const expansionStart = tokens(keeperPrefix).length;
  capture(keeperExpansion.slice(0, expansionStart), keeperPrefix, 'keeper body expansion');
  const expansionEnd = closeAt(keeperExpansion, expansionStart);
  capture(keeperExpansion.slice(expansionEnd + 1), '))', 'keeper body expansion suffix');
  const expansion = object(keeperExpansion.slice(expansionStart, expansionEnd + 1));
  fields(expansion, ['id', 'name', 'tier', 'level', 'role', 'description'], 'keeper body expansion');
  for (const field of ['id', 'name', 'tier']) capture(get(expansion, field), `keeper.${field}`, `keeper body ${field}`);
  capture(get(expansion, 'level'), 'keeper.tier * keeper.multiplier', 'keeper target');
  capture(get(expansion, 'role'), "'keeper' as const", 'keeper body role');
  const keeperInputs = keepers.map((row, rowIndex) => {
    const id = `wildernessBody/${row.id}`;
    origins.push({ inputId: id, module: 'wildernessDepth', symbol: 'WILDERNESS_RUNE_KEEPERS', rowIndex,
      catalog: 'WILDERNESS_CREATURE_SPECIES', catalogModule: 'wildernessCreatureSpecies', speciesId: row.id });
    return { id, kind: 'wildernessBody', role: 'keeper', keeperId: row.id };
  });
  verifyIds(baseline, 'wildernessCreatureSpecies', 'WILDERNESS_CREATURE_SPECIES', [...ordinary.map(row => row.speciesId), ...keepers.map(row => row.id)], 11);
  const bodyFn = fn(bodyModule, 'bodyStats'); capture(bodyFn.args.flat(), 'body: WildernessBody', 'bodyStats signature');
  const bodyValues = capture(bodyFn.body, `
    const heavy = body.role === __heavy1 || body.role === __heavy2;
    const magic = body.role === __magicRole || body.id === __magic1 || body.id === __magic2;
    const attackLevel = Math.round(body.level * (magic ? __attackMagic : heavy ? __attackHeavy : __attackOther));
    const defenceLevel = Math.round(body.level * (heavy ? __defenceHeavy : __defenceOther));
    const accuracy = magic ? __accuracyMagic : body.role === 'predator' ? __accuracyPredator : __accuracyOther;
    const armour = magic ? __armourMagic : heavy ? __armourHeavy : __armourOther;
    const magicArmour = magic ? __magicArmourMagic : body.tier === __deepTier ? __magicArmourDeep : __magicArmourOther;
    return tuneEnemyCombatLevel({
      id: \`\${body.id}_t\${body.tier}\`, family: body.id, name: body.name, tier: body.tier,
      attackStyle: magic ? 'magic' : 'melee', attackRangeM: magic ? __rangeMagic : heavy ? __rangeHeavy : __rangeOther,
      maxHealth: body.level * (heavy ? __healthHeavy : __healthOther), attackLevel, defenceLevel, accuracy, armour, magicArmour,
      maxHit: Math.round(body.tier * (body.role === 'keeper' ? __hitKeeper : heavy ? __hitHeavy : __hitOther)),
      attackSpeedMs: body.role === 'keeper' ? __cadenceKeeper : heavy ? __cadenceHeavy : magic ? __cadenceMagic : __cadenceOther,
      aggroRadius: body.role === 'keeper' ? __aggroKeeper : magic ? __aggroMagic : __aggroOther,
      moveSpeedMps: magic ? __moveMagic : heavy ? __moveHeavy : __moveOther,
      walkSpeedMps: heavy ? __walkHeavy : __walkOther,
      behaviour: heavy ? 'territorial' : 'aggressive', drops: [],
      marks: [body.tier, body.tier * (body.role === 'keeper' ? __marksKeeper : __marksOther)],
    }, body.level, body.tier);`, 'bodyStats arithmetic');
  capture(declaration(bodyModule, 'WILDERNESS_CREATURE_SPECIES'), `bodies.map(body => ({
    id: body.id, assetId: \`creature_\${body.id}\`, scale: 1 / tierSilhouetteScale(body.tier), regionId: 'wilderness',
    activity: body.role === 'heavy' ? 'graze' : body.role === 'predator' ? 'prowl' : 'patrol',
    description: body.description, stats: bodyStats(body),
  }))`, 'body source mapping');
  const bodyParams = {
    heavyRoles: [s(bodyValues, 'heavy1'), s(bodyValues, 'heavy2')], magicRoles: [s(bodyValues, 'magicRole')],
    magicSpeciesIds: [s(bodyValues, 'magic1'), s(bodyValues, 'magic2')], deepTier: n(bodyValues, 'deepTier'),
    attackLevelMultiplier: { magic: n(bodyValues, 'attackMagic'), heavy: n(bodyValues, 'attackHeavy'), other: n(bodyValues, 'attackOther') },
    defenceLevelMultiplier: { heavy: n(bodyValues, 'defenceHeavy'), other: n(bodyValues, 'defenceOther') },
    healthPerLevel: { heavy: n(bodyValues, 'healthHeavy'), other: n(bodyValues, 'healthOther') },
    accuracy: { magic: n(bodyValues, 'accuracyMagic'), predator: n(bodyValues, 'accuracyPredator'), other: n(bodyValues, 'accuracyOther') },
    armour: { magic: n(bodyValues, 'armourMagic'), heavy: n(bodyValues, 'armourHeavy'), other: n(bodyValues, 'armourOther') },
    magicArmour: { magic: n(bodyValues, 'magicArmourMagic'), deep: n(bodyValues, 'magicArmourDeep'), other: n(bodyValues, 'magicArmourOther') },
    maxHitPerTier: { keeper: n(bodyValues, 'hitKeeper'), heavy: n(bodyValues, 'hitHeavy'), other: n(bodyValues, 'hitOther') },
    attackRangeM: { magic: n(bodyValues, 'rangeMagic'), heavy: n(bodyValues, 'rangeHeavy'), other: n(bodyValues, 'rangeOther') },
    attackSpeedMs: { keeper: n(bodyValues, 'cadenceKeeper'), heavy: n(bodyValues, 'cadenceHeavy'), magic: n(bodyValues, 'cadenceMagic'), other: n(bodyValues, 'cadenceOther') },
    aggroRadius: { keeper: n(bodyValues, 'aggroKeeper'), magic: n(bodyValues, 'aggroMagic'), other: n(bodyValues, 'aggroOther') },
    moveSpeedMps: { magic: n(bodyValues, 'moveMagic'), heavy: n(bodyValues, 'moveHeavy'), other: n(bodyValues, 'moveOther') },
    walkSpeedMps: { heavy: n(bodyValues, 'walkHeavy'), other: n(bodyValues, 'walkOther') },
    // The original first mark is the tier itself, so its coefficient is exactly one.
    marks: { minimumPerTier: 1, maximumPerTier: { keeper: n(bodyValues, 'marksKeeper'), other: n(bodyValues, 'marksOther') } },
  };

  const dragonModule = tokens(sources.wildernessDragons), dragonExpression = declaration(dragonModule, 'DRAGON_SPECIES');
  const dragonRowsEnd = closeAt(dragonExpression, 0), dragonRows = array(dragonExpression.slice(0, dragonRowsEnd + 1));
  const dragonSuffix = dragonExpression.slice(dragonRowsEnd + 1), dragonPrefix = '.map(row => (';
  const dragonObjectStart = tokens(dragonPrefix).length; capture(dragonSuffix.slice(0, dragonObjectStart), dragonPrefix, 'dragon mapping');
  const dragonObjectEnd = closeAt(dragonSuffix, dragonObjectStart);
  capture(dragonSuffix.slice(dragonObjectEnd + 1), '))', 'dragon mapping suffix');
  const dragonOutput = object(dragonSuffix.slice(dragonObjectStart, dragonObjectEnd + 1));
  fields(dragonOutput, ['id', 'assetId', 'scale', 'regionId', 'activity', 'description', 'stats'], 'dragon source output');
  const dragonArgs = call(get(dragonOutput, 'stats'), 'tuneEnemyCombatLevel', 2);
  capture(dragonArgs[1]!, 'row.combatLevel', 'dragon tuning target');
  const dragonStats = object(dragonArgs[0]!);
  fields(dragonStats, ['id', 'family', 'name', 'tier', 'maxHealth', 'attackLevel', 'defenceLevel', 'accuracy', 'armour', 'magicArmour',
    'maxHit', 'attackSpeedMs', 'attackStyle', 'attackRangeM', 'aggroRadius', 'moveSpeedMps', 'walkSpeedMps', 'behaviour', 'marks', 'drops'], 'dragon stats');
  capture(get(dragonStats, 'id'), '`${row.id}_t${row.tier}`', 'dragon identity');
  for (const [field, expression] of [['family', 'row.id'], ['name', 'row.name'], ['tier', 'row.tier'], ['attackStyle', "'melee'"], ['behaviour', "'aggressive'"]] as const)
    capture(get(dragonStats, field), expression, `dragon ${field}`);
  const health = capture(get(dragonStats, 'maxHealth'), 'row.tier * __value', 'dragon health');
  const attack = capture(get(dragonStats, 'attackLevel'), 'row.tier - __value', 'dragon attack');
  const defence = capture(get(dragonStats, 'defenceLevel'), 'row.tier - __value', 'dragon defence');
  const hit = capture(get(dragonStats, 'maxHit'), 'Math.round(row.tier * __value)', 'dragon hit');
  const dragonMarks = capture(get(dragonStats, 'marks'), '[row.tier * __low, row.tier * __high]', 'dragon marks');
  const profiles = ['attackSpeedMs', 'attackRangeM', 'aggroRadius', 'moveSpeedMps', 'walkSpeedMps'].map(field => {
    const choices = capture(get(dragonStats, field), 'row.tier === __tier ? __shallow : __deep', `dragon ${field}`);
    return { field, tier: n(choices, 'tier'), shallow: n(choices, 'shallow'), deep: n(choices, 'deep') };
  });
  assert(profiles.every(profile => profile.tier === profiles[0]!.tier), 'Dragon profile selectors must agree');
  const dragonParams = {
    shallowTier: profiles[0]!.tier, healthPerTier: n(health, 'value'), attackLevelOffset: -n(attack, 'value'), defenceLevelOffset: -n(defence, 'value'),
    accuracy: number(get(dragonStats, 'accuracy')), armour: number(get(dragonStats, 'armour')), magicArmour: number(get(dragonStats, 'magicArmour')),
    maxHitPerTier: n(hit, 'value'), marksPerTier: [n(dragonMarks, 'low'), n(dragonMarks, 'high')],
    shallow: Object.fromEntries(profiles.map(profile => [profile.field, profile.shallow])),
    deep: Object.fromEntries(profiles.map(profile => [profile.field, profile.deep])),
  };
  const dragonInputs = dragonRows.map((value, rowIndex) => {
    const row = object(value); fields(row, ['id', 'name', 'tier', 'combatLevel', 'description'], 'dragon row');
    const speciesId = string(get(row, 'id')), id = `wildernessDragon/${speciesId}`;
    origins.push({ inputId: id, module: 'wildernessDragons', symbol: 'DRAGON_SPECIES', rowIndex, catalog: 'WILDERNESS_DRAGONS', catalogModule: 'wildernessDragons', speciesId });
    return { id, kind: 'wildernessDragon', speciesId, name: string(get(row, 'name')), tier: number(get(row, 'tier')), targetLevel: number(get(row, 'combatLevel')) };
  });
  capture(declaration(dragonModule, 'WILDERNESS_DRAGONS'), 'DRAGON_SPECIES', 'dragon source export');
  capture(declaration(dragonModule, 'WILDERNESS_DRAGON_CANDIDATES'), 'DRAGON_SPECIES', 'dragon candidate reference');
  verifyIds(baseline, 'wildernessDragons', 'WILDERNESS_DRAGONS', dragonInputs.map(row => row.speciesId), 7);

  const bosses = tokens(sources.regionalBossBodies), bossSources = constantObject(declaration(bosses, 'SOURCES'));
  const bossBodies = constantObject(declaration(bosses, 'REGIONAL_BOSS_BODIES'));
  assert(bossSources.size === 7 && bossBodies.size === 7, 'Expected seven regional boss sources and bodies');
  const bossValues = capture(declaration(bosses, 'REGIONAL_BOSS_SPECIES'), `Object.entries(REGIONAL_BOSS_BODIES).map(([key, body]) => {
    const id = key as keyof typeof REGIONAL_BOSS_BODIES;
    const [sourceId, name, regionId] = SOURCES[id];
    const source = RPG_BESTIARY_BY_ID.get(sourceId)!;
    const { tier, multiplier } = REGIONAL_BOSS_LEVELS[id];
    const stats = tuneEnemyCombatLevel(source.stats, tier * multiplier, tier);
    return { id: \`boss_\${id}\`, ...body, scale: body.scale / tierSilhouetteScale(tier), regionId, activity: 'patrol',
      stats: { ...stats, id: \`boss_\${id}_t\${tier}\`, family: \`boss_\${id}\`, name, behaviour: __behaviour } };
  })`, 'regional boss source mapping');
  const bossInputs = [...bossBodies.keys()].map(bossId => {
    const source = array(get(bossSources, bossId)); assert(source.length === 3, 'Expected regional boss source triple');
    const sourceSpecies = string(source[0]!), sourceInputId = `rpg/${sourceSpecies}`;
    const dependency = coreInputs.find(input => input.id === sourceInputId);
    assert(dependency?.kind === 'rpg' && dependency.speciesId === sourceSpecies, `Missing RPG source dependency ${sourceInputId}`);
    const speciesId = `boss_${bossId}`, id = `regionalBossBody/${speciesId}`;
    origins.push({ inputId: id, module: 'regionalBossBodies', symbol: 'SOURCES', rowIndex: [...bossSources.keys()].indexOf(bossId),
      catalog: 'REGIONAL_BOSS_SPECIES', catalogModule: 'regionalBossBodies', speciesId });
    return { id, kind: 'regionalBossBody', speciesId, name: string(source[1]!), sourceInputId, bossId };
  });
  verifyIds(baseline, 'regionalBossBodies', 'REGIONAL_BOSS_SPECIES', bossInputs.map(row => row.speciesId), 7);
  const params = parseValue(WildernessSourceParamsSchema, { wildernessBody: bodyParams, wildernessDragon: dragonParams,
    regionalBossBody: { behaviour: s(bossValues, 'behaviour') } }, 'wildernessSourceParams');
  const inputs = parseValue(WildernessBaseSourceInputsSchema, [...ordinary, ...keeperInputs, ...dragonInputs, ...bossInputs], 'wildernessSourceInputs');
  const bodyIds = [...ordinary.map(row => row.speciesId), ...keepers.map(row => row.id)];
  assert(params.wildernessBody.magicSpeciesIds.every(id => bodyIds.includes(id)), 'Magic body selectors must name an original body input');
  return { params, inputs, keepers, manifest: { sources: files, rows: origins, parameters: [
    { parameterPath: 'wildernessBody', module: 'wildernessCreatureSpecies', symbol: 'bodyStats' },
    { parameterPath: 'wildernessDragon', module: 'wildernessDragons', symbol: 'DRAGON_SPECIES' },
    { parameterPath: 'regionalBossBody', module: 'regionalBossBodies', symbol: 'REGIONAL_BOSS_SPECIES' },
    { parameterPath: 'keepers', module: 'wildernessDepth', symbol: 'WILDERNESS_RUNE_KEEPERS' },
  ] } };
}
