import { RESOLVED_TABLES } from './resolvedCatalog.js';
const rawLootTables = RESOLVED_TABLES["lootTables"];
import type { EnemyDef } from "./index.js";
import { parseCollection } from "./schema/core.js";
import { LootTableSchema, type LootTableRecord } from "./schema/loot.js";

/** Parsed loot tables in their authored order. The JSON is parsed exactly once at module load. */
export const LOOT_RECORDS: readonly LootTableRecord[] = parseCollection(
  LootTableSchema,
  rawLootTables,
  { name: "lootTables" },
);

const lootTablesById = new Map(LOOT_RECORDS.map((row) => [row.id, row] as const));

function unknownLootTable(id: string): never {
  throw new Error(`Unknown loot table: ${id}`);
}

/** Returns the parsed record for a stable loot-table id. */
export function lootTableById(id: string): LootTableRecord {
  const row = lootTablesById.get(id);
  if (!row) return unknownLootTable(id);
  return row;
}

/** Returns the cached drop array for a stable loot-table id. */
export function lootDrops(id: string): EnemyDef["drops"] {
  return lootTableById(id).drops;
}
