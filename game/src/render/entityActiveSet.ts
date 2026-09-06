import type { Archetype, EntityId, RegionId, SemanticEntity, Vec3 } from "../contracts.js";

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
  private readonly cells = new Map<string, EntityId[]>();
  private selectedCache: readonly SemanticEntity[] | null = null;

  constructor(options: EntityActiveSetOptions = {}) {
    this.cellSize = positiveFinite(options.cellSize ?? DEFAULT_CELL_SIZE, "cellSize");
    this.radius = nonNegativeFinite(options.radius ?? DEFAULT_ACTIVE_RADIUS, "radius");
    this.structureRadius = nonNegativeFinite(
      options.structureRadius ?? this.radius,
      "structureRadius",
    );
  }

  /** Replaces the read-only semantic snapshot and rebuilds the spatial lookup. */
  replace(entities: readonly SemanticEntity[]): void {
    this.entities.clear();
    this.positions.clear();
    this.regions.clear();
    this.cells.clear();

    for (const entity of entities) {
      this.entities.set(entity.id, entity);
      this.positions.set(entity.id, copyPosition(entity.position));
      this.regions.set(entity.id, entity.regionId);
      if (!entity.view) continue;
      const key = cellKey(this.positions.get(entity.id)!, this.cellSize);
      const cell = this.cells.get(key) ?? [];
      cell.push(entity.id);
      this.cells.set(key, cell);
    }

    // Entity id is the stable authored key. Sorting both the cell buckets and final result makes
    // membership and iteration independent of store insertion or travel hydration order.
    for (const ids of this.cells.values()) ids.sort(compareIds);
    this.selectedCache = null;
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
