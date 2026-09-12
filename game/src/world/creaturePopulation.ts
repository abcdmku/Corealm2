import type { SemanticEntity } from '../contracts.js';
import { hashId } from './habitatMovement.js';
import { tierSilhouetteScale } from '../core/math.js';

/** Live resident budgets use measured production bodies, including coastal and regional packs.
 * Keep the first saved actor IDs and never increase an already sparse group. */
export function refineCreaturePopulation(entities: readonly SemanticEntity[],
  includes: (entity: SemanticEntity) => boolean = entity => entity.regionId === 'karrowmoor',
  assetSize?: (assetId: string) => { y: number } | null): SemanticEntity[] {
  const groups = new Map<string, SemanticEntity[]>();
  for (const entity of entities) {
    if (entity.archetype !== 'enemy' || !includes(entity)) continue;
    const key = `${entity.regionId}:${entity.meta?.groupId ?? entity.id}`;
    const members = groups.get(key) ?? [];
    members.push(entity); groups.set(key, members);
  }
  const removed = new Set<string>();
  for (const [key, members] of groups) {
    const radius = Math.max(...members.map(entity => {
      const height = entity.view?.assetId ? (assetSize?.(entity.view.assetId)?.y ?? 0)
        * (entity.view.scale ?? 1) * tierSilhouetteScale(entity.tier ?? 1) : 0;
      // A 3.6 m tall figure occupies as much of the view as a 2.4 m wide body.
      return Math.max(entity.combat?.bodyRadius ?? .5, height / 3);
    }));
    const [minimum, variation]: [number, number] = radius >= 1.2 ? [2, 2] : radius >= .9 ? [4, 2]
      : radius >= .6 ? [6, 2] : [8, 3];
    const limit = minimum + hashId(key) % variation;
    for (const entity of members.slice(limit)) removed.add(entity.id);
  }
  return entities.filter(entity => !removed.has(entity.id));
}
