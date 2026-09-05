import { describe, expect, it } from "vitest";
import type { ItemId, SemanticEntity, SkillId } from "../game/src/contracts.js";
import { ok, SKILL_IDS } from "../game/src/contracts.js";
import { dialogueNode, validateDialogue } from "../game/src/content/dialogue.js";
import { ENEMIES } from "../game/src/content/enemies.js";
import { quest } from "../game/src/content/quests.js";
import { EventBus } from "../game/src/core/events.js";
import { SimClock } from "../game/src/core/time.js";
import { setSkillLevel, Store } from "../game/src/state/store.js";
import {
  QuestSystem,
  type QuestEntityPort,
  type QuestInventoryPort,
} from "../game/src/systems/quests.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

function sparkingStone() {
  const found = quest("sparking_stone");
  if (!found) throw new Error("Missing sparking_stone quest");
  return found;
}

function questRuntime() {
  const store = new Store(419, 0);
  setSkillLevel(store.get(), "mining", 10);

  const events = new EventBus();
  const clock = new SimClock();
  const bag = new Map<ItemId, number>();
  const inventory: QuestInventoryPort = {
    addItem(itemId, quantity) {
      bag.set(itemId, (bag.get(itemId) ?? 0) + quantity);
      return ok(quantity);
    },
    removeItem(itemId, quantity) {
      const removed = Math.min(bag.get(itemId) ?? 0, quantity);
      bag.set(itemId, (bag.get(itemId) ?? 0) - removed);
      return ok(removed);
    },
    countItem: (itemId) => bag.get(itemId) ?? 0,
    hasRoomFor: () => true,
    addCurrency: (amount) => ok(amount),
  };

  const tempestRoc: SemanticEntity = {
    id: "tempest_roc",
    archetype: "enemy",
    name: "Storm Rhino",
    tier: 1,
    regionId: "fallowmarch",
    position: [-292, 0, -156],
    state: "alive",
    interactions: ["attack"],
    meta: { family: "tempest_roc" },
  };
  const entities: QuestEntityPort = {
    get: (id) => id === tempestRoc.id ? tempestRoc : undefined,
    setState: () => false,
  };

  const skillLevels = (): Record<SkillId, number> => {
    const levels = {} as Record<SkillId, number>;
    for (const id of SKILL_IDS) levels[id] = store.get().skills[id].level;
    return levels;
  };
  const dispatcher = new InteractionDispatcher({
    get: entities.get,
    playerPosition: () => store.get().player.position,
    skillLevels,
  });
  const quests = new QuestSystem({
    store,
    events,
    clock,
    entities,
    inventory,
    xp: { award: () => undefined },
    dispatcher,
  });

  return { store, events, bag, quests };
}

describe("The Sparking Stone Air Orb route", () => {
  it("keeps the fresh magic loadout to the Basic Wooden Wand and makes the boss supply the orb", () => {
    const { store } = questRuntime();
    const state = store.get();
    const startedWith = [
      ...state.inventory.slots.flatMap((slot) => slot ? [slot.itemId] : []),
      ...Object.values(state.equipment).flatMap((stack) => stack ? [stack.itemId] : []),
    ];

    expect(state.equipment.mainHand).toEqual({ itemId: "basic_wooden_wand", quantity: 1 });
    expect(Object.keys(state.equipment)).not.toContain("focus");
    expect(state.inventory.slots.find((slot) => slot?.itemId === "air_essence"))
      .toMatchObject({ itemId: "air_essence", quantity: 50 });
    expect(startedWith).not.toContain("palewood_staff");
    expect(startedWith).not.toContain("air_orb");

    const def = sparkingStone();
    expect(def.onStart?.items).toEqual([
      { itemId: "palewood_log", quantity: 1 },
      { itemId: "air_essence", quantity: 100 },
    ]);
    expect(def.onStart?.items).not.toContainEqual({ itemId: "air_orb", quantity: 1 });

    const boss = ENEMIES.find((enemy) => enemy.id === "tempest_roc_t1");
    expect(boss?.family).toBe("tempest_roc");
    expect(boss?.drops).toContainEqual({ itemId: "air_orb", quantity: [1, 1], chance: 1 });
  });

  it("orders the tracked objectives as kill, loot, craft and equip, train, then return", () => {
    const def = sparkingStone();

    expect(def.stages.map((stage) => stage.index)).toEqual([0, 1, 2, 3, 4]);
    expect(def.stages.map((stage) => stage.completion)).toEqual([
      { kind: "kill", enemyFamily: "tempest_roc", count: 1 },
      {
        kind: "have", itemId: "air_orb", quantity: 1,
        orAwakenedAltarId: "fallowmarch_air_altar",
      },
      { kind: "equipped", itemId: "air_staff" },
      { kind: "skill", skill: "magic", level: 5 },
      { kind: "talk", npcId: "npc_quarrier_vess", dialogueNodeId: "vess_stone_tested" },
    ]);
    expect(def.stages[0]?.refs).toEqual(expect.arrayContaining([
      { kind: "entity", id: "tempest_roc" },
      { kind: "location", id: "fallowmarch_air_cache" },
    ]));
  });

  it("advances those objectives through the quest system's existing event and state semantics", () => {
    const { store, events, bag, quests } = questRuntime();

    expect(quests.start("sparking_stone").ok).toBe(true);
    expect(quests.stage("sparking_stone")).toBe(0);
    expect(bag.get("palewood_log")).toBe(1);
    expect(bag.has("palewood_staff")).toBe(false);
    expect(bag.get("air_essence")).toBe(100);
    expect(bag.has("air_orb")).toBe(false);

    events.emit(
      "combat.ended",
      { reason: "killed", enemyId: "tempest_roc" },
      "tempest_roc",
      100,
    );
    events.flush();
    quests.tick(100, 100);
    expect(quests.counter("sparking_stone", "kill:tempest_roc")).toBe(1);
    expect(quests.stage("sparking_stone")).toBe(1);

    bag.set("air_orb", 1);
    quests.tick(500, 600);
    expect(quests.stage("sparking_stone")).toBe(2);

    bag.set("air_orb", 0);
    bag.set("palewood_staff", 0);
    bag.set("air_staff", 1);
    store.get().equipment.mainHand = { itemId: "air_staff", quantity: 1 };
    quests.tick(500, 1_100);
    expect(quests.stage("sparking_stone")).toBe(3);

    setSkillLevel(store.get(), "magic", 5);
    quests.tick(500, 1_600);
    expect(quests.stage("sparking_stone")).toBe(4);

    quests.noteDialogueNode("npc_quarrier_vess", "vess_stone_tested");
    quests.evaluateNow();
    expect(quests.status("sparking_stone")).toBe("complete");
    quests.dispose();
  });

  it("gives repeatable boss, loot, altar, and recharge directions in Vess's dialogue", () => {
    expect(validateDialogue()).toEqual([]);

    const offer = dialogueNode("vess_stone_offer");
    const directions = dialogueNode("vess_stone_accepted");
    const root = dialogueNode("vess_root");
    const text = `${offer?.text ?? ""} ${directions?.text ?? ""}`;

    expect(text).toMatch(/Storm Rhino/);
    expect(text).toMatch(/Air Essence Cache/);
    expect(text).toMatch(/loot the Air Orb/i);
    expect(text).toMatch(/Air Staff/);
    expect(text).toMatch(/Air Essence Altar/);
    expect(text).toMatch(/awaken/i);
    expect(text).toMatch(/1000/);
    expect(text).toMatch(/100 Air Essence/);

    const reminder = root?.options.find((option) => option.id === "vess_root#roc_route");
    expect(reminder?.next).toBe("vess_stone_accepted");

    const delivery = root?.options.find((option) => option.id === "vess_root#deliver");
    const stageGate = delivery?.requires?.find((condition) => condition.kind === "questStage");
    expect(stageGate).toMatchObject({ questId: "sparking_stone", min: 4 });
  });
});
