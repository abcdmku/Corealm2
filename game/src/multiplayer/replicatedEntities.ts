import { worldMapForRegion, type RegionId, type SemanticEntity } from "../contracts.js";
import type { EntityStore } from "../world/entities.js";

/** Fixed authored scenery is shared by content version and seed, not gameplay interest radius. */
export function isStaticScenery(entity: SemanticEntity): boolean {
  return entity.archetype === "landmark" && entity.interactions.every(verb => verb === "inspect");
}

/** Keep immutable map scenery while authoritative snapshots replace actors and interactables. */
export class ReplicatedEntityLayer {
  private scenery = new Map<string, SemanticEntity>();
  private readonly filters = new Map<string, (entity: SemanticEntity) => boolean>();
  constructor(private readonly store: EntityStore, baseline: readonly SemanticEntity[]) { this.capture(baseline); }
  // Call with the saved offline copy, never the live entity objects that replication mutates.
  capture(baseline: readonly SemanticEntity[]): void {
    this.scenery = new Map(baseline.filter(isStaticScenery).map(entity => [entity.id, entity]));
  }
  reset(): void { this.store.load([...this.scenery.values()]); }
  upsert(entity: SemanticEntity): void {
    // Do not mutate the authored fallback when the server overrides the same id.
    if (this.store.get(entity.id) === this.scenery.get(entity.id)) this.store.add(entity);
    else upsertReplicatedEntity(this.store, entity);
  }
  remove(id: string): void {
    const fallback = this.scenery.get(id);
    if (fallback) this.store.add(fallback);
    else this.store.remove(id);
  }
  renderSnapshot(region: RegionId): readonly SemanticEntity[] {
    const map = worldMapForRegion(region);
    let filter = this.filters.get(map);
    if (!filter) { filter = entity => worldMapForRegion(entity.regionId) === map; this.filters.set(map, filter); }
    return this.store.renderSnapshot(filter);
  }
}

/** Preserve render references and spatial membership when a delta only changes actor state. */
export function upsertReplicatedEntity(store: EntityStore, next: SemanticEntity): void {
  const current = store.get(next.id);
  if (!current) { store.add(next); return; }
  const membershipChanged = current.archetype !== next.archetype || current.regionId !== next.regionId
    || Boolean(current.view) !== Boolean(next.view);
  const before = current.interactionPosition ?? current.position;
  const after = next.interactionPosition ?? next.position;
  const moved = before.some((value, axis) => value !== after[axis]);
  for (const key of Object.keys(current)) if (!Object.hasOwn(next, key)) Reflect.deleteProperty(current, key);
  Object.assign(current, next);
  if (membershipChanged) store.add(current);
  else if (moved) store.setPosition(current.id, current.position);
}
