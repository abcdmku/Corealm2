import { describe, expect, it } from "vitest";
import { migrate } from "../game/src/persistence/migrate.js";
import { createInitialState } from "../game/src/state/store.js";

describe("magic save migrations", () => {
  it("rewrites legacy focus items in recovery and loot without losing container fields", () => {
    const legacy = createInitialState(90, 0);
    legacy.meta.saveVersion = 2;
    legacy.world.recoveryCache = {
      id: "recovery_cache",
      position: [1, 2, 3],
      regionId: "fallowmarch",
      items: [{ itemId: "quartz_focus", quantity: 1 }],
      expiresAtMs: 50_000,
    };
    legacy.world.lootPiles.old_drop = {
      position: [4, 5, 6],
      items: [{ itemId: "amber_focus", quantity: 1 }],
      expiresAtMs: 60_000,
      ownerOnly: true,
    };
    const old = legacy as unknown as { magic?: unknown; equipment: Record<string, unknown> };
    delete old.magic;
    delete old.equipment.focus;

    const state = migrate(legacy).state;
    expect(state?.meta.saveVersion).toBe(8);
    expect(state?.world.recoveryCache).toMatchObject({
      position: [1, 2, 3], items: [{ itemId: "air_orb", quantity: 1 }], expiresAtMs: 50_000,
    });
    expect(state?.world.lootPiles.old_drop).toMatchObject({
      position: [4, 5, 6], items: [{ itemId: "earth_orb", quantity: 1 }],
      expiresAtMs: 60_000, ownerOnly: true,
    });
  });

  it("preserves the equipped v3 Orb charge on the crafted weapon", () => {
    const legacy = createInitialState(91, 0);
    legacy.meta.saveVersion = 3;
    legacy.equipment.mainHand = { itemId: "cairnpine_staff", quantity: 1 };
    const old = legacy as unknown as {
      equipment: Record<string, unknown>;
      magic: { orbCharges: Record<string, number> };
    };
    old.equipment.focus = { itemId: "water_orb", quantity: 1 };
    old.magic = { orbCharges: { water_orb: 219 } };

    const state = migrate(legacy).state;
    expect(state?.equipment.mainHand).toEqual({ itemId: "water_staff", quantity: 1 });
    expect((state?.equipment as unknown as Record<string, unknown>).focus).toBeUndefined();
    expect(state?.magic.weaponCharges.water_staff).toBe(219);
    expect(state?.magic.consumedOrbs.water_orb).toBe(true);
    expect(state?.magic.awakenedAltars.karrowmoor_water_altar).toBe(true);
  });

  it("returns a v3 focus Orb to storage when no wand or staff is equipped", () => {
    const legacy = createInitialState(92, 0);
    legacy.meta.saveVersion = 3;
    legacy.equipment.mainHand = { itemId: "worn_sword", quantity: 1 };
    const old = legacy as unknown as {
      equipment: Record<string, unknown>;
      magic: { orbCharges: Record<string, number> };
    };
    old.equipment.focus = { itemId: "air_orb", quantity: 1 };
    old.magic = { orbCharges: { air_orb: 800 } };

    const state = migrate(legacy).state;
    expect(state?.inventory.slots.some((slot) => slot?.itemId === "air_orb")).toBe(true);
    expect(state?.equipment.mainHand?.itemId).toBe("worn_sword");
    expect(state?.magic.consumedOrbs.air_orb).toBeUndefined();
  });
});
