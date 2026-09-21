import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSerializedSave, serializeSave } from "../game/src/persistence/storage.js";
import { createInitialState } from "../game/src/state/store.js";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

/**
 * A reload must not carry a live engagement's CLOCK INSTANTS into the next session.
 *
 * `inCombatUntilMs` and `nextAttackAtMs` are measured on the per-session simulation clock, which
 * restarts at zero every boot. A save written five minutes into a session therefore carried a
 * `nextAttackAtMs` five minutes into the NEXT session's future, and `resolvePlayerSwing` sat on
 * `atMs < nextAttackAtMs` the whole time: every monster in the world was unattackable until the
 * new clock caught up. Reported from play as "you can't attack a monster — it eventually attacks
 * after like 30 seconds", the delay being exactly the previous session's age at the autosave.
 * The same rule the loader already applies to `activity`, for the same reason.
 */
describe("combat state across a reload", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("drops the live engagement and its old-clock instants", () => {
    const state = createInitialState(7);
    state.combat.targetId = "redsill_cattle_1";
    state.combat.activeSpellId = "voltrend";
    state.combat.engagedBy = ["redsill_cattle_1"];
    state.combat.inCombatUntilMs = 295_000;
    state.combat.nextAttackAtMs = 298_400;
    state.combat.preferredSpellId = "skirlbolt";


    const loaded = loadSerializedSave(serializeSave(state));
    expect(loaded.state, "save did not round-trip").not.toBeNull();
    const combat = loaded.state!.combat;
    expect(combat.targetId).toBeNull();
    expect(combat.activeSpellId).toBeNull();
    expect(combat.engagedBy).toEqual([]);
    expect(combat.inCombatUntilMs).toBe(0);
    expect(combat.nextAttackAtMs).toBe(0);
    // The one combat field that is MEANT to outlive a session.
    expect(combat.preferredSpellId).toBe("skirlbolt");
  });
});
