/** Read original factory arguments and named arithmetic literals without executing game source. */
import { createHash } from 'node:crypto';
import { parseValue } from '../../game/src/content/schema/core.js';
import { SourceInputsSchema, SourceParamsSchema } from '../../game/src/content/schema/enemySources.js';
import type { M4Baseline } from './m4-baseline.js';

export interface CoreEnemySources { creatureExpansion: string; starterCreatures: string; rpgBestiary: string }
type Module = keyof CoreEnemySources;
interface Origin { inputId: string; module: Module; symbol: string; rowIndex: number; catalog: string }
type Properties = Map<string, string[]>;
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Core enemy source extraction: ${message}`); }

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
  throw new Error('Core enemy source extraction: Unclosed delimiter');
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
    if (prop.length === 1 || (prop.length === 4 && prop.slice(0, 3).join('') === '...')) result.set(key, prop);
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
function identities(baseline: M4Baseline, module: Module, name: string): string[] {
  const exports = baseline.constants.filter(row => row.module === module && row.name === name);
  assert(exports.length === 1 && exports[0]!.value.kind === 'array', `Missing original ${module}.${name} identities`);
  return exports[0]!.value.values.map(row => {
    assert(row.kind === 'object', 'Expected original species object');
    const id = row.entries.find(([key]) => key === 'id')?.[1]; assert(id?.kind === 'string', 'Missing original species id'); return id.value;
  });
}
function verifyIds(actual: string[], expected: string[], count: number, label: string): void {
  assert(actual.length === count && expected.length === count && new Set(actual).size === count
    && actual.every((id, index) => id === expected[index]), `${label} source identity/count/order mismatch`);
}

export function buildCoreEnemySources(baseline: M4Baseline, sources: CoreEnemySources) {
  const files = (Object.keys(sources) as Module[]).map(module => {
    const path = `.baseline/game/src/content/${module}.ts`, sha256 = createHash('sha256').update(sources[module]).digest('hex');
    const matches = baseline.source.files.filter(row => row.path === path);
    assert(matches.length === 1 && matches[0]!.sha256 === sha256, `${module} source hash does not match baseline`);
    return { module, path, sha256 };
  });
  assert(files.length === 3 && ['creatureExpansion', 'starterCreatures', 'rpgBestiary'].every(module => files.some(row => row.module === module)), 'Expected all three original source modules');
  const expansion = tokens(sources.creatureExpansion), starter = tokens(sources.starterCreatures), rpg = tokens(sources.rpgBestiary);
  const origins: Origin[] = [];

  const species = fn(expansion, 'species');
  capture(species.args[0]!, 'id: string', 'expansion first argument');
  const expansionStats = object(get(returnObject(species.body), 'stats'));
  capture(get(expansionStats, '...stats'), '...stats', 'expansion authored spread');
  capture(get(expansionStats, 'id'), '`${id}_t${stats.tier}`', 'expansion identity');
  capture(get(expansionStats, 'family'), 'id', 'expansion family');
  fields(expansionStats, ['...stats', 'id', 'family', 'marks'], 'expansion factory');
  const expansionMarks = capture(get(expansionStats, 'marks'), '[__low * stats.tier, __high * stats.tier]', 'expansion marks');
  const expansionInputs = array(declaration(expansion, 'CREATURE_EXPANSION')).map((row, rowIndex) => {
    const args = call(row, 'species', 5), speciesId = string(args[0]!), stats = object(args[4]!);
    const tier = number(get(stats, 'tier')), name = string(get(stats, 'name'));
    assert(stats.has('drops'), 'Expansion source must retain original drops argument');
    const authored = Object.fromEntries([...stats].filter(([key]) => !['name', 'tier', 'drops'].includes(key)).map(([key, value]) => [key, literal(value)]));
    const id = `expansion/${speciesId}`;
    origins.push({ inputId: id, module: 'creatureExpansion', symbol: 'CREATURE_EXPANSION', rowIndex, catalog: 'CREATURE_EXPANSION' });
    return { id, kind: 'expansion', identity: { enemyId: `${speciesId}_t${tier}`, family: speciesId, name, tier }, authored };
  });
  verifyIds(expansionInputs.map(row => row.identity.family), identities(baseline, 'creatureExpansion', 'CREATURE_EXPANSION'), 24, 'expansion');

  const small = fn(starter, 'small'), smallStats = object(get(returnObject(small.body), 'stats'));
  fields(smallStats, ['id', 'family', 'name', 'tier', 'maxHealth', 'attackLevel', 'defenceLevel', 'accuracy', 'armour', 'magicArmour',
    'maxHit', 'attackSpeedMs', 'aggroRadius', 'moveSpeedMps', 'walkSpeedMps', 'behaviour', 'marks', 'drops'], 'starter factory');
  capture(get(smallStats, 'id'), '`${id}_t1`', 'starter identity');
  for (const key of ['name', 'armour', 'moveSpeedMps', 'behaviour']) capture(get(smallStats, key), key, `starter ${key}`);
  capture(get(smallStats, 'family'), 'id', 'starter family'); capture(get(smallStats, 'maxHealth'), 'health', 'starter health');
  assert(small.args.length === 11, 'Unexpected starter factory signature');
  ['id: string', 'name: string', 'assetId: string', 'scale: number', 'health: number',
    'behaviour: EnemyDef["behaviour"]', 'activity: CreatureSpeciesDef["activity"]', 'loot: string', 'description: string']
    .forEach((signature, index) => capture(small.args[index]!, signature, `starter argument ${index}`));
  const armourDefault = capture(small.args[9]!, 'armour = __default', 'starter armour default');
  const speedDefault = capture(small.args[10]!, 'moveSpeedMps = __default', 'starter speed default');
  const starterAggro = capture(get(smallStats, 'aggroRadius'), 'behaviour === "aggressive" ? __aggressive : __other', 'starter aggro');
  const starterWalk = capture(get(smallStats, 'walkSpeedMps'), 'Math.min(__cap, moveSpeedMps / __divisor)', 'starter walk speed');
  const starterMarks = array(get(smallStats, 'marks')).map(number);
  const starterInputs = array(declaration(starter, 'STARTER_CREATURES')).map((row, rowIndex) => {
    const args = call(row, 'small', 9, 11), speciesId = string(args[0]!), id = `starter/${speciesId}`;
    origins.push({ inputId: id, module: 'starterCreatures', symbol: 'STARTER_CREATURES', rowIndex, catalog: 'STARTER_CREATURES' });
    return { id, kind: 'starter', speciesId, name: string(args[1]!), health: number(args[4]!), behaviour: string(args[5]!),
      armour: args[9] ? number(args[9]) : n(armourDefault, 'default'), moveSpeedMps: args[10] ? number(args[10]) : n(speedDefault, 'default') };
  });
  verifyIds(starterInputs.map(row => row.speciesId), identities(baseline, 'starterCreatures', 'STARTER_CREATURES'), 7, 'starter');
  const starterParams = {
    ...Object.fromEntries(['tier', 'attackLevel', 'defenceLevel', 'accuracy', 'magicArmour', 'maxHit', 'attackSpeedMs'].map(key => [key, number(get(smallStats, key))])),
    aggroRadius: { aggressive: n(starterAggro, 'aggressive'), other: n(starterAggro, 'other') },
    walkSpeedCap: n(starterWalk, 'cap'), walkSpeedDivisor: n(starterWalk, 'divisor'), marks: starterMarks,
  };
  assert(number(get(smallStats, 'tier')) === 1, 'Starter literal id suffix disagrees with tier');

  const entry = fn(rpg, 'entry'), rpgStats = object(declaration(entry.body, 'stats'));
  assert(entry.args.length === 1, 'Unexpected RPG factory signature');
  capture(entry.args[0]!, '[id, name, bodyFamily, regionId, tier, role, action, habitat]: Row', 'RPG row argument');
  fields(rpgStats, ['id', 'family', 'name', 'tier', 'attackStyle', 'attackRangeM', 'maxHealth', 'attackLevel', 'defenceLevel',
    'accuracy', 'armour', 'magicArmour', 'maxHit', 'attackSpeedMs', 'aggroRadius', 'moveSpeedMps', 'walkSpeedMps', 'behaviour', 'drops', 'marks'], 'RPG factory');
  capture(get(rpgStats, 'id'), '`${id}_t${tier}`', 'RPG identity'); capture(get(rpgStats, 'family'), 'id', 'RPG family');
  for (const key of ['name', 'tier', 'attackStyle', 'attackSpeedMs']) capture(get(rpgStats, key), key, `RPG ${key}`);
  capture(declaration(entry.body, 'brute'), 'role === "brute", guard = role === "guard", caster = role === "caster", swift = role === "skirmisher"', 'RPG role aliases');
  const health = capture(get(rpgStats, 'maxHealth'), 'Math.round((__base + tier * __perTier) * (brute ? __brute : guard ? __guard : caster ? __caster : __other))', 'RPG health');
  const attack = capture(get(rpgStats, 'attackLevel'), 'tier + (brute ? __brute : __other)', 'RPG attack level');
  const defence = capture(get(rpgStats, 'defenceLevel'), 'tier + (guard ? __guard : __other)', 'RPG defence level');
  const accuracy = capture(get(rpgStats, 'accuracy'), 'swift ? __swift : caster ? __caster : __other', 'RPG accuracy');
  const armour = capture(get(rpgStats, 'armour'), 'guard ? __guard : brute ? __brute : caster ? __caster : __other', 'RPG armour');
  const magic = capture(get(rpgStats, 'magicArmour'), 'caster ? __caster : bodyFamily === "golem" ? __golem : __other', 'RPG magic armour');
  const hit = capture(get(rpgStats, 'maxHit'), 'Math.max(__minimum, Math.round(tier * __perTier + (brute ? __brute : __other)))', 'RPG max hit');
  const cadence = capture(declaration(entry.body, 'attackSpeedMs'), 'brute ? __brute : guard ? __guard : caster ? __caster : swift ? __swift : __other', 'RPG cadence');
  const aggro = capture(get(rpgStats, 'aggroRadius'), 'swift ? __swift : __other', 'RPG aggro');
  const move = capture(get(rpgStats, 'moveSpeedMps'), 'brute ? __brute : guard ? __guard : __other', 'RPG movement');
  const range = capture(get(rpgStats, 'attackRangeM'), 'attackStyle === "melee" ? __melee : attackStyle === "ranged" ? __ranged : __magic', 'RPG range');
  const actions = capture(declaration(entry.body, 'attackStyle'), 'action === __ranged ? "ranged" : action === __magic1 || action === __magic2 ? "magic" : "melee"', 'RPG actions');
  const behaviour = capture(get(rpgStats, 'behaviour'), 'bodyFamily === __first || bodyFamily === __second ? "territorial" : "aggressive"', 'RPG behaviour');
  const marks = capture(get(rpgStats, 'marks'), '[Math.max(__lowMinimum, tier), Math.max(__highMinimum, tier * __highPerTier)]', 'RPG marks');
  const roleParams = Object.fromEntries(['skirmisher', 'fighter', 'brute', 'caster', 'guard'].map(role => {
    const pick = (values: Map<string, string>) => n(values, values.has(`__${role === 'skirmisher' ? 'swift' : role}`) ? role === 'skirmisher' ? 'swift' : role : 'other');
    return [role, { healthMultiplier: pick(health), attackLevelOffset: pick(attack), defenceLevelOffset: pick(defence),
      accuracy: pick(accuracy), armour: pick(armour), maxHitOffset: pick(hit), attackSpeedMs: pick(cadence), aggroRadius: pick(aggro), moveSpeedMps: pick(move) }];
  }));
  const retained = declaration(rpg, 'retainedFamilies');
  capture(retained.slice(0, 7), 'new Set<RpgBodyFamily>([', 'RPG retained families');
  capture(retained.slice(-2), '])', 'RPG retained families suffix');
  const retainedFamilies = array(retained.slice(6, -1)).map(string);
  assert(new Set(retainedFamilies).size === retainedFamilies.length, 'Duplicate retained RPG family');
  capture(declaration(rpg, 'RPG_BESTIARY'), '[...rows.filter(row => retainedFamilies.has(row[2])).map(entry), ...acceptedCompleteSources]', 'RPG active assembly');
  const parseRpg = (value: readonly string[], rowIndex: number, symbol: string, catalog: string) => {
    const args = array(value); assert(args.length === 8, 'Expected eight RPG row arguments');
    const speciesId = string(args[0]!), id = `rpg/${speciesId}`;
    origins.push({ inputId: id, module: 'rpgBestiary', symbol, rowIndex, catalog });
    return { id, kind: 'rpg', speciesId, name: string(args[1]!), bodyFamily: string(args[2]!), regionId: string(args[3]!),
      tier: number(args[4]!), role: string(args[5]!), action: string(args[6]!) };
  };
  const rpgInputs = array(declaration(rpg, 'rows')).flatMap((row, rowIndex) => {
    const args = array(row); assert(args.length === 8, 'Expected eight historical RPG row arguments');
    return retainedFamilies.includes(string(args[2]!)) ? [parseRpg(row, rowIndex, 'rows', 'RPG_BESTIARY')] : [];
  });
  for (const [symbol, catalog] of [['acceptedCompleteSources', 'RPG_BESTIARY'], ['RPG_BESTIARY_STAGED', 'RPG_BESTIARY_STAGED']] as const) {
    const rows = array(declaration(rpg, symbol)); assert(rows.length === 4, `Expected four ${symbol} rows`);
    rows.forEach((row, rowIndex) => rpgInputs.push(parseRpg(call(row, 'entry', 1)[0]!, rowIndex, symbol, catalog)));
  }
  const expectedActive = identities(baseline, 'rpgBestiary', 'RPG_BESTIARY'), expectedStaged = identities(baseline, 'rpgBestiary', 'RPG_BESTIARY_STAGED');
  verifyIds(rpgInputs.slice(0, 21).map(row => row.speciesId), expectedActive, 21, 'active RPG');
  verifyIds(rpgInputs.slice(21).map(row => row.speciesId), expectedStaged, 4, 'staged RPG');

  const params = parseValue(SourceParamsSchema, {
    expansion: { marksPerTier: [n(expansionMarks, 'low'), n(expansionMarks, 'high')] }, starter: starterParams,
    rpg: { healthBase: n(health, 'base'), healthPerTier: n(health, 'perTier'), maxHitMinimum: n(hit, 'minimum'), maxHitPerTier: n(hit, 'perTier'),
      roles: roleParams, magicArmour: { caster: n(magic, 'caster'), golem: n(magic, 'golem'), other: n(magic, 'other') },
      attackRangeM: { melee: n(range, 'melee'), ranged: n(range, 'ranged'), magic: n(range, 'magic') },
      rangedActions: [s(actions, 'ranged')], magicActions: [s(actions, 'magic1'), s(actions, 'magic2')],
      territorialFamilies: [s(behaviour, 'first'), s(behaviour, 'second')], walkSpeedMps: number(get(rpgStats, 'walkSpeedMps')),
      marksMinimum: [n(marks, 'lowMinimum'), n(marks, 'highMinimum')], marksPerTier: [1, n(marks, 'highPerTier')] },
  }, 'coreEnemySourceParams');
  const inputs = parseValue(SourceInputsSchema, [...expansionInputs, ...starterInputs, ...rpgInputs], 'coreEnemySourceInputs');
  return { params, inputs, manifest: { sources: files, rows: origins, parameters: [
    { parameterPath: 'expansion', module: 'creatureExpansion', symbol: 'species' },
    { parameterPath: 'starter', module: 'starterCreatures', symbol: 'small' },
    { parameterPath: 'rpg', module: 'rpgBestiary', symbol: 'entry' },
  ] } };
}
