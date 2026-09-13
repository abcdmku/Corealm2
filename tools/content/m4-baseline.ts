/** M4 baseline inventory. Imports do no work; CLI defaults to dry-run. */
import path from 'node:path';
import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { build } from 'esbuild';
import type { EnemyDef } from '../../game/src/content/index.js';
import type { CreatureSpeciesDef } from '../../game/src/content/creatureSpecies.js';
import type { RpgBestiaryEntry } from '../../game/src/content/rpgBestiary.js';
import { repoRoot } from '../lib/paths.js';

export const SPECIES_SOURCES = [
  ['creatureExpansion', 'CREATURE_EXPANSION'], ['starterCreatures', 'STARTER_CREATURES'],
  ['redWorms', 'RED_WORM_SPECIES'], ['regionalCreatureVariants', 'REGIONAL_CREATURE_VARIANTS'],
  ['creatureRedesign', 'CREATURE_REDESIGNS'], ['forestCreatureRedesigns', 'FOREST_CREATURE_REDESIGNS'],
  ['ashCreatureRedesigns', 'ASH_CREATURE_REDESIGNS'], ['stoneCreatureRedesigns', 'STONE_CREATURE_REDESIGNS'],
  ['wildernessDragons', 'WILDERNESS_DRAGONS'], ['wildernessCreatureSpecies', 'WILDERNESS_CREATURE_SPECIES'],
  ['fairyCrownCreatures', 'FAIRY_CROWN_SPECIES'], ['crownwardDragons', 'CROWNWARD_DRAGON_SPECIES'],
  ['fairyCreatures', 'FAIRY_CREATURE_SPECIES'], ['fairyGardenCreatures', 'FAIRY_GARDEN_SPECIES'],
  ['universalMinibosses', 'UNIVERSAL_MINIBOSS_SPECIES'], ['rpgBestiary', 'RPG_BESTIARY'],
  ['rpgBestiary', 'RPG_BESTIARY_STAGED'], ['regionalBossBodies', 'REGIONAL_BOSS_SPECIES'],
] as const;
export const M4_MODULES = [...new Set([
  'enemies', 'creatureSpecies', ...SPECIES_SOURCES.map(([module]) => module),
  'encounterBalance', 'wildernessEnemyProgression', 'wildernessLoot', 'bossArmor',
  'regionalTierEquipment', 'universalMinibossLoot', 'creatureLoot', 'biomePopulation',
  'wildernessDepth', 'fairyMinibossForms',
])];
export type SpeciesCatalog = typeof SPECIES_SOURCES[number][1];
export type EnemyCatalog = 'LEGACY_BLOCKS' | 'CREATURE_SPECIES_BLOCKS' | 'RPG_BESTIARY_BLOCKS'
  | 'FANTASY_TIER_BLOCKS' | 'WILDERNESS_BLOCKS' | 'RPG_BESTIARY_STAGED_BLOCKS' | 'REGIONAL_BOSS_BLOCKS';
export type AliasCatalog = 'GROUP_ALIASES' | 'FANTASY_ENCOUNTER_BLOCKS' | 'WILDERNESS_GROUP_ALIASES';
export type LootCatalog = 'ENEMY_BLOCK_LOOT' | 'CREATURE_SOURCE_LOOT' | 'ENEMY_ALIAS_LOOT';
export type BaselineEnemyRecord = Omit<EnemyDef, 'drops'> & {
  catalog: EnemyCatalog; stage: 'registered' | 'labOnly'; lootTableId: string;
  registrationOrder?: number; labOrder?: number; fantasyTierOrder?: number;
};
export interface BaselineAliasRecord {
  id: string; blockId: string; catalog: AliasCatalog; registrationOrder: number;
  overrides: Partial<Omit<EnemyDef, 'id' | 'drops'>>; lootTableId?: string;
  speciesId?: string; lineage?: readonly [string, string];
}
export type BaselineCreatureRecord = (Omit<CreatureSpeciesDef, 'stats'> | Omit<RpgBestiaryEntry, 'stats'>) & {
  catalog: SpeciesCatalog; stage: 'registered' | 'labOnly'; presentationKind: 'basic' | 'rpg';
  blockId: string; lootTableId: string;
};
export interface BaselineLootRecord { id: string; catalog: LootCatalog; ownerId: string; drops: EnemyDef['drops'] }

/** Fully tagged values preserve undefined, Map/Set insertion order and object key order in JSON. */
export type Snapshot = { kind: 'null' | 'undefined' } | { kind: 'string'; value: string }
  | { kind: 'number'; value: number } | { kind: 'boolean'; value: boolean }
  | { kind: 'array' | 'set'; values: Snapshot[] }
  | { kind: 'object'; entries: [string, Snapshot][] }
  | { kind: 'map'; entries: [Snapshot, Snapshot][] };
export interface ExportSnapshot { module: string; name: string; value: Snapshot }
export interface FunctionProbe {
  label: string; args: Snapshot;
  result: { kind: 'return'; value: Snapshot } | { kind: 'throw'; name: string; message: string };
}
export interface FunctionEvidence { module: string; name: string; probes: FunctionProbe[]; unprobedReason?: string }
export interface CanonicalProvenance { id: string; writes: { source: string; index: number }[]; catalog: EnemyCatalog }
export interface M4Baseline {
  version: 1;
  source: { root: '.baseline'; files: { path: string; sha256: string }[] };
  constants: ExportSnapshot[];
  sharedExportReferences: string[][];
  functions: FunctionEvidence[];
  records: { enemies: BaselineEnemyRecord[]; aliases: BaselineAliasRecord[];
    creatures: BaselineCreatureRecord[]; lootTables: BaselineLootRecord[] };
  provenance: CanonicalProvenance[];
  original: { blocks: EnemyDef[]; groupBlock: readonly (readonly [string, string])[];
    preWildernessBlocks: EnemyDef[]; wildernessBlocks: EnemyDef[];
    registeredOrder: string[]; canonicalOrder: string[]; fantasyTierOrder: string[];
    speciesOrder: string[]; labOrder: string[] };
  counts: { species: number; basicSpecies: number; rpgSpecies: number; registeredEnemies: number;
    canonicalEnemies: number; labEnemies: number; aliases: number; lootTables: number;
    enemyCatalogs: Record<string, number>; speciesCatalogs: Record<string, number>; aliasCatalogs: Record<string, number> };
}

export function snapshot(value: unknown, ancestors = new Set<object>()): Snapshot {
  if (value === null) return { kind: 'null' };
  if (value === undefined) return { kind: 'undefined' };
  if (typeof value === 'string') return { kind: 'string', value };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return { kind: 'number', value };
  if (typeof value !== 'object') throw new Error(`Unsupported snapshot value: ${typeof value}`);
  if (ancestors.has(value)) throw new Error('Cyclic snapshot value');
  const next = new Set(ancestors).add(value);
  const visit = (entry: unknown) => snapshot(entry, next);
  if (Array.isArray(value)) return { kind: 'array', values: value.map(visit) };
  if (value instanceof Map) return { kind: 'map', entries: [...value].map(([key, entry]) => [visit(key), visit(entry)]) };
  if (value instanceof Set) return { kind: 'set', values: [...value].map(visit) };
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Unsupported snapshot object');
  return { kind: 'object', entries: Object.entries(value).map(([key, entry]) => [key, visit(entry)]) };
}

type Namespace = Record<string, unknown>;
interface PrivateEnemies {
  BLOCKS: EnemyDef[]; GROUP_BLOCK: [string, string][]; ALL_BLOCKS: EnemyDef[];
  GROUP_ALIASES: EnemyDef[]; WILDERNESS_BLOCKS: EnemyDef[]; REGIONAL_BOSS_BLOCKS: Map<string, EnemyDef>;
  PRE_WILDERNESS_BLOCKS: EnemyDef[];
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(expected: unknown, actual: unknown, label: string): void {
  assert(isDeepStrictEqual(expected, actual), `M4 baseline parity failed: ${label}`);
}
function rows<T>(module: Namespace, name: string): T[] {
  const value = module[name]; assert(Array.isArray(value), `Missing array ${name}`); return value as T[];
}
function countCatalog(rows: readonly { catalog: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.catalog] = (counts[row.catalog] ?? 0) + 1;
  return counts;
}
const normalized = (value: string) => value.replaceAll('\\', '/');
function within(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

/** Bundles only the immutable baseline; private exports are appended in memory, never on disk. */
async function loadBaseline(root: string): Promise<{ modules: Record<string, Namespace>; files: M4Baseline['source']['files'] }> {
  const contentDir = path.join(root, '.baseline/game/src/content');
  const entries = [...M4_MODULES, 'index', 'wilderness'];
  const entry = entries.map((name, index) => `import * as m${index} from './${name}.ts';`).join('\n')
    + '\nexport default {' + entries.map((name, index) => `${JSON.stringify(name)}:m${index}`).join(',') + '};';
  const result = await build({
    absWorkingDir: root, stdin: { contents: entry, resolveDir: contentDir, sourcefile: 'm4-baseline-entry.ts', loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false, metafile: true,
    plugins: [{ name: 'm4-private-provenance', setup(plugin) {
      plugin.onLoad({ filter: /[/\\]enemies\.ts$/ }, async args => {
        assert(path.resolve(args.path) === path.join(contentDir, 'enemies.ts'), 'Unexpected enemies source outside baseline');
        return { contents: await readFile(args.path, 'utf8') + '\nexport const __M4_PRIVATE = { BLOCKS, GROUP_BLOCK, ALL_BLOCKS, GROUP_ALIASES, WILDERNESS_BLOCKS, REGIONAL_BOSS_BLOCKS, PRE_WILDERNESS_BLOCKS };', loader: 'ts' };
      });
    } }],
  });
  const files: M4Baseline['source']['files'] = [];
  for (const input of Object.keys(result.metafile!.inputs)) {
    if (path.basename(input) === 'm4-baseline-entry.ts') continue;
    const absolute = path.resolve(root, input);
    assert(within(path.join(root, '.baseline'), absolute), `Baseline import escaped .baseline: ${input}`);
    files.push({ path: normalized(path.relative(root, absolute)), sha256: createHash('sha256').update(await readFile(absolute)).digest('hex') });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const loaded = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles![0]!.text).toString('base64')}`) as { default: Record<string, Namespace> };
  return { modules: loaded.default, files };
}

/** The complete reusable inventory; no writes, production imports or runtime registration. */
export async function buildM4Baseline(root = repoRoot): Promise<M4Baseline> {
  const { modules: m, files } = await loadBaseline(path.resolve(root));
  const enemies = rows<EnemyDef>(m.enemies!, 'ENEMIES');
  const blocks = rows<EnemyDef>(m.enemies!, 'ENEMY_BLOCKS');
  const fantasy = rows<EnemyDef>(m.enemies!, 'FANTASY_TIER_BLOCKS');
  const privateRows = m.enemies!.__M4_PRIVATE as PrivateEnemies;
  const lineage = m.enemies!.FANTASY_ENCOUNTER_LINEAGE as Record<string, readonly [string, string]>;
  const replacements = m.biomePopulation!.BIOME_POPULATION_LEGACY_REPLACEMENTS as Record<string, string>;
  const sourceSpecies = SPECIES_SOURCES.flatMap(([module, catalog]) => rows<CreatureSpeciesDef | RpgBestiaryEntry>(m[module]!, catalog).map(row => ({ row, catalog })));
  const species = sourceSpecies.map(source => source.row);
  equal(species.slice(0, 214), m.creatureSpecies!.CREATURE_SPECIES, 'CREATURE_SPECIES source order');
  assert(new Set(species.map(row => row.id)).size === species.length, 'Duplicate source species ID');
  const canonical = new Map(blocks.map(row => [row.id, row]));
  const registration = new Map(enemies.map((row, index) => [row.id, index]));
  const labs = sourceSpecies.filter(source => source.catalog === 'RPG_BESTIARY_STAGED' || source.catalog === 'REGIONAL_BOSS_SPECIES');
  for (const { row } of labs) { assert(!canonical.has(row.stats.id), `Lab block registered: ${row.stats.id}`); canonical.set(row.stats.id, row.stats); }
  const allBlocks = [...canonical.values()];
  const writes = new Map<string, { source: string; index: number }[]>();
  const replay = new Map<string, EnemyDef>();
  const write = (source: string, sourceRows: readonly EnemyDef[]) => sourceRows.forEach((row, index) => {
    writes.set(row.id, [...(writes.get(row.id) ?? []), { source, index }]); replay.set(row.id, row);
  });
  write('LEGACY_BLOCKS', privateRows.BLOCKS.map(row => privateRows.REGIONAL_BOSS_BLOCKS.get(row.id) ?? row));
  for (const [module, catalog] of SPECIES_SOURCES.slice(0, 16)) write(catalog, rows<CreatureSpeciesDef>(m[module]!, catalog).map(row => row.stats));
  write('FANTASY_TIER_BLOCKS', fantasy);
  equal(privateRows.ALL_BLOCKS, [...replay.values()], 'pre-Wilderness canonical replay');
  write('WILDERNESS_BLOCKS', privateRows.WILDERNESS_BLOCKS.filter(row => row.id === `${row.family}_t${row.tier}`));
  equal(blocks, [...replay.values()], 'final canonical replay');
  for (const [module, catalog] of SPECIES_SOURCES.slice(16)) write(catalog, rows<CreatureSpeciesDef>(m[module]!, catalog).map(row => row.stats));
  const wildIds = new Set(privateRows.WILDERNESS_BLOCKS.map(row => row.id));
  const nativeIds = new Set(sourceSpecies.slice(0, 214).map(({ row }) => row.stats.id));
  const rpgIds = new Set(rows<CreatureSpeciesDef>(m.rpgBestiary!, 'RPG_BESTIARY').map(row => row.stats.id));
  const legacyIds = new Set(privateRows.BLOCKS.map(row => row.id));
  const fantasyIds = new Map(fantasy.map((row, index) => [row.id, index]));
  const lootTables: BaselineLootRecord[] = [];
  const makeLoot = (catalog: LootCatalog, ownerId: string, drops: EnemyDef['drops']) => {
    const prefix = catalog === 'ENEMY_BLOCK_LOOT' ? 'loot_enemy_' : catalog === 'CREATURE_SOURCE_LOOT' ? 'loot_species_' : 'loot_alias_';
    const id = prefix + ownerId; lootTables.push({ id, catalog, ownerId, drops: structuredClone(drops) }); return id;
  };
  const enemyRecords: BaselineEnemyRecord[] = allBlocks.map((row, index) => {
    const labIndex = labs.findIndex(source => source.row.stats.id === row.id);
    const catalog: EnemyCatalog = labIndex >= 0 ? labs[labIndex]!.catalog === 'RPG_BESTIARY_STAGED' ? 'RPG_BESTIARY_STAGED_BLOCKS' : 'REGIONAL_BOSS_BLOCKS'
      : wildIds.has(row.id) ? 'WILDERNESS_BLOCKS' : nativeIds.has(row.id) ? 'CREATURE_SPECIES_BLOCKS'
        : rpgIds.has(row.id) ? 'RPG_BESTIARY_BLOCKS' : fantasyIds.has(row.id) && !legacyIds.has(row.id) ? 'FANTASY_TIER_BLOCKS' : 'LEGACY_BLOCKS';
    const { drops, ...stats } = structuredClone(row);
    assert(labIndex >= 0 || registration.has(row.id), `Missing registration ${row.id}`);
    const record: BaselineEnemyRecord = { ...stats, catalog, stage: labIndex >= 0 ? 'labOnly' : 'registered', lootTableId: makeLoot('ENEMY_BLOCK_LOOT', row.id, drops),
      ...(labIndex >= 0 ? { labOrder: labIndex } : { registrationOrder: registration.get(row.id)! }),
      ...(fantasyIds.has(row.id) ? { fantasyTierOrder: fantasyIds.get(row.id)! } : {}) };
    assert(index < 327 || record.stage === 'labOnly', 'Unexpected canonical order'); return record;
  });
  const byRecord = new Map(enemyRecords.map(row => [row.id, row]));
  const creatureRecords: BaselineCreatureRecord[] = sourceSpecies.map(({ row, catalog }) => {
    const base = canonical.get(row.stats.id); assert(base, `Missing species block ${row.id}`);
    const { drops: originalDrops, ...originalStats } = row.stats;
    const { drops: baseDrops, ...baseStats } = base;
    equal(originalStats, baseStats, `${row.id} source combat fields`);
    const { stats: _stats, ...presentation } = structuredClone(row);
    return { ...presentation, catalog, stage: byRecord.get(base.id)!.stage,
      presentationKind: 'bodyFamily' in row ? 'rpg' : 'basic', blockId: base.id,
      lootTableId: isDeepStrictEqual(originalDrops, baseDrops) ? byRecord.get(base.id)!.lootTableId : makeLoot('CREATURE_SOURCE_LOOT', row.id, originalDrops) };
  });
  const groupBases = new Map(privateRows.GROUP_BLOCK);
  const plainAliases = new Set(privateRows.GROUP_ALIASES.map(row => row.id));
  const aliasRecords: BaselineAliasRecord[] = enemies.filter(row => !canonical.has(row.id)).map(row => {
    const catalog: AliasCatalog = plainAliases.has(row.id) ? 'GROUP_ALIASES' : Object.hasOwn(lineage, row.id) ? 'FANTASY_ENCOUNTER_BLOCKS' : 'WILDERNESS_GROUP_ALIASES';
    const blockId = catalog === 'GROUP_ALIASES' ? groupBases.get(row.id)! : catalog === 'FANTASY_ENCOUNTER_BLOCKS' ? lineage[row.id]![0] : `${row.family}_t${row.tier}`;
    const base = canonical.get(blockId); assert(base, `Missing alias base ${row.id}: ${blockId}`);
    const overrides: BaselineAliasRecord['overrides'] = {};
    for (const key of Object.keys(base) as (keyof EnemyDef)[]) assert(Object.hasOwn(row, key), `Alias ${row.id} removes inherited ${key}`);
    for (const key of Object.keys(row) as (keyof EnemyDef)[]) {
      if (key !== 'id' && key !== 'drops' && !isDeepStrictEqual(row[key], base[key])) Object.assign(overrides, { [key]: structuredClone(row[key]) });
    }
    const record: BaselineAliasRecord = { id: row.id, blockId, catalog, registrationOrder: registration.get(row.id)!, overrides,
      ...(!isDeepStrictEqual(row.drops, base.drops) ? { lootTableId: makeLoot('ENEMY_ALIAS_LOOT', row.id, row.drops) } : {}),
      ...(catalog === 'FANTASY_ENCOUNTER_BLOCKS' ? { speciesId: replacements[row.id]!, lineage: structuredClone(lineage[row.id]!) } : {}) };
    equal(row, { ...base, ...overrides, id: row.id, drops: record.lootTableId ? lootTables.find(table => table.id === record.lootTableId)!.drops : base.drops }, `alias ${row.id}`);
    return record;
  });
  const constants: ExportSnapshot[] = [], functions: FunctionEvidence[] = [];
  const shared = new Map<object, string[]>();
  for (const module of M4_MODULES) for (const [name, value] of Object.entries(m[module]!)) {
    if (name === '__M4_PRIVATE') continue;
    if (typeof value === 'function') { functions.push({ module, name, probes: [] }); continue; }
    constants.push({ module, name, value: snapshot(value) });
    if (value && typeof value === 'object') shared.set(value, [...(shared.get(value) ?? []), `${module}.${name}`]);
  }
  const probe = (module: string, name: string, label: string, args: unknown[], invokeArgs = args) => {
    let evidence = functions.find(row => row.module === module && row.name === name);
    if (!evidence) { evidence = { module, name, probes: [] }; functions.push(evidence); }
    const fn = m[module]?.[name]; assert(typeof fn === 'function', `Missing probe function ${module}.${name}`);
    let result: FunctionProbe['result'];
    let returned: unknown, thrown: Error | undefined;
    try { returned = fn(...invokeArgs); }
    catch (error) { assert(error instanceof Error, 'Non-error probe failure'); thrown = error; }
    result = thrown ? { kind: 'throw', name: thrown.name, message: thrown.message } : { kind: 'return', value: snapshot(returned) };
    evidence.probes.push({ label, args: snapshot(args), result });
  };
  for (const row of allBlocks) probe('index', 'enemyCombatLevel', row.id, [row]);
  for (const row of enemies) {
    probe('enemies', 'enemyIdFor', row.id, [row.family, row.tier]);
    probe('enemies', 'enemyBlockFor', row.id, [row.id, row.family, row.tier]);
  }
  probe('enemies', 'enemyBlockFor', 'missing group uses canonical', ['__m4_missing', 'frog', 1]);
  probe('enemies', 'enemyBlockFor', 'missing everything', ['__m4_missing', '__m4_missing', 1]);
  probe('enemies', 'enemyBlockFor', 'mismatched family falls back', [enemies[0]!.id, 'frog', 5]);
  for (const [alias, pair] of Object.entries(lineage)) for (const predecessor of pair) {
    probe('enemies', 'huntEnemyDefMatches', `forward ${alias}/${predecessor}`, [predecessor, alias]);
    probe('enemies', 'huntEnemyDefMatches', `reverse ${alias}/${predecessor}`, [alias, predecessor]);
  }
  probe('enemies', 'huntEnemyDefMatches', 'same ID', ['frog_t1', 'frog_t1']);
  probe('enemies', 'huntEnemyDefMatches', 'unrelated IDs', ['frog_t1', 'frog_t5']);
  for (const row of [...rows<CreatureSpeciesDef>(m.rpgBestiary!, 'RPG_BESTIARY'), ...rows<CreatureSpeciesDef>(m.rpgBestiary!, 'RPG_BESTIARY_STAGED')]) probe('rpgBestiary', 'rpgBestiaryLevel', row.id, [row.id]);
  probe('rpgBestiary', 'rpgBestiaryLevel', 'unknown ID', ['__m4_missing']);
  for (const tier of [1, 5, 10, 20, 30, 40, 50, 60, 70]) for (const boss of [false, true]) probe('regionalTierEquipment', 'regionalFabricDrops', `${tier}/${boss}`, [tier, boss]);
  for (const tier of [50, 70]) probe('bossArmor', 'bossArmorDrops', String(tier), [tier]);
  const keeperIds = new Set(rows<{ id: string }>(m.wildernessDepth!, 'WILDERNESS_RUNE_KEEPERS').map(row => row.id));
  for (const { row, catalog } of sourceSpecies.filter(source => source.catalog === 'WILDERNESS_DRAGONS' || source.catalog === 'WILDERNESS_CREATURE_SPECIES')) {
    probe('wildernessLoot', 'wildernessDrops', `${catalog}/${row.id}`, [row.id, row.stats.tier]);
    if (keeperIds.has(row.id)) probe('wildernessLoot', 'wildernessDrops', `keeper/${row.id}`, [row.id, row.stats.tier, row.id]);
  }
  for (const structure of Object.keys(m.wildernessLoot!.WILDERNESS_STRUCTURE_COMPONENTS as object)) for (const side of ['west', 'east']) {
    probe('wildernessEnemyProgression', 'wildernessStructureLootForGroup', `${structure}/${side}`, [`${structure}_${side}_conclave`]);
    probe('wildernessLoot', 'wildernessDrops', `structure/${structure}/${side}`, ['gloam_wraith', 70, undefined, structure]);
  }
  probe('wildernessEnemyProgression', 'wildernessStructureLootForGroup', 'nearby name is not exact', ['cinder_chain_foundry']);
  const depth = m.wildernessDepth!.WILDERNESS_DEPTH as { south: number; divide: number; north: number };
  for (const z of [depth.south - 1, depth.south, depth.divide - 1, depth.divide, depth.north, depth.north + 1]) {
    probe('wildernessDepth', 'wildernessTierAt', String(z), [z]);
    for (const x of [-200, 0, 200]) probe('wildernessDepth', 'wildernessMagicAt', `${x}/${z}`, [x, z]);
  }
  for (const number of ['01', '02', '03', '06', '07', '08', '09']) for (const region of ['gloamgarden', 'faeholme', 'wilderness']) probe('fairyMinibossForms', 'fairyMinibossAsset', `${number}/${region}`, [number, region]);
  for (const base of [blocks[0]!, ...species.filter(row => row.id.includes('purple_wilderness') || keeperIds.has(row.id)).map(row => row.stats)]) {
    for (const z of [depth.south - 1, depth.south, depth.divide - 1, depth.divide, depth.north, depth.north + 1]) probe('wildernessEnemyProgression', 'wildernessEnemyLevelAt', `${base.id}/${z}`, [base, z]);
  }
  for (const target of [1, 6, 50, 70, 175]) probe('encounterBalance', 'tuneEnemyCombatLevel', `frog/${target}`, [blocks[0]!, target, 20]);
  for (const region of ['fallowmarch', 'gravelmaw', 'wilderness', 'crownward']) {
    for (const number of ['01', '09']) probe('universalMinibosses', 'universalMinibossSpecies', `${number}/${region}`, [number, region]);
  }
  probe('universalMinibosses', 'universalMinibossSpecies', 'deep Wilderness override', ['01', 'wilderness', 70]);
  for (const asset of [...m.universalMinibosses!.RESERVED_UNIVERSAL_MINIBOSS_ASSET_IDS as Set<string>, '__m4_missing']) probe('universalMinibosses', 'isReservedUniversalMinibossAsset', asset, [asset]);
  for (const row of rows<CreatureSpeciesDef>(m.crownwardDragons!, 'CROWNWARD_DRAGON_SPECIES')) probe('crownwardDragons', 'crownwardDragonGroup', row.id, [row.id, 'm4_probe', [17, -23]]);
  const positions = Object.fromEntries(rows<{ id: string }>(m.crownwardDragons!, 'CROWNWARD_DRAGON_ENCOUNTER_INTENTS').map((row, index) => [row.id, [index * 17, -index * 23]]));
  // Avoid signed zero in the stable JSON evidence.
  positions[Object.keys(positions)[0]!] = [0, 0];
  probe('crownwardDragons', 'resolveCrownwardDragonEncounters', 'all intents', [positions]);
  probe('crownwardDragons', 'resolveCrownwardDragonEncounters', 'missing positions', [{}]);
  probe('biomePopulation', 'resolveBiomePopulation', 'complete source list', [species.slice(0, 214)]);
  const groups = [...rows(m.wilderness!, 'WILDERNESS_GROUPS'), ...(m.biomePopulation!.resolveBiomePopulation as (rows: CreatureSpeciesDef[]) => { id: string }[])(species.slice(0, 214)).filter(group => rows<{ id: string; regionId: string }>(m.biomePopulation!, 'BIOME_POPULATION').some(pack => pack.id === group.id && pack.regionId === 'wilderness'))];
  const lookupRows = privateRows.PRE_WILDERNESS_BLOCKS;
  const lookupMap = new Map(lookupRows.map(row => [row.id, row]));
  const lookup = (groupId: string, family: string, tier: number) => { const exact = lookupMap.get(groupId); return exact?.family === family ? exact : lookupMap.get(`${family}_t${tier}`); };
  const projected = (m.wildernessEnemyProgression!.buildWildernessEnemyProgression as (...args: unknown[]) => unknown)(groups, lookup, species.slice(0, 235));
  equal(privateRows.WILDERNESS_BLOCKS, projected, 'complete Wilderness function probe');
  probe('wildernessEnemyProgression', 'buildWildernessEnemyProgression', 'original complete inputs; lookup is exact-family group then family/tier',
    [groups, { lookupKind: 'exactFamilyGroupThenFamilyTier', rows: lookupRows }, species.slice(0, 235)], [groups, lookup, species.slice(0, 235)]);
  for (const fn of functions) if (!fn.probes.length) fn.unprobedReason = 'Public helper retained in inventory; its function value is not parity evidence. Add caller-specific probes before changing it.';
  const report: M4Baseline = {
    version: 1, source: { root: '.baseline', files }, constants,
    sharedExportReferences: [...shared.values()].filter(names => names.length > 1).map(names => names.sort()).sort((a, b) => a[0]!.localeCompare(b[0]!)), functions,
    records: { enemies: enemyRecords, aliases: aliasRecords, creatures: creatureRecords, lootTables },
    provenance: enemyRecords.map(row => ({ id: row.id, catalog: row.catalog, writes: writes.get(row.id)! })),
    original: { blocks: structuredClone(privateRows.BLOCKS), groupBlock: structuredClone(privateRows.GROUP_BLOCK),
      preWildernessBlocks: structuredClone(privateRows.PRE_WILDERNESS_BLOCKS), wildernessBlocks: structuredClone(privateRows.WILDERNESS_BLOCKS),
      registeredOrder: enemies.map(row => row.id), canonicalOrder: blocks.map(row => row.id), fantasyTierOrder: fantasy.map(row => row.id),
      speciesOrder: species.map(row => row.id), labOrder: labs.map(({ row }) => row.stats.id) },
    counts: { species: species.length, basicSpecies: creatureRecords.filter(row => row.presentationKind === 'basic').length,
      rpgSpecies: creatureRecords.filter(row => row.presentationKind === 'rpg').length, registeredEnemies: enemies.length,
      canonicalEnemies: blocks.length, labEnemies: labs.length, aliases: aliasRecords.length, lootTables: lootTables.length,
      enemyCatalogs: countCatalog(enemyRecords), speciesCatalogs: countCatalog(creatureRecords), aliasCatalogs: countCatalog(aliasRecords) },
  };
  equal([246, 219, 27, 472, 327, 11, 145, 362], [report.counts.species, report.counts.basicSpecies, report.counts.rpgSpecies,
    report.counts.registeredEnemies, report.counts.canonicalEnemies, report.counts.labEnemies, report.counts.aliases, report.counts.lootTables], 'approved counts');
  equal([35, 169, 21, 45, 57, 4, 7], ['LEGACY_BLOCKS', 'CREATURE_SPECIES_BLOCKS', 'RPG_BESTIARY_BLOCKS', 'FANTASY_TIER_BLOCKS', 'WILDERNESS_BLOCKS', 'RPG_BESTIARY_STAGED_BLOCKS', 'REGIONAL_BOSS_BLOCKS'].map(catalog => report.counts.enemyCatalogs[catalog]), 'canonical provenance counts');
  assert(new Set(lootTables.map(row => row.id)).size === lootTables.length, 'Duplicate loot owner ID');
  const lootMap = new Map(lootTables.map(row => [row.id, row.drops]));
  const resolvedBlocks = new Map(enemyRecords.map(({ catalog: _catalog, stage: _stage, registrationOrder: _order,
    labOrder: _lab, fantasyTierOrder: _fantasy, lootTableId, ...row }) => [row.id, { ...row, drops: lootMap.get(lootTableId)! }]));
  const resolvedAliases = aliasRecords.map(row => ({ ...resolvedBlocks.get(row.blockId)!, ...row.overrides,
    id: row.id, drops: row.lootTableId ? lootMap.get(row.lootTableId)! : resolvedBlocks.get(row.blockId)!.drops }));
  const resolvedAll = new Map([...resolvedBlocks.values(), ...resolvedAliases].map(row => [row.id, row]));
  equal(enemies, report.original.registeredOrder.map(id => resolvedAll.get(id)), 'all normalized enemies round-trip');
  equal(fantasy, enemyRecords.filter(row => row.fantasyTierOrder !== undefined).sort((a, b) => a.fantasyTierOrder! - b.fantasyTierOrder!).map(row => resolvedBlocks.get(row.id)), 'fantasy view order');
  equal(species, creatureRecords.map(({ catalog: _catalog, stage: _stage, presentationKind: _kind, blockId, lootTableId, ...row }) =>
    ({ ...row, stats: { ...resolvedBlocks.get(blockId)!, drops: lootMap.get(lootTableId)! } })), 'all normalized species round-trip');
  return report;
}

/** Reports are restricted to test-results/*.json and existing parents must resolve inside the repo. */
export async function writeM4BaselineReport(report: M4Baseline, out: string, root = repoRoot): Promise<string> {
  const absoluteRoot = await realpath(root);
  const destination = path.resolve(absoluteRoot, out), reportRoot = path.join(absoluteRoot, 'test-results');
  assert(within(reportRoot, destination) && destination.endsWith('.json'), '--out must be a JSON report under test-results/');
  let parent = path.dirname(destination);
  for (;;) {
    try {
      const resolved = await realpath(parent);
      assert(resolved === parent && (resolved === absoluteRoot || within(absoluteRoot, resolved)), 'Report parent escapes workspace or uses a symlink');
      break;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; parent = path.dirname(parent); }
  }
  try { const resolved = await realpath(destination); assert(resolved === destination && within(reportRoot, resolved), 'Report destination escapes test-results or uses a symlink'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); return destination;
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 2 && args[0] === '--out'), 'Usage: tsx tools/content/m4-baseline.ts [--out test-results/report.json]');
  const report = await buildM4Baseline();
  if (args[1]) console.log(`Wrote ${await writeM4BaselineReport(report, args[1])}`);
  console.log(JSON.stringify({ mode: args[1] ? 'report' : 'dry-run', ...report.counts,
    modules: M4_MODULES.length, constants: report.constants.length, functions: report.functions.length,
    probes: report.functions.reduce((sum, row) => sum + row.probes.length, 0),
    unprobed: report.functions.filter(row => !row.probes.length).map(row => `${row.module}.${row.name}`) }, null, 2));
}
