/** M4 creature export. Baseline loading and writes occur only when explicitly invoked. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { CreatureRecordSchema, CreatureRuntimeSchema, type CreatureRecord } from '../../game/src/content/schema/creatures.js';
import { parseValue } from '../../game/src/content/schema/core.js';
import { buildM4Baseline, SPECIES_SOURCES, type M4Baseline, type Snapshot } from './m4-baseline.js';
import { canonicalRecords, writeContentJson } from './format.js';

function restore(value: Snapshot): unknown {
  switch (value.kind) {
    case 'undefined': return undefined;
    case 'null': return null;
    case 'array': return value.values.map(restore);
    case 'set': return new Set(value.values.map(restore));
    case 'map': return new Map(value.entries.map(([key, entry]) => [restore(key), restore(entry)]));
    case 'object': return Object.fromEntries(value.entries.map(([key, entry]) => [key, restore(entry)]));
    default: return value.value;
  }
}

/** Validate complete source views, references and stage before any record can be written. */
export function buildCreatureRecords(baseline: M4Baseline): CreatureRecord[] {
  const records = canonicalRecords(CreatureRecordSchema, baseline.records.creatures, 'creatures');
  const enemies = new Map(baseline.records.enemies.map(row => [row.id, row]));
  const loot = new Map(baseline.records.lootTables.map(row => [row.id, row]));
  const runtime = records.map(({ catalog: _catalog, stage: _stage, presentationKind: _kind, blockId, lootTableId, ...presentation }) => {
    const enemy = enemies.get(blockId);
    const table = loot.get(lootTableId);
    if (!enemy) throw new Error(`Creature ${presentation.id} references unknown block ${blockId}`);
    if (!table) throw new Error(`Creature ${presentation.id} references unknown loot table ${lootTableId}`);
    const { catalog: _enemyCatalog, stage: _enemyStage, registrationOrder: _registrationOrder,
      labOrder: _labOrder, fantasyTierOrder: _fantasyTierOrder, lootTableId: _enemyLoot, ...stats } = enemy;
    return parseValue(CreatureRuntimeSchema, { ...presentation, stats: { ...stats, drops: table.drops } }, `creatures.${presentation.id}`);
  });
  for (const [module, name] of SPECIES_SOURCES) {
    const source = baseline.constants.find(entry => entry.module === module && entry.name === name);
    if (!source) throw new Error(`Missing baseline creature source ${module}.${name}`);
    const actual = runtime.filter((_row, index) => records[index]!.catalog === name);
    if (!isDeepStrictEqual(restore(source.value), actual)) throw new Error(`Creature source parity failed for ${name}`);
  }
  const aggregate = runtime.filter((_row, index) => SPECIES_SOURCES.slice(0, 15).some(([, name]) => records[index]!.catalog === name));
  const original = baseline.constants.find(entry => entry.module === 'creatureSpecies' && entry.name === 'CREATURE_SPECIES');
  if (!original || !isDeepStrictEqual(restore(original.value), aggregate)) throw new Error('Creature source parity failed for CREATURE_SPECIES');
  return records;
}

export async function exportCreatures(apply = false): Promise<{ count: number; applied: boolean }> {
  const records = buildCreatureRecords(await buildM4Baseline());
  if (apply) await writeContentJson('data/creatures.json', records);
  return { count: records.length, applied: apply };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) throw new Error('Usage: tsx tools/content/export-creatures.ts [--apply]');
  console.log(JSON.stringify(await exportCreatures(args.includes('--apply')), null, 2));
}
