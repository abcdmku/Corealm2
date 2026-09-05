import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Result, SemanticEntity, ShopView, SkillId } from "../game/src/contracts.js";
import { content, type ContentTables, type ShopDef } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { SHOPS } from "../game/src/content/shops.js";
import { EventBus } from "../game/src/core/events.js";
import { Store } from "../game/src/state/store.js";
import { EconomySystem } from "../game/src/systems/economy.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const originalContent: ContentTables = {
  items: [...content.allItems()],
  resources: [...content.allResources()],
  recipes: [...content.allRecipes()],
  spells: [...content.allSpells()],
  enemies: [...content.allEnemies()],
  shops: [...content.allShops()],
};

const customShop: ShopDef = {
  id: "test_custom_shop",
  name: "Custom shop",
  buyMultiplier: 1,
  sellMultiplier: 0.75,
  stock: [{ itemId: "grithe_pickaxe", quantity: 5 }],
};

beforeAll(() => {
  content.register({ items: ALL_ITEMS, shops: [...SHOPS, customShop] });
});

afterAll(() => {
  content.register(originalContent);
});

function runtime(contentShopId = "coldbrace_general", inRange = true) {
  const store = new Store(92, 0);
  store.get().inventory.slots.fill(null);
  store.get().currency = 0;
  store.get().player.position = [0, 0, 0];
  const events = new EventBus();
  const inventory = new InventorySystem({ store, events, now: () => 100 });
  const entity: SemanticEntity = {
    id: "test_shop",
    archetype: "shop",
    name: "Test Shop",
    tier: 1,
    regionId: "fallowmarch",
    position: [0, 0, 0],
    state: "open",
    interactions: ["inspect", "trade"],
  };
  const dispatcher = new InteractionDispatcher({
    get: (id) => id === entity.id ? entity : undefined,
    playerPosition: () => store.get().player.position,
    skillLevels: () => Object.fromEntries(
      Object.entries(store.get().skills).map(([id, skill]) => [id, skill.level]),
    ) as Record<SkillId, number>,
  });
  const economy = new EconomySystem({
    store,
    events,
    inventory,
    dispatcher,
    now: () => 100,
    resolveShop: (shopId) => !shopId || shopId === entity.id
      ? { entityId: entity.id, contentShopId, inRange }
      : undefined,
  });
  return { store, events, inventory, economy, entity, dispatcher };
}

function view(result: Result<ShopView>): ShopView {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("shop trade interaction", () => {
  it("registers with the production dispatcher and emits the UI signal for a valid shop", () => {
    const fixture = runtime();
    expect(fixture.dispatcher.hasHandler("trade")).toBe(true);
    expect(fixture.dispatcher.run("test_shop", "trade")).toEqual({
      ok: true,
      value: { started: "trading at Test Shop" },
    });

    fixture.events.flush();
    expect(fixture.events.since(0).events).toEqual([
      expect.objectContaining({
        type: "activity.started",
        entityId: "test_shop",
        atMs: 100,
        data: { kind: "shop", interaction: "trade" },
      }),
    ]);
    expect(fixture.store.get().activity).toBeNull();
    expect(fixture.store.get().currency).toBe(0);
    expect(fixture.inventory.freeSlots()).toBe(28);
  });

  it("refuses an out-of-range interaction without opening the shop", () => {
    const fixture = runtime();
    fixture.store.get().player.position = [100, 0, 0];
    expect(fixture.dispatcher.run("test_shop", "trade")).toMatchObject({
      ok: false,
      error: { code: "OUT_OF_RANGE", entityId: "test_shop" },
    });
    fixture.events.flush();
    expect(fixture.events.since(0).events).toEqual([]);
  });

  it("also validates the economy's current shop range before opening", () => {
    const fixture = runtime("coldbrace_general", false);
    expect(fixture.dispatcher.run("test_shop", "trade")).toEqual({
      ok: false,
      error: {
        code: "OUT_OF_RANGE",
        message: "You need to be standing at the shop counter",
        entityId: "test_shop",
      },
    });
    fixture.events.flush();
    expect(fixture.events.since(0).events).toEqual([]);
  });

  it("does not open a shop whose content cannot be resolved", () => {
    const fixture = runtime("missing_shop");
    expect(fixture.dispatcher.run("test_shop", "trade")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", entityId: "test_shop" },
    });
    fixture.events.flush();
    expect(fixture.events.since(0).events).toEqual([]);
  });

  it("does not treat another archetype offering trade as a shop", () => {
    const fixture = runtime();
    fixture.entity.archetype = "npc";
    expect(fixture.dispatcher.run("test_shop", "trade")).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT", entityId: "test_shop" },
    });
    fixture.events.flush();
    expect(fixture.events.since(0).events).toEqual([]);
  });
});

describe("shop sale quotes and receipts", () => {
  it("quotes non-stock ore at 7 marks and pays that rounded unit price for every item sold", () => {
    const fixture = runtime();
    expect(fixture.inventory.addItem("grithe_ore", 8)).toEqual({ ok: true, value: 8 });
    fixture.events.flush();
    const cursor = fixture.events.currentSeq();
    const listed = view(fixture.economy.op("list"));

    expect(listed.stock.some((row) => row.itemId === "grithe_ore")).toBe(false);
    expect(listed.sellPrices).toEqual({ grithe_ore: 7 });
    expect(listed.currency).toBe(0);

    const sold = view(fixture.economy.op("sell", { itemId: "grithe_ore", quantity: 5 }));
    expect(fixture.inventory.countOf("grithe_ore")).toBe(3);
    expect(sold.currency - listed.currency).toBe(35);
    expect(fixture.store.get().currency).toBe(sold.currency);
    expect(sold.sellPrices).toEqual({ grithe_ore: 7 });

    fixture.events.flush();
    expect(fixture.events.since(cursor, ["item.received"]).events).toEqual([
      expect.objectContaining({ data: { itemId: "marks", name: "marks", quantity: 35 } }),
    ]);
    expect(fixture.events.since(cursor, ["item.lost"]).events).toEqual([
      expect.objectContaining({ data: { itemId: "grithe_ore", name: "Copper Ore", quantity: 5 } }),
    ]);
  });

  it("buys a stocked item at face value and sells it for the same price quoted on both sides", () => {
    const fixture = runtime();
    fixture.inventory.addCurrency(100);
    const listed = view(fixture.economy.op("list"));
    const stock = listed.stock.find((row) => row.itemId === "grithe_pickaxe");
    expect(stock).toMatchObject({ buyPrice: 60, sellPrice: 36 });
    expect(listed.sellPrices).toEqual({});

    const bought = view(fixture.economy.op("buy", { itemId: "grithe_pickaxe", quantity: 1 }));
    expect(bought.currency - listed.currency).toBe(-60);
    expect(fixture.inventory.countOf("grithe_pickaxe")).toBe(1);
    expect(bought.sellPrices).toEqual({ grithe_pickaxe: stock!.sellPrice });

    const sold = view(fixture.economy.op("sell", { itemId: "grithe_pickaxe", quantity: 1 }));
    expect(sold.currency - bought.currency).toBe(bought.sellPrices["grithe_pickaxe"]);
    expect(sold.currency).toBe(76);
    expect(fixture.inventory.countOf("grithe_pickaxe")).toBe(0);
    expect(sold.sellPrices).toEqual({});
  });

  it("applies the selected shop multiplier once to stocked and non-stock sale quotes", () => {
    const fixture = runtime(customShop.id);
    fixture.inventory.addItem("grithe_ore", 2);
    fixture.inventory.addItem("grithe_pickaxe", 1);
    const listed = view(fixture.economy.op("list"));

    expect(listed.stock[0]?.sellPrice).toBe(45);
    expect(listed.sellPrices).toEqual({ grithe_ore: 9, grithe_pickaxe: 45 });
    const sold = view(fixture.economy.op("sell", { itemId: "grithe_ore" }));
    expect(sold.currency - listed.currency).toBe(18);
    expect(fixture.inventory.countOf("grithe_ore")).toBe(0);
    expect(sold.sellPrices).toEqual({ grithe_pickaxe: 45 });
  });
});
