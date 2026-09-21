import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../game/src/persistence/migrate.js";
import { loadSerializedSave } from "../game/src/persistence/storage.js";
import { createInitialState, type GameState } from "../game/src/state/store.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

describe("save v3 integrity", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects unsupported or noninteger save version %s",
    (saveVersion) => {
      const result = migrate({ meta: { saveVersion } });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("Unsupported save version");
    },
  );

  it("runs serialized imports through the parse, migration, and repair pipeline", () => {
    expect(loadSerializedSave("{")).toEqual({ status: "failed", reason: "Save is not valid JSON" });

    const state = createInitialState(440, 10);
    state.activity = { kind: "eating", itemId: "seared_minnow", endsAtMs: 9_999 };
    const imported = loadSerializedSave(JSON.stringify(state));

    expect(imported.status).toBe("loaded");
    expect(imported.state?.activity).toBeNull();
  });

  it.each([
    ["not an object", "burnt out"],
    ["wrong id", {
      id: "campfire:somewhere-else", position: [1, 2, 3], regionId: "fallowmarch",
      logItemId: "palewood_log", tier: 1, expiresAtPlaySeconds: 90,
    }],
    ["bad position tuple", {
      id: "campfire:player", position: [1, 2], regionId: "fallowmarch",
      logItemId: "palewood_log", tier: 1, expiresAtPlaySeconds: 90,
    }],
    ["nonfinite-looking position", {
      id: "campfire:player", position: [1, null, 3], regionId: "fallowmarch",
      logItemId: "palewood_log", tier: 1, expiresAtPlaySeconds: 90,
    }],
    ["unknown fuel", {
      id: "campfire:player", position: [1, 2, 3], regionId: "fallowmarch",
      logItemId: "imaginary_log", tier: 20, expiresAtPlaySeconds: 90,
    }],
    ["fuel tier mismatch", {
      id: "campfire:player", position: [1, 2, 3], regionId: "fallowmarch",
      logItemId: "palewood_log", tier: 5, expiresAtPlaySeconds: 90,
    }],
    ["unknown region", {
      id: "campfire:player", position: [1, 2, 3], regionId: "fallowmarch_annex",
      logItemId: "palewood_log", tier: 1, expiresAtPlaySeconds: 90,
    }],
    ["invalid expiry", {
      id: "campfire:player", position: [1, 2, 3], regionId: "fallowmarch",
      logItemId: "palewood_log", tier: 1, expiresAtPlaySeconds: -1,
    }],
  ])("clears a malformed campfire: %s", (_label, campfire) => {
    const state = createInitialState(441, 10);
    state.world.campfire = campfire as unknown as GameState["world"]["campfire"];

    const loaded = loadSerializedSave(JSON.stringify(state));

    expect(loaded.status).toBe("loaded");
    expect(loaded.state?.world.campfire).toBeNull();
  });

  it("keeps a valid fire, canonicalizes its shape, and interrupts the saved activity", () => {
    const state = createInitialState(442, 10);
    state.activity = {
      kind: "building_campfire", logItemId: "duskoak_log", tier: 5,
      regionId: "vellenwood", position: [4, 1, -7], buildTimeMs: 3_000,
      lifetimeMs: 120_000, endsAtMs: 20_000,
    };
    state.world.campfire = {
      id: "campfire:player", position: [3, 1, -8], regionId: "vellenwood",
      logItemId: "duskoak_log", tier: 5, expiresAtPlaySeconds: 130,
    };
    const withExtraField = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    ((withExtraField.world as Record<string, unknown>).campfire as Record<string, unknown>).obsolete = true;

    const loaded = loadSerializedSave(JSON.stringify(withExtraField));

    expect(loaded.status).toBe("loaded");
    expect(loaded.state?.activity).toBeNull();
    expect(loaded.state?.world.campfire).toEqual(state.world.campfire);
    expect(loaded.state?.world.campfire).not.toHaveProperty("obsolete");
  });

  it("fills every missing combat field while migrating a partial v1 combat record", () => {
    const state = createInitialState(443, 10);
    const partial = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    partial.meta = { ...(partial.meta as Record<string, unknown>), saveVersion: 1 };
    partial.combat = { targetId: "marchwolf_1" };

    const loaded = loadSerializedSave(JSON.stringify(partial));

    expect(loaded.status).toBe("loaded");
    // `targetId` no longer survives a load: the live engagement is dropped with its clock
    // instants, for the reason `tests/combat-reload-reset.test.ts` pins — a persisted
    // `nextAttackAtMs` from the old session's clock blocked every swing of the new one.
    expect(loaded.state?.combat).toEqual({
      targetId: null,
      inCombatUntilMs: 0,
      nextAttackAtMs: 0,
      activeSpellId: null,
      preferredSpellId: null,
      engagedBy: [],
    });
  });

  it("reports repair failures instead of throwing", () => {
    const state = createInitialState(444, 10);
    const malformed = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    malformed.skills = 7;

    expect(() => loadSerializedSave(JSON.stringify(malformed))).not.toThrow();
    expect(loadSerializedSave(JSON.stringify(malformed))).toEqual({
      status: "failed",
      reason: "Save repair failed",
    });
  });
});
