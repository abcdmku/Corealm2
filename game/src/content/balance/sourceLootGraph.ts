import type { EnemyDef } from '../index.js';
import { deriveSourceLoot, type SourceLootParams } from './sourceLoot.js';
import { deriveActorLoot, type ActorLootDependencies, type ActorLootParams } from './actorLoot.js';
import type { SourceLootGraphInput } from '../schema/sourceLootGraph.js';

import { deriveDescendantLoot, type DescendantLootParams } from './descendantLoot.js';
export interface SourceLootGraphDependencies extends ActorLootDependencies { actorLootParameters: ActorLootParams; descendantLootParameters?: DescendantLootParams }
export function deriveSourceLootGraph(params: SourceLootParams, rows: readonly SourceLootGraphInput[], dependencies?: SourceLootGraphDependencies): ReadonlyMap<string, EnemyDef['drops']> {
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
    const drops = input.kind === 'fairyCrown' || input.kind === 'crownwardDragon' || input.kind === 'wildernessDragonSource'
      ? (() => {
        if (!dependencies?.descendantLootParameters) throw new Error(`Missing descendant loot dependencies for ${id}`);
        return deriveDescendantLoot(dependencies.descendantLootParameters, input, dependencies);
      })() : input.kind === 'fairy' || input.kind === 'universalJewelry'
      ? (() => {
        if (!dependencies) throw new Error(`Missing actor loot dependencies for ${id}`);
        return deriveActorLoot(dependencies.actorLootParameters, input, dependencies);
      })() : deriveSourceLoot(params, input, cache);
    visiting.delete(id); cache.set(id, drops); return drops;
  };
  return new Map(rows.map(row => [row.id, resolve(row.id)]));
}
