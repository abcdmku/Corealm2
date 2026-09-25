import { beforeAll, describe, expect, it } from "vitest";
import type { ItemDef } from "../game/src/contracts.js";
import { content } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { parseValue } from "../game/src/content/schema/core.js";
import { ItemSchema } from "../game/src/content/schema/items.js";
import { EventBus } from "../game/src/core/events.js";
import { Store } from "../game/src/state/store.js";
import { EquipmentSystem } from "../game/src/systems/equipment.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { itemTooltipContent } from "../game/src/ui/itemTooltipContent.js";
import { activePotionLines } from "../game/src/ui/hud.js";

const potions: ItemDef[] = [
  { id: "test_melee_weak", name: "Weak Melee Potion", tier: 10, description: "", stackable: false, value: 100, category: "potion", potion: { kind: "melee", strength: 5, durationMs: 300_000 } },
  { id: "test_melee_strong", name: "Strong Melee Potion", tier: 70, description: "", stackable: false, value: 100, category: "potion", potion: { kind: "melee", strength: 20, durationMs: 300_000 } },
  { id: "test_magic", name: "Magic Potion", tier: 10, description: "", stackable: false, value: 100, category: "potion", potion: { kind: "magic", strength: 5, durationMs: 300_000 } },
  { id: "test_defence", name: "Defence Potion", tier: 10, description: "", stackable: false, value: 100, category: "potion", potion: { kind: "defence", strength: 5, durationMs: 300_000 } },
];

beforeAll(() => content.register({ items: [...ALL_ITEMS, ...potions] }));

function harness() {
  const store = new Store(7, 0);
  const events = new EventBus();
  let now = 1_000;
  const inventory = new InventorySystem({ store, events, now: () => now });
  const equipment = new EquipmentSystem({ store, events, inventory, now: () => now });
  return { store, inventory, equipment, setNow: (atMs: number) => { now = atMs; } };
}

describe("timed potion buffs", () => {
  it("applies each kind to its combat stats and expires at the simulation deadline", () => {
    const h = harness();
    const base = h.equipment.totals();
    for (const id of ["test_melee_weak", "test_magic", "test_defence"]) {
      expect(h.inventory.addItem(id, 1).ok).toBe(true);
      expect(h.inventory.use(id).ok).toBe(true);
      expect(h.inventory.countOf(id)).toBe(0);
    }
    expect(h.equipment.totals()).toMatchObject({
      meleeAccuracy: base.meleeAccuracy + 5, meleePower: base.meleePower + 5,
      magicAccuracy: base.magicAccuracy + 5, magicPower: base.magicPower + 5,
      defence: base.defence + 5,
    });
    h.setNow(300_999);
    expect(h.equipment.totals().defence).toBe(base.defence + 5);
    h.setNow(301_000);
    expect(h.equipment.totals()).toEqual(base);
  });

  it("replaces a same-kind buff and preserves a weaker potion while a stronger one is active", () => {
    const h = harness();
    h.inventory.addItem("test_melee_weak", 2);
    h.inventory.addItem("test_melee_strong", 1);
    expect(h.inventory.use("test_melee_weak").ok).toBe(true);
    h.setNow(2_000);
    expect(h.inventory.use("test_melee_strong").ok).toBe(true);
    expect(h.equipment.totals().meleePower).toBe(20);
    const strong = h.store.get().combat.potionBuffs?.melee;
    expect(h.inventory.use("test_melee_weak").ok).toBe(false);
    expect(h.inventory.countOf("test_melee_weak")).toBe(1);
    expect(h.store.get().combat.potionBuffs?.melee).toEqual(strong);
    h.setNow(302_000);
    expect(h.inventory.use("test_melee_weak").ok).toBe(true);
    expect(h.equipment.totals().meleePower).toBe(5);
  });

  it("does not consume a potion when dead and describes its duration and stat effect", () => {
    const h = harness();
    h.inventory.addItem("test_magic", 1);
    h.store.get().player.health = 0;
    expect(h.inventory.use("test_magic").ok).toBe(false);
    expect(h.inventory.countOf("test_magic")).toBe(1);
    expect(itemTooltipContent("test_magic").details).toContain("Drink for +5 magic accuracy and power for 5 minutes.");
  });

  it("shows active effects against the replicated simulation clock", () => {
    const h = harness();
    h.inventory.addItem("test_defence", 1);
    h.inventory.use("test_defence");
    const buffs = h.store.get().combat.potionBuffs;
    expect(activePotionLines(buffs, 1_000)).toEqual(["Defence +5 · 5:00"]);
    expect(activePotionLines(buffs, 300_999)).toEqual(["Defence +5 · 0:01"]);
    expect(activePotionLines(buffs, 301_000)).toEqual([]);
  });

  it("rejects invalid potion kinds and nonpositive or nonfinite strengths in content", () => {
    const base = potions[0]!;
    expect(() => parseValue(ItemSchema, base, "potion")).not.toThrow();
    for (const potion of [
      { kind: "healing", strength: 5, durationMs: 300_000 },
      { kind: "melee", strength: 0, durationMs: 300_000 },
      { kind: "melee", strength: Infinity, durationMs: 300_000 },
    ]) {
      expect(() => parseValue(ItemSchema, { ...base, potion }, "potion")).toThrow();
    }
  });
});
