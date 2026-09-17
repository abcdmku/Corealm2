import { worldMapForRegion, type RegionId, type SemanticEntity, type Vec3 } from '../contracts.js';
import type { GameState } from '../state/store.js';
import { EntityActiveSet } from './entityActiveSet.js';

export interface PlayerAssetArea {
  position: Vec3;
  regionId: RegionId;
  resourceRadius: number;
  viewRadius: number;
}

/** Adjacent regions share visible content only when they belong to the same map. */
export function selectPlayerEntities(entities: readonly SemanticEntity[], area: PlayerAssetArea): readonly SemanticEntity[] {
  return new PlayerEntitySelector().select(entities, area);
}

/** Travel reuses the spatial index; stable store snapshots refresh only moving actors. */
export class PlayerEntitySelector {
  private readonly index = new EntityActiveSet();

  select(entities: readonly SemanticEntity[], area: PlayerAssetArea): readonly SemanticEntity[] {
    this.index.replace(entities);
    this.index.setArea(area.position, area.resourceRadius, area.viewRadius);
    this.index.setActorRadius(area.viewRadius);
    const mapId = worldMapForRegion(area.regionId);
    return this.index.selected().filter(entity => worldMapForRegion(entity.regionId) === mapId);
  }
}

/** The backpack and worn items can be used immediately. Banked items are fetched on withdrawal. */
export function immediatePlayerItems(state: Pick<GameState, 'inventory' | 'equipment'>): string[] {
  return [...new Set([...state.inventory.slots, ...Object.values(state.equipment)]
    .flatMap(stack => stack ? [stack.itemId] : []))].sort();
}
