import { arr, refine, union, type Infer } from './core.js';
import { SourceInputSchema, SourceParamsSchema } from './enemySources.js';
import { VariantEnemySourceInputSchema, VariantParamsSchema } from './enemySourceVariants.js';
import { DescendantSourceInputSchema } from './enemyDescendantSources.js';
import { WildernessBaseSourceInputSchema } from './enemyWildernessSources.js';
import { ActorEnemySourceInputSchema } from './enemyActorSources.js';

export const EnemySourceGraphInputSchema = union([SourceInputSchema, VariantEnemySourceInputSchema, ActorEnemySourceInputSchema, WildernessBaseSourceInputSchema, DescendantSourceInputSchema] as const);
export type EnemySourceGraphInput = Infer<typeof EnemySourceGraphInputSchema>;
export const EnemySourceGraphParamsSchema = SourceParamsSchema.extend(VariantParamsSchema.fields);
export type EnemySourceGraphParams = Infer<typeof EnemySourceGraphParamsSchema>;
export const EnemySourceGraphInputsSchema = refine(arr(EnemySourceGraphInputSchema), rows => {
  const inputs = new Map(rows.map(row => [row.id, row]));
  if (inputs.size !== rows.length) return false;
  const visiting = new Set<string>(), complete = new Set<string>();
  const visit = (id: string): boolean => {
    if (complete.has(id)) return true;
    if (visiting.has(id)) return false;
    const input = inputs.get(id);
    if (!input) return false;
    visiting.add(id);
    if ('sourceInputId' in input && !visit(input.sourceInputId)) return false;
    visiting.delete(id); complete.add(id);
    return true;
  };
  return rows.every(row => visit(row.id));
}, 'Source input ids must be unique, dependencies must exist, and the graph must be acyclic');
