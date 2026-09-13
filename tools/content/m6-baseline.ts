/**
 * M6 baseline inventory.
 *
 * This helper deliberately evaluates only the immutable `.baseline` tree.  The
 * baseline source is bundled in memory and private authored values are appended
 * by an esbuild loader; importing this module itself has no content side effects
 * and the CLI defaults to printing a dry-run summary.
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { repoRoot } from '../lib/paths.js';

/** The seventeen authored modules covered by the M6 migration. */
export const M6_CONTENT_MODULES = [
  'regions', 'worldHabitats', 'legacyEncounterPlacements', 'creatureHabitats',
  'starterHabitats', 'regionalVariantHabitats', 'biomePopulation', 'wilderness',
  'deepWildernessEncounters', 'redWormHabitat', 'regionalPacks', 'crownward',
  'fairyRegions', 'encounterPlacement', 'fantasyEncounters', 'wildernessResources',
  'crownwardFishing',
] as const;

/** Runtime modules whose inputs affect pack acceptance, expansion and placement. */
export const M6_DEPENDENCY_MODULES = [
  'rpgRegionalPacks', 'regionalPackActivation', 'regionalPackLayout',
  'wildernessExpansion', 'world/universalMinibossSockets', 'world/mobSpawnSpacing',
] as const;

/** Stable module keys used in report entries and function evidence. */
export const M6_MODULES = [...M6_CONTENT_MODULES, ...M6_DEPENDENCY_MODULES] as const;

/** Support entries are bundled for original helper probes but are not inventory modules. */
export const M6_PROBE_SUPPORT_MODULES = [
  'creatureSpecies', 'crownwardRiver',
] as const;

export type M6ModuleKey = typeof M6_MODULES[number];
export type M6ContentModuleKey = typeof M6_CONTENT_MODULES[number];

export interface M6ModuleSpec {
  readonly key: string;
  /** Path relative to `.baseline/game/src`. */
  readonly source: string;
  readonly category: 'content' | 'dependency' | 'probe-support';
}

export const M6_MODULE_SPECS: readonly M6ModuleSpec[] = [
  ...M6_CONTENT_MODULES.map((key) => ({ key, source: `content/${key}.ts`, category: 'content' as const })),
  ...M6_DEPENDENCY_MODULES.map((key) => ({
    key, source: `${key.startsWith('world/') ? '' : 'content/'}${key}.ts`, category: 'dependency' as const,
  })),
  ...M6_PROBE_SUPPORT_MODULES.map((key) => ({ key, source: `content/${key}.ts`, category: 'probe-support' as const })),
];

const INVENTORY_SPECS = M6_MODULE_SPECS.filter((spec) => spec.category !== 'probe-support');
const SUPPORT_SPECS = M6_MODULE_SPECS.filter((spec) => spec.category === 'probe-support');

/** Fully tagged values preserve undefined, Map/Set insertion order and object key order in JSON. */
export type Snapshot = { kind: 'null' | 'undefined' } | { kind: 'string'; value: string }
  | { kind: 'number'; value: number; negativeZero?: boolean } | { kind: 'boolean'; value: boolean }
  | { kind: 'array' | 'set'; values: Snapshot[] }
  | { kind: 'object'; entries: [string, Snapshot][] }
  | { kind: 'map'; entries: [Snapshot, Snapshot][] };

export interface ExportSnapshot { module: string; name: string; value: Snapshot }

export interface FunctionProbe {
  label: string;
  args: Snapshot;
  result: { kind: 'return'; value: Snapshot } | { kind: 'throw'; name: string; message: string };
}

export interface FunctionEvidence {
  module: string;
  name: string;
  probes: FunctionProbe[];
  unprobedReason?: string;
}

export interface M6Baseline {
  version: 1;
  source: { root: '.baseline'; files: { path: string; sha256: string }[] };
  modules: { content: string[]; dependencies: string[]; probeSupport: string[] };
  constants: ExportSnapshot[];
  privateConstants: ExportSnapshot[];
  sharedExportReferences: string[][];
  functions: FunctionEvidence[];
  original: {
    sourceRegions: Snapshot;
    regions: Snapshot;
    sourceGroups: Snapshot;
    groups: Snapshot;
    sourceDungeonGroups: Snapshot;
    dungeonGroups: Snapshot;
    sourceHabitats: Snapshot;
    worldHabitats: Snapshot;
    sourceHabitatLookup: Snapshot;
    habitatLookup: Snapshot;
    sourceResourceClusters: Snapshot;
    resourceClusters: Snapshot;
    placementOverrides: Snapshot;
    caveFloorIntents: Snapshot;
    regionalPacks: Snapshot;
    regionalPackVariants: Snapshot;
    regionalPackGroups: Snapshot;
    regionalPackHabitats: Snapshot;
    regionalPackPlan: Snapshot;
    regionalPackLayout: Snapshot;
    regionalPackActivation: Snapshot;
    activatedRegionalPackIds: Snapshot;
    sourcePackAssignments: Snapshot;
    wildernessGroups: Snapshot;
    wildernessHabitats: Snapshot;
    fairyRegions: Snapshot;
  };
  orders: {
    sourceGroups: string[];
    groups: string[];
    sourceDungeonGroups: string[];
    dungeonGroups: string[];
    regionalPacks: string[];
    resourceClusters: string[];
  };
  counts: {
    sourceRegions: number;
    regions: number;
    sourceGroups: number;
    groups: number;
    sourceSurfaceGroups: number;
    acceptedSurfaceGroups: number;
    sourceDungeonGroups: number;
    acceptedDungeonGroups: number;
    worldHabitats: number;
    regionalPacks: number;
    activatedRegionalPacks: number;
    resourceClusters: number;
    constants: number;
    privateConstants: number;
    functions: number;
    probes: number;
  };
}

type Namespace = Record<string, unknown>;
type AnyRecord = Record<string, any>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Snapshot only JSON-like authored values; function values are probe metadata, never placeholders. */
export function snapshot(value: unknown, ancestors = new Set<object>()): Snapshot {
  if (value === null) return { kind: 'null' };
  if (value === undefined) return { kind: 'undefined' };
  if (typeof value === 'string') return { kind: 'string', value };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (typeof value === 'number' && Object.is(value, -0)) return { kind: 'number', value: 0, negativeZero: true };
  if (typeof value === 'number' && Number.isFinite(value)) return { kind: 'number', value };
  if (typeof value !== 'object') throw new Error(`Unsupported snapshot value: ${typeof value}`);
  if (ancestors.has(value)) throw new Error('Cyclic snapshot value');
  const next = new Set(ancestors).add(value);
  const visit = (entry: unknown): Snapshot => snapshot(entry, next);
  if (Array.isArray(value)) return { kind: 'array', values: value.map(visit) };
  if (value instanceof Map) return { kind: 'map', entries: [...value].map(([key, entry]) => [visit(key), visit(entry)]) };
  if (value instanceof Set) return { kind: 'set', values: [...value].map(visit) };
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new Error('Unsupported snapshot object');
  return { kind: 'object', entries: Object.entries(value).map(([key, entry]) => [key, visit(entry)]) };
}

function normalized(value: string): string { return value.replaceAll('\\', '/'); }

function within(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function rows<T = AnyRecord>(module: Namespace, name: string): T[] {
  const value = module[name];
  assert(Array.isArray(value), `Missing array ${name}`);
  return value as T[];
}

function privateRows(module: Namespace, name: string): unknown {
  const values = module.__M6_PRIVATE as Namespace | undefined;
  return values?.[name];
}

function regionGroups(regions: readonly AnyRecord[]): {
  surface: AnyRecord[]; dungeon: AnyRecord[]; all: AnyRecord[];
} {
  const surface: AnyRecord[] = [];
  const dungeon: AnyRecord[] = [];
  for (const region of regions) {
    surface.push(...(region.enemyGroups ?? []));
    if (region.dungeon) dungeon.push(...(region.dungeon.enemyGroups ?? []));
  }
  return { surface, dungeon, all: [...surface, ...dungeon] };
}

function groupIds(rowsToRead: readonly AnyRecord[]): string[] {
  return rowsToRead.map((row) => String(row.id));
}

function getModule(modules: Record<string, Namespace>, key: string): Namespace {
  const module = modules[key];
  assert(module, `Missing bundled module ${key}`);
  return module;
}

function invokeError(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'NonErrorThrow', message: String(error) };
}

/** Bundle only `.baseline`, appending private declarations in memory for provenance. */
async function loadBaseline(root: string): Promise<{
  modules: Record<string, Namespace>;
  files: M6Baseline['source']['files'];
}> {
  const sourceRoot = path.join(root, '.baseline/game/src');
  const entrySpecs = [...INVENTORY_SPECS, ...SUPPORT_SPECS];
  const entry = entrySpecs.map((spec, index) =>
    `import * as m${index} from ${JSON.stringify(`./${spec.source}`)};`).join('\n')
    + `\nexport default {${entrySpecs.map((spec, index) => `${JSON.stringify(spec.key)}:m${index}`).join(',')}};`;
  const privatePaths = new Map<string, M6ModuleSpec>();
  for (const spec of INVENTORY_SPECS) privatePaths.set(path.resolve(sourceRoot, spec.source), spec);

  const result = await build({
    absWorkingDir: root,
    stdin: { contents: entry, resolveDir: sourceRoot, sourcefile: 'm6-baseline-entry.ts', loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false, metafile: true,
    plugins: [{ name: 'm6-private-provenance', setup(plugin) {
      plugin.onLoad({ filter: /\.tsx?$/ }, async (args) => {
        const spec = privatePaths.get(path.resolve(args.path));
        if (!spec) return;
        assert(within(path.join(root, '.baseline'), path.resolve(args.path)),
          `Private provenance escaped .baseline: ${args.path}`);
        const source = await readFile(args.path, 'utf8');
        // Top-level declarations are intentionally gathered lexically.  This captures all
        // private authored constants while functions remain available only to their module.
        const names = [...source.matchAll(/^(?:export\s+)?(?:(?:async)\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)]
          .map((match) => match[1]!).filter((name, index, all) => all.indexOf(name) === index && name !== '__M6_PRIVATE');
        const suffix = names.length
          ? `\nexport const __M6_PRIVATE = { ${names.join(', ')} };\n`
          : '';
        return { contents: source + suffix, loader: 'ts' };
      });
    } }],
  });
  const files: M6Baseline['source']['files'] = [];
  for (const input of Object.keys(result.metafile!.inputs)) {
    if (path.basename(input) === 'm6-baseline-entry.ts') continue;
    const absolute = path.resolve(root, input);
    assert(within(path.join(root, '.baseline'), absolute), `Baseline import escaped .baseline: ${input}`);
    files.push({
      path: normalized(path.relative(root, absolute)),
      sha256: createHash('sha256').update(await readFile(absolute)).digest('hex'),
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const loadedValue: unknown = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles![0]!.text).toString('base64')}`,
  );
  const loaded = loadedValue as { default: Record<string, Namespace> };
  return { modules: loaded.default, files };
}

/** The complete immutable original M6 inventory and placement evidence. */
export async function buildM6Baseline(root = repoRoot): Promise<M6Baseline> {
  const absoluteRoot = path.resolve(root);
  const { modules: m, files } = await loadBaseline(absoluteRoot);
  const regionsModule = getModule(m, 'regions');
  const sourceRegions = rows<AnyRecord>(regionsModule, 'SOURCE_REGIONS');
  const regions = rows<AnyRecord>(regionsModule, 'REGIONS');
  const sourceGroups = regionGroups(sourceRegions);
  const acceptedGroups = regionGroups(regions);
  const sourceClusters = sourceRegions.flatMap((region) => region.clusters ?? []);
  const acceptedClusters = regions.flatMap((region) => region.clusters ?? []);
  const worldHabitats = rows<AnyRecord>(getModule(m, 'worldHabitats'), 'WORLD_HABITATS');
  const regionalPacks = rows<AnyRecord>(getModule(m, 'regionalPacks'), 'REGIONAL_PACKS');
  const activeIds = (getModule(m, 'regionalPackActivation').activatedRegionalPackIds as () => string[])();
  const placementModule = getModule(m, 'legacyEncounterPlacements');

  const habitatForGroup = getModule(m, 'worldHabitats').habitatForGroup as (groupId: string) => unknown;
  const makeLookup = (groups: readonly AnyRecord[]): Map<string, unknown> => {
    const lookup = new Map<string, unknown>();
    for (const group of groups) if (!lookup.has(String(group.id))) lookup.set(String(group.id), habitatForGroup(String(group.id)));
    return lookup;
  };
  const sourceHabitatLookup = makeLookup(sourceGroups.all);
  const acceptedHabitatLookup = makeLookup(acceptedGroups.all);

  const constants: ExportSnapshot[] = [];
  const privateConstants: ExportSnapshot[] = [];
  const functions: FunctionEvidence[] = [];
  const shared = new Map<object, string[]>();
  const capture = (target: ExportSnapshot[], moduleKey: string, name: string, value: unknown, reference: string): void => {
    target.push({ module: moduleKey, name, value: snapshot(value) });
    if (value && typeof value === 'object') shared.set(value, [...(shared.get(value) ?? []), reference]);
  };
  for (const spec of INVENTORY_SPECS) {
    const module = getModule(m, spec.key);
    for (const [name, value] of Object.entries(module)) {
      if (name === '__M6_PRIVATE') continue;
      if (typeof value === 'function') functions.push({ module: spec.key, name, probes: [] });
      else capture(constants, spec.key, name, value, `${spec.key}.${name}`);
    }
    const privateValues = module.__M6_PRIVATE as Namespace | undefined;
    for (const [name, value] of Object.entries(privateValues ?? {})) {
      if (typeof value !== 'function') capture(privateConstants, spec.key, name, value, `${spec.key}.__M6_PRIVATE.${name}`);
    }
  }

  const probe = (moduleKey: string, name: string, label: string, args: unknown[], invokeArgs = args): void => {
    let evidence = functions.find((row) => row.module === moduleKey && row.name === name);
    if (!evidence) { evidence = { module: moduleKey, name, probes: [] }; functions.push(evidence); }
    const fn = getModule(m, moduleKey)[name];
    assert(typeof fn === 'function', `Missing probe function ${moduleKey}.${name}`);
    try {
      evidence.probes.push({ label, args: snapshot(args), result: { kind: 'return', value: snapshot(fn(...invokeArgs)) } });
    } catch (error) {
      const thrown = invokeError(error);
      evidence.probes.push({ label, args: snapshot(args), result: { kind: 'throw', ...thrown } });
    }
  };

  // Region, habitat and legacy formation probes retain the original ordered group inputs.
  const firstRegionId = String(sourceRegions[0]!.id);
  probe('regions', 'getRegion', 'starting source region', [firstRegionId]);
  probe('regions', 'getRegion', 'unknown region', ['__m6_missing_region']);
  probe('regions', 'allLocations', 'all accepted locations', []);
  probe('regions', 'findLocation', 'first accepted location', [String(regions[0]!.locations[0]!.id)]);
  probe('regions', 'findLocation', 'unknown location', ['__m6_missing_location']);
  probe('regions', 'spotDistance', 'three four triangle', [[0, 0], [3, 4]]);
  probe('regions', 'validateRegions', 'without asset set', []);
  const firstHabitat = worldHabitats[0];
  if (firstHabitat) {
    const centre = firstHabitat.centre as [number, number];
    probe('worldHabitats', 'habitatContains', 'habitat centre', [firstHabitat, [centre[0], 0, centre[1]]]);
    probe('worldHabitats', 'habitatContains', 'outside habitat radius',
      [firstHabitat, [centre[0] + firstHabitat.radius + 1, 0, centre[1]]]);
  }
  for (const group of acceptedGroups.all) probe('worldHabitats', 'habitatForGroup', `accepted ${group.id}`, [group.id]);
  probe('worldHabitats', 'habitatForGroup', 'unknown group', ['__m6_missing_group']);

  const overrides = (placementModule.LEGACY_ENCOUNTER_PLACEMENT_OVERRIDES ?? {}) as AnyRecord;
  const overrideId = Object.keys(overrides)[0];
  const overrideGroup = [...sourceGroups.all, ...acceptedGroups.all].find((group) => group.id === overrideId);
  const createFormation = placementModule.createLegacyEncounterFormation;
  if (overrideGroup && typeof createFormation === 'function') {
    probe('legacyEncounterPlacements', 'createLegacyEncounterFormation', 'first authored placement',
      [overrideGroup, { bodyRadius: .5 }]);
    probe('legacyEncounterPlacements', 'createLegacyEncounterFormation', 'body exceeds authored budget',
      [overrideGroup, { bodyRadius: 999 }]);
    probe('legacyEncounterPlacements', 'createLegacyEncounterFormation', 'unknown placement',
      [{ ...overrideGroup, id: '__m6_missing_group' }, { bodyRadius: .5 }]);
  }

  const firstAcceptedGroup = acceptedGroups.all[0];
  if (firstAcceptedGroup) {
    probe('encounterPlacement', 'encounterBodyRadius', 'first accepted group', [firstAcceptedGroup]);
    probe('encounterPlacement', 'populationGroup', 'first accepted group', [firstAcceptedGroup]);
    probe('fantasyEncounters', 'fantasyEncounter', 'first accepted group', [firstAcceptedGroup]);
  }
  const biomeModule = getModule(m, 'biomePopulation');
  const species = rows<AnyRecord>(getModule(m, 'creatureSpecies'), 'CREATURE_SPECIES');
  probe('biomePopulation', 'resolveBiomePopulation', 'complete original species list', [species]);

  const deepModule = getModule(m, 'deepWildernessEncounters');
  probe('deepWildernessEncounters', 'resolveDeepWildernessPacks', 'complete original species list', [species]);
  const deepPack = rows<AnyRecord>(deepModule, 'DEEP_WILDERNESS_PACKS')[0];
  if (deepPack) probe('deepWildernessEncounters', 'deepWildernessPackFormation', 'first deep pack', [deepPack]);
  probe('wildernessExpansion', 'wildernessExpansionGroups', 'complete original species list', [species]);

  const fantasySpecies = Object.keys((biomeModule.FANTASY_ENCOUNTER_SPECIES ?? {}) as AnyRecord);
  const fantasyGroup = acceptedGroups.all.find((group) => fantasySpecies.includes(String(group.id)));
  if (fantasyGroup) probe('fantasyEncounters', 'fantasyEncounter', 'legacy fantasy replacement', [fantasyGroup]);
  const startBounds = getModule(m, 'fantasyEncounters').STARTER_WILDLIFE_BOUNDS as AnyRecord;
  probe('fantasyEncounters', 'inStarterWildlifeArea', 'inside starter wildlife bounds',
    ['fallowmarch', [startBounds.min[0], startBounds.min[1]], 0]);
  probe('fantasyEncounters', 'inStarterWildlifeArea', 'outside starter wildlife bounds',
    ['vellenwood', [startBounds.min[0], startBounds.min[1]], 0]);
  probe('fantasyEncounters', 'isStarterAnimalAsset', 'starter animal asset', ['animal_m6_probe']);
  probe('fantasyEncounters', 'isStarterAnimalAsset', 'non starter asset', ['creature_m6_probe']);

  const rpgModule = getModule(m, 'rpgRegionalPacks');
  const plan = rows<AnyRecord>(rpgModule, 'RPG_REGIONAL_PACK_PLAN');
  const knownReplacement = plan.find((row) => row.speciesId)?.speciesId;
  probe('rpgRegionalPacks', 'regionalPackReplacements', 'empty replacement map', [{}]);
  if (knownReplacement) probe('rpgRegionalPacks', 'regionalPackReplacements', 'known species null replacement',
    [{ [knownReplacement]: null }]);
  probe('rpgRegionalPacks', 'regionalPackReplacements', 'unknown species replacement', [{ __m6_missing_species: null }]);
  const firstPack = regionalPacks[0];
  const unitMeasurement = () => ({ size: { x: 1, y: 1, z: 1 }, base: { x: .5, y: .5, z: .5 } });
  const noMeasurement = () => null;
  if (firstPack) {
    const packId = String(firstPack.id);
    probe('rpgRegionalPacks', 'createRpgRegionalPackCatalogue', 'one pack with measured unit model',
      ['unit measurement', [packId], {}], [unitMeasurement, [packId], {}]);
    probe('rpgRegionalPacks', 'createRpgRegionalPackCatalogue', 'missing measured model',
      ['missing measurement', [packId], {}], [noMeasurement, [packId], {}]);
  }
  const activationModule = getModule(m, 'regionalPackActivation');
  probe('regionalPackActivation', 'activatedRegionalPackIds', 'default activation', []);
  probe('regionalPackActivation', 'activatedRegionalPackIds', 'unknown excluded pack',
    [{ regions: ['fallowmarch'], excludedPackIds: ['__m6_missing_pack'], assignmentOverrides: {} }]);

  const fishingModule = getModule(m, 'crownwardFishing');
  const riverChannels = (getModule(m, 'crownwardRiver').CROWNWARD_RIVER_CHANNELS ?? []) as AnyRecord[];
  if (typeof fishingModule.crownwardFisheries === 'function')
    probe('crownwardFishing', 'crownwardFisheries', 'original Crownward channels', [riverChannels]);

  // Universal source bodies are attached by the runtime world builder rather than regions.ts;
  // use a source-shaped group with a known reserved asset to exercise this pure remapping helper.
  const remapBase = acceptedGroups.all[0] ?? {
    id: 'm6_probe_group', family: 'probe', name: 'Probe', tier: 1, assetId: 'probe', scale: 1,
    centre: [0, 0], count: 1, radius: 1,
  };
  probe('world/universalMinibossSockets', 'remapReservedEncounterGroup', 'reserved source body',
    [{ ...remapBase, id: 'm6_probe_reserved', assetId: 'fantasy_monster_01' }]);
  const firstAcceptedRegion = regions[0]!;
  const flatOptions = { seed: 6, heightAt: (_x: number, _z: number) => 0, canStand: (_x: number, _z: number) => true };
  probe('world/universalMinibossSockets', 'validUniversalMinibossFootprint', 'flat receiving floor',
    [firstAcceptedRegion.id, firstAcceptedRegion.spawnPoint, { heightAt: 'flat', canStand: 'always' }],
    [firstAcceptedRegion.id, firstAcceptedRegion.spawnPoint, flatOptions]);

  // These helpers need live receiving-floor/entity ports or production terrain and are retained
  // explicitly as unprobed evidence rather than being called with a fake geometry model.
  const unprobedReasons: Record<string, string> = {
    'regions.validateRegions': 'Known asset IDs are a runtime manifest input; the no-argument probe is retained separately.',
    'world/universalMinibossSockets.deriveUniversalMinibossSockets': 'Requires production terrain, water and solid collision ports.',
    'world/universalMinibossSockets.validUniversalMinibossFootprint': 'Additional production solids/entity cases require live placement ports.',
    'world/mobSpawnSpacing.spreadMobSpawns': 'Requires live semantic entities and receiving-floor placement ports.',
  };
  for (const evidence of functions) if (!evidence.probes.length)
    evidence.unprobedReason = unprobedReasons[`${evidence.module}.${evidence.name}`]
      ?? 'Public helper retained in inventory; caller-specific geometry or acceptance inputs were not available in the immutable baseline.';

  const sourceHabitats = privateRows(getModule(m, 'worldHabitats'), 'sourceHabitats');
  const assignments = privateRows(rpgModule, 'assignments');
  const resourceClusters = acceptedClusters;
  const report: M6Baseline = {
    version: 1,
    source: { root: '.baseline', files },
    modules: {
      content: [...M6_CONTENT_MODULES], dependencies: [...M6_DEPENDENCY_MODULES], probeSupport: [...M6_PROBE_SUPPORT_MODULES],
    },
    constants, privateConstants,
    sharedExportReferences: [...shared.values()]
      .filter((names) => names.length > 1)
      .map((names) => [...names].sort())
      .sort((a, b) => a[0]!.localeCompare(b[0]!)),
    functions,
    original: {
      sourceRegions: snapshot(sourceRegions), regions: snapshot(regions),
      sourceGroups: snapshot(sourceGroups.surface), groups: snapshot(acceptedGroups.surface),
      sourceDungeonGroups: snapshot(sourceGroups.dungeon), dungeonGroups: snapshot(acceptedGroups.dungeon),
      sourceHabitats: snapshot(sourceHabitats), worldHabitats: snapshot(worldHabitats),
      sourceHabitatLookup: snapshot(sourceHabitatLookup), habitatLookup: snapshot(acceptedHabitatLookup),
      sourceResourceClusters: snapshot(sourceClusters), resourceClusters: snapshot(resourceClusters),
      placementOverrides: snapshot(placementModule.LEGACY_ENCOUNTER_PLACEMENT_OVERRIDES),
      caveFloorIntents: snapshot(placementModule.LEGACY_CAVE_FLOOR_INTENTS),
      regionalPacks: snapshot(regionalPacks),
      regionalPackVariants: snapshot(getModule(m, 'regionalPacks').REGIONAL_PACK_VARIANTS),
      regionalPackGroups: snapshot(getModule(m, 'regionalPacks').REGIONAL_PACK_GROUPS),
      regionalPackHabitats: snapshot(getModule(m, 'regionalPacks').REGIONAL_PACK_HABITATS),
      regionalPackPlan: snapshot(rpgModule.RPG_REGIONAL_PACK_PLAN),
      regionalPackLayout: snapshot(getModule(m, 'regionalPackLayout').REGIONAL_PACK_LAYOUT),
      regionalPackActivation: snapshot(activationModule.REGIONAL_PACK_ACTIVATION),
      activatedRegionalPackIds: snapshot(activeIds),
      sourcePackAssignments: snapshot(assignments),
      wildernessGroups: snapshot(getModule(m, 'wilderness').WILDERNESS_GROUPS),
      wildernessHabitats: snapshot(getModule(m, 'wilderness').WILDERNESS_HABITATS),
      fairyRegions: snapshot(getModule(m, 'fairyRegions').FAIRY_REGIONS),
    },
    orders: {
      sourceGroups: groupIds(sourceGroups.surface), groups: groupIds(acceptedGroups.surface),
      sourceDungeonGroups: groupIds(sourceGroups.dungeon), dungeonGroups: groupIds(acceptedGroups.dungeon),
      regionalPacks: groupIds(regionalPacks), resourceClusters: sourceClusters.map((row) => String(row.id)),
    },
    counts: {
      sourceRegions: sourceRegions.length, regions: regions.length,
      sourceGroups: sourceGroups.all.length, groups: acceptedGroups.all.length,
      sourceSurfaceGroups: sourceGroups.surface.length, acceptedSurfaceGroups: acceptedGroups.surface.length,
      sourceDungeonGroups: sourceGroups.dungeon.length, acceptedDungeonGroups: acceptedGroups.dungeon.length,
      worldHabitats: worldHabitats.length, regionalPacks: regionalPacks.length,
      activatedRegionalPacks: activeIds.length, resourceClusters: sourceClusters.length,
      constants: constants.length, privateConstants: privateConstants.length,
      functions: functions.length, probes: functions.reduce((sum, row) => sum + row.probes.length, 0),
    },
  };
  assert(report.counts.sourceRegions === 8 && report.counts.regions === 8, 'Unexpected original region count');
  assert(report.counts.sourceSurfaceGroups === 176 && report.counts.acceptedSurfaceGroups === 232,
    'Unexpected original surface group counts');
  assert(report.counts.sourceDungeonGroups === 7 && report.counts.acceptedDungeonGroups === 7,
    'Unexpected original dungeon group counts');
  assert(report.counts.worldHabitats === 213 && report.counts.regionalPacks === 96 && report.counts.resourceClusters === 50,
    'Unexpected original M6 aggregate counts');
  return report;
}

/** Reports are restricted to `test-results/*.json` and symlink-safe parents inside the repo. */
export async function writeM6BaselineReport(report: M6Baseline, out: string, root = repoRoot): Promise<string> {
  const absoluteRoot = await realpath(root);
  const destination = path.resolve(absoluteRoot, out);
  const reportRoot = path.join(absoluteRoot, 'test-results');
  assert(within(reportRoot, destination) && destination.endsWith('.json'), '--out must be a JSON report under test-results/');
  let parent = path.dirname(destination);
  for (;;) {
    try {
      const resolved = await realpath(parent);
      assert(resolved === parent && (resolved === absoluteRoot || within(absoluteRoot, resolved)),
        'Report parent escapes workspace or uses a symlink');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      parent = path.dirname(parent);
    }
  }
  try {
    const resolved = await realpath(destination);
    assert(resolved === destination && within(reportRoot, resolved), 'Report destination escapes test-results or uses a symlink');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return destination;
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 2 && args[0] === '--out' && !!args[1]),
    'Usage: tsx tools/content/m6-baseline.ts [--out test-results/report.json]');
  const report = await buildM6Baseline();
  if (args[1]) console.log(`Wrote ${await writeM6BaselineReport(report, args[1])}`);
  console.log(JSON.stringify({ mode: args[1] ? 'report' : 'dry-run', ...report.counts,
    modules: M6_MODULES.length, contentModules: M6_CONTENT_MODULES.length, dependencyModules: M6_DEPENDENCY_MODULES.length,
    probes: report.counts.probes, unprobed: report.functions.filter((row) => !row.probes.length)
      .map((row) => `${row.module}.${row.name}`) }, null, 2));
}
