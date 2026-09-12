import type { RegionId, SemanticEntity, Vec3 } from '../contracts.js';
import type { GameState } from '../state/store.js';
import { EntityActiveSet } from './entityActiveSet.js';

export interface PlayerAssetArea {
  position: Vec3;
  regionId: RegionId;
  resourceRadius: number;
  viewRadius: number;
}

/** Region labels are ownership. Only the underground boundary separates visible worlds. */
export function selectPlayerEntities(entities: readonly SemanticEntity[], area: PlayerAssetArea): readonly SemanticEntity[] {
  const index = new EntityActiveSet();
  index.replace(entities.filter(entity => (entity.regionId === 'gravelmaw') === (area.regionId === 'gravelmaw')));
  index.setArea(area.position, area.resourceRadius, area.viewRadius);
  index.setActorRadius(area.viewRadius);
  return index.selected();
}

/** The backpack and worn items can be used immediately. Banked items are fetched on withdrawal. */
export function immediatePlayerItems(state: Pick<GameState, 'inventory' | 'equipment'>): string[] {
  return [...new Set([...state.inventory.slots, ...Object.values(state.equipment)]
    .flatMap(stack => stack ? [stack.itemId] : []))].sort();
}
