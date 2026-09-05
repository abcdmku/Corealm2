import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GameEvent, SkillId } from "../game/src/contracts.js";
import { content } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { EventBus } from "../game/src/core/events.js";
import { SimClock } from "../game/src/core/time.js";
import { SaveService } from "../game/src/persistence/storage.js";
import { addSkillXp, setSkillLevel, Store, type GameState } from "../game/src/state/store.js";
import { BankSystem } from "../game/src/systems/bank.js";
import { DialogueSystem } from "../game/src/systems/dialogue.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { QuestSystem } from "../game/src/systems/quests.js";
import { EntityStore } from "../game/src/world/entities.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const WAGER = "the_carters_wager";
const STONE = "sparking_stone";
const FOOD = "seared_minnow";
const systems: QuestSystem[] = [];

beforeEach(() => content.register({ items: ALL_ITEMS }));

afterEach(() => {
  for (const quests of systems.splice(0)) quests.dispose();
});

function runtime(saved?: GameState) {
  const store = new Store(427, 0);
  if (saved) store.replace(saved);
  else {
    store.get().inventory.slots.fill(null);
    store.get().player.position = [0, 0, 0];
  }
  const events = new EventBus();
  const clock = new SimClock();
  const emitted: GameEvent[] = [];
  events.subscribe((event) => emitted.push(event));
  const skillLevels = () => Object.fromEntries(
    Object.entries(store.get().skills).map(([id, skill]) => [id, skill.level]),
  ) as Record<SkillId, number>;
  const entities = new EntityStore({ skillLevels });
  entities.load([
    {
      id: "npc_carter_bel", archetype: "npc", name: "Carter Bel", tier: 1,
      regionId: "fallowmarch", position: [0, 0, 0], state: "idle", interactions: ["talk"],
    },
    {
      id: "tempest_roc", archetype: "boss", name: "Tempest Roc", tier: 1,
      regionId: "fallowmarch", position: [2, 0, 0], state: "alive", interactions: ["attack"],
      meta: { family: "tempest_roc" },
    },
  ]);
  const dispatcher = new InteractionDispatcher({
    get: (id) => entities.get(id),
    playerPosition: () => store.get().player.position,
    skillLevels,
  });
  const inventory = new InventorySystem({ store, events, now: () => clock.elapsedMs });
  const xp = {
    award(skill: SkillId, amount: number) {
      const result = addSkillXp(store.get(), skill, amount);
      if (result.levelsGained > 0) events.emit("level.gained", {
        skill, level: result.newLevel, levelsGained: result.levelsGained,
      }, undefined, clock.elapsedMs);
      store.markDirty();
    },
  };
  const quests = new QuestSystem({ store, events, clock, entities, inventory, xp, dispatcher });
  systems.push(quests);
  const dialogue = new DialogueSystem({ store, events, clock, entities, inventory, xp, quests, dispatcher });
  const bank = new BankSystem({
    store, events, inventory, dispatcher, now: () => clock.elapsedMs, inRangeOfBank: () => true,
  });
  const tick = (count = 5) => {
    for (let index = 0; index < count; index += 1) {
      clock.commitTick();
      quests.tick(100, clock.elapsedMs);
      events.flush();
    }
  };
  const rocKill = () => {
    events.emit("combat.ended", { reason: "killed", enemyId: "tempest_roc" }, "tempest_roc", clock.elapsedMs);
    events.flush();
    tick();
  };
  return { store, events, emitted, inventory, quests, dialogue, bank, dispatcher, tick, rocKill };
}

function reload(previous: ReturnType<typeof runtime>) {
  const saves = new SaveService(false);
  const loaded = saves.deserialize(saves.serialize(previous.store.get()));
  expect(loaded.status).toBe("loaded");
  if (!loaded.state) throw new Error(loaded.reason ?? "Save did not return state");
  previous.quests.dispose();
  return runtime(loaded.state);
}

function foodReceived(events: GameEvent[]): number[] {
  return events.filter((event) => event.type === "item.received" && event.data.itemId === FOOD)
    .map((event) => Number(event.data.quantity));
}

describe("quest recovery across inventory pressure and reload", () => {
  it("delivers Carter Bel's completed reward in partial batches without repeating XP or currency", () => {
    const first = runtime();
    expect(first.dispatcher.run("npc_carter_bel", "talk").ok).toBe(true);
    expect(first.dialogue.op("choose", "bel_root#offer").ok).toBe(true);
    expect(first.dialogue.op("choose", "bel_wager_offer#accept").ok).toBe(true);
    expect(first.quests.status(WAGER)).toBe("active");

    // Isolate the final conversation with the two earlier requirements already satisfied.
    setSkillLevel(first.store.get(), "agility", 3);
    first.store.get().world.obstaclesUsed.wall_vault = 1;
    first.tick();
    expect(first.quests.stage(WAGER)).toBe(2);
    expect(first.inventory.addItem("grithe_ore", 28)).toEqual({ ok: true, value: 28 });
    expect(first.inventory.freeSlots()).toBe(0);
    const xpBefore = first.store.get().skills.agility.xp;
    const currencyBefore = first.store.get().currency;

    expect(first.dispatcher.run("npc_carter_bel", "talk").ok).toBe(true);
    expect(first.dialogue.op("choose", "bel_root#report").ok).toBe(true);
    expect(first.dialogue.op("choose", "bel_wager_report#truth").ok).toBe(true);
    expect(first.store.get().dialogue?.nodeId).toBe("bel_wager_settled");
    expect(first.quests.status(WAGER)).toBe("complete");
    expect(first.quests.counter(WAGER, `pending:${FOOD}`)).toBe(4);
    expect(first.inventory.countItem(FOOD)).toBe(0);
    expect(first.store.get().skills.agility.xp).toBe(xpBefore + 180);
    expect(first.store.get().currency).toBe(currencyBefore + 260);
    const rewardedSkills = structuredClone(first.store.get().skills);
    const rewardedCurrency = first.store.get().currency;
    first.tick(20);
    expect(first.quests.counter(WAGER, `pending:${FOOD}`)).toBe(4);

    expect(first.bank.op("deposit", { itemId: "grithe_ore", quantity: 1 }).ok).toBe(true);
    expect(first.inventory.freeSlots()).toBe(1);
    first.tick(20);
    expect(first.inventory.countItem(FOOD)).toBe(1);
    expect(first.inventory.freeSlots()).toBe(0);
    expect(first.quests.counter(WAGER, `pending:${FOOD}`)).toBe(3);
    expect(foodReceived(first.emitted)).toEqual([1]);

    const second = reload(first);
    expect(second.quests.status(WAGER)).toBe("complete");
    expect(second.inventory.countItem(FOOD)).toBe(1);
    expect(second.quests.counter(WAGER, `pending:${FOOD}`)).toBe(3);
    second.tick(20);
    expect(second.quests.counter(WAGER, `pending:${FOOD}`)).toBe(3);
    expect(second.bank.op("deposit", { itemId: "grithe_ore", quantity: 3 }).ok).toBe(true);
    expect(second.inventory.freeSlots()).toBe(3);
    second.tick(20);
    expect(second.inventory.countItem(FOOD)).toBe(4);
    expect(second.quests.counter(WAGER, `pending:${FOOD}`)).toBe(0);
    expect(second.store.get().quests[WAGER]?.counters).not.toHaveProperty(`pending:${FOOD}`);
    expect(foodReceived(second.emitted)).toEqual([3]);

    // Leave ample room so a duplicate delivery cannot hide behind another full bag.
    expect(second.bank.op("depositAll").ok).toBe(true);
    second.tick(20);
    const third = reload(second);
    third.tick(20);
    expect(third.inventory.freeSlots()).toBe(28);
    expect(third.inventory.countItem(FOOD)).toBe(0);
    expect(third.store.get().bank.slots.find((slot) => slot.itemId === FOOD)?.quantity).toBe(4);
    expect(third.store.get().skills).toEqual(rewardedSkills);
    expect(third.store.get().currency).toBe(rewardedCurrency);
    expect(third.quests.status(WAGER)).toBe("complete");
    expect(foodReceived(second.emitted)).toEqual([3]);
    expect(foodReceived(third.emitted)).toEqual([]);
  });

  it("accepts an altar awakened before starting Sparking Stone after a new Roc kill", () => {
    const beforeQuest = runtime();
    setSkillLevel(beforeQuest.store.get(), "mining", 10);
    beforeQuest.store.get().magic.awakenedAltars.fallowmarch_air_altar = true;
    beforeQuest.rocKill();
    const current = reload(beforeQuest);
    expect(current.inventory.countItem("air_orb")).toBe(0);
    expect(current.quests.start(STONE).ok).toBe(true);
    current.tick(20);
    expect(current.quests.stage(STONE)).toBe(0);
    expect(current.quests.counter(STONE, "kill:tempest_roc")).toBe(0);

    current.events.emit("combat.ended", { reason: "escaped", enemyId: "tempest_roc" });
    current.events.emit("combat.ended", { reason: "killed", enemyId: "other_enemy", family: "frog" });
    current.events.flush();
    current.tick();
    expect(current.quests.stage(STONE)).toBe(0);

    current.rocKill();
    expect(current.quests.counter(STONE, "kill:tempest_roc")).toBe(1);
    expect(current.quests.stage(STONE)).toBe(2);
    expect(current.quests.summary(STONE)?.currentObjective).toContain("equip it");
    expect(current.inventory.countItem("air_orb")).toBe(0);
    expect(current.store.get().magic.awakenedAltars.fallowmarch_air_altar).toBe(true);
    current.tick(20);
    expect(current.quests.stage(STONE)).toBe(2);
  });

  it("still requires the orb when only another altar is awakened", () => {
    const beforeQuest = runtime();
    setSkillLevel(beforeQuest.store.get(), "mining", 10);
    beforeQuest.store.get().magic.awakenedAltars.karrowmoor_water_altar = true;
    beforeQuest.store.get().magic.consumedOrbs.water_orb = true;
    const current = reload(beforeQuest);
    expect(current.quests.start(STONE).ok).toBe(true);
    current.rocKill();
    current.tick(20);
    expect(current.quests.counter(STONE, "kill:tempest_roc")).toBe(1);
    expect(current.quests.stage(STONE)).toBe(1);
    expect(current.inventory.countItem("air_orb")).toBe(0);
    expect(current.inventory.addItem("air_orb", 1)).toEqual({ ok: true, value: 1 });
    current.tick();
    expect(current.quests.stage(STONE)).toBe(2);
  });
});
