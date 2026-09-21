import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../game/src/persistence/migrate.js";
import { loadSerializedSave, serializeSave } from "../game/src/persistence/storage.js";
import { SAVE_VERSION, createInitialState, type GameState } from "../game/src/state/store.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

describe("save v3 portable campfire persistence", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("migrates v2 saves with no portable fire to an explicit null v3 field", () => {
    const current = createInitialState(814, 123_000);
    current.meta.playSeconds = 48.25;
    current.meta.lastSavedAtMs = 456_000;
    current.world.nodes["legacy_seam"] = {
      remaining: 0,
      state: "depleted",
      respawnAtMs: 9_999_999,
    } as unknown as GameState["world"]["nodes"][string];
    const { campfire: _campfire, ...v2World } = current.world;
    const v2 = {
      ...current,
      meta: { ...current.meta, saveVersion: 2 },
      world: v2World,
    };

    const result = migrate(v2);
    expect(result.ok).toBe(true);
    expect(result.fromVersion).toBe(2);
    expect(result.state?.meta.saveVersion).toBe(SAVE_VERSION);
    expect(result.state?.world.campfire).toBeNull();
    expect(result.state?.meta.playSeconds).toBe(48.25);
    expect(result.state?.meta.lastSavedAtMs).toBe(456_000);
    expect(result.state?.world.nodes["legacy_seam"]?.respawnAtMs).toBe(48_250);
    expect(v2.world).not.toHaveProperty("campfire");
  });

  it("round-trips a played-time deadline without converting it to wall-clock time", () => {
    vi.spyOn(Date, "now").mockReturnValue(99_999_999_999);
    const state = createInitialState(991, 1_000);
    state.meta.playSeconds = 35.5;
    state.world.campfire = {
      id: "campfire:player",
      position: [17.25, 2.5, -8.75],
      regionId: "fallowmarch",
      logItemId: "duskoak_log",
      tier: 5,
      expiresAtPlaySeconds: 155.5,
    };

    const serialized = serializeSave(state);
    const serializedState = JSON.parse(serialized) as GameState;
    expect(serializedState.meta.playSeconds).toBe(35.5);
    expect(serializedState.world.campfire?.expiresAtPlaySeconds).toBe(155.5);
    expect(serializedState.world.campfire).not.toHaveProperty("expiresAtMs");

    const loaded = loadSerializedSave(serialized);
    expect(loaded.status).toBe("loaded");
    expect(loaded.state?.meta.playSeconds).toBe(35.5);
    expect(loaded.state?.world.campfire).toEqual(state.world.campfire);
    expect((loaded.state?.world.campfire?.expiresAtPlaySeconds ?? 0) - (loaded.state?.meta.playSeconds ?? 0)).toBe(120);
  });
});
