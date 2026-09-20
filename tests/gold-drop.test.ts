/**
 * Gold is an item and a drop. The creature's gold range compiles into a guaranteed first roll, a
 * kill leaves the coins in the loot pile, and taking the pile credits the purse without a slot.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EquipmentBonuses, LootDrop, LootRoll, SemanticEntity, SkillId } from "../game/src/contracts.js";
import { SKILL_IDS } from "../game/src/contracts.js";
import { compileCreatures, resolveCreatureAtLevel } from "../game/src/content/creatureCompiler.js";
import { CREATURE_CATALOG, CREATURE_DEFINITIONS, CREATURE_PROFILES } from "../game/src/content/creatureRuntime.js";
import { ENEMIES } from "../game/src/content/enemies.js";
import { content, type ContentTables } from "../game/src/content/index.js";
import { ALL_ITEMS, CURRENCY_ITEM_ID } from "../game/src/content/items.js";
import { GOLD_ROLL_ID, createLootCompiler, goldRoll } from "../game/src/content/lootCompiler.js";
import { LOOT_RECORDS } from "../game/src/content/lootData.js";
import { SPELLS } from "../game/src/content/spells.js";
import { EventBus } from "../game/src/core/events.js";
import { RngStreams } from "../game/src/core/rng.js";
import { Store } from "../game/src/state/store.js";
import { CombatSystem } from "../game/src/systems/combat.js";
import { DeathSystem } from "../game/src/systems/death.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { EntityStore } from "../game/src/world/entities.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const originalContent: ContentTables = {
  items: [...content.allItems()], resources: [...content.allResources()], recipes: [...content.allRecipes()],
  spells: [...content.allSpells()], enemies: [...content.allEnemies()], shops: [...content.allShops()],
};
beforeAll(() => { content.register({ items: ALL_ITEMS, spells: SPELLS, enemies: ENEMIES }); });
afterAll(() => { content.register(originalContent); });

describe("goldRoll", () => {
  it("turns a range into one guaranteed roll of the gold item", () => {
    expect(GOLD_ROLL_ID).toBe("gold");
    expect(CURRENCY_ITEM_ID).toBe("gold");
    expect(goldRoll([30, 60])).toEqual({
      id: "gold", name: "Gold", count: 1, drops: [{ itemId: "gold", quantity: [30, 60], chance: 1 }],
    });
  });

  it("never rolls an empty stack, and has nothing to roll without a payable range", () => {
    expect(goldRoll([0, 5])!.drops[0]!.quantity).toEqual([1, 5]);
    expect(goldRoll(undefined)).toBeUndefined();
    expect(goldRoll([0, 0])).toBeUndefined();
  });
});

describe("gold in compiled creature loot", () => {
  it("leads every paying creature's rolls, sized by its final gold range", () => {
    const paying = CREATURE_CATALOG.creatures.filter(row => row.enemy.gold && row.enemy.gold[1] >= 1);
    expect(paying.length).toBeGreaterThan(100);
    for (const { id, enemy } of paying) {
      expect(enemy.lootRolls[0], id).toEqual(goldRoll(enemy.gold));
      expect(enemy.lootRolls.filter(roll => roll.id === GOLD_ROLL_ID), id).toHaveLength(1);
    }
    for (const { id, enemy } of CREATURE_CATALOG.creatures) {
      if (!paying.some(row => row.id === id)) expect(enemy.lootRolls.some(roll => roll.id === GOLD_ROLL_ID), id).toBe(false);
    }
  });

  it("uses an authored gold adjustment, not the curve, when a creature has one", () => {
    const adjusted = CREATURE_CATALOG.creatures.find(row => row.adjustments.gold && row.adjustments.gold[1] >= 1)!;
    expect(adjusted).toBeDefined();
    expect(adjusted.enemy.gold).toEqual(adjusted.adjustments.gold);
    expect(adjusted.enemy.lootRolls[0]!.drops[0]!.quantity).toEqual([Math.max(1, adjusted.adjustments.gold![0]), adjusted.adjustments.gold![1]]);
  });

  it("rebuilds the gold roll when an encounter re-levels a creature", () => {
    const creature = CREATURE_CATALOG.creatures.find(row => !row.adjustments.gold && row.enemy.gold && row.enemy.gold[1] >= 1)!;
    const raised = resolveCreatureAtLevel(creature, CREATURE_PROFILES, creature.level + 10);
    expect(raised.gold![1]).toBeGreaterThan(creature.enemy.gold![1]);
    expect(raised.lootRolls[0]).toEqual(goldRoll(raised.gold));
    expect(raised.lootRolls.slice(1)).toEqual(creature.enemy.lootRolls.slice(1));
  });

  it("reserves the gold roll id, and still lets any table drop gold as an ordinary item", () => {
    const drop = (itemId: string, chance: number): LootDrop => ({ itemId, chance, quantity: [1, 1] });
    const roll = (id: string, drops: LootDrop[]): LootRoll => ({ id, name: id, count: 1, drops, tables: [] });
    expect(() => createLootCompiler([])({ rolls: [roll("gold", [])] }, "creature")).toThrow("reserved");
    expect(() => createLootCompiler([{ id: "purse", name: "Purse", rolls: [roll("gold", [])] }])).toThrow("reserved");

    const definitions = CREATURE_DEFINITIONS.map(row => row.id !== "red_worm_t1" ? row
      : { ...row, loot: { rolls: [roll("gold", [drop("grithe_ore", 1)])] } });
    expect(() => compileCreatures(definitions, CREATURE_PROFILES, LOOT_RECORDS)).toThrow("reserved");

    const purse = { id: "purse", name: "Purse", rolls: [roll("coins", [{ itemId: "gold", chance: .5, quantity: [5, 9] }])] };
    const compiled = createLootCompiler([purse])({ rolls: [{ ...roll("main", []), tables: [{ tableId: "purse", rollId: "coins" }] }] }, "creature");
    expect(compiled[0]!.drops).toEqual([{ itemId: "gold", chance: .5, quantity: [5, 9] }]);
  });
});

const HERO_BONUSES: EquipmentBonuses = {
  meleeAccuracy: 500, meleePower: 500, magicAccuracy: 0, magicPower: 0, defence: 500, health: 0, vitality: 0,
};

/** The production systems end to end: a real kill, a real pile, the real inventory. */
function killRedWorm(seed: number) {
  const store = new Store(seed, 0);
  const state = store.get();
  state.skills.melee.level = 99;
  state.equipment.mainHand = { itemId: "worn_sword", quantity: 1 };
  const events = new EventBus();
  const skillLevels = (): Record<SkillId, number> => {
    const levels = {} as Record<SkillId, number>;
    for (const id of SKILL_IDS) levels[id] = store.get().skills[id].level;
    return levels;
  };
  const entities = new EntityStore({ skillLevels });
  const position = state.player.position;
  const target: SemanticEntity = {
    id: "red_worm_t1_1", archetype: "enemy", name: "Red Worm", tier: 1, regionId: "fallowmarch",
    position: [position[0], position[1], position[2] + 1.2], state: "alive", interactions: ["inspect", "attack"],
    combat: { health: 1, maxHealth: 1, level: 1, aggroRadius: 0 },
    meta: { enemyId: "red_worm_t1", behaviour: "passive", spawnX: 0, spawnZ: 2 },
  };
  entities.add(target);
  const inventory = new InventorySystem({ store, events, now: () => 0 });
  const dispatcher = new InteractionDispatcher({
    get: (id) => entities.get(id), playerPosition: () => store.get().player.position, skillLevels,
  });
  const equipment = { totals: () => HERO_BONUSES, slots: () => state.equipment };
  const combat = new CombatSystem({ store, events, rng: new RngStreams(seed), entities, equipment, inventory, dispatcher });
  const death = new DeathSystem({
    store, events, entities, inventory, dispatcher,
    respawn: { resolve: () => ({ position: [0, 0, 0], regionId: "fallowmarch" }) },
  });

  expect(combat.attack(target.id).ok).toBe(true);
  for (let atMs = 0; atMs <= 60_000 && target.state === "alive"; atMs += 100) combat.tick(100, atMs);
  expect(target.state).toBe("dead");
  const [pileId] = Object.keys(state.world.lootPiles);
  return { state, events, death, pileId: pileId!, pile: state.world.lootPiles[pileId!]! };
}

describe("gold from a kill", () => {
  it("lands in the loot pile, not the purse, and is credited when the pile is taken", () => {
    const range = ENEMIES.find(row => row.id === "red_worm_t1")!.gold!;
    const { state, death, pileId, pile } = killRedWorm(7);
    expect(state.currency).toBe(0);
    const gold = pile.items.find(stack => stack.itemId === "gold")!;
    expect(gold.quantity).toBeGreaterThanOrEqual(Math.max(1, range[0]));
    expect(gold.quantity).toBeLessThanOrEqual(range[1]);

    const dropped = gold.quantity;
    const taken = death.take(pileId);
    expect(taken.ok && taken.value.taken.find(stack => stack.itemId === "gold")).toEqual({ itemId: "gold", quantity: dropped });
    expect(state.currency).toBe(dropped);
    expect(state.inventory.slots.some(slot => slot?.itemId === "gold")).toBe(false);
  });

  it("is never refused by a full inventory, while slotted loot waits in the pile", () => {
    const { state, events, death, pileId, pile } = killRedWorm(7);
    pile.items.push({ itemId: "grithe_ore", quantity: 1 });
    state.inventory.slots = state.inventory.slots.map((_, slotIndex) => ({ slotIndex, itemId: "palewood_log", quantity: 1 }));
    const dropped = pile.items.find(stack => stack.itemId === "gold")!.quantity;

    const taken = death.take(pileId);
    expect(taken.ok).toBe(true);
    if (!taken.ok) return;
    expect(taken.value.taken).toEqual([{ itemId: "gold", quantity: dropped }]);
    expect(taken.value.remaining.some(stack => stack.itemId === "gold")).toBe(false);
    expect(taken.value.remaining).toContainEqual({ itemId: "grithe_ore", quantity: 1 });
    expect(state.currency).toBe(dropped);
    expect(state.inventory.slots.every(slot => slot?.itemId === "palewood_log")).toBe(true);
    events.flush();
    expect(events.since(0).events.filter(event => event.type === "item.received" && event.data["itemId"] === "gold")
      .map(event => event.data["name"] ?? event.data["source"])).toEqual(["gold", "loot"]);
  });
});
