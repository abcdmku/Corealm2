/** One-shot loot migration. Dry run validates the baseline; --apply replaces data/lootTables.json. */
import path from "node:path";
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from "node:url";
import { buildM4Baseline } from "./m4-baseline.js";
import { repoRoot } from "../lib/paths.js";
import { canonicalRecords, writeContentJson } from "./format.js";
import { LootTableSchema, type LootTableRecord } from "../../game/src/content/schema/loot.js";
import { buildCoreSourceLoot, CORE_SOURCE_LOOT_MODULES, type CoreSourceLootSources } from './source-loot-inputs.js';
import { buildCoreEnemySources } from './enemy-source-inputs.js';
import { buildVariantEnemySources } from './enemy-source-variant-inputs.js';
import { deriveEnemySourceGraph } from '../../game/src/content/balance/enemySourceGraph.js';
import { deriveSourceLootGraph } from '../../game/src/content/balance/sourceLootGraph.js';
import { buildActorLootSources, ACTOR_LOOT_MODULES, type ActorLootSources } from './actor-loot-inputs.js';
import { buildDescendantLootSources, DESCENDANT_LOOT_MODULES, type DescendantLootSources } from './descendant-loot-inputs.js';

export async function buildLootSourceBundle() {
  const baseline = await buildM4Baseline();
  const sources = Object.fromEntries(CORE_SOURCE_LOOT_MODULES.map(name => [name,
    readFileSync(path.join(repoRoot, '.baseline/game/src/content', `${name}.ts`), 'utf8')])) as CoreSourceLootSources;
  const extracted = buildCoreSourceLoot(baseline, sources);
  const actorSources = Object.fromEntries(ACTOR_LOOT_MODULES.map(name => [name,
    readFileSync(path.join(repoRoot, '.baseline/game/src/content', `${name}.ts`), 'utf8')])) as ActorLootSources;
  const actors = buildActorLootSources(baseline, actorSources);
  const core = buildCoreEnemySources(baseline, { creatureExpansion: sources.creatureExpansion, starterCreatures: sources.starterCreatures, rpgBestiary: sources.rpgBestiary });
  const variants = buildVariantEnemySources(baseline, { enemies: sources.enemies, regionalCreatureVariants: sources.regionalCreatureVariants, creatureRedesign: sources.creatureRedesign, forestCreatureRedesigns: sources.forestCreatureRedesigns, ashCreatureRedesigns: sources.ashCreatureRedesigns, stoneCreatureRedesigns: sources.stoneCreatureRedesigns }, core.inputs);
  const descendantSources = Object.fromEntries(DESCENDANT_LOOT_MODULES.map(name => [name,
    readFileSync(path.join(repoRoot, '.baseline/game/src/content', `${name}.ts`), 'utf8')])) as DescendantLootSources;
  const descendants = buildDescendantLootSources(baseline, descendantSources, [...core.inputs, ...variants.inputs]);
  if (!isDeepStrictEqual(actors.externalFabric, descendants.externalFabric)) throw new Error('Original shared fabric dependencies disagree');
  const enemies = deriveEnemySourceGraph({ ...core.params, ...variants.params }, [...core.inputs, ...variants.inputs]);
  const owners = extracted.ownerProposals.map(owner => ({ id: owner.lootTableId, inputId: owner.inputId,
    mode: owner.formula ? 'formula' as const : 'authored' as const }));
  for (const inputId of variants.sourceInputIds) {
    const source = enemies.get(inputId)!;
    for (const tier of variants.fantasy.tiers) if (tier !== source.tier) owners.push({
      id: `loot_enemy_${source.family}_t${tier}`, inputId, mode: 'formula',
    });
  }
  owners.push(...actors.ownerProposals.map(owner => ({ id: owner.lootTableId, inputId: owner.inputId, mode: 'formula' as const })));
  owners.push(...descendants.ownerProposals.map(owner => ({ id: owner.lootTableId, inputId: owner.inputId,
    mode: owner.formula ? 'formula' as const : 'authored' as const })));
  // Append source inputs after the established core/actor prefix. Inherited boss loot resolves to its original RPG source.
  const sourceInputs = [...extracted.inputs, ...actors.inputs, ...descendants.inputs];
  const outputs = deriveSourceLootGraph(extracted.params, sourceInputs, { ...actors.externalFabric,
    actorLootParameters: actors.params, descendantLootParameters: descendants.params });
  const records = canonicalRecords(LootTableSchema, baseline.records.lootTables, 'lootTables');
  for (const owner of owners) {
    const record = records.find(row => row.id === owner.id);
    if (!record || !isDeepStrictEqual(record.drops, outputs.get(owner.inputId))) throw new Error(`Original loot ownership parity failed: ${owner.id}`);
    if (owner.mode === 'formula') record.derivation = { kind: 'sourceLoot.v1', inputId: owner.inputId };
  }
  if (new Set(owners.map(owner => owner.id)).size !== owners.length) throw new Error('Duplicate source loot owner');
  if (sourceInputs.length !== 253 || owners.length !== 298 || owners.filter(owner => owner.mode === 'authored').length !== 70
    || records.filter(record => record.derivation?.kind === 'sourceLoot.v1').length !== 228) {
    throw new Error('Unexpected source loot coverage counts');
  }
  const manifestSources = [...extracted.manifest.sources, ...actors.manifest.sources, ...descendants.manifest.sources]
    .filter((file, index, all) => all.findIndex(candidate => candidate.path === file.path) === index);
  return { records: canonicalRecords(LootTableSchema, records, 'lootTables'), sourceLoot: extracted.params,
    actorLootParameters: actors.params, descendantLootParameters: descendants.params, sourceInputs, sourceOwners: owners, externalFabric: actors.externalFabric,
    manifest: { sources: manifestSources,
      rows: [...extracted.manifest.rows, ...actors.manifest.rows, ...descendants.manifest.rows],
      parameters: [...extracted.manifest.parameters, ...actors.manifest.parameters.map(row => ({
        ...row, parameterPath: `actorLootParameters.${row.parameterPath}`,
      })), ...descendants.manifest.parameters.map(row => ({
        ...row, parameterPath: `descendantLootParameters.${row.parameterPath}`,
      }))], externalParameters: actors.manifest.externalParameters } };
}

/** Rebuilds the canonical loot rows from the immutable M4 baseline. */
export async function buildLootRecords(): Promise<LootTableRecord[]> {
  return (await buildLootSourceBundle()).records;
}

function parseApply(args: readonly string[]): boolean {
  const unexpected = args.filter((arg) => arg !== "--apply");
  if (unexpected.length > 0) throw new Error(`Unknown arguments: ${unexpected.join(" ")}`);
  if (args.filter((arg) => arg === "--apply").length > 1) throw new Error("Duplicate --apply argument");
  return args.includes("--apply");
}

/** Validates by default and writes only when --apply is passed. */
export async function runLootExport(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const apply = parseApply(args);
  const records = await buildLootRecords();
  console.log(`Validated ${records.length} baseline loot tables.`);
  if (apply) {
    const changed = await writeContentJson("data/lootTables.json", records);
    console.log(changed ? "Wrote game/content/data/lootTables.json" : "game/content/data/lootTables.json already matches");
  } else {
    console.log("Dry run: no files written. Pass --apply to replace game/content/data/lootTables.json with baseline records.");
  }
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  await runLootExport();
}
