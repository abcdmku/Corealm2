import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SpellId } from "../game/src/contracts.js";
import { SPELL_ELEMENTS } from "../game/src/contracts.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { SHOPS } from "../game/src/content/shops.js";
import { content, type ContentTables } from "../game/src/content/index.js";
import {
  ADVANCED_SPELLS, ALL_SPELLS, COSMIC_RUNE_ID, SPELLS, SPELL_RUNES, isAdvancedSpell, tierRune,
} from "../game/src/content/spells.js";
import { ELEMENTAL_SPELLS } from "../game/src/content/elementalSpells.js";
import { areaFootprintRadius, planElementalAttack } from "../game/src/systems/elementalAttacks.js";
import { spellBlockReason, spendSpellFuel, spellRunesCarried } from "../game/src/systems/essence.js";
import { EventBus } from "../game/src/core/events.js";
import { Store, setSkillLevel } from "../game/src/state/store.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { EquipmentSystem } from "../game/src/systems/equipment.js";
import { SPELL_MOTIF_IDS, spellIconSvg, spellMotifId } from "../game/src/ui/spellIcons.js";
import { SPELL_RANGE } from "../game/src/app/config.js";

/**
 * The twenty invocations and their six runes, frozen as tests.
 *
 * The rule the owner set: the basics stay rune-free, every invocation spends its rank's rune, and
 * every area invocation spends a Cosmic Rune on top. Rank one is the only single-target rank, so it
 * is also the only rank without the Cosmic Rune, and that has to stay true of the pulse plans too.
 */

const originalContent: ContentTables = {
  items: [...content.allItems()], resources: [...content.allResources()],
  recipes: [...content.allRecipes()], spells: [...content.allSpells()],
  enemies: [...content.allEnemies()], shops: [...content.allShops()],
};

beforeAll(() => content.register({ items: ALL_ITEMS, spells: ALL_SPELLS }));
afterAll(() => content.register(originalContent));

function runtime() {
  const store = new Store(4242, 0);
  const events = new EventBus();
  const now = () => 1000;
  const inventory = new InventorySystem({ store, events, now });
  const equipment = new EquipmentSystem({ store, events, inventory, now });
  return { store, inventory, equipment };
}

describe("the invocation ladder", () => {
  it("adds twenty invocations to the sixteen basics, five per element, one per rank", () => {
    expect(SPELLS).toHaveLength(16);
    expect(ADVANCED_SPELLS).toHaveLength(20);
    expect(ALL_SPELLS).toHaveLength(36);
    expect(new Set(ALL_SPELLS.map((spell) => spell.id)).size).toBe(36);
    for (const element of SPELL_ELEMENTS) {
      const ranks = ADVANCED_SPELLS.filter((spell) => spell.element === element).map((spell) => spell.rank).sort();
      expect(ranks, element).toEqual([1, 2, 3, 4, 5]);
    }
    for (const spell of SPELLS) expect(isAdvancedSpell(spell)).toBe(false);
    for (const spell of ADVANCED_SPELLS) expect(isAdvancedSpell(spell)).toBe(true);
  });

  it("uses the lab's own ids, names and descriptions", () => {
    for (const spell of ADVANCED_SPELLS) {
      const source = ELEMENTAL_SPELLS.find((entry) => entry.id === spell.id);
      expect(source, spell.id).toBeDefined();
      expect(spell.name).toBe(source!.name);
      expect(spell.rank).toBe(source!.rank);
      expect(spell.element).toBe(source!.element);
    }
  });

  it("climbs in level and damage within every element and stays inside Magic 99", () => {
    for (const element of SPELL_ELEMENTS) {
      const rows = ADVANCED_SPELLS.filter((spell) => spell.element === element).sort((a, b) => a.rank! - b.rank!);
      for (let index = 1; index < rows.length; index += 1) {
        expect(rows[index]!.reqLevel).toBeGreaterThan(rows[index - 1]!.reqLevel);
        expect(rows[index]!.baseMax).toBeGreaterThan(rows[index - 1]!.baseMax);
        expect(rows[index]!.divisor).toBeLessThanOrEqual(rows[index - 1]!.divisor);
        expect(rows[index]!.baseXp).toBeGreaterThan(rows[index - 1]!.baseXp);
      }
      expect(rows[0]!.reqLevel).toBeGreaterThanOrEqual(20);
      expect(rows[4]!.reqLevel).toBeLessThanOrEqual(99);
    }
  });
});

describe("spell runes", () => {
  it("are six carried items: one per rank plus the Cosmic Rune, all sold somewhere", () => {
    expect(SPELL_RUNES).toHaveLength(6);
    expect(SPELL_RUNES.filter((rune) => rune.tier > 0).map((rune) => rune.tier).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(SPELL_RUNES.filter((rune) => rune.tier === 0).map((rune) => rune.itemId)).toEqual([COSMIC_RUNE_ID]);
    const stocked = new Set(SHOPS.flatMap((shop) => shop.stock.map((row) => row.itemId)));
    for (const rune of SPELL_RUNES) {
      const item = ALL_ITEMS.find((entry) => entry.id === rune.itemId);
      expect(item, rune.itemId).toBeDefined();
      expect(item!.stackable).toBe(true);
      expect(item!.name).toBe(rune.name);
      expect(stocked.has(rune.itemId), `${rune.itemId} is sold`).toBe(true);
    }
  });

  it("are spent by rank, with the Cosmic Rune on every area invocation and never on a basic", () => {
    for (const spell of SPELLS) expect(spell.cost.runes ?? []).toHaveLength(0);
    for (const spell of ADVANCED_SPELLS) {
      const runes = spell.cost.runes ?? [];
      expect(runes.map((rune) => rune.itemId)).toContain(tierRune(spell.rank!).itemId);
      expect(runes.some((rune) => rune.itemId === COSMIC_RUNE_ID), spell.id).toBe(spell.aoe === true);
      expect(runes).toHaveLength(spell.aoe ? 2 : 1);
      for (const rune of runes) expect(rune.quantity).toBe(1);
    }
  });

  it("mark exactly the invocations whose pulse plans reach past one target as area", () => {
    for (const spell of ADVANCED_SPELLS) {
      const pulses = planElementalAttack(spell.id as never, [0, 0, 0], [0, 0, 10]);
      const spread = pulses.some((pulse) => pulse.radius > 1.5 || Math.hypot(pulse.point[0], pulse.point[2] - 10) > 0.5);
      expect(spread, `${spell.id} aoe flag`).toBe(spell.aoe === true);
      expect(spell.aoe === true, `${spell.id} rank ${spell.rank}`).toBe(spell.rank! >= 2);
      if (spell.aoe) expect(areaFootprintRadius(spell.id as never)).toBeGreaterThan(2);
    }
  });
});

describe("paying for an invocation", () => {
  it("blocks on the missing rune after Essence, then spends Essence and both runes together", () => {
    const { store, inventory, equipment } = runtime();
    const state = store.get();
    setSkillLevel(state, "magic", 99);
    inventory.addItem("basic_wooden_staff", 1);
    expect(equipment.equip("basic_wooden_staff").ok).toBe(true);
    inventory.addItem("fire_essence", 5);
    const sunfall = content.spell("starfall")!;
    expect(spellBlockReason(store.get(), sunfall)).toContain("Wrath Rune");
    inventory.addItem("wrath_rune", 2);
    expect(spellBlockReason(store.get(), sunfall)).toContain("Cosmic Rune");
    inventory.addItem("cosmic_rune", 3);
    expect(spellBlockReason(store.get(), sunfall)).toBeNull();
    expect(spellRunesCarried(store.get(), sunfall)).toEqual([
      { itemId: "wrath_rune", name: "Wrath Rune", quantity: 1, carried: 2 },
      { itemId: "cosmic_rune", name: "Cosmic Rune", quantity: 1, carried: 3 },
    ]);

    const paid = spendSpellFuel(store.get(), sunfall, inventory);
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.value.source).toBe("essence");
    expect(paid.value.runes).toEqual([
      { itemId: "wrath_rune", quantity: 1, remaining: 1 },
      { itemId: "cosmic_rune", quantity: 1, remaining: 2 },
    ]);
    expect(inventory.countItem("fire_essence")).toBe(4);

    // A rank-one invocation needs its Mind Rune and nothing else beyond Essence.
    inventory.addItem("air_essence", 2);
    const needle = content.spell("air-needle")!;
    expect(spellBlockReason(store.get(), needle)).toContain("Mind Rune");
    inventory.addItem("mind_rune", 1);
    const dart = spendSpellFuel(store.get(), needle, inventory);
    expect(dart.ok && dart.value.runes).toEqual([{ itemId: "mind_rune", quantity: 1, remaining: 0 }]);
  });

  it("leaves a basic spell's spend result exactly as it was", () => {
    const { store, inventory, equipment } = runtime();
    setSkillLevel(store.get(), "magic", 99);
    inventory.addItem("basic_wooden_staff", 1);
    expect(equipment.equip("basic_wooden_staff").ok).toBe(true);
    inventory.addItem("air_essence", 3);
    const paid = spendSpellFuel(store.get(), content.spell("voltrend")!, inventory);
    // A fresh character already carries the 50 starter Air Essence; the shape is what is frozen.
    expect(paid.ok && paid.value).toEqual({ source: "essence", essenceItemId: "air_essence", remainingEssence: inventory.countItem("air_essence") });
    expect(paid.ok && Object.keys(paid.value)).toEqual(["source", "essenceItemId", "remainingEssence"]);
  });
});

describe("spell icons", () => {
  it("draw a distinct motif for every invocation and every element's basic, inside the spell range", () => {
    expect(new Set(SPELL_MOTIF_IDS).size).toBe(24);
    const seen = new Map<string, SpellId>();
    for (const spell of ALL_SPELLS) {
      const subject = { id: spell.id, element: spell.element, rung: spell.rung, rank: spell.rank ?? 0 };
      expect(SPELL_MOTIF_IDS).toContain(spellMotifId(subject));
      const svg = spellIconSvg(subject);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain("<path");
      const previous = seen.get(svg);
      expect(previous, `${spell.id} shares an icon with ${previous}`).toBeUndefined();
      seen.set(svg, spell.id);
    }
    expect(seen.size).toBe(36);
    expect(SPELL_RANGE).toBe(15);
  });
});
