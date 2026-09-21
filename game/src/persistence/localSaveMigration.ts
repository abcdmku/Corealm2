/**
 * The one-time import of a pre-server local save into the worker's player tables.
 *
 * The old game kept everything in `localStorage["corealm.save.v1"]`: character, world and settings
 * in one record. The worker keeps a character row and a per-world owned row, and builds the world
 * itself from the seed. So the import carries the player and drops the world.
 *
 * What is dropped, and why: resource nodes, enemies, ground loot and their respawn timers are keyed
 * by spawn ids the old client made up at boot, and the server's world has its own. Writing them
 * back would either resurrect nothing or resurrect the wrong thing. Everything the player earned —
 * skills, quests, discovery, inventory, bank, equipment, currency, hunt contracts, magic — carries
 * over exactly, and so do the objects a player owns in a world: campfire, recovery cache and the
 * agility obstacles they have used.
 *
 * The main thread runs `readLegacySave`, because a worker has no `localStorage`. The marker is set
 * only after the worker acknowledges the import, so a crash halfway through re-imports rather than
 * losing the save. The raw text is kept under a backup key either way.
 */
import type { PlayerCharacter } from "../contracts.js";
import { playerSessionState, type GameState, type PlayerSessionState } from "../state/store.js";
import { SaveService } from "./storage.js";

/** The old single-record save. */
export const LEGACY_SAVE_KEY = "corealm.save.v1";
/** Written once, before the first import attempt, and never overwritten. */
export const LEGACY_SAVE_BACKUP_KEY = "corealm.save.v1.backup";
/** Set only by `markLegacySaveMigrated`, after the worker has the data. */
export const LEGACY_SAVE_MIGRATED_KEY = "corealm.save.v1.migrated";

/** One legacy save as the player tables store it. No world record: the worker spawns the world. */
export interface LegacySaveImport {
  /** The `players` row: everything private except what the player owns in one world. */
  character: PlayerCharacter;
  /** The `worldPlayers` row's owned objects: campfire, recovery cache, used obstacles. */
  owned: PlayerSessionState["ownedWorld"];
  /** The world the save was played in. The worker packs this seed or falls back to a safe spawn. */
  seed: number;
  /** `meta.lastSavedAtMs` from the save, for the import audit line and for picking between saves. */
  savedAt: number;
}

/** Pure: the split the player tables want, from a state that already passed the load pipeline. */
export function legacySaveImport(state: GameState): LegacySaveImport {
  const { ownedWorld, ...character } = playerSessionState(state);
  return { character, owned: ownedWorld, seed: state.meta.seed, savedAt: state.meta.lastSavedAtMs };
}

/** Why a save present in storage produced nothing. The raw text is under the backup key. */
export interface LegacySaveRejection { reason: string; raw: string }

/**
 * Read the old save on the main thread through the game's own load pipeline (migrate, recompute,
 * validate). Null when there is nothing to import: no save, already migrated, or a save that will
 * not load. A save that will not load is still backed up and reported — never dropped in silence.
 */
export function readLegacySave(
  storage: Pick<Storage, "getItem" | "setItem">,
  onRejected: (rejection: LegacySaveRejection) => void = rejection => console.warn(`Local save not imported: ${rejection.reason}`),
): { state: GameState; raw: string } | null {
  if (read(storage, LEGACY_SAVE_MIGRATED_KEY) !== null) return null;
  const raw = read(storage, LEGACY_SAVE_KEY);
  if (raw === null || raw === "") return null;
  backup(storage, raw);
  const loaded = new SaveService(false).loadSerialized(raw);
  if (loaded.status !== "loaded" || !loaded.state) {
    onRejected({ reason: loaded.reason ?? "Save could not be loaded", raw });
    return null;
  }
  return { state: loaded.state, raw };
}

/**
 * The import is done. Idempotent, and the only writer of the marker: until it runs, the next boot
 * imports the same save again, which is harmless because the worker overwrites one character row.
 */
export function markLegacySaveMigrated(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): void {
  try {
    if (storage.getItem(LEGACY_SAVE_MIGRATED_KEY) === null) storage.setItem(LEGACY_SAVE_MIGRATED_KEY, String(Date.now()));
    storage.removeItem(LEGACY_SAVE_KEY);
  } catch { /* A storage that refuses writes re-imports next boot; it never loses the save. */ }
}

/**
 * Written once. A later boot must not replace it: the local path may have saved a fresh character
 * over the real one in between, and the backup is the only copy of what the player had.
 */
function backup(storage: Pick<Storage, "getItem" | "setItem">, raw: string): void {
  try { if (storage.getItem(LEGACY_SAVE_BACKUP_KEY) === null) storage.setItem(LEGACY_SAVE_BACKUP_KEY, raw); } catch { /* quota or a private window */ }
}

function read(storage: Pick<Storage, "getItem">, key: string): string | null {
  try { return storage.getItem(key); } catch { return null; }
}
