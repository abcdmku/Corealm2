import type { Archetype, EntityId, RegionId, SemanticEntity, Vec3 } from "../contracts.js";
import { isStableRenderSnapshot } from '../world/entities.js';

const DEFAULT_CELL_SIZE = 64;
const DEFAULT_ACTIVE_RADIUS = 160;

export interface EntityActiveSetOptions {
  /** Width of one XZ lookup cell in world metres. This changes query cost, not membership. */
  cellSize?: number;
  /** Radius used by `setPosition` before a caller supplies one explicitly. */
  radius?: number;
  /** Radius for static architecture. Defaults to `radius`. */
  structureRadius?: number;
}

export interface EntityActiveSetStats {
  /** Semantic rows in the latest snapshot, including rows without a visual view. */
  tracked: number;
  /** Rows that carry `SemanticEntity.view` and can have a visual record. */
  eligible: number;
  /** Eligible rows selected by the current area, full-residency mode, or capture pin. */
  selected: number;
  /** Radius for actors, resources, and other changing views. */
  radius: number;
  /** Radius for static architecture. */
  structureRadius: number;
  actorRadius: number;
  fullResidency: boolean;
  pinnedEntityId: EntityId | null;
}

/**
 * Deterministic XZ selection for semantic entity views.
 *
 * This class only indexes references supplied by the semantic store. It never writes them. Region
 * lookup exists for asset preloading, not visual biome ownership: radius selection remains spatial
 * and may cross every semantic region boundary.
 */
export class EntityActiveSet {
  private readonly cellSize: number;
  private radius: number;
  private structureRadius: number;
  private actorRadius: number | null = null;
  private position: Vec3 = [0, 0, 0];
  private fullResidency = true;
  private pinnedEntityId: EntityId | null = null;
  private readonly entities = new Map<EntityId, SemanticEntity>();
  private readonly positions = new Map<EntityId, Vec3>();
  private readonly regions = new Map<EntityId, RegionId>();
  private readonly cells = new Map<string, Set<EntityId>>();
  private readonly membership = new Map<EntityId, { key: string | null; seen: number }>();
  private generation = 0;
  private selectedCache: readonly SemanticEntity[] | null = null;
  private stableSnapshot: readonly SemanticEntity[] | null = null;
  private moving: SemanticEntity[] = [];

  constructor(options: EntityActiveSetOptions = {}) {
    this.cellSize = positiveFinite(options.cellSize ?? DEFAULT_CELL_SIZE, "cellSize");
    this.radius = nonNegativeFinite(options.radius ?? DEFAULT_ACTIVE_RADIUS, "radius");
    this.structureRadius = nonNegativeFinite(
      options.structureRadius ?? this.radius,
      "structureRadius",
    );
  }

  /** Refreshes the snapshot, moving only changed rows between spatial cells. */
  replace(entities: readonly SemanticEntity[]): void {
    if (entities === this.stableSnapshot) {
      for (const entity of this.moving) this.updateEntry(entity, this.generation);
      this.selectedCache = null;
      return;
    }
    this.stableSnapshot = isStableRenderSnapshot(entities) ? entities : null;
    this.moving = entities.filter(isActorEntity);
    const generation = ++this.generation;
    for (const entity of entities) this.updateEntry(entity, generation);
    for (const [id, member] of this.membership) {
      if (member.seen === generation) continue;
      if (member.key) this.removeFromCell(id, member.key);
      this.membership.delete(id);
      this.entities.delete(id);
      this.positions.delete(id);
      this.regions.delete(id);
    }
    // The final selection is sorted, so bucket insertion order never affects residency.
    this.selectedCache = null;
  }

  private updateEntry(entity: SemanticEntity, generation: number): void {
    this.entities.set(entity.id, entity);
    this.regions.set(entity.id, entity.regionId);
    const previous = this.positions.get(entity.id);
    const position = entity.position;
    const moved = !previous || previous[0] !== position[0]
      || previous[1] !== position[1] || previous[2] !== position[2];
    if (moved) this.positions.set(entity.id, copyPosition(position));
    const member = this.membership.get(entity.id);
    const key = !entity.view ? null : member?.key && !moved
      ? member.key : cellKey(position, this.cellSize);
    if (!member || member.key !== key) {
      if (member?.key) this.removeFromCell(entity.id, member.key);
      if (key) {
        let cell = this.cells.get(key);
        if (!cell) this.cells.set(key, cell = new Set());
        cell.add(entity.id);
      }
    }
    if (member) { member.key = key; member.seen = generation; }
    else this.membership.set(entity.id, { key, seen: generation });
  }

  private removeFromCell(id: EntityId, key: string): void {
    const cell = this.cells.get(key);
    cell?.delete(id);
    if (cell?.size === 0) this.cells.delete(key);
  }

  /** Activates radius selection around one world position. */
  setArea(position: Vec3, radius: number, structureRadius = radius): void {
    this.position = copyPosition(position);
    this.radius = nonNegativeFinite(radius, "radius");
    this.structureRadius = nonNegativeFinite(structureRadius, "structureRadius");
    this.fullResidency = false;
    this.selectedCache = null;
  }

  /** Moves the active area while keeping its radius. */
  setPosition(position: Vec3): void {
    this.position = copyPosition(position);
    this.fullResidency = false;
    this.selectedCache = null;
  }

  /** Changes the active radius while keeping its centre. */
  setRadius(radius: number): void {
    this.radius = nonNegativeFinite(radius, "radius");
    this.structureRadius = this.radius;
    this.fullResidency = false;
    this.selectedCache = null;
  }

  /** Changes only actors and resources while leaving static architecture resident farther out. */
  setDynamicRadius(radius: number): void {
    this.radius = nonNegativeFinite(radius, "radius");
    this.fullResidency = false;
    this.selectedCache = null;
  }

  /** Changes the static-architecture radius without pulling actors and resources into it. */
  setStructureRadius(radius: number): void {
    this.structureRadius = nonNegativeFinite(radius, "structureRadius");
    this.fullResidency = false;
    this.selectedCache = null;
  }

  /** Actors remain visible beyond the resource interaction working set. */
  setActorRadius(radius: number): void {
    this.actorRadius = nonNegativeFinite(radius, "actorRadius");
    this.fullResidency = false;
    this.selectedCache = null;
  }

  /** Full residency is reserved for deterministic full-island capture and explicit diagnostics. */
  setFullResidency(enabled: boolean): void {
    if (this.fullResidency === enabled) return;
    this.fullResidency = enabled;
    this.selectedCache = null;
  }

  /** Keeps one documentation subject selected even when it lies outside the active radius. */
  pin(entityId: EntityId | null): void {
    if (this.pinnedEntityId === entityId) return;
    this.pinnedEntityId = entityId;
    this.selectedCache = null;
  }

  /** Selected visual rows in stable entity-id order. */
  selected(): readonly SemanticEntity[] {
    if (this.selectedCache) return this.selectedCache;

    const ids = this.fullResidency ? this.allEligibleIds() : this.idsInsideArea();
    if (this.pinnedEntityId && this.entities.get(this.pinnedEntityId)?.view) {
      ids.add(this.pinnedEntityId);
    }

    this.selectedCache = [...ids]
      .sort(compareIds)
      .map((id) => this.entities.get(id))
      .filter((entity): entity is SemanticEntity => Boolean(entity?.view));
    return this.selectedCache;
  }

  /** Every visual row in the latest snapshot, stable across input order. */
  all(): readonly SemanticEntity[] {
    return [...this.entities.values()]
      .filter((entity) => Boolean(entity.view))
      .sort((a, b) => compareIds(a.id, b.id));
  }

  /** Semantic-region rows for asset preloading only. This does not select or instantiate them. */
  forRegion(regionId: RegionId): readonly SemanticEntity[] {
    return [...this.entities.values()]
      .filter((entity) => entity.view && this.regions.get(entity.id) === regionId)
      .sort((a, b) => compareIds(a.id, b.id));
  }

  has(entityId: EntityId): boolean {
    return this.entities.has(entityId);
  }

  isSelected(entityId: EntityId): boolean {
    return this.selected().some((entity) => entity.id === entityId);
  }

  stats(): EntityActiveSetStats {
    let eligible = 0;
    for (const entity of this.entities.values()) if (entity.view) eligible += 1;
    return {
      tracked: this.entities.size,
      eligible,
      selected: this.selected().length,
      radius: this.radius,
      structureRadius: this.structureRadius,
      actorRadius: this.actorRadius ?? this.radius,
      fullResidency: this.fullResidency,
      pinnedEntityId: this.pinnedEntityId,
    };
  }

  private allEligibleIds(): Set<EntityId> {
    const ids = new Set<EntityId>();
    for (const entity of this.entities.values()) if (entity.view) ids.add(entity.id);
    return ids;
  }

  private idsInsideArea(): Set<EntityId> {
    const ids = new Set<EntityId>();
    const queryRadius = Math.max(this.radius, this.structureRadius, this.actorRadius ?? this.radius);
    const minX = Math.floor((this.position[0] - queryRadius) / this.cellSize);
    const maxX = Math.floor((this.position[0] + queryRadius) / this.cellSize);
    const minZ = Math.floor((this.position[2] - queryRadius) / this.cellSize);
    const maxZ = Math.floor((this.position[2] + queryRadius) / this.cellSize);

    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      for (let cellZ = minZ; cellZ <= maxZ; cellZ += 1) {
        const cell = this.cells.get(`${cellX}_${cellZ}`);
        if (!cell) continue;
        for (const entityId of cell) {
          const entity = this.entities.get(entityId);
          const position = this.positions.get(entityId);
          if (!entity?.view || !position) continue;
          const dx = position[0] - this.position[0];
          const dz = position[2] - this.position[2];
          const radius = isStructureEntity(entity) ? this.structureRadius
            : isActorEntity(entity) ? this.actorRadius ?? this.radius : this.radius;
          if (dx * dx + dz * dz <= radius * radius) ids.add(entityId);
        }
      }
    }
    return ids;
  }
}

const STRUCTURE_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>([
  "bank",
  "door",
  "landmark",
  "obstacle",
  "portal",
  "shop",
  "station",
]);

/** Static world geometry that must already exist before it crosses the camera's far clip. */
export function isStructureEntity(entity: SemanticEntity): boolean {
  return entity.meta?.["scenery"] === true || STRUCTURE_ARCHETYPES.has(entity.archetype);
}

export function isActorEntity(entity: SemanticEntity): boolean {
  return entity.archetype === "enemy" || entity.archetype === "boss" || entity.archetype === "npc";
}

function cellKey(position: Vec3, cellSize: number): string {
  return `${Math.floor(position[0] / cellSize)}_${Math.floor(position[2] / cellSize)}`;
}

function copyPosition(position: Vec3): Vec3 {
  if (!position.every(Number.isFinite)) throw new Error("Entity active position must be finite.");
  return [position[0], position[1], position[2]];
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Entity active-set ${name} must be a positive finite number.`);
  }
  return value;
}

function nonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Entity active-set ${name} must be a non-negative finite number.`);
  }
  return value;
}

function compareIds(a: EntityId, b: EntityId): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
