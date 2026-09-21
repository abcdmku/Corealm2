/**
 * Discovery: what the player has actually found.
 *
 * PRD F12 is an information-parity criterion — "after the player walks within 40 m with line of
 * sight, `entity.discovered` fires and `corealm_inspect` succeeds" — and the machinery for it was
 * built and never connected. `EntityStore` accepts a `discoveredLocationIds` port and
 * `observeKnown` honours it; `app/boot.ts` constructed the store without one, so the port returned
 * null, and null means "discovery is not gating anything". `state.discovery.locations` had exactly
 * one writer, `systems/travel.ts` on a portal entry, and no reader at all.
 *
 * The result was that a character who had never left the spawn square could ask for every named
 * place in a 700 x 400 m world and get all forty. Parity was preserved, in the sense that a human
 * and an agent were both handed the map — but the gate the PRD asks for was not there.
 *
 * This system is the missing writer. It is deliberately the whole of the mechanism:
 *
 *  - A location within `DISCOVERY_RADIUS_M` is discovered. There is no line-of-sight test. The
 *    world has no occlusion query the sim layer can afford at tick rate, and a radius that a player
 *    can always verify by walking is more honest than a raycast that sometimes says no for reasons
 *    they cannot see.
 *  - It runs on a slow accumulator, not every tick. Forty-five locations against one position is
 *    cheap, but it is also pointless sixty times a second: the player cannot cross 40 m in 700 ms.
 *  - Discovery is permanent and is part of the save. Finding somewhere twice is not an event.
 *
 * Owner: root. State lives in `state.discovery`; this file adds none.
 */
import type { RegionId, Vec3 } from "../contracts.js";
import type { Store } from "../state/store.js";
import type { EventBus } from "../core/events.js";
import type { TickSystem } from "../core/time.js";
import { distanceXZ } from "../core/math.js";

/**
 * How close counts as found, in metres. PRD F12's number.
 *
 * Also roughly the fog distance, so in practice a discovered place is one the player could have
 * seen — which is what the criterion is really asking for.
 */
export const DISCOVERY_RADIUS_M = 40;

/** How often the sweep runs, in sim milliseconds. At 4.2 m/s the player covers 3 m in this time. */
const SWEEP_INTERVAL_MS = 700;

export interface DiscoverableLocation {
  id: string;
  regionId: RegionId;
  position: Vec3;
}

export interface DiscoveryDeps {
  store: Store;
  events: EventBus;
  /** Every named place in the world, from the route graph. */
  locations: () => readonly DiscoverableLocation[];
}

export class DiscoverySystem implements TickSystem {
  readonly name = "discovery";
  /** Before quests: reaching somewhere can satisfy a `reach` predicate in the same tick. */
  readonly order = 55;

  private accumulatorMs = SWEEP_INTERVAL_MS;

  constructor(private readonly deps: DiscoveryDeps) {}

  tick(deltaMs: number, atMs: number): void {
    this.accumulatorMs += deltaMs;
    if (this.accumulatorMs < SWEEP_INTERVAL_MS) return;
    this.accumulatorMs = 0;
    this.sweep(atMs);
  }

  /**
   * Marks everything in range as found. Public because boot calls it once at startup: a loaded save
   * or a fresh spawn should know where it is standing before the first frame, not 700 ms later.
   */
  sweep(atMs: number): string[] {
    const state = this.deps.store.get();
    const from = state.player.position;
    const found: string[] = [];

    for (const location of this.deps.locations()) {
      if (state.discovery.locations[location.id] !== undefined) continue;
      if (distanceXZ(from, location.position) > DISCOVERY_RADIUS_M) continue;

      state.discovery.locations[location.id] = Date.now();
      found.push(location.id);
      if (!state.discovery.regions.includes(location.regionId)) {
        state.discovery.regions.push(location.regionId);
      }
      this.deps.events.emit(
        "entity.discovered",
        { locationId: location.id, regionId: location.regionId, via: "proximity" },
        undefined,
        atMs,
      );
    }

    if (found.length > 0) this.deps.store.markDirty();
    return found;
  }

  /** The set `EntityStore.discoveredLocationIds` reads. */
  discovered(): ReadonlySet<string> {
    return new Set(Object.keys(this.deps.store.get().discovery.locations));
  }
}
