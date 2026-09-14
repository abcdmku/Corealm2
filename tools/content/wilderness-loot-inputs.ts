/** Source-only Wilderness loot selection inputs; imports perform no I/O. */
import { createHash } from 'node:crypto';
import { parseValue } from '../../game/src/content/schema/core.js';
import { WildernessLootParamsSchema } from '../../game/src/content/schema/wildernessLoot.js';
import type { M4Baseline } from './m4-baseline.js';
export const WILDERNESS_LOOT_MODULES = ['wildernessLoot', 'wildernessEnemyProgression', 'wildernessDepth', 'spells'] as const;
export type WildernessLootSources = Record<typeof WILDERNESS_LOOT_MODULES[number], string>;
type Properties = Map<string, string[]>;
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Wilderness loot source extraction: ${message}`); }

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
  throw new Error('Wilderness loot source extraction: Unclosed delimiter');
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

export function buildWildernessLootSources(baseline: M4Baseline, sources: WildernessLootSources) {
  const files = WILDERNESS_LOOT_MODULES.map(module => {
    const path = `.baseline/game/src/content/${module}.ts`, sha256 = createHash('sha256').update(sources[module]).digest('hex');
    const evidence = baseline.source.files.filter(row => row.path === path);
    assert(evidence.length === 1 && evidence[0]!.sha256 === sha256, `${module} source hash does not match baseline`);
    return { module, path, sha256 };
  });
  const loot = tokens(sources.wildernessLoot), body = fn(loot, 'wildernessDrops').body;
  capture(fn(loot, 'runeForRank').body, `
    const rune = SPELL_RUNES.find((candidate) => candidate.tier === rank);
    if (!rune) throw new Error(\`Missing merged invocation rune rank \${rank}\`);
    return rune.itemId;`, 'rune rank lookup');
  const dropHelper = fn(loot, 'drop');
  capture(dropHelper.body, 'return { itemId, quantity: [min, max], chance };', 'drop ordering');
  capture(dropHelper.args.at(-1)!, 'chance = 1', 'drop default chance');
  const dragon = declaration(body, 'draconic').join('').match(/^\/([a-z|]+)\/\.test\(lootSpecies\)$/);
  const stone = declaration(body, 'stony').join('').match(/^STONE_SPECIES\.has\(lootSpecies\)\|\|\/([a-z|]+)\/\.test\(lootSpecies\)$/);
  assert(dragon && stone, 'Unsupported species classification');
  const selected = capture(body, `
    const keeper = WILDERNESS_RUNE_KEEPERS.find((candidate) => candidate.id === keeperId);
    if (keeperId && !keeper) throw new Error(\`Unknown Wilderness rune keeper: \${keeperId}\`);
    const deep = (keeper?.tier ?? tier) >= __deepTier;
    const lootSpecies = keeper?.id ?? speciesId;
    const draconic = /${dragon[1]}/.test(lootSpecies);
    const stony = STONE_SPECIES.has(lootSpecies) || /${stone[1]}/.test(lootSpecies);
    const materialId = draconic ? (deep ? __deepHide : __shallowHide)
      : stony ? (deep ? __deepFlux : __shallowFlux) : (deep ? __deepThread : __shallowThread);
    if (keeper) { return [
      drop(materialId, __kmn, __kmx), drop(WILDERNESS_KEEPER_COMPONENTS[keeper.id], __kcn, __kcx),
      drop(keeper.rune, __krn, __krx), drop(COSMIC_RUNE_ID, __kcrn, __kcrx),
      drop(deep ? __deepOre : __shallowOre, __kon, __kox), drop(__gem, __kgn, __kgx, __kgc),
      ...bossArmorDrops(keeper.tier),
    ]; }
    return [drop(materialId, __omn, __omx), drop(COSMIC_RUNE_ID, __ocrn, __ocrx, __ocrc),
      ...(deep ? [drop(runeForRank(__dr1), __r3n, __r3x, __r3c), drop(runeForRank(__dr2), __r4n, __r4x, __r4c), drop(runeForRank(__dr3), __r5n, __r5x, __r5c)]
       : [drop(runeForRank(__sr1), __r1n, __r1x, __r1c), drop(runeForRank(__sr2), __r2n, __r2x, __r2c)]),
      ...(stony ? [drop(deep ? __deepOre : __shallowOre, __oon, __oox, __ooc)] : []),
      drop(__gem, __ogn, __ogx, __ogc),
      ...(structureId ? [drop(WILDERNESS_STRUCTURE_COMPONENTS[structureId], __osn, __osx, __osc)] : []),
    ];`, 'wildernessDrops');
  for (const [name, value] of selected) {
    if (/^__(?:deep|shallow)(?:Hide|Flux|Thread|Ore)$|^__gem$/.test(name)) string([value]);
    else number([value]);
  }
  // Literal branches must agree with the actual original crafting rows. The formula then reads
  // the current authored rows directly, so material mappings have a single editable owner.
  const tierTokens = declaration(loot, 'WILDERNESS_CRAFTING_TIERS');
  capture(tierTokens.slice(closeAt(tierTokens, 0) + 1), 'as const', 'crafting tier declaration');
  const crafting = array(tierTokens.slice(0, closeAt(tierTokens, 0) + 1)).map(row => object(row));
  assert(crafting.length === 2, 'Expected two original Wilderness crafting tiers');
  for (const [tier, band] of [[50, 'shallow'], [70, 'deep']] as const) {
    const rows = crafting.filter(row => number(get(row, 'tier')) === tier);
    assert(rows.length === 1, `Missing crafting tier ${tier}`);
    for (const field of ['hide', 'flux', 'thread', 'ore'] as const) {
      assert(string(get(rows[0]!, field)) === s(selected, band + field[0]!.toUpperCase() + field.slice(1)), `Crafting ${band} ${field} mismatch`);
    }
    assert(string(get(rows[0]!, 'gem')) === s(selected, 'gem'), 'Crafting gem mismatch');
  }
  const stoneSet = declaration(loot, 'STONE_SPECIES');
  assert(stoneSet[0] === 'new', 'Expected literal stone Set');
  const stoneSpeciesIds = array(call(stoneSet.slice(1), 'Set', 1)[0]!).map(string);
  const components = object(declaration(loot, 'WILDERNESS_KEEPER_COMPONENTS'));
  const keeperTokens = declaration(tokens(sources.wildernessDepth), 'WILDERNESS_RUNE_KEEPERS');
  const keeperRows = array(keeperTokens.slice(0, closeAt(keeperTokens, 0) + 1)).map(object);
  assert(components.size === keeperRows.length, 'Keeper component identity mismatch');
  const keeperRewards = keeperRows.map(row => {
    const keeperId = string(get(row, 'id'));
    return { keeperId, rune: string(get(row, 'rune')), component: string(get(components, keeperId)) };
  });
  const spellTokens = tokens(sources.spells);
  const runesByRank = array(declaration(spellTokens, 'SPELL_RUNES')).map(object)
    .filter(row => number(get(row, 'tier')) > 0)
    .map(row => ({ rank: number(get(row, 'tier')), itemId: string(get(row, 'itemId')) }));
  const structureComponents = [...object(declaration(loot, 'WILDERNESS_STRUCTURE_COMPONENTS'))]
    .map(([structureId, value]) => ({ structureId, itemId: string(value) }));
  const group = capture(fn(tokens(sources.wildernessEnemyProgression), 'wildernessStructureLootForGroup').body, `
    for (const siteId of Object.keys(WILDERNESS_STRUCTURE_COMPONENTS) as WildernessStructureLootId[]) {
      if (groupId === __west || groupId === __east) return siteId;
    } return undefined;`, 'structure group mapping');
  const groupSuffixes = ['__west', '__east'].map(key => {
    const match = group.get(key)!.match(/^`\$\{siteId\}([a-z_]+)`$/);
    assert(match, 'Expected exact siteId template suffix'); return match[1]!;
  });
  const params = parseValue(WildernessLootParamsSchema, {
    dragonTokens: dragon[1]!.split('|'), stoneTokens: stone[1]!.split('|'), stoneSpeciesIds,
    cosmicRuneId: string(declaration(spellTokens, 'COSMIC_RUNE_ID')), runesByRank,
    ordinaryRanks: { shallow: [n(selected, 'sr1'), n(selected, 'sr2')], deep: [n(selected, 'dr1'), n(selected, 'dr2'), n(selected, 'dr3')] },
    keeperRewards, structureComponents, groupSuffixes,
  }, 'wildernessLoot');
  return { params, manifest: { sources: files, parameters: [
    { module: 'wildernessLoot', symbol: 'wildernessDrops', fields: ['dragonTokens', 'stoneTokens', 'ordinaryRanks'] },
    { module: 'wildernessLoot', symbol: 'STONE_SPECIES', fields: ['stoneSpeciesIds'] },
    { module: 'wildernessLoot', symbol: 'WILDERNESS_KEEPER_COMPONENTS', fields: ['keeperRewards.component'] },
    { module: 'wildernessLoot', symbol: 'WILDERNESS_STRUCTURE_COMPONENTS', fields: ['structureComponents'] },
    { module: 'wildernessDepth', symbol: 'WILDERNESS_RUNE_KEEPERS', fields: ['keeperRewards.keeperId', 'keeperRewards.rune'] },
    { module: 'spells', symbol: 'SPELL_RUNES', fields: ['runesByRank'] },
    { module: 'spells', symbol: 'COSMIC_RUNE_ID', fields: ['cosmicRuneId'] },
    { module: 'wildernessEnemyProgression', symbol: 'wildernessStructureLootForGroup', fields: ['groupSuffixes'] },
  ] } };
}
