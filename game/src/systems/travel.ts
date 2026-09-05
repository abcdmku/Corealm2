/**
 * Portals: entering the dungeon and coming back out.
 *
 * The `enter` interaction was owned by `systems/agility.ts`, which reads it as an obstacle
 * traversal and refuses anything without an `obstacle` block — so the Gravelmaw mouth, a `portal`,
 * could be inspected and never entered. That is the only way into the dungeon and therefore the
 * only way to finish The Long Cairn.
 *
 * A portal is a placement, not a route: the player walks to it on the navmesh, and arriving moves
 * them to the linked location. Nothing here bypasses navigation — you still have to get there.
 */
import type { EntityId, RegionId, Result, SemanticEntity, Vec3 } from "../contracts.js";
import { err, ok } from "../contracts.js";
import type { EventBus } from "../core/events.js";
import type { SimClock } from "../core/time.js";
import type { Store } from "../state/store.js";
import type { InteractionDispatcher, InteractionHandler } from "../world/interactions.js";
import { distanceXZ } from "../core/math.js";
import { INTERACT_RANGE } from "../app/config.js";

export interface TravelEntityPort {
  get(id: EntityId): SemanticEntity | undefined;
  all(): SemanticEntity[];
}

export interface TravelNavPort {
  closestPoint(point: Vec3): Vec3 | null;
  routeNode(id: string): { id: string; position: Vec3; regionId: string } | undefined;
}

export interface TravelDeps {
  store: Store;
  events: EventBus;
  clock: SimClock;
  entities: TravelEntityPort;
  nav: TravelNavPort;
  dispatcher: InteractionDispatcher;
  /** The same timed, level-gated traversal used by climb and vault. */
  traverseObstacle?: InteractionHandler;
  /** Portal placement interrupts any timed action before the player's region changes. */
  activity?: { stop(reason: "moved", atMs: number): boolean };
  /** Places the player and resyncs the views. The root owns the camera and scene. */
  place(position: Vec3, regionId: RegionId): void;
  /** Production presentation defers the commit until the destination is ready behind a fade. */
  transition?(destination: { position: Vec3; regionId: RegionId; name: string }, commit: () => void): Promise<void>;
}

export class TravelSystem {
  private pending = false;
  private generation = 0;

  cancel(): void {
    this.generation++;
    this.pending = false;
  }
  constructor(private readonly deps: TravelDeps) {
    // Registering `enter` here REPLACES agility's handler for the interaction. Portals and
    // obstacles both use the verb, so this one dispatches on the entity: an entity carrying an
    // `obstacle` block is handed back to agility's traversal, anything else is a portal.
    this.deps.dispatcher.registerHandler("enter", (context) => context.entity.obstacle && this.deps.traverseObstacle
      ? this.deps.traverseObstacle(context) : this.enter(context.entity));
  }

  private enter(entity: SemanticEntity): Result<{ started: string }> {
    const state = this.deps.store.get();
    if (this.pending) return err("BUSY", "A passage is already loading.", entity.id);

    if (entity.obstacle) {
      // An agility obstacle that reached here means the dispatcher order changed. Refuse loudly
      // rather than silently teleporting the player past a climb they have not earned.
      return err("UNAVAILABLE", `${entity.name} is an agility obstacle, not a portal`, entity.id);
    }

    if (entity.state === "locked" || entity.state === "sealed") {
      const reason = typeof entity.meta?.lockedReason === "string"
        ? entity.meta.lockedReason
        : `${entity.name} is sealed.`;
      return err("REQUIREMENTS_NOT_MET", reason, entity.id);
    }

    const gap = distanceXZ(state.player.position, entity.interactionPosition ?? entity.position);
    if (gap > INTERACT_RANGE * 2) {
      return err("OUT_OF_RANGE", `Walk to ${entity.name} first.`, entity.id);
    }

    const destination = this.resolveDestination(entity);
    if (!destination) {
      return err("NOT_REACHABLE", `${entity.name} does not lead anywhere yet.`, entity.id);
    }

    this.deps.activity?.stop("moved", this.deps.clock.elapsedMs);
    const generation = this.generation;
    let committed = false;
    const commit = (): void => {
      // Import/reset can replace the store while a destination is still loading.
      if (committed || generation !== this.generation || this.deps.store.get() !== state) return;
      committed = true;
      this.deps.place(destination.position, destination.regionId);

      state.discovery.locations[destination.locationId] = Date.now();
      if (!state.discovery.regions.includes(destination.regionId)) state.discovery.regions.push(destination.regionId);
      this.deps.store.markDirty();
      this.deps.events.emit(
        "entity.discovered",
        { locationId: destination.locationId, regionId: destination.regionId, via: "portal" },
        entity.id,
        this.deps.clock.elapsedMs,
      );
    };

    if (this.deps.transition) {
      this.pending = true;
      void this.deps.transition({ ...destination, name: entity.name }, commit).catch((cause: unknown) => {
        if (generation !== this.generation) return;
        this.deps.events.emit("navigation.failed", {
          reason: "portal-load-failed", message: cause instanceof Error ? cause.message : String(cause),
        }, entity.id, this.deps.clock.elapsedMs);
      }).finally(() => { if (generation === this.generation) this.pending = false; });
    } else commit();

    return ok({ started: `${this.deps.transition ? "entering" : "entered"} ${entity.name}` });
  }

  /**
   * Where a portal leads.
   *
   * `meta.toLocationId` is the authored answer — that is the key `content/regions.ts` writes, and
   * the content's naming wins over anything this file would rather have been called. The dungeon
   * fallbacks exist for a portal authored without an explicit target.
   */
  private resolveDestination(
    entity: SemanticEntity,
  ): { position: Vec3; regionId: RegionId; locationId: string } | undefined {
    const linked = typeof entity.meta?.toLocationId === "string" ? entity.meta.toLocationId : null;
    const dungeonId = typeof entity.meta?.toRegionId === "string"
      ? entity.meta.toRegionId
      : typeof entity.meta?.dungeonId === "string" ? entity.meta.dungeonId : null;

    const candidates = [
      ...(linked ? [linked] : []),
      ...(dungeonId ? [`${dungeonId}_chamber1`, `${dungeonId}_entrance`] : []),
    ];

    for (const candidate of candidates) {
      const node = this.deps.nav.routeNode(candidate);
      if (!node) continue;
      const snapped = this.deps.nav.closestPoint(node.position);
      if (!snapped || distanceXZ(snapped, node.position) > 1.5 || Math.abs(snapped[1] - node.position[1]) > 1.5) continue;
      return { position: snapped, regionId: node.regionId as RegionId, locationId: node.id };
    }
    return undefined;
  }
}
