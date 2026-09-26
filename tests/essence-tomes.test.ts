import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ItemId, Result, SemanticEntity } from "../game/src/contracts.js";
import { err, ok } from "../game/src/contracts.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { content, type ContentTables } from "../game/src/content/index.js";
import { SPELLS } from "../game/src/content/spells.js";
import { Store } from "../game/src/state/store.js";
import { spellBlockReason, spendSpellFuel } from "../game/src/systems/essence.js";
import {
  availableEssenceFuel, EssenceTomeSystem, essenceTomeViews, spendEssenceFuel, tomeCharges,
} from "../game/src/systems/essenceTomes.js";

const originalContent: ContentTables = {
  items: [...content.allItems()], resources: [...content.allResources()],
  recipes: [...content.allRecipes()], spells: [...content.allSpells()],
  enemies: [...content.allEnemies()], shops: [...content.allShops()],
};
beforeAll(() => content.register({ items: ALL_ITEMS, spells: SPELLS }));
afterAll(() => content.register(originalContent));

function fixture() {
  const store = new Store(908, 0);
  const state = store.get();
  state.inventory.slots.fill(null);
  const put = (itemId: ItemId, quantity: number) => {
    const index = state.inventory.slots.findIndex((slot) => slot === null);
    if (index < 0) throw new Error("No slot");
    state.inventory.slots[index] = { itemId, quantity, slotIndex: index };
  };
  const inventory = {
    countItem: (itemId: ItemId) => state.inventory.slots.reduce(
      (sum, slot) => sum + (slot?.itemId === itemId ? slot.quantity : 0), 0,
    ),
    removeItem: (itemId: ItemId, quantity: number): Result<number> => {
      if (inventory.countItem(itemId) < quantity) return err("NOT_ENOUGH_ITEMS", "Shortfall");
      let remaining = quantity;
      for (let i = 0; i < state.inventory.slots.length && remaining > 0; i++) {
        const slot = state.inventory.slots[i];
        if (slot?.itemId !== itemId) continue;
        const taken = Math.min(slot.quantity, remaining);
        slot.quantity -= taken;
        remaining -= taken;
        if (slot.quantity === 0) state.inventory.slots[i] = null;
      }
      return ok(quantity);
    },
  };
  const altar: SemanticEntity = {
    id: "test_altar", name: "Essence Altar", archetype: "station", tier: 1,
    position: [...state.player.position], regionId: state.player.regionId, state: "awakened",
    interactions: ["produce"], station: { kind: "essence_altar", skill: "magic", recipeIds: [] },
    meta: { essenceAltar: true },
  };
  state.magic.awakenedAltars[altar.id] = true;
  return { store, state, inventory, put, altar, tomes: new EssenceTomeSystem({ store, inventory, altars: () => [altar] }) };
}

describe("essence tome reservoirs", () => {
  it.each(["distant", "other region", "above", "dormant"])("rejects a %s altar without consuming essence", (condition) => {
    const f = fixture();
    f.put("apprentice_essence_tome", 1);
    f.put("cosmic_essence", 100);
    if (condition === "distant") f.altar.position = [f.altar.position[0] + 20, f.altar.position[1], f.altar.position[2]];
    if (condition === "other region") f.altar.regionId = "vellenwood";
    if (condition === "above") f.altar.position = [f.altar.position[0], f.altar.position[1] + 20, f.altar.position[2]];
    if (condition === "dormant") delete f.state.magic.awakenedAltars[f.altar.id];
    expect(f.tomes.imbue("apprentice_essence_tome", "cosmic_essence").ok).toBe(false);
    expect(f.inventory.countItem("cosmic_essence")).toBe(100);
    expect(tomeCharges(f.state, "apprentice_essence_tome", "cosmic_essence")).toBe(0);
  });
  it.each([
    ["apprentice_essence_tome", 100, 100],
    ["adept_essence_tome", 500, 500],
    ["master_essence_tome", 1000, 1000],
  ] as const)("imbues %s at its exact exchange rate", (tomeId, cost, capacity) => {
    const f = fixture();
    f.put(tomeId, 1);
    f.put("arc_essence", cost);
    expect(f.tomes.imbue(tomeId, "arc_essence")).toEqual(ok({ charges: capacity, essenceSpent: cost }));
    expect(f.inventory.countItem("arc_essence")).toBe(0);
    expect(tomeCharges(f.state, tomeId, "arc_essence")).toBe(capacity);
    expect(f.tomes.list()[0]?.essences.find((row) => row.itemId === "arc_essence"))
      .toMatchObject({ charges: capacity, carried: 0, canImbue: false });
  });

  it("rejects a partial recharge without spending essence", () => {
    const f = fixture();
    f.put("apprentice_essence_tome", 1);
    f.put("fire_essence", 100);
    f.state.magic.tomeCharges.apprentice_essence_tome = { fire_essence: 1 };
    expect(f.tomes.imbue("apprentice_essence_tome", "fire_essence").ok).toBe(false);
    expect(f.inventory.countItem("fire_essence")).toBe(100);
    expect(tomeCharges(f.state, "apprentice_essence_tome", "fire_essence")).toBe(1);
  });

  it("ignores charged books in the bank and uses the strongest carried tome first", () => {
    const f = fixture();
    f.put("adept_essence_tome", 1);
    f.put("apprentice_essence_tome", 1);
    f.put("water_essence", 3);
    f.state.bank.slots.push({ itemId: "master_essence_tome", quantity: 1 });
    f.state.magic.tomeCharges = {
      master_essence_tome: { water_essence: 500 },
      adept_essence_tome: { water_essence: 2 },
      apprentice_essence_tome: { water_essence: 4 },
    };
    expect(availableEssenceFuel(f.state, "water_essence")).toBe(9);
    expect(spendEssenceFuel(f.state, f.inventory, [{ itemId: "water_essence", quantity: 7 }]))
      .toMatchObject({ ok: true, value: {
        tomeChargesSpent: [
          { tomeId: "adept_essence_tome", quantity: 2, remaining: 0 },
          { tomeId: "apprentice_essence_tome", quantity: 4, remaining: 0 },
        ],
        looseEssenceSpent: [{ itemId: "water_essence", quantity: 1, remaining: 2 }],
      } });
    expect(f.state.magic.tomeCharges.master_essence_tome?.water_essence).toBe(500);
    expect(essenceTomeViews(f.state).map((row) => row.itemId))
      .toEqual(["adept_essence_tome", "apprentice_essence_tome"]);
  });

  it("checks all essence types and duplicate costs before changing any fuel", () => {
    const f = fixture();
    f.put("master_essence_tome", 1);
    f.put("air_essence", 1);
    f.state.magic.tomeCharges.master_essence_tome = { air_essence: 2, cosmic_essence: 1 };
    expect(spendEssenceFuel(f.state, f.inventory, [
      { itemId: "air_essence", quantity: 2 },
      { itemId: "cosmic_essence", quantity: 2 },
    ]).ok).toBe(false);
    expect(spendEssenceFuel(f.state, f.inventory, [
      { itemId: "air_essence", quantity: 2 },
      { itemId: "air_essence", quantity: 2 },
    ]).ok).toBe(false);
    expect(f.state.magic.tomeCharges.master_essence_tome)
      .toEqual({ air_essence: 2, cosmic_essence: 1 });
    expect(f.inventory.countItem("air_essence")).toBe(1);
  });

  it("uses a carried tome when the matching staff is exhausted", () => {
    const f = fixture();
    f.put("apprentice_essence_tome", 1);
    f.state.equipment.mainHand = { itemId: "air_wand", quantity: 1 };
    f.state.magic.weaponCharges.air_wand = 0;
    f.state.magic.tomeCharges.apprentice_essence_tome = { air_essence: 2 };
    const spell = content.spell("voltrend")!;
    expect(spellBlockReason(f.state, spell)).toBeNull();
    expect(spendSpellFuel(f.state, spell, f.inventory)).toMatchObject({ ok: true, value: {
      source: "tome", tomeItemId: "apprentice_essence_tome",
      essenceItemId: "air_essence", remainingCharges: 1,
    } });
    expect(f.state.magic.weaponCharges.air_wand).toBe(0);
  });

  it("uses matching staff charge first and pays secondary Arc Essence from a tome", () => {
    const f = fixture();
    f.put("master_essence_tome", 1);
    f.state.equipment.mainHand = { itemId: "air_wand", quantity: 1 };
    f.state.magic.weaponCharges.air_wand = 10;
    f.state.magic.tomeCharges.master_essence_tome = { arc_essence: 3 };
    const basic = content.spell("voltrend")!;
    const spell = { ...basic, cost: { ...basic.cost,
      runes: [{ itemId: "arc_essence", quantity: 2 }],
    } };
    expect(spellBlockReason(f.state, spell)).toBeNull();
    expect(spendSpellFuel(f.state, spell, f.inventory)).toMatchObject({ ok: true, value: {
      source: "weapon", weaponItemId: "air_wand", remainingCharges: 9,
      runes: [{ itemId: "arc_essence", quantity: 2, remaining: 1 }],
    } });
    expect(tomeCharges(f.state, "master_essence_tome", "arc_essence")).toBe(1);
  });
});
