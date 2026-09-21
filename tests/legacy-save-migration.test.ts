import { expect, it } from "vitest";
import {
  LEGACY_SAVE_BACKUP_KEY, LEGACY_SAVE_KEY, LEGACY_SAVE_MIGRATED_KEY,
  legacySaveImport, markLegacySaveMigrated, readLegacySave, type LegacySaveRejection,
} from "../game/src/persistence/localSaveMigration.js";
import { createInitialState, type GameState } from "../game/src/state/store.js";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
  removeItem(key: string): void { this.values.delete(key); }
}

/**
 * A save from before the server existed: an old version stamp, none of the slices added since, and
 * a world full of spawn ids this build has never heard of.
 */
function legacySave(): GameState {
  const state = createInitialState(9_001, 1_000);
  state.meta.saveVersion = 3;
  state.meta.lastSavedAtMs = 1_750_000_000_000;
  state.meta.playSeconds = 4_210;
  state.currency = 137;
  state.skills.mining = { xp: 13_363, level: 30 };
  state.skills.melee = { xp: 4_470, level: 20 };
  state.player.name = "Old Hand";
  state.player.position = [12.5, 0, -48.25];
  state.player.regionId = "vellenwood";
  state.player.respawnPointId = "duskhollow";
  state.inventory.slots[0] = { itemId: "copper_ore", quantity: 7, slotIndex: 0 };
  state.bank.slots = [{ itemId: "palewood_log", quantity: 120 }];
  state.equipment.mainHand = { itemId: "bronze_sword", quantity: 1 };
  state.quests.eleven_empty_days = { status: "active", stage: 2, counters: { "kill:fen_crawler": 3 }, flags: { met: true } };
  state.discovery.entities["vellenwood:oak_1"] = 900;
  state.discovery.locations.duskhollow = 901;
  state.discovery.regions = ["fallowmarch", "vellenwood"];
  state.world.obstaclesUsed["vellenwood:log_bridge"] = 4;
  state.world.campfire = { id: "campfire:player", position: [3, 1, -8], regionId: "vellenwood", logItemId: "duskoak_log", tier: 5, expiresAtPlaySeconds: 9_999 };
  state.world.recoveryCache = { id: "cache:player", position: [4, 0, -9], regionId: "vellenwood", items: [{ itemId: "copper_ore", quantity: 2 }], expiresAtMs: 9_000_000, expiresAtWallMs: Date.now() + 600_000 };
  // The world the old client made up for itself. None of these ids exist in the server's world.
  state.world.nodes["client:ore_7"] = { remaining: 1, maxYields: 3, state: "depleted", respawnAtMs: 60_000 };
  state.world.enemies["client:wolf_2"] = { health: 0, state: "dead", spawnPos: [1, 0, 1], respawnAtMs: 30_000 };
  state.world.lootPiles["client:pile_3"] = { position: [2, 0, 2], items: [{ itemId: "gold", quantity: 500 }], expiresAtMs: 120_000, ownerOnly: true };
  return state;
}

it("carries every earned value of an old save into the character and owned rows", () => {
  const storage = new MemoryStorage();
  const raw = JSON.stringify(legacySave());
  storage.setItem(LEGACY_SAVE_KEY, raw);

  const loaded = readLegacySave(storage);
  expect(loaded?.raw).toBe(raw);
  const imported = legacySaveImport(loaded!.state);

  expect(imported.seed).toBe(9_001);
  expect(imported.savedAt).toBe(1_750_000_000_000);
  expect(imported.character.currency).toBe(137);
  // The xp is the player's; the level is recomputed from the current tables, as every load does.
  expect(imported.character.skills.mining).toEqual({ xp: 13_363, level: 26 });
  expect(imported.character.skills.melee.xp).toBe(4_470);
  expect(imported.character.player.name).toBe("Old Hand");
  // Position is kept; the worker decides whether it can pack this seed's world.
  expect(imported.character.player.position).toEqual([12.5, 0, -48.25]);
  expect(imported.character.player.regionId).toBe("vellenwood");
  expect(imported.character.player.respawnPointId).toBe("duskhollow");
  expect(imported.character.inventory.slots[0]).toEqual({ itemId: "copper_ore", quantity: 7, slotIndex: 0 });
  expect(imported.character.bank.slots).toEqual([{ itemId: "palewood_log", quantity: 120 }]);
  expect(imported.character.equipment.mainHand).toEqual({ itemId: "bronze_sword", quantity: 1 });
  expect(imported.character.quests.eleven_empty_days).toEqual({ status: "active", stage: 2, counters: { "kill:fen_crawler": 3 }, flags: { met: true } });
  expect(imported.character.discovery.entities["vellenwood:oak_1"]).toBe(900);
  expect(imported.character.discovery.regions).toEqual(["fallowmarch", "vellenwood"]);
  expect(imported.character.meta.playSeconds).toBe(4_210);

  // What the player owns in a world travels; the world itself does not.
  expect(Object.keys(imported.owned).sort()).toEqual(["campfire", "obstaclesUsed", "recoveryCache"]);
  expect(imported.owned.campfire).toEqual({ id: "campfire:player", position: [3, 1, -8], regionId: "vellenwood", logItemId: "duskoak_log", tier: 5, expiresAtPlaySeconds: 9_999 });
  expect(imported.owned.obstaclesUsed).toEqual({ "vellenwood:log_bridge": 4 });
  expect(imported.owned.recoveryCache?.items).toEqual([{ itemId: "copper_ore", quantity: 2 }]);
  const text = JSON.stringify(imported);
  for (const dropped of ["client:ore_7", "client:wolf_2", "client:pile_3", "lootPiles", "respawnAtMs"]) expect(text).not.toContain(dropped);
  expect(imported.character).not.toHaveProperty("world");
  expect(imported.character).not.toHaveProperty("settings");
});

it("backs a save up before reading it, and never replaces that backup with a later one", () => {
  const storage = new MemoryStorage();
  const raw = JSON.stringify(legacySave());
  storage.setItem(LEGACY_SAVE_KEY, raw);
  expect(readLegacySave(storage)).not.toBeNull();
  expect(storage.getItem(LEGACY_SAVE_BACKUP_KEY)).toBe(raw);

  // A second boot before the marker lands, on a save the local path has since emptied.
  const emptied = createInitialState(9_001, 1_000);
  emptied.meta.lastSavedAtMs = 1_760_000_000_000;
  storage.setItem(LEGACY_SAVE_KEY, JSON.stringify(emptied));
  const again = readLegacySave(storage);
  expect(legacySaveImport(again!.state).character.currency).toBe(0);
  expect(storage.getItem(LEGACY_SAVE_BACKUP_KEY)).toBe(raw);
});

it("keeps a save it cannot load, and reports why", () => {
  const rejections: LegacySaveRejection[] = [];
  for (const [label, raw] of [["corrupt", "{\"meta\":{"], ["wrong version", JSON.stringify({ meta: { saveVersion: 0 } })],
    ["corrupt progress", JSON.stringify({ ...legacySave(), skills: 7 })]] as const) {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_SAVE_KEY, raw);
    expect(readLegacySave(storage, rejection => rejections.push(rejection)), label).toBeNull();
    expect(storage.getItem(LEGACY_SAVE_BACKUP_KEY), label).toBe(raw);
    expect(storage.getItem(LEGACY_SAVE_KEY), label).toBe(raw);
  }
  expect(rejections.map(rejection => rejection.reason)).toEqual(["Save is not valid JSON", "Unsupported save version: 0", "Save repair failed"]);
});

it("imports once: the marker retires the save, and a second boot finds nothing", () => {
  const storage = new MemoryStorage();
  const raw = JSON.stringify(legacySave());
  storage.setItem(LEGACY_SAVE_KEY, raw);
  expect(readLegacySave(storage)).not.toBeNull();

  markLegacySaveMigrated(storage);
  const marker = storage.getItem(LEGACY_SAVE_MIGRATED_KEY);
  expect(marker).not.toBeNull();
  expect(storage.getItem(LEGACY_SAVE_KEY)).toBeNull();
  expect(readLegacySave(storage)).toBeNull();

  // Idempotent, including against a save some other path wrote after the import.
  storage.setItem(LEGACY_SAVE_KEY, raw);
  markLegacySaveMigrated(storage);
  expect(storage.getItem(LEGACY_SAVE_MIGRATED_KEY)).toBe(marker);
  expect(storage.getItem(LEGACY_SAVE_KEY)).toBeNull();
  expect(storage.getItem(LEGACY_SAVE_BACKUP_KEY)).toBe(raw);
});

it("finds nothing to import when there is no save at all", () => {
  const storage = new MemoryStorage();
  expect(readLegacySave(storage)).toBeNull();
  expect(storage.values.size).toBe(0);
});

it("leaves settings in localStorage for the main thread", () => {
  const state = legacySave();
  state.settings.uiScale = 1.25;
  const imported = legacySaveImport(state);
  expect(JSON.stringify(imported)).not.toContain("uiScale");
});
