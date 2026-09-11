import { describe, expect, it } from "vitest";
import { createGameplayAcceptanceFixture } from "../game/src/featureLab/gameplayAcceptance.js";
import { Store } from "../game/src/state/store.js";
import type { SemanticEntity } from "../game/src/contracts.js";

function setup(failAssets = false) {
  const store = new Store(8124, 0);
  const table = new Map<string, SemanticEntity>();
  const fixture = createGameplayAcceptanceFixture({ store,
    entities: { get: (id) => table.get(id), add: (entity) => { table.set(entity.id, entity); }, remove: (id) => table.delete(id) },
    prepareEntities: async () => { if (failAssets) throw new Error("asset preparation failed"); },
    groundHeightAt: () => 4, baseY: () => -0.2, assetSize: () => ({ x: 2, y: 2, z: 3 }),
  });
  return { store, table, fixture };
}

describe("gameplay acceptance fixture prerequisites", () => {
  it("does not consume an orb or awaken the production altar while preparing", async () => {
    const { fixture, store, table } = setup();
    await fixture.prepare("altar");
    expect(table.get("fallowmarch_air_altar")).toMatchObject({ state: "dormant", interactions: ["inspect", "awaken"],
      station: { kind: "essence_altar", recipeIds: ["craft_air_wand", "craft_air_staff"] } });
    expect(store.get().magic.awakenedAltars.fallowmarch_air_altar).toBeUndefined();
    expect(store.get().magic.consumedOrbs.air_orb).toBeUndefined();
    expect(store.get().inventory.slots[0]).toMatchObject({ itemId: "air_orb", quantity: 1 });
    expect(store.get().quests.sparking_stone?.stage).toBe(2);
    await expect(fixture.prepare("altar")).rejects.toThrow("Reload the lab");
  });

  it("publishes an alive canonical Storm Scarab and an unsatisfied kill objective", async () => {
    const { fixture, store, table } = setup();
    await fixture.prepare("storm-rhino");
    expect(table.get("tempest_roc")).toMatchObject({ id: "tempest_roc", state: "alive", meta: { family: "tempest_roc" } });
    const enemy = table.get("tempest_roc")!;
    expect(enemy.combat!.health).toBe(enemy.combat!.maxHealth);
    expect(store.get().quests.sparking_stone).toMatchObject({ status: "active", stage: 0, counters: { "@base:kill:tempest_roc": 0 } });
    expect(store.get().inventory.slots.every((slot) => slot === null)).toBe(true);
  });

  it("leaves the physical boss gate sealed until ordinary quest actions satisfy it", async () => {
    const { fixture, store, table } = setup();
    table.set("ordrun_gate", { id: "ordrun_gate", name: "Gate", archetype: "door", tier: 1,
      regionId: "fallowmarch", position: [36, 4, -18], state: "sealed", interactions: ["inspect", "open"] });
    await fixture.prepare("gate");
    expect(table.get("ordrun_gate")?.state).toBe("sealed");
    expect(store.get().quests.long_cairn).toMatchObject({ status: "active", stage: 6, counters: { "@base:kill:vault_custodian": 0 } });
    expect(table.get("ordrun")).toMatchObject({ state: "alive", meta: { family: "quarrykeeper" } });
    expect([...table.values()].filter((entity) => entity.meta?.family === "vault_custodian")).toHaveLength(2);
    expect(store.get().inventory.slots[0]?.itemId).toBe("cairn_garnet");
  });

  it("keeps the character and entity table unchanged if required assets cannot prepare", async () => {
    const { fixture, store, table } = setup(true);
    const before = store.snapshot();
    await expect(fixture.prepare("altar")).rejects.toThrow("asset preparation failed");
    expect(store.snapshot()).toEqual(before);
    expect(table.size).toBe(0);
    expect(fixture.getState().ready).toBe(false);
  });
});
