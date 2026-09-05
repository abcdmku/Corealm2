import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DialogueEffect } from "../game/src/content/dialogue.js";
import { dialogueNode } from "../game/src/content/dialogue.js";
import { content } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { EventBus } from "../game/src/core/events.js";
import { SimClock } from "../game/src/core/time.js";
import { addSkillXp, Store } from "../game/src/state/store.js";
import { DialogueSystem } from "../game/src/systems/dialogue.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { QuestSystem } from "../game/src/systems/quests.js";
import { EntityStore } from "../game/src/world/entities.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";
import type { SkillId } from "../game/src/contracts.js";

const ODE = "npc_cairnkeeper_ode";
const CLEANUPS: Array<() => void> = [];
beforeEach(() => content.register({ items: ALL_ITEMS }));
afterEach(() => { for (const cleanup of CLEANUPS.splice(0)) cleanup(); });

function runtime() {
  const store = new Store(344, 0);
  store.get().inventory.slots.fill(null);
  store.get().quests.long_cairn = { status: "active", stage: 6, counters: { stones_given: 0 }, flags: {} };
  const events = new EventBus();
  const clock = new SimClock();
  const skillLevels = () => Object.fromEntries(
    Object.entries(store.get().skills).map(([id, skill]) => [id, skill.level]),
  ) as Record<SkillId, number>;
  const entities = new EntityStore({ skillLevels });
  entities.load([{
    id: ODE, name: "Cairnkeeper Ode", archetype: "npc", tier: 1, state: "idle",
    position: [0, 0, 0], regionId: "fallowmarch", interactions: ["talk"],
  }]);
  const dispatcher = new InteractionDispatcher({
    get: (id) => entities.get(id), playerPosition: () => store.get().player.position, skillLevels,
  });
  const inventory = new InventorySystem({ store, events, now: () => clock.elapsedMs });
  const xp = { award: (skill: SkillId, amount: number) => { addSkillXp(store.get(), skill, amount); } };
  const quests = new QuestSystem({ store, events, clock, entities, inventory, xp, dispatcher });
  CLEANUPS.push(() => quests.dispose());
  const dialogue = new DialogueSystem({ store, events, clock, entities, inventory, xp, quests, dispatcher });
  const open = () => {
    expect(dialogue.open(ODE, "ode_root").ok).toBe(true);
    events.flush();
    return events.since(0).nextSeq;
  };
  return { store, events, clock, inventory, quests, dialogue, open };
}

/** Test only the effect combinations through the production graph walker and inventory ports. */
function option(effects: DialogueEffect[]): string {
  const node = dialogueNode("ode_root")!;
  const id = "ode_root#transaction_test";
  const definition = { id, text: "Test this handover.", effects, next: "ode_replacement_stone" };
  node.options.push(definition);
  CLEANUPS.push(() => { node.options.splice(node.options.indexOf(definition), 1); });
  return id;
}

describe("dialogue item transactions", () => {
  it("never spends Ode's replacement quota on a full bag, then gives one stone on retry", () => {
    const current = runtime();
    expect(current.inventory.addItem("grithe_ore", 28).ok).toBe(true);
    const cursor = current.open();
    const before = current.store.snapshot();
    const revision = current.store.revision();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = current.dialogue.op("choose", "ode_root#restone");
      expect(result).toMatchObject({ ok: false, error: { code: "INVENTORY_FULL", message: expect.stringContaining("Garnet") } });
      expect(current.store.snapshot()).toEqual(before);
      expect(current.store.revision()).toBe(revision);
      expect(current.dialogue.op("state")).toMatchObject({
        ok: true, value: { options: expect.arrayContaining([{ id: "ode_root#restone", text: "I no longer have the keeping-stone.", enabled: true }]) },
      });
    }
    current.events.flush();
    expect(current.events.since(cursor).events).toEqual([]);

    expect(current.inventory.removeItem("grithe_ore", 1).ok).toBe(true);
    expect(current.dialogue.op("choose", "ode_root#restone").ok).toBe(true);
    expect(current.inventory.countItem("cairn_garnet")).toBe(1);
    expect(current.quests.counter("long_cairn", "stones_given")).toBe(1);
    expect(current.store.get().dialogue?.nodeId).toBe("ode_replacement_stone");
    current.events.flush();
    expect(current.events.since(cursor).events.filter((event) =>
      event.type === "item.received" && event.data.itemId === "cairn_garnet",
    )).toHaveLength(1);
  });

  it("rejects a partial multi-item reward before counters, currency or XP change", () => {
    const current = runtime();
    current.inventory.addItem("grithe_ore", 27);
    const id = option([
      { kind: "bumpCounter", questId: "long_cairn", counter: "stones_given" },
      { kind: "grantXp", skill: "mining", amount: 100 },
      { kind: "grantCurrency", amount: 70 },
      { kind: "giveItem", itemId: "palewood_log", quantity: 2 },
    ]);
    const cursor = current.open();
    const before = current.store.snapshot();
    expect(current.dialogue.op("choose", id)).toMatchObject({ ok: false, error: { code: "INVENTORY_FULL" } });
    expect(current.store.snapshot()).toEqual(before);
    current.events.flush();
    expect(current.events.since(cursor).events).toEqual([]);
  });

  it("reserves capacity across separate grants before committing either", () => {
    const current = runtime();
    current.inventory.addItem("grithe_ore", 27);
    const id = option([
      { kind: "setFlag", questId: "long_cairn", flag: "paid" },
      { kind: "giveItem", itemId: "palewood_log", quantity: 1 },
      { kind: "giveItem", itemId: "cairn_garnet", quantity: 1 },
    ]);
    current.open();
    const before = current.store.snapshot();
    expect(current.dialogue.op("choose", id)).toMatchObject({ ok: false, error: { code: "INVENTORY_FULL" } });
    expect(current.store.snapshot()).toEqual(before);
  });

  it("allows an ordered handover to free a slot before the replacement arrives", () => {
    const current = runtime();
    current.inventory.addItem("grithe_ore", 28);
    const id = option([
      { kind: "takeItem", itemId: "grithe_ore", quantity: 1 },
      { kind: "giveItem", itemId: "cairn_garnet", quantity: 1 },
      { kind: "bumpCounter", questId: "long_cairn", counter: "stones_given" },
    ]);
    const cursor = current.open();
    expect(current.dialogue.op("choose", id).ok).toBe(true);
    expect(current.inventory.countItem("grithe_ore")).toBe(27);
    expect(current.inventory.countItem("cairn_garnet")).toBe(1);
    expect(current.quests.counter("long_cairn", "stones_given")).toBe(1);
    current.events.flush();
    expect(current.events.since(cursor).events.filter((event) =>
      event.type === "item.lost" || event.type === "item.received",
    ).map((event) => [event.type, event.data.itemId, event.data.quantity])).toEqual([
      ["item.lost", "grithe_ore", 1], ["item.received", "cairn_garnet", 1],
    ]);
  });

  it("does not count a partially consumed stack as a free slot", () => {
    const current = runtime();
    current.inventory.addItem("pale_quartz", 2);
    current.inventory.addItem("grithe_ore", 27);
    const id = option([
      { kind: "takeItem", itemId: "pale_quartz", quantity: 1 },
      { kind: "giveItem", itemId: "cairn_garnet", quantity: 1 },
    ]);
    current.open();
    const before = current.store.snapshot();
    expect(current.dialogue.op("choose", id)).toMatchObject({ ok: false, error: { code: "INVENTORY_FULL" } });
    expect(current.store.snapshot()).toEqual(before);
  });

  it("rejects cumulative takes without consuming the first payment", () => {
    const current = runtime();
    current.inventory.addItem("grithe_ore", 1);
    const id = option([
      { kind: "takeItem", itemId: "grithe_ore", quantity: 1 },
      { kind: "takeItem", itemId: "grithe_ore", quantity: 1 },
    ]);
    current.open();
    const before = current.store.snapshot();
    expect(current.dialogue.op("choose", id)).toMatchObject({ ok: false, error: { code: "NOT_ENOUGH_ITEMS" } });
    expect(current.store.snapshot()).toEqual(before);
  });

  it("keeps ordinary quest acceptance available when its starting grant must wait", () => {
    const current = runtime();
    current.inventory.addItem("grithe_ore", 28);
    expect(current.dialogue.open("npc_seamer_juno", "juno_parts_offer").ok).toBe(true);
    expect(current.dialogue.op("choose", "juno_parts_offer#accept").ok).toBe(true);
    expect(current.quests.status("knots_and_names")).toBe("active");
    expect(current.quests.counter("knots_and_names", "pending:pale_quartz")).toBe(3);
    expect(current.inventory.countItem("pale_quartz")).toBe(0);
  });

  it("accounts for a first quest-start grant before a later direct item grant", () => {
    const current = runtime();
    current.inventory.addItem("grithe_ore", 27);
    const id = option([
      { kind: "startQuest", questId: "knots_and_names" },
      { kind: "giveItem", itemId: "cairn_garnet", quantity: 1 },
    ]);
    current.open();
    const before = current.store.snapshot();
    expect(current.dialogue.op("choose", id)).toMatchObject({ ok: false, error: { code: "INVENTORY_FULL" } });
    expect(current.store.snapshot()).toEqual(before);
    expect(current.quests.status("knots_and_names")).toBe("unstarted");
  });

  it("rejects an unavailable quest start before consuming a preceding payment", () => {
    const current = runtime();
    current.inventory.addItem("grithe_ore", 1);
    const id = option([
      { kind: "takeItem", itemId: "grithe_ore", quantity: 1 },
      { kind: "startQuest", questId: "sparking_stone" },
    ]);
    current.open();
    const before = current.store.snapshot();
    expect(current.dialogue.op("choose", id)).toMatchObject({ ok: false, error: { code: "REQUIREMENTS_NOT_MET" } });
    expect(current.store.snapshot()).toEqual(before);
  });

  it.each(["active", "complete"] as const)("does not replay a starting grant for an %s quest", (status) => {
    const current = runtime();
    current.store.get().quests.knots_and_names = { status, stage: 0, counters: {}, flags: {} };
    current.inventory.addItem("grithe_ore", 27);
    const id = option([
      { kind: "startQuest", questId: "knots_and_names" },
      { kind: "giveItem", itemId: "cairn_garnet", quantity: 1 },
    ]);
    current.open();
    expect(current.dialogue.op("choose", id).ok).toBe(true);
    expect(current.inventory.countItem("cairn_garnet")).toBe(1);
    expect(current.inventory.countItem("pale_quartz")).toBe(0);
    expect(current.quests.status("knots_and_names")).toBe(status);
  });
});
