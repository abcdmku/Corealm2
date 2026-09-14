import type { EnemySourceGraphInput, EnemySourceGraphParams } from '../schema/enemySourceGraph.js';
import { deriveCoreEnemy, type EnemyFieldsWithoutDrops } from './enemySources.js';
import { deriveVariantEnemy } from './enemySourceVariants.js';
import { deriveActorEnemy, type ActorTuningDependencies, type ActorSourceParams } from './enemyActorSources.js';

import { deriveWildernessSourceEnemy, type WildernessSourceDependencies, type WildernessSourceParams } from './enemyWildernessSources.js';
import { deriveDescendantEnemy, type DescendantSourceParams } from './enemyDescendantSources.js';
export interface EnemySourceGraphDependencies extends ActorTuningDependencies {
  actorSourceParameters: ActorSourceParams;
  wildernessSourceParameters?: WildernessSourceParams;
  descendantSourceParameters?: DescendantSourceParams;
  regionalBossLevels?: WildernessSourceDependencies['regionalBossLevels'];
  keepers?: WildernessSourceDependencies['keepers'];
}

/** Resolve original inputs once per graph, retaining the caller's row order and cached dependencies. */
export function deriveEnemySourceGraph(params: EnemySourceGraphParams, rows: readonly EnemySourceGraphInput[], dependencies?: EnemySourceGraphDependencies): ReadonlyMap<string, EnemyFieldsWithoutDrops> {
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
    let result: EnemyFieldsWithoutDrops;
    if (input.kind === 'fairyCrown' || input.kind === 'crownwardDragon') {
      if (!dependencies?.descendantSourceParameters) throw new Error(`Missing descendant source dependencies for ${input.id}`);
      result = deriveDescendantEnemy(dependencies.descendantSourceParameters, input, { ...dependencies, resolveSource: resolve });
    } else if (input.kind === 'wildernessBody' || input.kind === 'wildernessDragon' || input.kind === 'regionalBossBody') {
      if (!dependencies?.wildernessSourceParameters || !dependencies.regionalBossLevels || !dependencies.keepers) throw new Error(`Missing Wilderness source dependencies for ${input.id}`);
      result = deriveWildernessSourceEnemy(dependencies.wildernessSourceParameters, input, { ...dependencies, regionalBossLevels: dependencies.regionalBossLevels, keepers: dependencies.keepers, resolveSource: resolve });
    } else if (input.kind === 'universal' || input.kind === 'fairy' || input.kind === 'garden') {
      if (!dependencies) throw new Error(`Missing actor tuning dependencies for ${input.id}`);
      result = deriveActorEnemy(dependencies.actorSourceParameters, input, dependencies);
    } else result = input.kind === 'variant' || input.kind === 'redesign'
      ? deriveVariantEnemy(params, input, resolve(input.sourceInputId)) : deriveCoreEnemy(params, input);
    visiting.delete(id); outputs.set(id, result);
    return result;
  };
  return new Map(rows.map(row => [row.id, resolve(row.id)]));
}
