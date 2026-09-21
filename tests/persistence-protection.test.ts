import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSerializedSave, serializeSave } from "../game/src/persistence/storage.js";
import { SAVE_VERSION, createInitialState, type GameState } from "../game/src/state/store.js";

const NOW = 1_800_000_000_000;

function saved(overwrite: (state: GameState) => void = () => {}): string {
  const state = createInitialState(441, NOW - 60_000);
  overwrite(state);
  return JSON.stringify(state, null, 2);
}

describe("save text that must be rejected", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["newer version", () => saved((state) => { state.meta.saveVersion = SAVE_VERSION + 1; })],
    ["malformed JSON", () => " {\n  \"meta\": broken save bytes\n"],
    ["repair failure", () => saved((state) => { Object.assign(state, { skills: 7 }); })],
  ])("rejects a %s save with a reason and no state", (_label, makeRaw) => {
    const rejected = loadSerializedSave(makeRaw());
    expect(rejected.status).toBe("failed");
    expect(rejected.reason).toBeTruthy();
    expect(rejected.state).toBeUndefined();
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
    const result = loadSerializedSave(saved(corrupt));
    expect(result.status).toBe("failed");
    expect(result.state).toBeUndefined();
  });

  it("accepts a complete current save and preserves player, inventory and quest progress", () => {
    const raw = saved((state) => {
      state.player.position = [25, 5, -72];
      state.quests.delivery = { status: "complete", stage: 2, counters: { "pending:seared_minnow": 3 }, flags: {} };
    });
    const state = JSON.parse(raw) as GameState;
    const loaded = loadSerializedSave(raw);
    expect(loaded.status).toBe("loaded");
    expect(loaded.state?.player).toEqual(state.player);
    expect(loaded.state?.inventory).toEqual(state.inventory);
    expect(loaded.state?.quests).toEqual(state.quests);
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
    const migrated = loadSerializedSave(raw);
    expect(migrated.state?.world.recoveryCache?.expiresAtWallMs).toBe(NOW + 540_000);
    // Written back and read again two minutes later: the wall-clock deadline stands, it is not granted again.
    vi.mocked(Date.now).mockReturnValue(NOW + 120_000);
    const reloaded = loadSerializedSave(serializeSave(migrated.state!));
    expect(reloaded.state?.world.recoveryCache?.expiresAtWallMs).toBe(NOW + 540_000);
    vi.mocked(Date.now).mockReturnValue(NOW + 540_000);
    expect(loadSerializedSave(serializeSave(reloaded.state!)).state?.world.recoveryCache).toBeNull();
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
    expect(loadSerializedSave(raw).state?.world.recoveryCache).toBeNull();
  });
});
