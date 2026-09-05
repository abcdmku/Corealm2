import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillId } from "../game/src/contracts.js";
import { content } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { EventBus } from "../game/src/core/events.js";
import { SimClock } from "../game/src/core/time.js";
import { addSkillXp, Store } from "../game/src/state/store.js";
import { DeathSystem } from "../game/src/systems/death.js";
import { DeferredDialogueSystem } from "../game/src/systems/deferredDialogue.js";
import { DialogueSystem } from "../game/src/systems/dialogue.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { QuestSystem } from "../game/src/systems/quests.js";
import { EntityStore } from "../game/src/world/entities.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const BEL = "npc_carter_bel";
const ILSE = "npc_warden_ilse";
const dispose: Array<() => void> = [];
type DialogueModule = { DialogueSystem: typeof DialogueSystem };

beforeEach(() => {
  vi.useFakeTimers();
  content.register({ items: ALL_ITEMS });
});

afterEach(() => {
  for (const cleanup of dispose.splice(0)) cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

function pendingModule() {
  let resolve!: (module: DialogueModule) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<DialogueModule>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve: () => resolve({ DialogueSystem }), reject };
}

function runtime(loader: () => Promise<DialogueModule>) {
  const store = new Store(433, 0);
  store.get().player.position = [0, 0, 0];
  const events = new EventBus();
  const clock = new SimClock();
  const skillLevels = () => Object.fromEntries(
    Object.entries(store.get().skills).map(([id, skill]) => [id, skill.level]),
  ) as Record<SkillId, number>;
  const entities = new EntityStore({ skillLevels });
  entities.load([
    {
      id: BEL, name: "Carter Bel", archetype: "npc", tier: 1, state: "idle",
      position: [0, 0, 0], regionId: "fallowmarch", interactions: ["talk"],
    },
    {
      id: ILSE, name: "Warden Ilse", archetype: "npc", tier: 1, state: "idle",
      position: [1, 0, 0], regionId: "fallowmarch", interactions: ["talk"],
    },
  ]);
  const dispatcher = new InteractionDispatcher({
    get: (id) => entities.get(id), playerPosition: () => store.get().player.position, skillLevels,
  });
  const inventory = new InventorySystem({ store, events, now: () => clock.elapsedMs });
  const xp = { award: (skill: SkillId, amount: number) => { addSkillXp(store.get(), skill, amount); } };
  const quests = new QuestSystem({ store, events, clock, entities, inventory, xp, dispatcher });
  const dialogue = new DeferredDialogueSystem({ store, events, clock, entities, inventory, xp, quests, dispatcher }, loader);
  dispose.push(() => { dialogue.dispose(); quests.dispose(); });
  return { store, events, entities, dispatcher, inventory, quests, dialogue };
}

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

function expectLoading(current: ReturnType<typeof runtime>, npcId = BEL) {
  expect(current.store.get().dialogue).toMatchObject({ npcId, text: expect.stringMatching(/loading/i) });
  expect(current.store.get().dialogue?.options).toContainEqual(expect.objectContaining({
    id: "deferred-dialogue:leave", enabled: true,
  }));
}

describe("deferred production dialogue", () => {
  it("does not import until a valid talk interaction", async () => {
    const pending = pendingModule();
    const loader = vi.fn(() => pending.promise);
    const current = runtime(loader);
    expect(loader).not.toHaveBeenCalled();
    expect(current.dialogue.op("state")).toEqual({ ok: true, value: null });
    current.dialogue.op("end");
    current.dialogue.op("choose", "bel_root#offer");
    current.store.get().player.position = [100, 0, 0];
    expect(current.dispatcher.run(BEL, "talk")).toMatchObject({ ok: false, error: { code: "OUT_OF_RANGE" } });
    await settle();
    expect(loader).not.toHaveBeenCalled();
    expect(current.store.get().dialogue).toBeNull();
  });

  it("opens readable loading state immediately, then runs real dialogue choices and quest effects", async () => {
    const pending = pendingModule();
    const loader = vi.fn(() => pending.promise);
    const current = runtime(loader);
    expect(current.dispatcher.run(BEL, "talk").ok).toBe(true);
    expectLoading(current);
    expect(current.quests.status("the_carters_wager")).toBe("unstarted");
    current.events.flush();
    expect(current.events.since(0, ["dialogue.opened"]).events).toContainEqual(expect.objectContaining({
      entityId: BEL, data: expect.objectContaining({ npcId: BEL }),
    }));
    expect(current.dialogue.op("state")).toMatchObject({ ok: true, value: { npcId: BEL } });
    await settle();
    expect(loader).toHaveBeenCalledTimes(1);

    pending.resolve();
    await settle();
    expect(current.store.get().dialogue?.nodeId).toBe("bel_root");
    expect(current.dialogue.op("choose", "bel_root#offer").ok).toBe(true);
    expect(current.dialogue.op("choose", "bel_wager_offer#accept").ok).toBe(true);
    expect(current.quests.status("the_carters_wager")).toBe("active");
    expect(current.store.get().dialogue?.nodeId).toBe("bel_wager_accepted");
    expect(current.dialogue.op("end").ok).toBe(true);
    expect(current.dispatcher.run(ILSE, "talk").ok).toBe(true);
    expect(current.store.get().dialogue?.nodeId).toBe("ilse_root");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("shares one import across rapid NPC switches and opens only the latest request", async () => {
    const pending = pendingModule();
    const loader = vi.fn(() => pending.promise);
    const current = runtime(loader);
    expect(current.dispatcher.run(BEL, "talk").ok).toBe(true);
    expect(current.dispatcher.run(ILSE, "talk").ok).toBe(true);
    expectLoading(current, ILSE);
    await settle();
    expect(loader).toHaveBeenCalledTimes(1);
    pending.resolve();
    await settle();
    expect(current.store.get().dialogue).toMatchObject({ npcId: ILSE, nodeId: "ilse_root" });
    current.events.flush();
    const opened = current.events.since(0, ["dialogue.opened"]).events;
    expect(opened.filter((event) => event.data.nodeId === "bel_root")).toEqual([]);
    expect(opened.filter((event) => event.data.nodeId === "ilse_root")).toHaveLength(1);
  });

  it.each(["end", "leave"] as const)("does not reopen after %s while loading", async (action) => {
    const pending = pendingModule();
    const current = runtime(() => pending.promise);
    current.dispatcher.run(BEL, "talk");
    const result = action === "end"
      ? current.dialogue.op("end")
      : current.dialogue.op("choose", "deferred-dialogue:leave");
    expect(result.ok).toBe(true);
    expect(current.store.get().dialogue).toBeNull();
    pending.resolve();
    await settle();
    expect(current.store.get().dialogue).toBeNull();
    current.events.flush();
    expect(current.events.since(0, ["dialogue.opened"]).events.some((event) => event.data.nodeId === "bel_root")).toBe(false);
  });

  it.each(["end", "leave", "walkaway"] as const)("keeps a new NPC request when an earlier %s queues a panel-close event", async (action) => {
    // PanelFrame invokes the dialogue End operation when it closes. Exercise that feedback through
    // the real event queue, including the former unconditional consumer as a negative control.
    for (const guardClose of [false, true]) {
      const pending = pendingModule();
      const loader = vi.fn(() => pending.promise);
      const current = runtime(loader);
      let panelOpen = false;
      const closePanel = vi.fn(() => {
        if (!panelOpen) return;
        panelOpen = false;
        current.dialogue.op("end");
      });
      const unsubscribe = current.events.subscribe((event) => {
        if (event.type === "dialogue.opened") {
          const view = current.dialogue.op("state");
          panelOpen = view.ok && view.value !== null;
        } else if (event.type === "dialogue.closed" && (!guardClose || !current.store.get().dialogue)) {
          closePanel();
        }
      });
      dispose.push(unsubscribe);

      current.dispatcher.run(BEL, "talk");
      current.events.flush();
      expect(panelOpen).toBe(true);
      if (action === "end") current.dialogue.op("end");
      else if (action === "leave") current.dialogue.op("choose", "deferred-dialogue:leave");
      else {
        current.store.get().player.position = [100, 0, 0];
        await vi.advanceTimersByTimeAsync(100);
        current.store.get().player.position = [0, 0, 0];
      }
      expect(current.store.get().dialogue).toBeNull();
      expect(panelOpen).toBe(true);
      expect(current.dispatcher.run(ILSE, "talk").ok).toBe(true);
      expectLoading(current, ILSE);

      current.events.flush();
      if (guardClose) {
        expectLoading(current, ILSE);
        expect(closePanel).not.toHaveBeenCalled();
      } else {
        expect(current.store.get().dialogue).toBeNull();
        expect(closePanel).toHaveBeenCalled();
      }
      pending.resolve();
      await settle();
      current.events.flush();
      expect(loader).toHaveBeenCalledTimes(1);
      if (guardClose) {
        expect(current.store.get().dialogue).toMatchObject({ npcId: ILSE, nodeId: "ilse_root" });
        expect(panelOpen).toBe(true);
        current.dialogue.op("end");
        current.events.flush();
        expect(closePanel).toHaveBeenCalledTimes(1);
      } else {
        expect(current.store.get().dialogue).toBeNull();
      }
      expect(panelOpen).toBe(false);
    }
  });

  it("cancels a walk away even when the player returns before the import finishes", async () => {
    const pending = pendingModule();
    const current = runtime(() => pending.promise);
    current.dispatcher.run(BEL, "talk");
    current.store.get().player.position = [current.dispatcher.rangeFor("talk") + 1, 0, 0];
    await vi.advanceTimersByTimeAsync(100);
    expect(current.store.get().dialogue).toBeNull();
    current.store.get().player.position = [0, 0, 0];
    pending.resolve();
    await settle();
    expect(current.store.get().dialogue).toBeNull();
    expect(current.dispatcher.run(BEL, "talk").ok).toBe(true);
    await settle();
    expect(current.store.get().dialogue?.nodeId).toBe("bel_root");
  });

  it.each(["death", "region change", "NPC removed", "NPC replaced"])("invalidates pending talk after %s", async (reason) => {
    const pending = pendingModule();
    const current = runtime(() => pending.promise);
    current.dispatcher.run(BEL, "talk");
    if (reason === "death") current.store.get().player.health = 0;
    if (reason === "region change") current.store.get().player.regionId = "karrowmoor";
    if (reason === "NPC removed") current.entities.remove(BEL);
    if (reason === "NPC replaced") {
      const original = current.entities.get(BEL);
      if (!original) throw new Error("Missing Carter Bel fixture");
      current.entities.add({ ...original });
    }
    expect(current.dialogue.op("state")).toEqual({ ok: true, value: null });
    expect(current.store.get().dialogue).toBeNull();
    pending.resolve();
    await settle();
    expect(current.store.get().dialogue).toBeNull();
  });

  it("cancels on death even when production respawn restores health and returns to the NPC", async () => {
    const pending = pendingModule();
    const current = runtime(() => pending.promise);
    current.dispatcher.run(BEL, "talk");
    const death = new DeathSystem({
      store: current.store, events: current.events, entities: current.entities,
      inventory: current.inventory, dispatcher: current.dispatcher,
      respawn: { resolve: () => ({ position: [0, 0, 0], regionId: "fallowmarch" }) },
    });
    current.store.get().player.health = 0;
    death.tick(100, 100);
    expect(current.store.get().player.health).toBe(current.store.get().player.maxHealth);
    current.events.flush();
    expect(current.store.get().dialogue).toBeNull();
    pending.resolve();
    await settle();
    expect(current.store.get().dialogue).toBeNull();
  });

  it("does not write an old request into replacement state", async () => {
    const pending = pendingModule();
    const current = runtime(() => pending.promise);
    current.dispatcher.run(BEL, "talk");
    const replacement = current.store.snapshot();
    replacement.dialogue = null;
    current.store.replace(replacement);
    pending.resolve();
    await settle();
    expect(current.store.get()).toBe(replacement);
    expect(current.store.get().dialogue).toBeNull();
  });

  it("preserves a newer conversation object when the pending request becomes stale", async () => {
    const pending = pendingModule();
    const current = runtime(() => pending.promise);
    current.dispatcher.run(BEL, "talk");
    const replacement = {
      npcId: ILSE, nodeId: "ilse_root", speaker: "Warden Ilse", text: "A newer conversation.", options: [],
    };
    current.store.get().dialogue = replacement;
    pending.resolve();
    await settle();
    expect(current.store.get().dialogue).toBe(replacement);
  });

  it.each(["rejection", "synchronous throw"])("shows retry and leave after loader %s, then retries successfully", async (failure) => {
    const pending = pendingModule();
    const retry = pendingModule();
    const loader = vi.fn(() => retry.promise);
    loader.mockImplementationOnce(() => {
      if (failure === "synchronous throw") throw new Error("Chunk unavailable");
      return pending.promise;
    });
    const current = runtime(loader);
    expect(current.dispatcher.run(BEL, "talk").ok).toBe(true);
    if (failure === "rejection") pending.reject(new Error("Chunk unavailable"));
    await settle();
    expect(current.store.get().dialogue).toMatchObject({ npcId: BEL, text: expect.stringMatching(/load|retry|try again|unavailable|failed/i) });
    expect(current.store.get().dialogue?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "deferred-dialogue:retry", enabled: true }),
      expect.objectContaining({ id: "deferred-dialogue:leave", enabled: true }),
    ]));
    expect(current.dialogue.op("choose", "deferred-dialogue:retry").ok).toBe(true);
    expectLoading(current);
    await settle();
    expect(loader).toHaveBeenCalledTimes(2);
    retry.resolve();
    await settle();
    expect(current.store.get().dialogue?.nodeId).toBe("bel_root");
  });

  it("keeps a readable failure after repeated retries when the real service cannot open an NPC node", async () => {
    const pending = pendingModule();
    const loader = vi.fn(() => pending.promise);
    const current = runtime(loader);
    const npc = current.entities.get(BEL);
    if (!npc) throw new Error("Missing Carter Bel fixture");
    npc.npc = { dialogueRootId: "unavailable_dialogue_root", questIds: [] };
    expect(current.dispatcher.run(BEL, "talk").ok).toBe(true);
    pending.resolve();
    await settle();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(current.store.get().dialogue).toMatchObject({
        npcId: BEL, text: expect.stringMatching(/could not|failed|unavailable/i),
        options: expect.arrayContaining([
          expect.objectContaining({ id: "deferred-dialogue:retry", enabled: true }),
          expect.objectContaining({ id: "deferred-dialogue:leave", enabled: true }),
        ]),
      });
      current.dialogue.op("choose", "deferred-dialogue:retry");
      await settle();
    }
    expect(loader).toHaveBeenCalledTimes(1);
    expect(current.store.get().dialogue?.text).toMatch(/could not|failed|unavailable/i);
    expect(current.dialogue.op("choose", "deferred-dialogue:leave").ok).toBe(true);
    expect(current.store.get().dialogue).toBeNull();
  });

  it("attributes a shared import failure to the latest NPC request and preserves its retry", async () => {
    const pending = pendingModule();
    const retry = pendingModule();
    const loader = vi.fn(() => retry.promise).mockImplementationOnce(() => pending.promise);
    const current = runtime(loader);
    current.dispatcher.run(BEL, "talk");
    current.dispatcher.run(ILSE, "talk");
    pending.reject(new Error("Chunk unavailable"));
    await settle();
    expect(current.store.get().dialogue).toMatchObject({ npcId: ILSE, speaker: "Warden Ilse" });
    expect(current.dialogue.op("choose", "deferred-dialogue:retry").ok).toBe(true);
    expectLoading(current, ILSE);
    retry.resolve();
    await settle();
    expect(current.store.get().dialogue).toMatchObject({ npcId: ILSE, nodeId: "ilse_root" });
  });

  it("does not show a stale failure after a newer conversation replaces loading state", async () => {
    const pending = pendingModule();
    const current = runtime(() => pending.promise);
    current.dispatcher.run(BEL, "talk");
    const replacement = {
      npcId: ILSE, nodeId: "ilse_root", speaker: "Warden Ilse", text: "A newer conversation.", options: [],
    };
    current.store.get().dialogue = replacement;
    pending.reject(new Error("Chunk unavailable"));
    await settle();
    expect(current.store.get().dialogue).toBe(replacement);
  });

  it("cancels pending work when disposed", async () => {
    const pending = pendingModule();
    const current = runtime(() => pending.promise);
    current.dispatcher.run(BEL, "talk");
    current.dialogue.dispose();
    pending.resolve();
    await settle();
    expect(current.store.get().dialogue).toBeNull();
  });
});
