/** Rebuilds runtime-only semantic entities for containers held in canonical save state. */
import type { EntityId, RegionId, SemanticEntity, Vec3 } from "../contracts.js";
import type { GameState } from "../state/store.js";
import { BOSS_RESPAWN_MS, ENEMY_RESPAWN_MS, resolveEnemyDef, spawnPositionOf } from "../systems/combat.js";

export const RECOVERY_CACHE_VIEW: NonNullable<SemanticEntity["view"]> = {
  assetId: "crate_wood",
  scale: 1.1,
  labelHeight: 1.4,
};

export const LOOT_PILE_VIEW: NonNullable<SemanticEntity["view"]> = {
  assetId: "crate_wood",
  scale: 0.72,
  labelHeight: 1.05,
};

export interface WorldContainerEntityPort {
  all(): SemanticEntity[];
  add(entity: SemanticEntity): void;
  remove(id: EntityId): boolean;
}

export interface RehydrateOptions {
  /** Fallback for old or hand-edited piles whose source entity cannot be recovered from the id. */
  regionAt?: (position: Vec3) => RegionId;
}

export interface RehydrateResult {
  recoveryCaches: number;
  lootPiles: number;
}

/**
 * `GameState.world` owns container contents and deadlines. `EntityStore` owns whether a player or
 * agent can see and interact with them. A save replacement must restore both halves.
 */
export function rehydrateWorldContainers(
  state: GameState,
  entities: WorldContainerEntityPort,
  options: RehydrateOptions = {},
): RehydrateResult {
  const staticEntities = entities.all().filter((entity) =>
    entity.archetype !== "recovery_cache" && entity.archetype !== "loot");

  // Safe when called more than once. A debug load can replace one save with another in place.
  for (const entity of entities.all()) {
    if (entity.archetype === "recovery_cache" || entity.archetype === "loot") {
      entities.remove(entity.id);
    }
  }

  let recoveryCaches = 0;
  if (state.world.recoveryCache?.expiresAtWallMs !== undefined
    && Date.now() >= state.world.recoveryCache.expiresAtWallMs) {
    state.world.recoveryCache = null;
  }
  const cache = state.world.recoveryCache;
  if (cache && cache.items.length > 0) {
    entities.add({
      id: cache.id,
      archetype: "recovery_cache",
      name: "Recovery Cache",
      tier: 1,
      regionId: cache.regionId,
      position: clonePosition(cache.position),
      state: "available",
      interactions: ["inspect", "loot"],
      view: RECOVERY_CACHE_VIEW,
      meta: {
        blurb: "Everything you were carrying when you died. It will not wait forever.",
        expiresAtMs: cache.expiresAtMs,
        ...(cache.expiresAtWallMs !== undefined ? { expiresAtWallMs: cache.expiresAtWallMs } : {}),
        itemCount: cache.items.length,
      },
    });
    recoveryCaches = 1;
  }

  let lootPiles = 0;
  for (const [pileId, pile] of Object.entries(state.world.lootPiles)) {
    if (!pile || pile.items.length === 0) continue;
    const source = sourceEntityForPile(pileId, staticEntities);
    const position = clonePosition(pile.position);
    const regionId = source?.regionId
      ?? options.regionAt?.(position)
      ?? state.player.regionId;
    entities.add({
      id: pileId,
      archetype: "loot",
      name: source ? `${source.name}'s drop` : "Loot pile",
      tier: source?.tier ?? 1,
      regionId,
      position,
      state: "available",
      interactions: ["inspect", "loot"],
      view: LOOT_PILE_VIEW,
      meta: {
        ...(source ? { droppedBy: source.id } : {}),
        expiresAtMs: pile.expiresAtMs,
      },
    });
    lootPiles += 1;
  }

  return { recoveryCaches, lootPiles };
}

/**
 * Reapplies persisted enemy runtimes onto the freshly rebuilt entity world.
 *
 * `GameState.world.enemies` survives a reload verbatim — a runtime can say "dead, respawning at
 * T" — but `buildSemanticWorld` rebuilds every enemy entity alive at its spawn, and nothing
 * reconciled the two. A monster killed inside the 30 s respawn window before a page refresh
 * therefore came back as a GHOST: standing there looking alive, latching an attack on click, and
 * silently dropping it the moment `resolvePlayerSwing` consulted the dead runtime — no swing, no
 * error, no matter how many times it was clicked. Reported from play as "sometimes you can't
 * attack a monster — it eventually attacks after like 30 seconds": the thirty seconds is
 * `ENEMY_RESPAWN_MS`, the moment the persisted timer finally agrees the monster exists again.
 *
 * THE TIMESTAMPS CANNOT BE KEPT. `SimClock.elapsedMs` restarts at zero every boot, so a persisted
 * `respawnAtMs` is an instant on LAST session's clock: after a twenty-minute session it sits
 * twenty minutes into the new clock's future, and the ghost outlives every reload in between.
 * Ordinary enemy windows restart on the new clock. Custom long cooldowns instead persist an
 * absolute wall deadline and restore its remaining delay, including offline time. Legacy saves
 * without that deadline start their authored interval once. A damaged runtime keeps its health
 * so the first click of a new session does not show a full bar on a half-dead animal.
 */
export function rehydrateEnemyRuntimes(
  state: GameState,
  entities: WorldContainerEntityPort,
  nowMs = 0,
  wallNowMs = Date.now(),
): { deadApplied: number; healthApplied: number } {
  let deadApplied = 0;
  let healthApplied = 0;
  for (const entity of entities.all()) {
    if (entity.archetype !== "enemy" && entity.archetype !== "boss") continue;
    const runtime = state.world.enemies[entity.id];
    if (!runtime) continue;
    if (entity.archetype === "enemy" && typeof entity.meta?.habitatId === "string"
      && entity.meta.habitatId.length > 0) {
      // Habitat placement belongs to current world content. Old saves retain health and death,
      // but their previous random spawn must not pull the animal out of its authored setting.
      runtime.spawnPos = spawnPositionOf(entity);
    }
    if (runtime.state === "dead") {
      entity.state = "dead";
      runtime.diedAtMs = nowMs;
      const customSeconds = resolveEnemyDef(entity).respawnSeconds;
      const cooldownMs = customSeconds !== undefined ? customSeconds * 1000
        : entity.archetype === "boss" ? BOSS_RESPAWN_MS : ENEMY_RESPAWN_MS;
      if (customSeconds !== undefined) {
        // Custom long cooldowns keep an absolute deadline across reload and offline time.
        // Legacy saves lack the old session baseline, so start the authored interval once.
        runtime.respawnAtWallMs ??= wallNowMs + cooldownMs;
        runtime.respawnAtMs = nowMs + Math.max(0, runtime.respawnAtWallMs - wallNowMs);
      } else {
        runtime.respawnAtMs = nowMs + cooldownMs;
      }
      if (entity.view) entity.view.diedAtMs = nowMs;
      deadApplied += 1;
    } else if (entity.combat) {
      // A balance update may lower the current maximum. Combat consumes runtime health,
      // so clamp that source as well as the displayed bar when loading an older save.
      const health = Math.min(runtime.health, entity.combat.maxHealth);
      if (runtime.health !== health || entity.combat.health !== health) healthApplied += 1;
      runtime.health = health;
      entity.combat.health = health;
    }
  }
  return { deadApplied, healthApplied };
}

/** Loot ids are `loot_${enemyId}_${sequence}`. Longest-first avoids prefix collisions. */
function sourceEntityForPile(
  pileId: EntityId,
  candidates: readonly SemanticEntity[],
): SemanticEntity | undefined {
  return [...candidates]
    .sort((a, b) => b.id.length - a.id.length)
    .find((entity) => {
      const prefix = `loot_${entity.id}_`;
      if (!pileId.startsWith(prefix)) return false;
      const suffix = pileId.slice(prefix.length);
      return /^\d+$/.test(suffix);
    });
}

function clonePosition(position: Vec3): Vec3 {
  return [position[0], position[1], position[2]];
}
