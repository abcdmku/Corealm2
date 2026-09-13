import type { EnemySourceGraphInput, EnemySourceGraphParams } from '../schema/enemySourceGraph.js';
import { deriveCoreEnemy, type EnemyFieldsWithoutDrops } from './enemySources.js';
import { deriveVariantEnemy } from './enemySourceVariants.js';

/** Resolve original inputs once per graph, retaining the caller's row order and cached dependencies. */
export function deriveEnemySourceGraph(params: EnemySourceGraphParams, rows: readonly EnemySourceGraphInput[]): ReadonlyMap<string, EnemyFieldsWithoutDrops> {
  const inputs = new Map(rows.map(row => [row.id, row]));
  if (inputs.size !== rows.length) throw new Error('Duplicate source input id');
  const outputs = new Map<string, EnemyFieldsWithoutDrops>(), visiting = new Set<string>();
  const resolve = (id: string): EnemyFieldsWithoutDrops => {
    const cached = outputs.get(id);
    if (cached) return cached;
    if (visiting.has(id)) throw new Error(`Circular source dependency ${id}`);
    const input = inputs.get(id);
    if (!input) throw new Error(`Missing original source input ${id}`);
    visiting.add(id);
    const result = input.kind === 'variant' || input.kind === 'redesign'
      ? deriveVariantEnemy(params, input, resolve(input.sourceInputId)) : deriveCoreEnemy(params, input);
    visiting.delete(id); outputs.set(id, result);
    return result;
  };
  return new Map(rows.map(row => [row.id, resolve(row.id)]));
}
