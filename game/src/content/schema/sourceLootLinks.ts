import { lootBalanceSchema } from './balance.js';
import { SourceLootDerivationSchema } from './lootDerivation.js';
import { parseValue, type SchemaIssue } from './core.js';

/** The source ledger retains ownership even when an editor keeps a table's saved values. */
export function validateSourceLootLinks(tables: ReadonlyMap<string, unknown>): SchemaIssue[] {
  const rows = tables.get('lootTables');
  if (!Array.isArray(rows) || !tables.has('balance/loot')) return [];
  const params = parseValue(lootBalanceSchema, tables.get('balance/loot'), 'balance/loot');
  const inputs = new Map(params.sourceInputs.map(row => [row.id, row]));
  const owners = new Map(params.sourceOwners.map(row => [row.id, row]));
  const records = new Map(rows.map((row: { id: string; derivation?: unknown }) => [row.id, row]));
  const issues: SchemaIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message, severity: 'error' });
  for (const owner of owners.values()) {
    if (!inputs.has(owner.inputId)) issue(`balance/loot.sourceOwners.${owner.id}.inputId`, 'Missing original loot source input');
    if (!records.has(owner.id)) issue(`balance/loot.sourceOwners.${owner.id}.id`, 'Missing saved loot table owner');
  }
  for (const row of records.values()) {
    if (row.derivation === undefined) continue;
    const at = `lootTables.${row.id}.derivation`;
    const tag = parseValue(SourceLootDerivationSchema, row.derivation, at);
    const owner = owners.get(row.id);
    if (!owner || owner.mode !== 'formula' || owner.inputId !== tag.inputId || !inputs.has(tag.inputId)) {
      issue(at, 'Loot source is missing or belongs to another saved table');
    }
  }
  return issues;
}
