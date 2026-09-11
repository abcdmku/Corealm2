import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SkillId, Vec3 } from "../game/src/contracts.js";
import { content } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { findLocation } from "../game/src/content/regions.js";
import { EventBus } from "../game/src/core/events.js";
import { SimClock } from "../game/src/core/time.js";
import { SaveService } from "../game/src/persistence/storage.js";
import { addSkillXp, Store, type GameState } from "../game/src/state/store.js";
import { DialogueSystem } from "../game/src/systems/dialogue.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { QuestSystem } from "../game/src/systems/quests.js";
import { EntityStore } from "../game/src/world/entities.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const ELEVEN = "eleven_empty_days";
const TRAP_LINE = ["blackwater_pools", "gorge_head", "thornline_camp", "gorge_ford"] as const;
const REVERSED = [...TRAP_LINE].reverse();
const systems: QuestSystem[] = [];

beforeEach(() => content.register({ items: ALL_ITEMS }));
afterEach(() => {
  for (const quests of systems.splice(0)) quests.dispose();
});

function location(id: string) {
  const entry = findLocation(id);
  if (!entry) throw new Error(`Missing production location ${id}`);
  return entry;
}

function visitFlag(locationId: string, stage = 0) {
  return `@visit:${JSON.stringify([stage, locationId])}`;
}

function runtime(saved?: GameState) {
  const store = new Store(439, 0);
  if (saved) store.replace(saved);
  else store.get().inventory.slots.fill(null);
  const events = new EventBus();
  const clock = new SimClock();
  const skillLevels = () => Object.fromEntries(
    Object.entries(store.get().skills).map(([id, skill]) => [id, skill.level]),
  ) as Record<SkillId, number>;
  const entities = new EntityStore({ skillLevels });
  const rootfall = location("rootfall_hamlet");
  const mottPosition: Vec3 = [rootfall.location.position[0], 0, rootfall.location.position[1]];
  entities.load([
    {
      id: "npc_trapper_mott", name: "Trapper Mott", archetype: "npc", tier: 1,
      regionId: rootfall.regionId, position: mottPosition, state: "idle", interactions: ["talk"],
    },
    ...(["fen_crawler", "blind_cave_weaver"] as const).map((family) => ({
      id: `test_${family}`, name: family, archetype: "enemy" as const, tier: 1,
      regionId: "vellenwood" as const, position: [0, 0, 0] as Vec3,
      state: "alive", interactions: ["attack" as const], meta: { family },
    })),
  ]);
  const dispatcher = new InteractionDispatcher({
    get: (id) => entities.get(id), playerPosition: () => store.get().player.position, skillLevels,
  });
  const inventory = new InventorySystem({ store, events, now: () => clock.elapsedMs });
  const xp = {
    award(skill: SkillId, amount: number) {
      const gained = addSkillXp(store.get(), skill, amount);
      if (gained.levelsGained > 0) events.emit("level.gained", {
        skill, level: gained.newLevel, levelsGained: gained.levelsGained,
      }, undefined, clock.elapsedMs);
      store.markDirty();
    },
  };
  const quests = new QuestSystem({ store, events, clock, entities, inventory, xp, dispatcher });
  systems.push(quests);
  const dialogue = new DialogueSystem({ store, events, clock, entities, inventory, xp, quests, dispatcher });
  const tick = (count = 5) => {
    for (let index = 0; index < count; index += 1) {
      clock.commitTick();
      quests.tick(100, clock.elapsedMs);
      events.flush();
    }
  };
  const visit = (id: string) => {
    const entry = location(id);
    store.get().player.position = [entry.location.position[0], 0, entry.location.position[1]];
    store.get().player.regionId = entry.regionId;
    tick();
  };
  const kill = (family: "fen_crawler" | "blind_cave_weaver", count = 1) => {
    for (let index = 0; index < count; index += 1) {
      events.emit("combat.ended", { reason: "killed", enemyId: `test_${family}` }, `test_${family}`, clock.elapsedMs);
    }
    events.flush();
    tick();
  };
  const talkToMott = () => {
    store.get().player.position = [...mottPosition];
    store.get().player.regionId = rootfall.regionId;
    expect(dispatcher.run("npc_trapper_mott", "talk").ok).toBe(true);
  };
  const accept = () => {
    talkToMott();
    expect(dialogue.op("choose", "mott_root#offer").ok).toBe(true);
    expect(dialogue.op("choose", "mott_line_offer#accept").ok).toBe(true);
  };
  return { store, events, entities, inventory, quests, dialogue, tick, visit, kill, talkToMott, accept };
}

function reload(previous: ReturnType<typeof runtime>) {
  const saves = new SaveService(false);
  const loaded = saves.deserialize(saves.serialize(previous.store.get()));
  expect(loaded.status).toBe("loaded");
  if (!loaded.state) throw new Error(loaded.reason ?? "Missing loaded state");
  previous.quests.dispose();
  return runtime(loaded.state);
}

describe("persistent quest visits", () => {
  it.each(["hog", "beetle_golem"])("retains two earned bait kills from a %s save and requires one new Fen Crawler", (oldFamily) => {
    const first = runtime();
    first.store.get().quests[ELEVEN] = { status: "active", stage: 1, counters: {
      [`kill:${oldFamily}`]: 7, [`@base:kill:${oldFamily}`]: 5,
    }, flags: { walked_the_line: true } };
    const second = reload(first);
    second.tick();
    expect(second.quests.stage(ELEVEN)).toBe(1);
    expect(second.quests.counter(ELEVEN, "kill:fen_crawler")).toBe(7);
    expect(second.quests.counter(ELEVEN, "@base:kill:fen_crawler")).toBe(5);
    second.kill("fen_crawler");
    expect(second.quests.stage(ELEVEN)).toBe(2);
    expect(second.store.get().skills.melee.xp).toBe(150);
  });

  it("completes Mott's circuit in reverse order across a reload, then counts only new Fen Crawler kills", () => {
    const first = runtime();
    first.accept();
    first.kill("fen_crawler", 2);
    for (const id of REVERSED.slice(0, 2)) first.visit(id);
    expect(first.quests.stage(ELEVEN)).toBe(0);
    for (const id of REVERSED.slice(0, 2)) expect(first.quests.flag(ELEVEN, visitFlag(id))).toBe(true);
    for (const id of REVERSED.slice(2)) expect(first.quests.flag(ELEVEN, visitFlag(id))).toBe(false);
    expect(first.store.get().skills.agility.xp).toBe(0);

    const second = reload(first);
    for (const id of REVERSED.slice(0, 2)) expect(second.quests.flag(ELEVEN, visitFlag(id))).toBe(true);
    for (const id of REVERSED.slice(2)) second.visit(id);
    expect(second.quests.stage(ELEVEN)).toBe(1);
    expect(second.store.get().skills.agility.xp).toBe(90);
    expect(second.quests.flag(ELEVEN, "walked_the_line")).toBe(true);
    expect(second.quests.counter(ELEVEN, "kill:fen_crawler")).toBe(2);
    for (const id of TRAP_LINE) second.visit(id);
    second.tick(20);
    expect(second.quests.stage(ELEVEN)).toBe(1);
    expect(second.store.get().skills.agility.xp).toBe(90);
    for (const id of TRAP_LINE) expect(second.quests.flag(ELEVEN, visitFlag(id, 1))).toBe(false);

    second.kill("fen_crawler", 2);
    expect(second.quests.stage(ELEVEN)).toBe(1);
    second.kill("fen_crawler");
    expect(second.quests.stage(ELEVEN)).toBe(2);
    expect(second.store.get().skills.melee.xp).toBe(150);
    second.talkToMott();
    expect(second.dialogue.op("choose", "mott_root#report").ok).toBe(true);
    expect(second.dialogue.op("choose", "mott_report#truth").ok).toBe(true);
    expect(second.quests.status(ELEVEN)).toBe("complete");
    expect(second.store.get().skills.agility.xp).toBe(210);
    expect(second.store.get().skills.melee.xp).toBe(350);
    expect(second.store.get().currency).toBe(420);
    expect(second.inventory.countItem("seared_trout")).toBe(5);
    const rewards = structuredClone(second.store.get().skills);

    for (const id of REVERSED) second.visit(id);
    second.kill("fen_crawler", 3);
    const third = reload(second);
    for (const id of TRAP_LINE) third.visit(id);
    third.tick(20);
    expect(third.quests.status(ELEVEN)).toBe("complete");
    expect(third.store.get().skills).toEqual(rewards);
    expect(third.store.get().currency).toBe(420);
    expect(third.inventory.countItem("seared_trout")).toBe(5);
  });

  it("records later leaves of the all predicate before earlier stops have been visited", () => {
    const current = runtime();
    current.accept();
    const mixedOrder = ["thornline_camp", "gorge_ford", "blackwater_pools", "gorge_head"];
    for (const [index, id] of mixedOrder.entries()) {
      current.visit(id);
      expect(current.quests.flag(ELEVEN, visitFlag(id))).toBe(true);
      expect(current.quests.stage(ELEVEN)).toBe(index === mixedOrder.length - 1 ? 1 : 0);
    }
    expect(current.store.get().skills.agility.xp).toBe(90);
  });

  it("does not credit trips made before accepting the quest", () => {
    const current = runtime();
    for (const id of TRAP_LINE) current.visit(id);
    expect(current.quests.status(ELEVEN)).toBe("unstarted");
    current.accept();
    current.tick();
    expect(current.quests.stage(ELEVEN)).toBe(0);
    for (const id of TRAP_LINE) expect(current.quests.flag(ELEVEN, visitFlag(id))).toBe(false);
    current.visit("gorge_ford");
    expect(current.quests.flag(ELEVEN, visitFlag("gorge_ford"))).toBe(true);
    expect(current.quests.stage(ELEVEN)).toBe(0);
  });

  it("does not collect visits from an inactive stage", () => {
    const current = runtime();
    expect(current.quests.setStage(ELEVEN, 1).ok).toBe(true);
    for (const id of TRAP_LINE) current.visit(id);
    expect(current.quests.stage(ELEVEN)).toBe(1);
    for (const id of TRAP_LINE) {
      expect(current.quests.flag(ELEVEN, visitFlag(id))).toBe(false);
      expect(current.quests.flag(ELEVEN, visitFlag(id, 1))).toBe(false);
    }
  });

  it("ignores dead players and the same coordinates in another region", () => {
    const current = runtime();
    current.accept();
    current.store.get().player.health = 0;
    current.visit("blackwater_pools");
    expect(current.quests.flag(ELEVEN, visitFlag("blackwater_pools"))).toBe(false);
    current.store.get().player.health = current.store.get().player.maxHealth;
    current.store.get().player.regionId = "fallowmarch";
    current.tick();
    expect(current.quests.flag(ELEVEN, visitFlag("blackwater_pools"))).toBe(false);
    current.store.get().player.regionId = "vellenwood";
    current.tick();
    expect(current.quests.flag(ELEVEN, visitFlag("blackwater_pools"))).toBe(true);
  });

  it("uses a canonical marker's region and full 3D distance instead of the authored XZ fallback", () => {
    const current = runtime();
    const markerPosition: Vec3 = [800, -24, 900];
    current.entities.add({
      id: "gorge_ford_marker", name: "Gorge Ford marker", archetype: "landmark", tier: 1,
      regionId: "vellenwood", position: markerPosition, state: "ready", interactions: ["inspect"],
    });
    current.accept();
    current.visit("gorge_ford");
    expect(current.quests.flag(ELEVEN, visitFlag("gorge_ford"))).toBe(false);
    current.store.get().player.position = [800, -9.99, 900];
    current.tick();
    expect(current.quests.flag(ELEVEN, visitFlag("gorge_ford"))).toBe(false);
    current.store.get().player.position = markerPosition;
    current.store.get().player.regionId = "gravelmaw";
    current.tick();
    expect(current.quests.flag(ELEVEN, visitFlag("gorge_ford"))).toBe(false);
    current.store.get().player.regionId = "vellenwood";
    current.store.get().player.position = [800, -10, 900];
    current.tick();
    expect(current.quests.flag(ELEVEN, visitFlag("gorge_ford"))).toBe(true);
  });
});

describe("current-location quest requirements", () => {
  it("still requires a return to the Long Cairn chamber after its kill requirement is met elsewhere", () => {
    const current = runtime();
    const chamberPosition: Vec3 = [800, -24, 900];
    current.entities.add({
      id: "gravelmaw_chamber2_marker", name: "The Collapse", archetype: "landmark", tier: 1,
      regionId: "gravelmaw", position: chamberPosition, state: "ready", interactions: ["inspect"],
    });
    expect(current.quests.setStage("long_cairn", 3).ok).toBe(true);
    current.store.get().player.position = chamberPosition;
    current.store.get().player.regionId = "gravelmaw";
    current.tick();
    expect(current.quests.stage("long_cairn")).toBe(3);
    current.store.get().player.position = [900, -24, 900];
    current.kill("blind_cave_weaver", 4);
    expect(current.quests.stage("long_cairn")).toBe(3);
    expect(current.quests.flag("long_cairn", visitFlag("gravelmaw_chamber2", 3))).toBe(false);
    current.store.get().player.position = [800, 0, 900];
    current.tick();
    expect(current.quests.stage("long_cairn")).toBe(3);
    current.store.get().player.position = chamberPosition;
    current.tick();
    expect(current.quests.stage("long_cairn")).toBe(4);
  });
});
