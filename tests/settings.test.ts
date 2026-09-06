import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, SettingsStore } from "../game/src/ui/settings.js";

const STORAGE_KEY = "corealm.settings.v1";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => { values.clear(); },
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("graphics settings", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts at high quality and persists live changes", () => {
    const store = new SettingsStore();
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(store.get().invertCameraY).toBe(true);

    const seen: number[] = [];
    const unsubscribe = store.subscribe((settings) => { seen.push(settings.renderScale); });
    store.set({ renderScale: 0.7, shadowQuality: "low", drawDistance: "near" });
    unsubscribe();

    expect(seen).toEqual([1, 0.7]);
    expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      renderScale: 0.7,
      shadowQuality: "low",
      drawDistance: "near",
    });
  });

  it("migrates the old shadow toggle and rejects invalid stored values", () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      renderScale: 2,
      shadowQuality: "cinematic",
      drawDistance: "endless",
      shadows: false,
      uiScale: "huge",
      damageNumbers: false,
    }));

    expect(new SettingsStore().get()).toEqual({
      ...DEFAULT_SETTINGS,
      shadowQuality: "off",
      damageNumbers: false,
    });
  });

  it("keeps legacy distance choices manual and persists an explicit switch to Auto", () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ drawDistance: "medium" }));
    const store = new SettingsStore();
    expect(store.get().autoDrawDistance).toBe(false);
    store.set({ autoDrawDistance: true });
    expect(new SettingsStore().get()).toMatchObject({ drawDistance: "medium", autoDrawDistance: true });
  });
});
