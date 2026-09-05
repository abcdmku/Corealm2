/**
 * Typed persistence over localStorage. The only place the game touches browser storage.
 *
 * Content-derived values (maxHealth, skill levels, prices) are recomputed on load rather than
 * trusted, so a content rebalance applies to existing saves.
 */
import { SAVE_VERSION, createInitialState, type GameState } from "../state/store.js";
import { levelForXp } from "../content/xp.js";
import { CAMPFIRE_FUELS } from "../content/gatheringProductionTiers.js";
import { SKILL_IDS, type RegionId } from "../contracts.js";
import { migrate, type MigrationResult } from "./migrate.js";
import { validateSaveState } from "./validate.js";
import { RECOVERY_CACHE_TTL_MS } from "../systems/death.js";

const SAVE_KEY = "corealm.save.v1";

/** Runtime membership check for the frozen RegionId union. Record keeps this list exhaustive. */
const REGION_IDS: Readonly<Record<RegionId, true>> = {
  fallowmarch: true,
  vellenwood: true,
  karrowmoor: true,
  kilnhalt: true,
  gravelmaw: true,
};

export interface LoadOutcome {
  status: "loaded" | "empty" | "failed";
  state?: GameState;
  reason?: string;
}

/** The original storage record stays untouched while this recovery notice is present. */
export interface SaveRecovery {
  reason: string;
  raw: string | null;
}

export class SaveService {
  private available: boolean;
  private recovery: SaveRecovery | null = null;

  constructor(persistent = true) {
    // Focused real-engine sessions must never load or overwrite the player's normal save. Keeping
    // the same service with persistence disabled also keeps GameLoop's autosave path unchanged.
    this.available = persistent && detectStorage();
  }

  isAvailable(): boolean {
    return this.available;
  }

  /** A copy suitable for the title/settings recovery flow, including an exact-byte export. */
  getRecovery(): SaveRecovery | null {
    return this.recovery ? { ...this.recovery } : null;
  }

  save(state: GameState, nowMs: number): boolean {
    if (!this.available || this.recovery) return false;
    return this.write(state, nowMs);
  }

  private write(state: GameState, nowMs: number): boolean {
    try {
      const payload = JSON.parse(JSON.stringify(state)) as GameState;
      payload.meta.saveVersion = SAVE_VERSION;
      payload.meta.lastSavedAtMs = nowMs;
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  load(): LoadOutcome {
    if (!this.available) return { status: "empty" };
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
    } catch {
      this.recovery = { reason: "localStorage read failed", raw: null };
      return { status: "failed", reason: "localStorage read failed" };
    }
    if (raw === null) {
      this.recovery = null;
      return { status: "empty" };
    }

    const loaded = this.loadSerialized(raw);
    this.recovery = loaded.status === "failed"
      ? { reason: loaded.reason ?? "Save could not be loaded", raw }
      : null;
    return loaded;
  }

  /** Runs the same import pipeline as load(), without writing the supplied text to localStorage. */
  loadSerialized(json: string): LoadOutcome {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { status: "failed", reason: "Save is not valid JSON" };
    }

    let result: MigrationResult;
    try {
      result = migrate(parsed);
    } catch {
      return { status: "failed", reason: "Save migration failed" };
    }
    if (!result.ok || !result.state) return { status: "failed", reason: result.reason ?? "Migration failed" };

    try {
      const state = recompute(result.state);
      const invalid = validateSaveState(state);
      if (invalid) return { status: "failed", reason: invalid };
      repairRecoveryCacheClock(state, Date.now());
      return { status: "loaded", state };
    } catch {
      return { status: "failed", reason: "Save repair failed" };
    }
  }

  /** Compatibility name used by callers that treat exported text as a deserialization boundary. */
  deserialize(raw: string): LoadOutcome {
    return this.loadSerialized(raw);
  }

  /** Explicit recovery replaces the rejected record only after the replacement is valid. */
  recoverSerialized(json: string, nowMs = Date.now()): LoadOutcome {
    const loaded = this.loadSerialized(json);
    if (loaded.status !== "loaded" || !loaded.state) return loaded;
    if (!this.available || !this.write(loaded.state, nowMs)) {
      return { status: "failed", reason: "Recovered save could not be written" };
    }
    this.recovery = null;
    return loaded;
  }

  /** The raw JSON that would be written. Used by the debug API and the export-on-failure path. */
  serialize(state: GameState): string {
    return JSON.stringify(state);
  }

  clear(): void {
    if (!this.available) return;
    try {
      localStorage.removeItem(SAVE_KEY);
      this.recovery = null;
    } catch {
      /* nothing useful to do */
    }
  }
}

/**
 * Recomputes everything derivable from content, so a rebalance reaches existing saves.
 *
 * Also repairs shape: a save written by an older build can be missing a slice entirely, and a
 * missing slice must not crash the boot that loads it. Every gap falls back to the fresh-state
 * default rather than to undefined.
 */
function recompute(state: GameState): GameState {
  assertRepairableSlices(state);
  const fresh = createInitialState(state.meta?.seed ?? 1337, Date.now());

  const rawSkills = (state as unknown as Record<string, unknown>).skills;
  if (rawSkills !== undefined && !isRecord(rawSkills)) throw new Error("Invalid skills slice");
  const savedSkills: Record<string, unknown> = isRecord(rawSkills) ? rawSkills : {};
  state.skills = { ...fresh.skills };
  for (const skill of SKILL_IDS) {
    const entry = savedSkills[skill] as { xp?: unknown; level?: unknown } | undefined;
    if (entry && typeof entry.xp === "number") entry.level = levelForXp(entry.xp);
    state.skills[skill] = entry && typeof entry.xp === "number"
      ? { xp: entry.xp, level: entry.level as number }
      : { xp: 0, level: 1 };
  }

  // Slices added after a save was written.
  const savedWorld: Record<string, unknown> = isRecord(state.world) ? state.world : {};
  state.world = { ...fresh.world, ...savedWorld } as GameState["world"];
  state.world.nodes = repairResourceNodes(savedWorld.nodes);
  state.world.enemies = isRecord(savedWorld.enemies)
    ? savedWorld.enemies as GameState["world"]["enemies"]
    : {};
  state.world.obstaclesUsed = isRecord(savedWorld.obstaclesUsed)
    ? savedWorld.obstaclesUsed as GameState["world"]["obstaclesUsed"]
    : {};
  state.world.lootPiles = isRecord(savedWorld.lootPiles)
    ? savedWorld.lootPiles as GameState["world"]["lootPiles"]
    : {};
  state.world.recoveryCache = isRecord(savedWorld.recoveryCache)
    ? savedWorld.recoveryCache as NonNullable<GameState["world"]["recoveryCache"]>
    : null;
  state.world.campfire = repairCampfire(savedWorld.campfire);
  state.discovery = state.discovery ?? fresh.discovery;
  state.discovery.entities = state.discovery.entities ?? {};
  state.discovery.locations = state.discovery.locations ?? {};
  state.discovery.regions = state.discovery.regions ?? fresh.discovery.regions;
  state.quests = state.quests ?? {};
  state.bank = state.bank ?? fresh.bank;
  state.bank.slots = state.bank.slots ?? [];
  state.equipment = { ...fresh.equipment, ...(state.equipment ?? {}) };
  state.combat = {
    ...fresh.combat,
    ...(isRecord(state.combat) ? state.combat : {}),
  } as GameState["combat"];
  // The live engagement is dropped for the same reason `activity` is below: `inCombatUntilMs` and
  // `nextAttackAtMs` are instants on the per-session simulation clock, which restarts at zero
  // every reload. Restored verbatim, a save written five minutes into a session blocks EVERY
  // player swing for the first five minutes of the next one — the swing resolver waits for a
  // clock that has started over. Reported from play as "you can't attack a monster; it eventually
  // attacks after like 30 seconds", the thirty seconds being that session's age at the autosave.
  // Only `preferredSpellId` is meant to outlive a fight, and it survives the reset below.
  state.combat.targetId = null;
  state.combat.activeSpellId = null;
  state.combat.engagedBy = [];
  state.combat.inCombatUntilMs = 0;
  state.combat.nextAttackAtMs = 0;
  state.magic = state.magic ?? fresh.magic;
  state.magic.weaponCharges = state.magic.weaponCharges ?? {};
  state.magic.consumedOrbs = state.magic.consumedOrbs ?? {};
  state.magic.awakenedAltars = state.magic.awakenedAltars ?? {};
  state.settings = { ...fresh.settings, ...(state.settings ?? {}) };

  // Activity deadlines are measured on the per-session simulation clock. Reloading starts that
  // clock at zero, so carrying an absolute deadline across sessions can leave the character busy
  // for the previous session's entire uptime. Reload is an interruption: no pending ingredient,
  // food, or campfire log has completed yet, so dropping the activity consumes nothing.
  state.activity = null;

  // A conversation does not survive a reload.
  //
  // `state.dialogue` is serialised with everything else, and the window that draws it is raised by
  // the `dialogue.opened` event — which a load does not emit. So saving mid-conversation and
  // reloading left the game silently inside an open dialogue: nothing on screen, and the next
  // `talk` behaving oddly because one was already running. The node is re-derivable by talking to
  // the NPC again, so dropping it costs nothing and closes the gap between the state and the
  // events that are supposed to describe it.
  state.dialogue = null;
  state.currency = typeof state.currency === "number" ? state.currency : 0;

  // The inventory must be exactly 28 slots, or every index-based operation is off by however
  // many an older build wrote.
  const slots = Array.isArray(state.inventory?.slots) ? state.inventory.slots : [];
  slots.length = fresh.inventory.slots.length;
  for (let index = 0; index < slots.length; index += 1) {
    if (slots[index] === undefined) slots[index] = null;
  }
  state.inventory = { slots };

  return state;
}

/** Missing old slices have defaults. Supplied corrupt progress must not become fresh progress. */
function assertRepairableSlices(state: GameState): void {
  const raw = state as unknown as Record<string, unknown>;
  for (const key of ["skills", "world", "inventory", "equipment", "bank", "discovery", "quests", "magic"]) {
    if (raw[key] !== undefined && !isRecord(raw[key])) throw new Error(`Invalid ${key} slice`);
  }
  for (const key of ["inventory", "bank"]) {
    const candidate = raw[key];
    if (isRecord(candidate) && candidate.slots !== undefined && !Array.isArray(candidate.slots)) {
      throw new Error(`Invalid ${key} slots`);
    }
  }
  if (isRecord(raw.skills)) {
    for (const skill of SKILL_IDS) {
      const entry = raw.skills[skill];
      if (entry !== undefined && (!isRecord(entry)
        || (entry.xp !== undefined && (typeof entry.xp !== "number" || !Number.isFinite(entry.xp) || entry.xp < 0)))) {
        throw new Error(`Invalid ${skill} progress`);
      }
    }
  }
  if (raw.currency !== undefined
    && (typeof raw.currency !== "number" || !Number.isFinite(raw.currency) || raw.currency < 0)) {
    throw new Error("Invalid currency");
  }
}

/** Every newly saved cache uses the same epoch deadline across sessions and closed pages. */
function repairRecoveryCacheClock(state: GameState, nowMs: number): void {
  const cache = state.world.recoveryCache;
  if (!cache) return;
  if (cache.expiresAtWallMs === undefined) {
    // Old saves kept only a session-clock deadline and cumulative played time. They cannot reveal
    // the old session's elapsed time. Subtracting cumulative time is a conservative lower bound:
    // it may expire an old cache early after several sessions, but cannot grant another lifetime.
    const remainingMs = Math.min(RECOVERY_CACHE_TTL_MS,
      Math.max(0, cache.expiresAtMs - state.meta.playSeconds * 1_000));
    cache.expiresAtWallMs = state.meta.lastSavedAtMs + remainingMs;
  }
  if (cache.expiresAtWallMs <= nowMs) state.world.recoveryCache = null;
}

type PersistedCampfire = NonNullable<GameState["world"]["campfire"]>;
type PersistedResourceNode = GameState["world"]["nodes"][string];

/**
 * Adds the capacity field introduced after save v3 without changing the save version. A legacy
 * half-worked node cannot reveal how many yields were already taken, so its saved remainder is the
 * only honest fallback. The next normal respawn replaces both counts with one fresh roll.
 */
function repairResourceNodes(value: unknown): GameState["world"]["nodes"] {
  if (!isRecord(value)) return {};

  const repaired: GameState["world"]["nodes"] = {};
  for (const [entityId, candidate] of Object.entries(value)) {
    if (!isRecord(candidate)) continue;

    const remaining = validYieldCount(candidate.remaining) ? candidate.remaining : 0;
    const savedMax = validYieldCount(candidate.maxYields) ? candidate.maxYields : remaining;
    const maxYields = Math.max(remaining, savedMax);
    const state = candidate.state === "depleted" ? "depleted" : "available";
    const respawnAtMs = candidate.respawnAtMs === null
      || (typeof candidate.respawnAtMs === "number" && Number.isFinite(candidate.respawnAtMs))
      ? candidate.respawnAtMs as number | null
      : null;

    repaired[entityId] = { remaining, maxYields, state, respawnAtMs } satisfies PersistedResourceNode;
  }
  return repaired;
}

function validYieldCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * A portable fire is reconstructed as a live station during boot, so malformed persisted data must
 * not reach that boundary. Valid records are copied into the exact JSON-safe shape the runtime
 * expects; invalid or obsolete records become an absent fire.
 */
function repairCampfire(value: unknown): PersistedCampfire | null {
  if (!isRecord(value)) return null;

  const position = value.position;
  if (
    value.id !== "campfire:player"
    || !Array.isArray(position)
    || position.length !== 3
    || !position.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
    || !isRegionId(value.regionId)
    || typeof value.logItemId !== "string"
    || !Number.isSafeInteger(value.tier)
    || (value.tier as number) < 1
    || typeof value.expiresAtPlaySeconds !== "number"
    || !Number.isFinite(value.expiresAtPlaySeconds)
    || value.expiresAtPlaySeconds < 0
  ) {
    return null;
  }

  const fuel = CAMPFIRE_FUELS.find((entry) => entry.logItemId === value.logItemId);
  if (!fuel || fuel.tier !== value.tier) return null;

  return {
    id: "campfire:player",
    position: [position[0] as number, position[1] as number, position[2] as number],
    regionId: value.regionId,
    logItemId: value.logItemId,
    tier: value.tier as number,
    expiresAtPlaySeconds: value.expiresAtPlaySeconds,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRegionId(value: unknown): value is RegionId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(REGION_IDS, value);
}

function detectStorage(): boolean {
  try {
    const probe = "__corealm_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
