import type { EnemyDef } from '../index.js';
import { deriveSourceLoot, type SourceLootInput, type SourceLootParams } from './sourceLoot.js';

export function deriveSourceLootGraph(params: SourceLootParams, rows: readonly SourceLootInput[]): ReadonlyMap<string, EnemyDef['drops']> {
  const inputs = new Map(rows.map(row => [row.id, row]));
  if (inputs.size !== rows.length) throw new Error('Duplicate source loot input id');
  const cache = new Map<string, EnemyDef['drops']>(), visiting = new Set<string>();
  const resolve = (id: string): EnemyDef['drops'] => {
    const cached = cache.get(id);
    if (cached) return cached;
    if (visiting.has(id)) throw new Error(`Circular source loot dependency ${id}`);
    const input = inputs.get(id);
    if (!input) throw new Error(`Missing source loot input ${id}`);
    visiting.add(id);
    if ('sourceInputId' in input) resolve(input.sourceInputId);
    const drops = deriveSourceLoot(params, input, cache);
    visiting.delete(id); cache.set(id, drops); return drops;
  };
  return new Map(rows.map(row => [row.id, resolve(row.id)]));
}
