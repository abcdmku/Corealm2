/**
 * The single canonical game state.
 *
 * FROZEN SHAPE. Only the root edits this file. Systems mutate through the exported reducers so that
 * persistence, the debug API, and the agent surface all see one shape.
 *
 * Everything here is plain JSON-safe data: no class instances, no Map/Set, no cycles. The harness
 * serialises this straight through `JSON.parse(JSON.stringify(...))`.
 */
import type {
  EntityId, EquipSlot, InventorySlot, ItemId, ItemStack, RecipeId,
  RegionId, SkillId, SpellId, Vec3,
} from "../contracts.js";
import { EQUIP_SLOTS, SKILL_IDS } from "../contracts.js";
import { levelForXp, totalXpAt } from "../content/xp.js";
import { STARTING_EQUIPMENT, STARTING_INVENTORY } from "../content/items.js";
import { createInitialHuntContracts, type HuntContractsState } from "../systems/huntContracts.js";

export const INVENTORY_SLOTS = 28;
export const BANK_CAPACITY = 400;
export const SAVE_VERSION = 7;

export type ActivityState =
  | {
      kind: "gathering"; skill: SkillId; entityId: EntityId; nodeTier: number;
      startedAtMs: number; nextRollAtMs: number; yieldsThisSession: number;
    }
  | {
      kind: "production"; skill: SkillId; recipeId: RecipeId; stationId: EntityId;
      remaining: number; completed: number; nextCompleteAtMs: number;
  }
  | { kind: "traversing"; obstacleId: EntityId; endsAtMs: number; exitPosition?: Vec3 }
  | { kind: "eating"; itemId: ItemId; endsAtMs: number }
  | {
      kind: "building_campfire"; logItemId: ItemId; tier: number; regionId: RegionId; position: Vec3;
      buildTimeMs: number; lifetimeMs: number; endsAtMs: number;
    };

/** Persisted lifecycle state for one authored gathering node. */
export interface ResourceNodeState {
  remaining: number;
  maxYields: number;
  state: "available" | "depleted";
  /** Cumulative played-time deadline in milliseconds. Null while the node is available. */
  respawnAtMs: number | null;
}

export interface GameState {
  huntContracts: HuntContractsState;
  meta: {
    saveVersion: number;
    createdAtMs: number;
    lastSavedAtMs: number;
    playSeconds: number;
    seed: number;
  };
  player: {
    id: EntityId;
    name: string;
    position: Vec3;
    facingRad: number;
    regionId: RegionId;
    health: number;
    maxHealth: number;
    respawnPointId: string;
    movement: {
      mode: "idle" | "path" | "direct";
      path: Vec3[] | null;
      pathIndex: number;
      destination: Vec3 | null;
      destinationEntityId: EntityId | null;
    };
  };
  skills: Record<SkillId, { xp: number; level: number }>;
  inventory: { slots: (InventorySlot | null)[] };
  equipment: Record<EquipSlot, ItemStack | null>;
  magic: {
    /** Charge on crafted elemental weapons, keyed by the charged weapon item id. */
    weaponCharges: Record<ItemId, number>;
    /** Boss Orbs already consumed by altar awakening, so repeat kills cannot replace them. */
    consumedOrbs: Record<ItemId, boolean>;
    /** Permanently awakened regional essence altars, keyed by semantic altar entity id. */
    awakenedAltars: Record<EntityId, boolean>;
  };
  bank: { slots: ItemStack[]; filter: string };
  currency: number;
  activity: ActivityState | null;
  combat: {
    targetId: EntityId | null;
    inCombatUntilMs: number;
    nextAttackAtMs: number;
    /** The spell the CURRENT engagement is throwing. Cleared on disengage. */
    activeSpellId: SpellId | null;
    /**
     * The spell the player chose in the spellbook, or null for "pick the best one for me".
     *
     * Distinct from `activeSpellId` on purpose: that one is the live engagement and dies with it,
     * this one outlives every fight and is the whole reason a sixteen-spell ladder is playable —
     * without it, "Cast at" silently throws whatever is strongest and the three elements a player
     * did not pick are decoration. See `systems/combat.ts setPreferredSpell`.
     */
    preferredSpellId: SpellId | null;
    engagedBy: EntityId[];
  };
  quests: Record<string, {
    status: "unstarted" | "active" | "complete";
    stage: number;
    counters: Record<string, number>;
    flags: Record<string, boolean>;
  }>;
  dialogue: {
    npcId: EntityId;
    nodeId: string;
    text: string;
    speaker: string;
    options: { id: string; text: string; enabled: boolean; disabledReason?: string }[];
  } | null;
  world: {
    nodes: Record<EntityId, ResourceNodeState>;
    enemies: Record<EntityId, {
      health: number;
      state: "idle" | "aggro" | "dead" | "returning";
      spawnPos: Vec3;
      respawnAtMs: number | null;
      bossPhase?: number;
      /**
       * When this enemy was killed, so a corpse can be given a lifetime shorter than its respawn.
       *
       * The authoritative copy. `systems/combat.ts` writes it here and onto the entity's view at
       * the same instant, and `systems/enemyAI.ts` clears both on respawn; the view copy is what
       * `render/entityViews.ts` reads, because render may not reach into world state.
       *
       * It is saved with the rest of the runtime, but a reload does NOT put a corpse back on the
       * ground: entities are rebuilt from `content/regions.ts` at boot and come back with
       * `state: "alive"` and no view copy, which is how dead enemies have always survived a reload
       * here. This field does not change that either way.
       */
      diedAtMs?: number;
    }>;
    obstaclesUsed: Record<EntityId, number>;
    lootPiles: Record<EntityId, { position: Vec3; items: ItemStack[]; expiresAtMs: number; ownerOnly: boolean }>;
    recoveryCache: {
      id: EntityId; position: Vec3; regionId: RegionId; items: ItemStack[]; expiresAtMs: number;
      /** Epoch deadline for new/migrated caches. expiresAtMs remains the legacy simulation deadline. */
      expiresAtWallMs?: number;
    } | null;
    campfire: {
      id: EntityId; position: Vec3; regionId: RegionId; logItemId: ItemId; tier: number;
      expiresAtPlaySeconds: number;
    } | null;
  };
  discovery: {
    entities: Record<EntityId, number>;
    locations: Record<string, number>;
    regions: RegionId[];
  };
  settings: {
    cameraDistance: number;
    cameraPitchRad: number;
    overlaysVisible: boolean;
    uiScale: number;
  };
}

export const DEFAULT_SPAWN: Vec3 = [0, 0, 0];
export const DEFAULT_REGION: RegionId = "fallowmarch";

export function createInitialState(seed = 1337, nowMs = 0): GameState {
  const skills = {} as Record<SkillId, { xp: number; level: number }>;
  for (const id of SKILL_IDS) skills[id] = { xp: 0, level: 1 };

  const equipment = {} as Record<EquipSlot, ItemStack | null>;
  for (const slot of EQUIP_SLOTS) equipment[slot] = null;
  // The starter kit, from one list in `content/items.ts` so a fresh game, a `__gameDebug.reset()`
  // and the docs cannot drift apart. Copied rather than referenced: the state is mutated in place
  // every tick, and handing out the content table's own object would let a stack count change the
  // canonical content.
  for (const [slot, stack] of Object.entries(STARTING_EQUIPMENT)) {
    equipment[slot as EquipSlot] = { ...stack };
  }

  const startingSlots = new Array<InventorySlot | null>(INVENTORY_SLOTS).fill(null);
  for (const [index, stack] of STARTING_INVENTORY.entries()) {
    if (index >= INVENTORY_SLOTS) break;
    startingSlots[index] = { ...stack, slotIndex: index };
  }

  return {
    meta: { saveVersion: SAVE_VERSION, createdAtMs: nowMs, lastSavedAtMs: 0, playSeconds: 0, seed },
    player: {
      id: "player",
      name: "Wanderer",
      position: [...DEFAULT_SPAWN] as unknown as Vec3,
      facingRad: 0,
      regionId: DEFAULT_REGION,
      health: 23,
      maxHealth: 23,
      respawnPointId: "coldbrace",
      movement: { mode: "idle", path: null, pathIndex: 0, destination: null, destinationEntityId: null },
    },
    skills,
    inventory: { slots: startingSlots },
    equipment,
    magic: { weaponCharges: {}, consumedOrbs: {}, awakenedAltars: {} },
    bank: { slots: [], filter: "" },
    currency: 0,
    activity: null,
    combat: {
      targetId: null, inCombatUntilMs: 0, nextAttackAtMs: 0,
      activeSpellId: null, preferredSpellId: null, engagedBy: [],
    },
    quests: {},
    huntContracts: createInitialHuntContracts(seed),
    dialogue: null,
    world: { nodes: {}, enemies: {}, obstaclesUsed: {}, lootPiles: {}, recoveryCache: null, campfire: null },
    discovery: { entities: {}, locations: {}, regions: [DEFAULT_REGION] },
    settings: { cameraDistance: 18, cameraPitchRad: 0.72, overlaysVisible: true, uiScale: 1 },
  };
}

/**
 * Holds the canonical state and notifies subscribers when it changes.
 *
 * Deliberately not immutable — systems mutate in place for speed on a 100 ms tick — but every read
 * that leaves the game (debug API, agent surface, persistence) goes through a JSON clone.
 */
export class Store {
  private state: GameState;
  private listeners = new Set<() => void>();
  private dirty = false;
  /**
   * Monotonic mutation counter. `dirty` is a one-shot flag the loop consumes for persistence, so
   * it cannot tell an agent whether anything changed between two reads; this can. It survives
   * `consumeDirty()` and is never reset within a session, including across `reset()`, so a reset
   * reads as a change rather than as nothing.
   */
  private revisionCount = 0;

  constructor(seed = 1337, nowMs = 0) {
    this.state = createInitialState(seed, nowMs);
  }

  /** Live reference. Systems use this. Never hand it outside the game. */
  get(): GameState {
    return this.state;
  }

  /** JSON-safe deep copy, for the debug API, the agent surface, and persistence. */
  snapshot(): GameState {
    return JSON.parse(JSON.stringify(this.state)) as GameState;
  }

  replace(next: GameState): void {
    this.state = next;
    this.markDirty();
    this.notify();
  }

  reset(seed = this.state.meta.seed, nowMs = 0): void {
    this.state = createInitialState(seed, nowMs);
    this.markDirty();
    this.notify();
  }

  markDirty(): void {
    this.dirty = true;
    this.revisionCount += 1;
  }

  /** The change token. Advances on every `markDirty()`, and only then. */
  revision(): number {
    return this.revisionCount;
  }

  consumeDirty(): boolean {
    const was = this.dirty;
    this.dirty = false;
    return was;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const listener of this.listeners) listener();
  }
}

// ------------------------------------------------------------- skill helpers

/** Adds XP through the real level-up path. Returns the levels gained, if any. */
export function addSkillXp(state: GameState, skill: SkillId, amount: number): { levelsGained: number; newLevel: number } {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { levelsGained: 0, newLevel: state.skills[skill].level };
  }
  const entry = state.skills[skill];
  const before = entry.level;
  entry.xp = Math.min(entry.xp + amount, totalXpAt(99));
  entry.level = levelForXp(entry.xp);
  return { levelsGained: entry.level - before, newLevel: entry.level };
}

export function setSkillLevel(state: GameState, skill: SkillId, level: number): void {
  const clamped = Math.max(1, Math.min(99, Math.floor(level)));
  state.skills[skill] = { xp: totalXpAt(clamped), level: clamped };
}

/**
 * Derived max health, per PRD 2.3:
 *   vitalityLevel = max(1, floor((melee + magic) / 2))
 *   maxHealth     = 20 + 3 * vitalityLevel + equipped vitality
 */
export function computeMaxHealth(state: GameState, equipmentVitality: number): number {
  const vitalityLevel = Math.max(1, Math.floor((state.skills.melee.level + state.skills.magic.level) / 2));
  return 20 + 3 * vitalityLevel + equipmentVitality;
}
