import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveService } from "../game/src/persistence/storage.js";
import { SAVE_VERSION, createInitialState, type GameState } from "../game/src/state/store.js";

const SAVE_KEY = "corealm.save.v1";
const NOW = 1_800_000_000_000;

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

function saved(overwrite: (state: GameState) => void = () => {}): string {
  const state = createInitialState(441, NOW - 60_000);
  overwrite(state);
  return JSON.stringify(state, null, 2);
}

describe("rejected save protection", () => {
  let storage: MemoryStorage;
  let service: SaveService;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    service = new SaveService();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["newer version", () => saved((state) => { state.meta.saveVersion = SAVE_VERSION + 1; })],
    ["malformed JSON", () => " {\n  \"meta\": broken save bytes\n"],
    ["repair failure", () => saved((state) => { Object.assign(state, { skills: 7 }); })],
  ])("keeps exact %s bytes through repeated save attempts and a fresh service", (_label, makeRaw) => {
    const raw = makeRaw();
    storage.setItem(SAVE_KEY, raw);
    const rejected = service.load();
    expect(rejected.status).toBe("failed");
    expect(service.getRecovery()).toEqual({ raw, reason: rejected.reason });

    const fresh = createInitialState(999, NOW);
    for (const time of [NOW + 30_000, NOW + 60_000, NOW + 900_000]) {
      expect(service.save(fresh, time)).toBe(false);
      expect(storage.getItem(SAVE_KEY)).toBe(raw);
    }
    const reloadedService = new SaveService();
    expect(reloadedService.load().status).toBe("failed");
    expect(reloadedService.save(fresh, NOW + 901_000)).toBe(false);
    expect(storage.getItem(SAVE_KEY)).toBe(raw);
  });

  it("does not release the storage lock for a successful read-only import", () => {
    storage.setItem(SAVE_KEY, "{broken");
    service.load();
    expect(service.loadSerialized(saved()).status).toBe("loaded");
    expect(service.save(createInitialState(), NOW)).toBe(false);
    expect(storage.getItem(SAVE_KEY)).toBe("{broken");
    expect(service.getRecovery()?.raw).toBe("{broken");
  });

  it("allows normal saves after explicit New Game clears the rejected record", () => {
    storage.setItem(SAVE_KEY, "{broken");
    service.load();
    service.clear();
    expect(service.getRecovery()).toBeNull();
    const state = createInitialState(912, NOW);
    expect(service.save(state, NOW + 1_000)).toBe(true);
    expect(service.load().state?.meta.seed).toBe(912);
  });

  it("keeps recovery active if New Game cannot remove the original record", () => {
    storage.setItem(SAVE_KEY, "{broken");
    service.load();
    vi.spyOn(storage, "removeItem").mockImplementation(() => { throw new Error("denied"); });
    service.clear();
    expect(service.save(createInitialState(), NOW)).toBe(false);
    expect(storage.getItem(SAVE_KEY)).toBe("{broken");
  });

  it("releases the lock only after an explicit valid recovery has been written", () => {
    const raw = "{broken";
    storage.setItem(SAVE_KEY, raw);
    service.load();
    expect(service.recoverSerialized('{"meta":{"saveVersion":7}}').status).toBe("failed");
    expect(storage.getItem(SAVE_KEY)).toBe(raw);
    expect(service.getRecovery()?.raw).toBe(raw);

    const recovered = saved((state) => { state.player.position = [12, 4, -7]; });
    expect(service.recoverSerialized(recovered, NOW).status).toBe("loaded");
    expect(service.getRecovery()).toBeNull();
    expect(service.load().state?.player.position).toEqual([12, 4, -7]);
    expect(service.save(createInitialState(28, NOW), NOW + 1_000)).toBe(true);
  });

  it("retains original bytes and the lock when a validated recovery cannot be stored", () => {
    storage.setItem(SAVE_KEY, "{broken");
    service.load();
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(service.recoverSerialized(saved())).toEqual({
      status: "failed", reason: "Recovered save could not be written",
    });
    expect(storage.getItem(SAVE_KEY)).toBe("{broken");
    expect(service.getRecovery()?.raw).toBe("{broken");
  });

  it("blocks writes after a storage read error even if the original bytes cannot be read", () => {
    storage.setItem(SAVE_KEY, "untouched");
    const read = vi.spyOn(storage, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(service.load().status).toBe("failed");
    expect(service.getRecovery()).toEqual({ reason: "localStorage read failed", raw: null });
    expect(service.save(createInitialState(), NOW)).toBe(false);
    read.mockRestore();
    expect(storage.getItem(SAVE_KEY)).toBe("untouched");
  });

  it.each([
    ["missing player", (state: GameState) => { Reflect.deleteProperty(state, "player"); }],
    ["invalid coordinates", (state: GameState) => { Object.assign(state.player, { position: [1, null, 3] }); }],
    ["incomplete metadata", (state: GameState) => { Reflect.deleteProperty(state.meta, "seed"); }],
    ["invalid path", (state: GameState) => { Object.assign(state.player.movement, { path: [[1, 2]] }); }],
    ["invalid inventory quantity", (state: GameState) => { state.inventory.slots[0]!.quantity = -1; }],
    ["invalid skill XP", (state: GameState) => { Object.assign(state.skills.mining, { xp: "oops" }); }],
    ["invalid inventory shape", (state: GameState) => { Object.assign(state.inventory, { slots: {} }); }],
    ["invalid quest flags", (state: GameState) => {
      Object.assign(state.quests, { broken: { status: "active", stage: 0, counters: {}, flags: [] } });
    }],
    ["invalid discovery", (state: GameState) => { Object.assign(state.discovery, { regions: "fallowmarch" }); }],
    ["invalid magic progress", (state: GameState) => { Object.assign(state.magic.awakenedAltars, { altar: "yes" }); }],
    ["invalid enemy", (state: GameState) => {
      Object.assign(state.world.enemies, { enemy: { health: 10, state: "idle", spawnPos: [], respawnAtMs: null } });
    }],
  ])("rejects %s before offering a replacement state", (_label, corrupt) => {
    const goodRaw = saved();
    storage.setItem(SAVE_KEY, goodRaw);
    const raw = saved(corrupt);
    const result = service.loadSerialized(raw);
    expect(result.status).toBe("failed");
    expect(result.state).toBeUndefined();
    expect(storage.getItem(SAVE_KEY)).toBe(goodRaw);
    expect(service.getRecovery()).toBeNull();
    storage.setItem(SAVE_KEY, raw);
    expect(service.load().status).toBe("failed");
    expect(service.save(createInitialState(), NOW)).toBe(false);
    expect(storage.getItem(SAVE_KEY)).toBe(raw);
  });

  it("accepts a complete current save and preserves player, inventory and quest progress", () => {
    const raw = saved((state) => {
      state.player.position = [25, 5, -72];
      state.quests.delivery = { status: "complete", stage: 2, counters: { "pending:seared_minnow": 3 }, flags: {} };
    });
    const state = JSON.parse(raw) as GameState;
    storage.setItem(SAVE_KEY, raw);
    const loaded = service.load();
    expect(loaded.status).toBe("loaded");
    expect(loaded.state?.player).toEqual(state.player);
    expect(loaded.state?.inventory).toEqual(state.inventory);
    expect(loaded.state?.quests).toEqual(state.quests);
    expect(service.save(loaded.state!, NOW)).toBe(true);
  });

  it("migrates a legacy session deadline once and subtracts time spent away", () => {
    const raw = saved((state) => {
      state.meta.lastSavedAtMs = NOW - 60_000;
      state.meta.playSeconds = 1_200;
      state.world.recoveryCache = {
        id: "recovery_cache", position: [1, 2, 3], regionId: "fallowmarch",
        items: [{ itemId: "grithe_ore", quantity: 2 }], expiresAtMs: 1_200_000 + 600_000,
      };
    });
    const migrated = service.loadSerialized(raw);
    expect(migrated.state?.world.recoveryCache?.expiresAtWallMs).toBe(NOW + 540_000);
    expect(service.save(migrated.state!, NOW)).toBe(true);
    vi.mocked(Date.now).mockReturnValue(NOW + 120_000);
    const reloaded = service.load();
    expect(reloaded.state?.world.recoveryCache?.expiresAtWallMs).toBe(NOW + 540_000);
    expect(service.save(reloaded.state!, NOW + 120_000)).toBe(true);
    vi.mocked(Date.now).mockReturnValue(NOW + 540_000);
    expect(service.load().state?.world.recoveryCache).toBeNull();
  });

  it("does not grant another lifetime to an already-expired legacy cache", () => {
    const raw = saved((state) => {
      state.meta.lastSavedAtMs = NOW - 1_000_000;
      state.meta.playSeconds = 1_200;
      state.world.recoveryCache = {
        id: "recovery_cache", position: [1, 2, 3], regionId: "fallowmarch",
        items: [{ itemId: "grithe_ore", quantity: 2 }], expiresAtMs: 2_100_000,
      };
    });
    expect(service.loadSerialized(raw).state?.world.recoveryCache).toBeNull();
  });
});
