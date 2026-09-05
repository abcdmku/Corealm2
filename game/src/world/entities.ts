/**
 * The live set of semantic entities, and the observation query the agent interface runs on.
 *
 * This is the shape `api/gameApi.ts` already calls through `SystemHooks.entities`:
 *
 *   get(id): SemanticEntity | undefined
 *   all(): SemanticEntity[]
 *   observe(filter, from): ObservedEntity[]
 *
 * Semantic state is the truth and Three.js is a view of it, so nothing here knows a mesh exists.
 * The store also does not import the store: it takes a skill-level accessor in its constructor,
 * which keeps the dependency arrow pointing one way and makes the whole thing testable with a
 * literal object.
 */
import type {
  Archetype, EntityId, ObserveFilter, ObservedEntity, RegionId,
  SemanticEntity, SkillId, Vec3,
} from "../contracts.js";
import { SKILLS } from "../content/skills.js";
import { SpatialIndex } from "./spatial.js";

/** Contract defaults, restated here because this is the file that enforces them. */
const DEFAULT_RADIUS = 40;
const MAX_RADIUS = 140;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * A place the player can be told about even when they cannot see it. `scope: "known"` returns
 * these rather than only what is currently in view, which is how an agent asks "where is a bank"
 * from the far side of the map.
 */
export interface KnownLocation {
  id: string;
  name: string;
  regionId: RegionId;
  position: Vec3;
  /** When the location has a real entity behind it (a bank chest, a gate), this is its id. */
  entityId?: EntityId;
}

/**
 * Straight-line distance. `ObservedEntity.distance` is documented as *path* distance, and the
 * world layer has no navmesh access by design.
 *
 * TODO(integration, root): inject the real one. `Navigation.pathDistance(from, to)` already
 * returns metres over the navmesh; wire it with `setDistanceFunction` at boot, after step 8 of the
 * architecture's boot order, and observation reports true path distance with no other change.
 * Until then every distance here is an underestimate for anything on the far side of a terrace.
 */
export function straightLineDistance(from: Vec3, to: Vec3): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export type DistanceFn = (from: Vec3, to: Vec3) => number;

export interface EntityStoreOptions {
  /** Current player skill levels. Kept as an accessor so this file never imports the store. */
  skillLevels: () => Record<SkillId, number>;
  /**
   * Which location ids the player has discovered. Returning `null` means "discovery is not
   * tracked yet", and every registered location counts as known - which is what round 1 wants.
   * Round 6's `api/observation.ts` supplies the real gate.
   */
  discoveredLocationIds?: () => ReadonlySet<string> | null;
  distanceFn?: DistanceFn;
  spatial?: SpatialIndex;
}

/** One scratch row per query, reused so a poll loop does not churn the heap. */
interface Candidate {
  entity: SemanticEntity;
  distance: number;
}

export class EntityStore {
  private readonly entities = new Map<EntityId, SemanticEntity>();
  private readonly locations = new Map<string, KnownLocation>();
  private readonly spatial: SpatialIndex;
  private readonly skillLevels: () => Record<SkillId, number>;
  private readonly discoveredLocationIds: () => ReadonlySet<string> | null;
  private distanceFn: DistanceFn;

  /** Reused across `observe` calls. Observation is single-threaded and never re-entrant. */
  private readonly candidates: Candidate[] = [];
  private readonly scratchIds: EntityId[] = [];

  constructor(options: EntityStoreOptions) {
    this.skillLevels = options.skillLevels;
    this.discoveredLocationIds = options.discoveredLocationIds ?? (() => null);
    this.distanceFn = options.distanceFn ?? straightLineDistance;
    this.spatial = options.spatial ?? new SpatialIndex();
  }

  // -------------------------------------------------------------- population

  /** Replaces the whole set. Called once at boot with `buildWorld(...).entities`. */
  load(entities: readonly SemanticEntity[]): void {
    this.entities.clear();
    this.spatial.clear();
    for (const entity of entities) this.add(entity);
  }

  add(entity: SemanticEntity): void {
    this.entities.set(entity.id, entity);
    this.spatial.insert(entity.id, entity.interactionPosition ?? entity.position);
  }

  remove(id: EntityId): boolean {
    this.spatial.remove(id);
    return this.entities.delete(id);
  }

  /** Registers the named places `scope: "known"` reports. Safe to call repeatedly. */
  registerLocations(locations: readonly KnownLocation[]): void {
    for (const location of locations) this.locations.set(location.id, location);
  }

  clearLocations(): void {
    this.locations.clear();
  }

  /** The seam for the navmesh distance function. See `straightLineDistance` above. */
  setDistanceFunction(fn: DistanceFn): void {
    this.distanceFn = fn;
  }

  // ------------------------------------------------------------------ reads

  get(id: EntityId): SemanticEntity | undefined {
    return this.entities.get(id);
  }

  all(): SemanticEntity[] {
    return [...this.entities.values()];
  }

  get size(): number {
    return this.entities.size;
  }

  index(): SpatialIndex {
    return this.spatial;
  }

  knownLocations(): KnownLocation[] {
    return [...this.locations.values()];
  }

  // ----------------------------------------------------------------- writes

  /**
   * Moves an entity and keeps the spatial index honest. Patrolling enemies use this every tick,
   * which is the only reason `SpatialIndex.move` exists.
   */
  setPosition(id: EntityId, position: Vec3): boolean {
    const entity = this.entities.get(id);
    if (!entity) return false;
    entity.position = position;
    this.spatial.move(id, entity.interactionPosition ?? position);
    return true;
  }

  setState(id: EntityId, state: string): boolean {
    const entity = this.entities.get(id);
    if (!entity) return false;
    entity.state = state;
    return true;
  }

  // ------------------------------------------------------------ observation

  /**
   * The contract's observation query, enforced exactly as documented:
   * radius defaults to 40 and caps at 140, limit defaults to 25 and caps at 100, and results come
   * back **sorted by distance ascending** - agents depend on that ordering to pick "the nearest
   * one" without re-sorting.
   */
  observe(filter: ObserveFilter, from: Vec3): ObservedEntity[] {
    if (filter.scope === "known") return this.observeKnown(filter, from);

    const radius = clampNumber(filter.radius ?? DEFAULT_RADIUS, 0, MAX_RADIUS);
    const limit = Math.floor(clampNumber(filter.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT));

    const candidates = this.candidates;
    candidates.length = 0;

    // The spatial index prunes on straight-line distance first. That is always <= the path
    // distance, so a radius filter over path distance can never lose an entity this way.
    this.spatial.forEachInRadius(from, radius, (id) => {
      const entity = this.entities.get(id);
      if (!entity) return;
      if (!this.matches(entity, filter)) return;
      const distance = this.distanceFn(from, entity.interactionPosition ?? entity.position);
      if (distance > radius) return;
      candidates.push({ entity, distance });
    });

    candidates.sort(byDistance);

    const out: ObservedEntity[] = [];
    for (let i = 0; i < candidates.length && out.length < limit; i += 1) {
      const candidate = candidates[i];
      if (!candidate) continue;
      out.push(this.toObserved(candidate.entity, candidate.distance));
    }
    candidates.length = 0;
    return out;
  }

  /**
   * `scope: "known"` ignores line of sight and radius: it answers "what places do I know about",
   * which is the query an agent uses to plan a route rather than to pick something to click.
   * Where a location has a real entity behind it the entity's live state is reported, so a known
   * bank still shows as `"open"` and a known seam still shows as `"depleted"`.
   */
  private observeKnown(filter: ObserveFilter, from: Vec3): ObservedEntity[] {
    const limit = Math.floor(clampNumber(filter.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT));
    const discovered = this.discoveredLocationIds();

    const rows: { observed: ObservedEntity; distance: number }[] = [];
    for (const location of this.locations.values()) {
      if (discovered && !discovered.has(location.id)) continue;
      if (filter.regionId && location.regionId !== filter.regionId) continue;

      const entity = location.entityId ? this.entities.get(location.entityId) : undefined;
      const position = entity?.interactionPosition ?? entity?.position ?? location.position;
      const distance = this.distanceFn(from, position);

      if (entity) {
        if (!this.matchesArchetypeAndInteraction(entity, filter)) continue;
        // The row is the ENTITY, so it carries the entity's id; `locationId` is what names the
        // place it stands at, and it is the only one of the two `moveTo({ locationId })` accepts.
        const observed = { ...this.toObserved(entity, distance), locationId: location.id };
        if (filter.requirementsMet !== undefined && observed.requirementsMet !== filter.requirementsMet) continue;
        rows.push({ observed, distance });
        continue;
      }

      // A place with no entity behind it: a junction, a ford, a ramp. Reported as a landmark so
      // the shape stays uniform and an agent never has to special-case the row.
      if (filter.archetypes && !filter.archetypes.includes("landmark")) continue;
      if (filter.interaction && filter.interaction !== "inspect") continue;
      if (filter.requirementsMet === false) continue;
      rows.push({
        distance,
        observed: {
          id: location.id,
          archetype: "landmark",
          name: location.name,
          tier: 0,
          regionId: location.regionId,
          position: location.position,
          distance: roundMetres(distance),
          state: "known",
          interactions: ["inspect"],
          requirementsMet: true,
        },
      });
    }

    rows.sort((a, b) => a.distance - b.distance);
    return rows.slice(0, limit).map((row) => row.observed);
  }

  private matches(entity: SemanticEntity, filter: ObserveFilter): boolean {
    // Assembled buildings put ~685 scenery rows in the store — 302 of them inside the default 40 m
    // radius in Coldbrace alone. Unfiltered, `observe()` in a town returns 25 wall pieces and no
    // shopkeeper, which is useless to an agent and to the UI.
    //
    // They stay IN the store on purpose: picking returns whatever mesh the ray hits, so scenery
    // held outside the store would make every click on a building a NOT_FOUND. `get`, `inspect`
    // and `moveTo({entityId})` all bypass this filter, so clicking a wall still works.
    if (entity.meta?.scenery === true) return false;
    if (filter.regionId && entity.regionId !== filter.regionId) return false;
    if (!this.matchesArchetypeAndInteraction(entity, filter)) return false;
    if (filter.requirementsMet !== undefined) {
      if (this.requirementsMet(entity) !== filter.requirementsMet) return false;
    }
    return true;
  }

  private matchesArchetypeAndInteraction(entity: SemanticEntity, filter: ObserveFilter): boolean {
    if (filter.archetypes && filter.archetypes.length > 0 && !filter.archetypes.includes(entity.archetype)) {
      return false;
    }
    if (filter.interaction && !entity.interactions.includes(filter.interaction)) return false;
    return true;
  }

  /** True when the player meets every skill requirement the entity declares. */
  requirementsMet(entity: SemanticEntity): boolean {
    const requirements = entity.requirements;
    if (!requirements) return true;
    const levels = this.skillLevels();
    for (const key of Object.keys(requirements) as SkillId[]) {
      const needed = requirements[key];
      if (needed === undefined) continue;
      if ((levels[key] ?? 1) < needed) return false;
    }
    return true;
  }

  /**
   * Plain text, not a code: "Requires Mining 10". Agents read this and so do players, and there is
   * no reason those should be two different strings.
   */
  blockedBy(entity: SemanticEntity): string | undefined {
    const requirements = entity.requirements;
    if (!requirements) return undefined;
    const levels = this.skillLevels();
    const unmet: string[] = [];
    for (const key of Object.keys(requirements) as SkillId[]) {
      const needed = requirements[key];
      if (needed === undefined) continue;
      if ((levels[key] ?? 1) < needed) unmet.push(`${SKILLS[key].name} ${needed}`);
    }
    if (unmet.length === 0) return undefined;
    return `Requires ${unmet.join(" and ")}`;
  }

  private toObserved(entity: SemanticEntity, distance: number): ObservedEntity {
    const met = this.requirementsMet(entity);
    const observed: ObservedEntity = {
      id: entity.id,
      archetype: entity.archetype,
      name: entity.name,
      tier: entity.tier,
      regionId: entity.regionId,
      position: entity.position,
      ...(entity.interactionPosition ? { interactionPosition: entity.interactionPosition } : {}),
      distance: roundMetres(distance),
      state: entity.state,
      interactions: entity.interactions,
      requirementsMet: met,
    };
    if (!met) {
      const reason = this.blockedBy(entity);
      if (reason) observed.blockedBy = reason;
    }
    return observed;
  }

  // -------------------------------------------------------------- convenience

  byRegion(regionId: RegionId): SemanticEntity[] {
    return this.all().filter((entity) => entity.regionId === regionId);
  }

  byArchetype(archetype: Archetype): SemanticEntity[] {
    return this.all().filter((entity) => entity.archetype === archetype);
  }

  /** Nearest entity matching a predicate. Uses the index, so it stays cheap at any world size. */
  nearest(
    from: Vec3,
    radius: number,
    accept?: (entity: SemanticEntity) => boolean,
  ): SemanticEntity | undefined {
    const ids = this.spatial.queryRadius(from, clampNumber(radius, 0, MAX_RADIUS), this.scratchIds);
    let best: SemanticEntity | undefined;
    let bestDistance = Infinity;
    for (const id of ids) {
      const entity = this.entities.get(id);
      if (!entity) continue;
      if (accept && !accept(entity)) continue;
      const distance = this.distanceFn(from, entity.interactionPosition ?? entity.position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entity;
      }
    }
    return best;
  }

  /** Counts per archetype. Used by `__gameDebug` and by the round exit checks. */
  countsByArchetype(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const entity of this.entities.values()) {
      counts[entity.archetype] = (counts[entity.archetype] ?? 0) + 1;
    }
    return counts;
  }
}

function byDistance(a: Candidate, b: Candidate): number {
  return a.distance - b.distance;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return value < min ? min : value > max ? max : value;
}

/** Two decimals. Keeps observation output stable in JSON snapshot diffs. */
function roundMetres(value: number): number {
  return Math.round(value * 100) / 100;
}
