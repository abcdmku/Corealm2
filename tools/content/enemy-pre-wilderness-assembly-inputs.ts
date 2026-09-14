/** Original assembly operands and species references, extracted without executing game modules. */
import { createHash } from 'node:crypto';
import { parseValue } from '../../game/src/content/schema/core.js';
import { PreWildernessAssemblyConfigSchema } from '../../game/src/content/schema/enemyPreWildernessAssembly.js';
import type { EnemySourceGraphInput } from '../../game/src/content/schema/enemySourceGraph.js';
import type { EnemyAssemblySource } from '../../game/src/content/schema/enemyAssemblySources.js';
import { buildCoreEnemySources } from './enemy-source-inputs.js';
import { buildVariantEnemySources, VARIANT_SOURCE_MODULES } from './enemy-source-variant-inputs.js';
import { buildWildernessEnemySources, WILDERNESS_SOURCE_MODULES } from './enemy-wilderness-source-inputs.js';
import { buildDescendantEnemySources, DESCENDANT_SOURCE_MODULES } from './enemy-descendant-source-inputs.js';
import { buildActorEnemySources, ACTOR_SOURCE_MODULES } from './enemy-actor-source-inputs.js';
import type { M4Baseline } from './m4-baseline.js';

export const PRE_WILDERNESS_ASSEMBLY_MODULES = [...new Set([
  'creatureExpansion', 'starterCreatures', 'rpgBestiary', ...VARIANT_SOURCE_MODULES,
  ...WILDERNESS_SOURCE_MODULES, ...DESCENDANT_SOURCE_MODULES, ...ACTOR_SOURCE_MODULES,
  'creatureSpecies', 'redWorms', 'biomePopulation', 'fairyMinibossForms',
] as const)];
type Module = typeof PRE_WILDERNESS_ASSEMBLY_MODULES[number];
export type PreWildernessAssemblySources = { [K in Module]: string };
export interface PreWildernessAssemblyMembership {
  combatInputs: readonly EnemySourceGraphInput[];
  lootInputIds: readonly string[];
  assemblySources: readonly EnemyAssemblySource[];
}
type Properties = Map<string, string[]>;
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(`Pre-Wilderness assembly extraction: ${message}`); }

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
  throw new Error('Pre-Wilderness assembly extraction: Unclosed delimiter');
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
function s(captures: Map<string, string>, name: string): string { const value = captures.get(`__${name}`); assert(value, `Missing ${name} string capture`); return string([value]); }

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
function leadingArray(values: readonly string[]): string[][] {
  assert(values[0] === '[', 'Expected leading literal array');
  return array(values.slice(0, closeAt(values, 0) + 1));
}
function property(values: readonly string[], name: string, occurrence = 0): string[] {
  const matches = values.flatMap((token, index) => token === name && values[index + 1] === ':' ? [index + 2] : []);
  const start = matches[occurrence]; assert(start !== undefined, `Missing ${name} property ${occurrence}`);
  let end = start;
  while (end < values.length && values[end] !== ',' && values[end] !== '}') {
    if (['(', '[', '{'].includes(values[end]!)) end = closeAt(values, end);
    end++;
  }
  return values.slice(start, end);
}
function render(value: readonly string[], bindings: Readonly<Record<string, string>>): string {
  assert(value.length === 1, 'Expected literal or simple template string');
  const raw = value[0]!;
  if (raw[0] !== '`') return string(value);
  assert(raw.at(-1) === '`', 'Unterminated template');
  const output = raw.slice(1, -1).replace(/\$\{([\w.]+)\}/g, (_match, key: string) => {
    assert(Object.hasOwn(bindings, key), `Unknown asset template operand ${key}`); return bindings[key]!;
  });
  assert(!output.includes('${') && !output.includes('`'), 'Unsupported asset template expression'); return output;
}
function pick<K extends Module>(sources: PreWildernessAssemblySources, names: readonly K[]): { [P in K]: string } {
  return Object.fromEntries(names.map(name => [name, sources[name]])) as { [P in K]: string };
}
interface SpeciesRef { id: string; assetId: string; sourceInputId: string }

export function buildPreWildernessAssemblyInputs(baseline: M4Baseline, sources: PreWildernessAssemblySources,
  membership: PreWildernessAssemblyMembership) {
  assert(Object.keys(sources).length === PRE_WILDERNESS_ASSEMBLY_MODULES.length, 'Expected all original assembly source modules');
  const files = PRE_WILDERNESS_ASSEMBLY_MODULES.map(module => {
    const source = sources[module]; assert(typeof source === 'string', `Missing ${module} source`);
    const path = `.baseline/game/src/content/${module}.ts`, sha256 = createHash('sha256').update(source).digest('hex');
    const expected = baseline.source.files.filter(row => row.path === path);
    assert(expected.length === 1 && expected[0]!.sha256 === sha256, `${module} source hash does not match baseline`);
    return { module, path, sha256 };
  });
  // Existing factory extractors establish independent source identity/order. Their generated
  // combat values are never read as assembly operands; only original input references are joined.
  const core = buildCoreEnemySources(baseline, pick(sources, ['creatureExpansion', 'starterCreatures', 'rpgBestiary']));
  const variants = buildVariantEnemySources(baseline, pick(sources, VARIANT_SOURCE_MODULES), core.inputs);
  const wild = buildWildernessEnemySources(baseline, pick(sources, WILDERNESS_SOURCE_MODULES), core.inputs);
  const actors = buildActorEnemySources(baseline, pick(sources, ACTOR_SOURCE_MODULES));
  const descendants = buildDescendantEnemySources(baseline, pick(sources, DESCENDANT_SOURCE_MODULES),
    [...core.inputs, ...variants.inputs, ...wild.inputs]);
  const originalInputs = [...core.inputs, ...variants.inputs, ...wild.inputs, ...actors.inputs, ...descendants.inputs];
  const suppliedInputs = new Map(membership.combatInputs.map(input => [input.id, input]));
  assert(suppliedInputs.size === membership.combatInputs.length && suppliedInputs.size === originalInputs.length, 'Combat source membership count or uniqueness mismatch');
  const identity = (input: EnemySourceGraphInput) => {
    if (input.kind === 'expansion') return { kind: input.kind, enemyId: input.identity.enemyId, family: input.identity.family };
    if (input.kind === 'universal') return { kind: input.kind, number: input.number, tier: input.tier };
    if (input.kind === 'wildernessBody' && input.role === 'keeper') return { kind: input.kind, keeperId: input.keeperId };
    return { kind: input.kind, speciesId: input.speciesId };
  };
  for (const input of originalInputs) {
    const supplied = suppliedInputs.get(input.id);
    assert(supplied && JSON.stringify(identity(input)) === JSON.stringify(identity(supplied)), `Missing or mismatched combat source ${input.id}`);
  }
  const lootIds = new Set(membership.lootInputIds);
  assert(lootIds.size === membership.lootInputIds.length, 'Duplicate loot input membership');
  const authored = new Map(membership.assemblySources.map(row => [row.id, row]));
  assert(authored.size === membership.assemblySources.length, 'Duplicate authored assembly source');
  const catalog = new Map<string, SpeciesRef[]>();
  const origins: { module: Module; symbol: string; rowIndex: number; speciesId: string; sourceInputId: string }[] = [];
  const add = (module: Module, symbol: string, rows: SpeciesRef[]) => {
    assert(!catalog.has(symbol), `Duplicate species catalog ${symbol}`);
    verifyIds(baseline, module, symbol, rows.map(row => row.id), rows.length);
    rows.forEach((row, rowIndex) => origins.push({ module, symbol, rowIndex, speciesId: row.id, sourceInputId: row.sourceInputId }));
    catalog.set(symbol, rows);
  };
  const sourceTokens = new Map(PRE_WILDERNESS_ASSEMBLY_MODULES.map(module => [module, tokens(sources[module])]));
  const source = (module: Module) => sourceTokens.get(module)!;
  const expansionAsset = property(fn(source('creatureExpansion'), 'species').body, 'assetId');
  add('creatureExpansion', 'CREATURE_EXPANSION', core.inputs.filter(input => input.kind === 'expansion').map(input => ({
    id: input.identity.family, assetId: render(expansionAsset, { id: input.identity.family }), sourceInputId: input.id,
  })));
  const small = fn(source('starterCreatures'), 'small');
  capture(small.args[2]!, 'assetId: string', 'starter asset argument');
  assert(small.body.join(' ').includes('id , assetId , scale'), 'Unsupported starter asset propagation');
  add('starterCreatures', 'STARTER_CREATURES', array(declaration(source('starterCreatures'), 'STARTER_CREATURES')).map(value => {
    assert(value[0] === 'small' && value[1] === '(', 'Expected original starter call');
    const args = split(value.slice(2, -1)), speciesId = string(args[0]!);
    return { id: speciesId, assetId: string(args[2]!), sourceInputId: `starter/${speciesId}` };
  }));
  const worm = object(array(declaration(source('redWorms'), 'RED_WORM_SPECIES'))[0]!);
  const wormId = string(get(worm, 'id')), wormInputId = `assembly/authored/${wormId}`;
  assert(authored.get(wormInputId)?.kind === 'redWorm', `Missing authored red worm ${wormInputId}`);
  add('redWorms', 'RED_WORM_SPECIES', [{ id: wormId, assetId: string(get(worm, 'assetId')), sourceInputId: wormInputId }]);
  const variantsAsset = property(declaration(source('regionalCreatureVariants'), 'REGIONAL_CREATURE_VARIANTS'), 'assetId');
  add('regionalCreatureVariants', 'REGIONAL_CREATURE_VARIANTS', variants.inputs.filter(input => input.kind === 'variant')
    .map(input => ({ id: input.speciesId, assetId: render(variantsAsset, { id: input.speciesId }), sourceInputId: input.id })));
  for (const [profile, module, symbol] of [
    ['basic', 'creatureRedesign', 'CREATURE_REDESIGNS'], ['forest', 'forestCreatureRedesigns', 'FOREST_CREATURE_REDESIGNS'],
    ['ash', 'ashCreatureRedesigns', 'ASH_CREATURE_REDESIGNS'], ['stone', 'stoneCreatureRedesigns', 'STONE_CREATURE_REDESIGNS'],
  ] as const) {
    const asset = property(declaration(source(module), symbol), 'assetId');
    add(module, symbol, variants.inputs.filter(input => input.kind === 'redesign' && input.profile === profile)
      .map(input => ({ id: input.speciesId, assetId: render(asset, { 'row.id': input.speciesId }), sourceInputId: input.id })));
  }
  for (const [kind, module, symbol, operand] of [
    ['wildernessDragon', 'wildernessDragons', 'WILDERNESS_DRAGONS', 'row.id'],
    ['wildernessBody', 'wildernessCreatureSpecies', 'WILDERNESS_CREATURE_SPECIES', 'body.id'],
  ] as const) {
    const asset = property(source(module), 'assetId');
    add(module, symbol, wild.inputs.filter(input => input.kind === kind).map(input => {
      const speciesId = input.kind === 'wildernessBody' && input.role === 'keeper' ? input.keeperId : input.speciesId;
      return { id: speciesId, assetId: render(asset, { [operand]: speciesId }), sourceInputId: input.id };
    }));
  }
  const crownAsset = property(declaration(source('fairyCrownCreatures'), 'FAIRY_CROWN_SPECIES'), 'assetId');
  add('fairyCrownCreatures', 'FAIRY_CROWN_SPECIES', descendants.inputs.filter(input => input.kind === 'fairyCrown')
    .map(input => ({ id: input.speciesId, assetId: render(crownAsset, { 'form.id': input.speciesId }), sourceInputId: input.id })));
  capture(property(declaration(source('crownwardDragons'), 'CROWNWARD_DRAGON_SPECIES'), 'assetId'), 'source.assetId', 'Crownward inherited asset');
  add('crownwardDragons', 'CROWNWARD_DRAGON_SPECIES', descendants.inputs.filter(input => input.kind === 'crownwardDragon').map(input => {
    const base = catalog.get('WILDERNESS_DRAGONS')!.find(row => row.sourceInputId === input.sourceInputId);
    assert(base, `Missing Crownward source asset ${input.sourceInputId}`);
    return { id: input.speciesId, assetId: base.assetId, sourceInputId: input.id };
  }));
  const fairyRoster = leadingArray(declaration(source('fairyCreatures'), 'FAIRY_CREATURE_ROSTER')).map(object);
  const fairyAsset = property(declaration(source('fairyCreatures'), 'FAIRY_CREATURE_SPECIES'), 'assetId');
  add('fairyCreatures', 'FAIRY_CREATURE_SPECIES', actors.inputs.filter(input => input.kind === 'fairy').map(input => {
    const row = fairyRoster.find(row => string(get(row, 'id')) === input.family); assert(row, `Missing fairy asset roster ${input.family}`);
    return { id: input.speciesId, assetId: render(fairyAsset, { 'row.number': string(get(row, 'number')) }), sourceInputId: input.id };
  }));
  const gardenExpression = declaration(source('fairyGardenCreatures'), 'FAIRY_GARDEN_VARIANTS');
  const gardenRegions = array(gardenExpression.slice(1, closeAt(gardenExpression, 1) + 1)).map(object);
  const gardenForms = leadingArray(declaration(source('fairyGardenCreatures'), 'FAIRY_GARDEN_FORMS')).map(object);
  const gardenAsset = property(gardenExpression, 'assetId');
  capture(property(declaration(source('fairyGardenCreatures'), 'FAIRY_GARDEN_SPECIES'), 'assetId'), 'form.assetId', 'garden asset propagation');
  add('fairyGardenCreatures', 'FAIRY_GARDEN_SPECIES', gardenRegions.flatMap(region => gardenForms.map(form => {
    const id = string(get(form, 'id')), tier = number(get(region, 'tier')), regionId = string(get(region, 'regionId'));
    const speciesId = `garden_${id}_t${tier}`;
    return { id: speciesId, assetId: render(gardenAsset, { 'form.id': id, regionId }), sourceInputId: `garden/${speciesId}` };
  })));
  const poolsExpression = declaration(source('fairyMinibossForms'), 'FAIRY_MINIBOSS_POOLS');
  const pools = object(poolsExpression.slice(0, closeAt(poolsExpression, 0) + 1));
  const fairyMiniboss = capture(declaration(source('fairyMinibossForms'), 'FAIRY_MINIBOSS_FORMS'),
    'Object.entries(FAIRY_MINIBOSS_POOLS).flatMap(([regionId, numbers]) => numbers.map(number => ({ number, regionId, source: __source, assetId: __asset, look: __look as const })))', 'fairy miniboss asset projection');
  capture(fn(source('fairyMinibossForms'), 'fairyMinibossAsset').body,
    'return FAIRY_MINIBOSS_FORMS.find(form => form.number === number && form.regionId === regionId)?.assetId;', 'fairy miniboss asset lookup');
  const universalAsset = capture(property(fn(source('universalMinibosses'), 'universalMinibossSpecies').body, 'assetId'),
    'fairyMinibossAsset(number, regionId) ?? __fallback', 'universal asset fallback');
  add('universalMinibosses', 'UNIVERSAL_MINIBOSS_SPECIES', actors.universalSpeciesMappings.map(row => {
    const input = actors.inputs.find(input => input.id === row.sourceInputId);
    assert(input?.kind === 'universal', `Missing universal source ${row.sourceInputId}`);
    const pool = pools.get(row.regionId), isFairy = pool && array(pool).map(string).includes(input.number);
    return { id: row.speciesId, sourceInputId: row.sourceInputId, assetId: render([
      isFairy ? fairyMiniboss.get('__asset')! : universalAsset.get('__fallback')!,
    ], { number: input.number, regionId: row.regionId }) };
  }));
  const rpgFn = fn(source('rpgBestiary'), 'entry'), rpgSourceId = capture(declaration(rpgFn.body, 'sourceId'),
    'id === __match ? __replacement : id', 'RPG original asset alias');
  const rpgAsset = property(rpgFn.body, 'assetId');
  const activeRpgIds = new Set(core.manifest.rows.filter(row => row.catalog === 'RPG_BESTIARY').map(row => row.inputId));
  add('rpgBestiary', 'RPG_BESTIARY', core.inputs.filter(input => input.kind === 'rpg').filter(input => activeRpgIds.has(input.id))
    .map(input => ({ id: input.speciesId, sourceInputId: input.id, assetId: render(rpgAsset,
      { sourceId: input.speciesId === s(rpgSourceId, 'match') ? s(rpgSourceId, 'replacement') : input.speciesId }) })));

  const creatureOrder = array(declaration(source('creatureSpecies'), 'CREATURE_SPECIES')).map(value => {
    assert(value.length === 4 && value.slice(0, 3).join('') === '...', 'Expected original species catalog spread');
    assert(catalog.has(value[3]!), `Unknown original species catalog ${value[3]}`); return value[3]!;
  });
  assert(new Set(creatureOrder).size === creatureOrder.length && !creatureOrder.includes('RPG_BESTIARY'), 'Invalid original creature catalog membership');
  const creatureSpecies = creatureOrder.flatMap(symbol => catalog.get(symbol)!);
  assert(creatureSpecies.length === 214, 'Expected 214 original basic species');
  verifyIds(baseline, 'creatureSpecies', 'CREATURE_SPECIES', creatureSpecies.map(row => row.id), 214);
  const progressionSpecies = [...creatureSpecies, ...catalog.get('RPG_BESTIARY')!];
  assert(progressionSpecies.length === 235, 'Expected 235 original progression species');
  const enemyTokens = source('enemies');
  capture(declaration(enemyTokens, 'FANTASY_SPECIES_BY_ID'),
    'new Map(FANTASY_SPECIES.map(species => [species.id, species]))', 'native fantasy species lookup');
  capture(declaration(enemyTokens, 'WILDERNESS_BLOCKS'), `buildWildernessEnemyProgression([
    ...WILDERNESS_GROUPS, ...resolveBiomePopulation(CREATURE_SPECIES).filter(group =>
      BIOME_POPULATION.some(pack => pack.id === group.id && pack.regionId === 'wilderness')),
    ], (groupId, family, tier) => {
      const exact = PRE_WILDERNESS_BY_ID.get(groupId);
      return exact?.family === family ? exact : PRE_WILDERNESS_BY_ID.get(enemyIdFor(family, tier));
    }, [...CREATURE_SPECIES, ...RPG_BESTIARY])`, 'progression source species order and pre-Wilderness lookup');
  capture(declaration(enemyTokens, 'ALL_BLOCKS'), `[...new Map([
    ...BLOCKS.map(row => REGIONAL_BOSS_BLOCKS.get(row.id) ?? row),
    ...CREATURE_SPECIES.map(species => species.stats), ...RPG_BESTIARY.map(species => species.stats),
    ...FANTASY_TIER_BLOCKS, ].map(row => [row.id, row] as const)).values()]`, 'ALL_BLOCKS source fold');
  capture(declaration(enemyTokens, 'BY_BLOCK_ID'), 'new Map(ALL_BLOCKS.map((row) => [row.id, row] as const))', 'canonical lookup');
  capture(declaration(enemyTokens, 'GROUP_ALIASES'), `GROUP_BLOCK.flatMap(([groupId, blockId]) => {
    if (Object.hasOwn(BIOME_POPULATION_LEGACY_REPLACEMENTS, groupId)) return [];
    const base = BY_BLOCK_ID.get(blockId); return base === undefined ? [] : [{ ...base, id: groupId }]; })`, 'ordinary group aliases');
  capture(declaration(enemyTokens, 'FANTASY_ENCOUNTER_BLOCKS'), `Object.entries(BIOME_POPULATION_LEGACY_REPLACEMENTS)
    .map(([groupId, speciesId]) => {
      const lineage = FANTASY_ENCOUNTER_LINEAGE[groupId];
      const original = lineage ? BY_BLOCK_ID.get(lineage[0]) : undefined;
      const species = FANTASY_SPECIES_BY_ID.get(speciesId);
      if (!original || !species) throw new Error(\`Missing original stats or replacement creature for \${groupId}\`);
      return { ...original, id: groupId, family: species.stats.family, name: species.stats.name,
        moveSpeedMps: species.stats.moveSpeedMps, walkSpeedMps: species.stats.walkSpeedMps }; })`, 'fantasy encounter patches');
  capture(declaration(enemyTokens, 'PRE_WILDERNESS_BLOCKS'), '[...ALL_BLOCKS, ...GROUP_ALIASES, ...FANTASY_ENCOUNTER_BLOCKS]', 'pre-Wilderness append order');
  capture(declaration(enemyTokens, 'PRE_WILDERNESS_BY_ID'), 'new Map(PRE_WILDERNESS_BLOCKS.map(row => [row.id, row]))', 'pre-Wilderness lookup');
  const legacyAssemblyInputIds = array(declaration(enemyTokens, 'BLOCKS')).map(value => {
    const enemyId = string(get(object(value), 'id')), id = `assembly/legacy/${enemyId}`, row = authored.get(id);
    assert(row && row.kind !== 'redWorm' && row.authored.id === enemyId, `Missing original legacy assembly source ${id}`);
    return id;
  });
  assert(legacyAssemblyInputIds.length === 35, 'Expected 35 original legacy blocks');
  const sourceBlocks = progressionSpecies.map(row => {
    assert(row.sourceInputId === wormInputId || suppliedInputs.has(row.sourceInputId), `Missing species combat membership ${row.sourceInputId}`);
    assert(row.sourceInputId === wormInputId || lootIds.has(row.sourceInputId), `Missing species loot membership ${row.sourceInputId}`);
    return { combatInputId: row.sourceInputId, lootInputId: row.sourceInputId };
  });
  const fantasyBlocks = variants.sourceInputIds.flatMap(sourceInputId => variants.fantasy.tiers.map(tier => ({ sourceInputId, tier, lootInputId: sourceInputId })));
  const replacementExpression = declaration(source('biomePopulation'), 'BIOME_POPULATION_LEGACY_REPLACEMENTS');
  const replacements = object(replacementExpression);
  const historicalLineage = [...object(declaration(enemyTokens, 'FANTASY_ENCOUNTER_LINEAGE'))].map(([id, value]) => {
    const pair = array(value).map(string); assert(pair.length === 2, `Invalid historical lineage ${id}`);
    return { id, originalEnemyId: pair[0]!, previousEnemyId: pair[1]! };
  });
  const lineageById = new Map(historicalLineage.map(row => [row.id, row]));
  const groupPairs = array(declaration(enemyTokens, 'GROUP_BLOCK')).map(value => {
    const pair = array(value).map(string); assert(pair.length === 2, 'Invalid original group pair');
    return { id: pair[0]!, baseEnemyId: pair[1]! };
  });
  const groupAliases = groupPairs.filter(row => !replacements.has(row.id));
  const fantasyEncounters = [...replacements].map(([id, value]) => {
    const speciesId = string(value), original = lineageById.get(id);
    const candidates = variants.inputs.filter(input => input.kind === 'redesign' && input.speciesId === speciesId
      && variants.sourceInputIds.includes(input.id));
    assert(original && candidates.length === 1, `Missing original fantasy lineage or replacement ${id}`);
    return { id, originalEnemyId: original.originalEnemyId, replacementSourceInputId: candidates[0]!.id };
  });
  assert(groupPairs.length === 38 && groupAliases.length === 18 && fantasyEncounters.length === 54 && historicalLineage.length === 54,
    'Original group or fantasy lineage count mismatch');
  verifyIds(baseline, 'enemies', 'FANTASY_ENCOUNTER_BLOCKS', fantasyEncounters.map(row => row.id), 54);
  const config = parseValue(PreWildernessAssemblyConfigSchema, { legacyAssemblyInputIds, sourceBlocks, fantasyBlocks,
    groupAliases, fantasyEncounters, progressionSpecies }, 'preWildernessAssembly');
  return { config, historicalLineage, manifest: { sources: files, species: origins, assembly: {
    legacy: { module: 'enemies', symbol: 'BLOCKS', inputIds: legacyAssemblyInputIds },
    catalogOrder: { module: 'creatureSpecies', symbol: 'CREATURE_SPECIES', catalogs: creatureOrder },
    groupPairs: { module: 'enemies', symbol: 'GROUP_BLOCK', rows: groupPairs },
    fantasyLineage: { module: 'enemies', symbol: 'FANTASY_ENCOUNTER_LINEAGE' },
    fantasyReplacements: { module: 'biomePopulation', symbol: 'BIOME_POPULATION_LEGACY_REPLACEMENTS' },
  } } };
}
