import { arr, refine, union, type Infer } from './core.js';
import { SourceLootInputSchema } from './sourceLoot.js';
import { DescendantLootInputSchema } from './descendantLoot.js';
import { ActorLootInputSchema } from './actorLoot.js';

export const SourceLootGraphInputSchema = union([SourceLootInputSchema, ActorLootInputSchema, DescendantLootInputSchema] as const);
export const SourceLootGraphInputsSchema = refine(arr(SourceLootGraphInputSchema), rows => {
  const inputs = new Map(rows.map(row => [row.id, row]));
  if (inputs.size !== rows.length) return false;
  const visiting = new Set<string>(), complete = new Set<string>();
  const visit = (id: string): boolean => {
    if (complete.has(id)) return true;
    if (visiting.has(id)) return false;
    const row = inputs.get(id);
    if (!row) return false;
    visiting.add(id);
    if ('sourceInputId' in row && !visit(row.sourceInputId)) return false;
    visiting.delete(id); complete.add(id); return true;
  };
  return rows.every(row => visit(row.id));
}, 'Source loot ids must be unique and all dependencies must exist without cycles');
export type SourceLootGraphInput = Infer<typeof SourceLootGraphInputSchema>;
