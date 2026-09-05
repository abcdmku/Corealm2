import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillId } from "../game/src/contracts.js";
import { content } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { EventBus } from "../game/src/core/events.js";
import { SimClock } from "../game/src/core/time.js";
import { SaveService } from "../game/src/persistence/storage.js";
import { addSkillXp, Store, type GameState } from "../game/src/state/store.js";
import { DialogueSystem } from "../game/src/systems/dialogue.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { QuestSystem } from "../game/src/systems/quests.js";
import { EntityStore } from "../game/src/world/entities.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const CAIRN = "long_cairn";
const DOOR = "gravelmaw_stone_door";
const GATE = "ordrun_gate";
const REACTED = "@reacted:4:lever_order_known";
const systems: QuestSystem[] = [];

beforeEach(() => content.register({ items: ALL_ITEMS }));
afterEach(() => {
  for (const quests of systems.splice(0)) quests.dispose();
});

function runtime(saved?: GameState, withDoors = true) {
  const store = new Store(443, 0);
  if (saved) store.replace(saved);
  else {
    store.get().player.position = [0, 0, 0];
    store.get().player.regionId = "karrowmoor";
  }
  const events = new EventBus();
  const clock = new SimClock();
  const skillLevels = () => Object.fromEntries(
    Object.entries(store.get().skills).map(([id, skill]) => [id, skill.level]),
  ) as Record<SkillId, number>;
  const entities = new EntityStore({ skillLevels });
  entities.load([
    {
      id: "npc_cairnkeeper_ode", name: "Cairnkeeper Ode", archetype: "npc", tier: 1,
      position: [0, 0, 0], regionId: "karrowmoor", state: "idle", interactions: ["talk"],
    },
  ]);
  if (withDoors) {
    entities.add({
      id: DOOR, name: "Three-Lever Door", archetype: "door", tier: 1,
      position: [2, 0, 0], regionId: "gravelmaw", state: "locked", interactions: ["inspect", "open"],
    });
    entities.add({
      id: GATE, name: "Quarrykeeper's Gate", archetype: "door", tier: 1,
      position: [4, 0, 0], regionId: "gravelmaw", state: "sealed", interactions: ["inspect", "open"],
    });
  }
  const dispatcher = new InteractionDispatcher({
    get: (id) => entities.get(id), playerPosition: () => store.get().player.position, skillLevels,
  });
  const inventory = new InventorySystem({ store, events, now: () => clock.elapsedMs });
  const xp = {
    award(skill: SkillId, amount: number) {
      addSkillXp(store.get(), skill, amount);
      store.markDirty();
    },
  };
  const quests = new QuestSystem({ store, events, clock, entities, inventory, xp, dispatcher });
  systems.push(quests);
  const dialogue = new DialogueSystem({ store, events, clock, entities, inventory, xp, quests, dispatcher });
  return { store, events, entities, inventory, quests, dialogue, dispatcher };
}

function reload(previous: ReturnType<typeof runtime>, withDoors = true) {
  const saves = new SaveService(false);
  const loaded = saves.deserialize(saves.serialize(previous.store.get()));
  expect(loaded.status).toBe("loaded");
  if (!loaded.state) throw new Error(loaded.reason ?? "Missing loaded state");
  previous.quests.dispose();
  return runtime(loaded.state, withDoors);
}

function hydrateWithoutGameWrites(current: ReturnType<typeof runtime>) {
  current.events.flush();
  const cursor = current.events.currentSeq();
  current.store.consumeDirty();
  const revision = current.store.revision();
  const before = current.store.snapshot();
  for (let index = 0; index < 3; index += 1) current.quests.rehydrateWorldState();
  expect(current.store.get()).toEqual(before);
  expect(current.store.revision()).toBe(revision);
  expect(current.store.consumeDirty()).toBe(false);
  current.events.flush();
  expect(current.events.since(cursor).events).toEqual([]);
}

describe("quest world-state rehydration", () => {
  it("restores an answered lever puzzle, then preserves the real Open action across another reload", () => {
    const first = runtime();
    expect(first.quests.setStage(CAIRN, 4).ok).toBe(true);
    expect(first.entities.get(DOOR)?.state).toBe("locked");
    expect(first.dispatcher.run("npc_cairnkeeper_ode", "talk").ok).toBe(true);
    expect(first.dialogue.op("choose", "ode_root#levers").ok).toBe(true);
    expect(first.dialogue.op("choose", "ode_long_cairn_levers#wde").ok).toBe(true);
    expect(first.quests.stage(CAIRN)).toBe(4);
    expect(first.quests.flag(CAIRN, "lever_order_known")).toBe(true);
    expect(first.quests.flag(CAIRN, REACTED)).toBe(true);
    expect(first.entities.get(DOOR)?.state).toBe("unbarred");
    expect(first.entities.get(GATE)?.state).toBe("sealed");

    const second = reload(first);
    expect(second.entities.get(DOOR)?.state).toBe("locked");
    hydrateWithoutGameWrites(second);
    expect(second.entities.get(DOOR)?.state).toBe("unbarred");
    expect(second.entities.get(GATE)?.state).toBe("sealed");
    second.store.get().player.position = [2, 0, 0];
    second.store.get().player.regionId = "gravelmaw";
    const agilityBefore = second.store.get().skills.agility.xp;
    const miningBefore = second.store.get().skills.mining.xp;
    expect(second.dispatcher.run(DOOR, "open").ok).toBe(true);
    expect(second.quests.stage(CAIRN)).toBe(5);
    expect(second.entities.get(DOOR)?.state).toBe("open");
    expect(second.store.get().skills.agility.xp).toBe(agilityBefore + 200);
    expect(second.store.get().skills.mining.xp).toBe(miningBefore + 200);

    const third = reload(second);
    expect(third.entities.get(DOOR)?.state).toBe("locked");
    hydrateWithoutGameWrites(third);
    expect(third.quests.stage(CAIRN)).toBe(5);
    expect(third.entities.get(DOOR)?.state).toBe("open");
    expect(third.entities.get(GATE)?.state).toBe("sealed");
    expect(third.store.get().skills.agility.xp).toBe(agilityBefore + 200);
    expect(third.store.get().skills.mining.xp).toBe(miningBefore + 200);
  });

  it("leaves an unanswered puzzle and the future boss gate locked", () => {
    const first = runtime();
    expect(first.quests.setStage(CAIRN, 4).ok).toBe(true);
    const current = reload(first);
    hydrateWithoutGameWrites(current);
    expect(current.entities.get(DOOR)?.state).toBe("locked");
    expect(current.entities.get(GATE)?.state).toBe("sealed");
    expect(current.dispatcher.run(DOOR, "open").ok).toBe(false);
    expect(current.quests.stage(CAIRN)).toBe(4);
  });

  it("requires an applied reaction marker, rather than only the lever answer flag", () => {
    const first = runtime();
    first.store.get().quests[CAIRN] = {
      status: "active", stage: 4, counters: {}, flags: { lever_order_known: true },
    };
    const current = reload(first);
    hydrateWithoutGameWrites(current);
    expect(current.entities.get(DOOR)?.state).toBe("locked");
    current.store.get().quests[CAIRN]!.flags[REACTED] = true;
    hydrateWithoutGameWrites(current);
    expect(current.entities.get(DOOR)?.state).toBe("unbarred");
    expect(current.entities.get(GATE)?.state).toBe("sealed");
  });

  it("does not replay a future-stage reaction even if a save contains its marker", () => {
    const current = runtime();
    current.store.get().quests[CAIRN] = {
      status: "active", stage: 3, counters: {}, flags: { [REACTED]: true, lever_order_known: true },
    };
    hydrateWithoutGameWrites(current);
    expect(current.entities.get(DOOR)?.state).toBe("locked");
    expect(current.entities.get(GATE)?.state).toBe("sealed");
  });

  it.each([
    { status: "active" as const, stage: 5, gate: "sealed" },
    { status: "complete" as const, stage: 7, gate: "open" },
  ])("restores an older $status record without replaying paid or pending rewards", ({ status, stage, gate }) => {
    const first = runtime();
    first.store.get().quests[CAIRN] = {
      status, stage, flags: { lever_order_known: true, door_open: true },
      counters: { "pending:seared_cragfin": 3, stones_given: 2 },
    };
    first.store.get().currency = 123;
    addSkillXp(first.store.get(), "mining", 450);
    const current = reload(first);
    hydrateWithoutGameWrites(current);
    expect(current.entities.get(DOOR)?.state).toBe("open");
    expect(current.entities.get(GATE)?.state).toBe(gate);
    expect(current.store.get().currency).toBe(123);
    expect(current.store.get().skills.mining.xp).toBe(450);
    expect(current.quests.counter(CAIRN, "pending:seared_cragfin")).toBe(3);
    expect(current.inventory.countItem("seared_cragfin")).toBe(0);
    expect(current.inventory.countItem("cairn_garnet")).toBe(0);
    expect(current.inventory.countItem("kaldite_dagger")).toBe(0);
  });

  it("tolerates missing world entities in a lab or rebuilt scene", () => {
    const first = runtime();
    first.store.get().quests[CAIRN] = { status: "complete", stage: 7, flags: {}, counters: {} };
    const current = reload(first, false);
    expect(() => hydrateWithoutGameWrites(current)).not.toThrow();
    expect(current.entities.get(DOOR)).toBeUndefined();
    expect(current.entities.get(GATE)).toBeUndefined();
  });

  it.each(["no quest", "another quest", "unstarted quest"])("does not write either locked gate for $0", (scenario) => {
    const current = runtime();
    if (scenario === "another quest") current.store.get().quests.the_carters_wager = {
      status: "complete", stage: 3, flags: {}, counters: {},
    };
    if (scenario === "unstarted quest") current.store.get().quests[CAIRN] = {
      status: "unstarted", stage: 0, flags: {}, counters: {},
    };
    const writes = vi.spyOn(current.entities, "setState");
    hydrateWithoutGameWrites(current);
    expect(writes).not.toHaveBeenCalled();
    expect(current.entities.get(DOOR)?.state).toBe("locked");
    expect(current.entities.get(GATE)?.state).toBe("sealed");
  });
});
