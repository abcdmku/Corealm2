import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  EquipmentBonuses, GameApi, SemanticEntity, SkillId,
} from "../game/src/contracts.js";
import { SKILL_IDS, err, ok } from "../game/src/contracts.js";
import { CorealmGameApi } from "../game/src/api/gameApi.js";
import { createTools, type ToolDef } from "../game/src/agent/tools.js";
import { EVENT_CATALOGUE } from "../game/src/agent/manual.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { content, type ContentTables } from "../game/src/content/index.js";
import { SPELLS } from "../game/src/content/spells.js";
import { EventBus } from "../game/src/core/events.js";
import { RngStreams } from "../game/src/core/rng.js";
import { SimClock } from "../game/src/core/time.js";
import type { Navigation } from "../game/src/systems/navigation.js";
import type { Movement } from "../game/src/systems/movement.js";
import { Store, setSkillLevel } from "../game/src/state/store.js";
import { CombatSystem } from "../game/src/systems/combat.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const originalContent: ContentTables = {
  items: [...content.allItems()],
  resources: [...content.allResources()],
  recipes: [...content.allRecipes()],
  spells: [...content.allSpells()],
  enemies: [...content.allEnemies()],
  shops: [...content.allShops()],
};

beforeAll(() => {
  content.register({ items: ALL_ITEMS, spells: SPELLS });
});

afterAll(() => {
  content.register(originalContent);
});

const NO_BONUSES: EquipmentBonuses = {
  meleeAccuracy: 0,
  meleePower: 0,

  magicAccuracy: 0,
  magicPower: 0,
  defence: 0,
  health: 0, vitality: 0 };

function findTool(tools: ToolDef[], name: string): ToolDef {
  const found = tools.find((tool) => tool.name === name);
  if (!found) throw new Error(`Missing tool ${name}`);
  return found;
}

function levels(store: Store): Record<SkillId, number> {
  const result = {} as Record<SkillId, number>;
  for (const id of SKILL_IDS) result[id] = store.get().skills[id].level;
  return result;
}

function target(): SemanticEntity {
  return {
    id: "magic_tool_target",
    archetype: "enemy",
    name: "Training Target",
    tier: 1,
    regionId: "fallowmarch",
    position: [0, 0, 5],
    state: "alive",
    interactions: ["attack", "cast"],
    combat: { health: 10_000, maxHealth: 10_000, level: 1, aggroRadius: 0 },
  };
}

function magicCommandRuntime() {
  const store = new Store(417, 0);
  setSkillLevel(store.get(), "magic", 99);
  const enemy = target();
  const events = new EventBus();
  const clock = new SimClock();
  const dispatcher = new InteractionDispatcher({
    get: (id) => id === enemy.id ? enemy : undefined,
    playerPosition: () => store.get().player.position,
    skillLevels: () => levels(store),
  });
  const combat = new CombatSystem({
    store,
    events,
    rng: new RngStreams(417),
    entities: {
      get: (id) => id === enemy.id ? enemy : undefined,
      all: () => [enemy],
    },
    equipment: {
      totals: () => NO_BONUSES,
      slots: () => store.get().equipment,
    },
    inventory: {
      addItem: (_itemId, quantity) => ok(quantity),
      removeItem: (_itemId, quantity) => ok(quantity),
      countItem: () => 0,
      freeSlots: () => 28,
      hasRoomFor: () => true,
    },
    dispatcher,
  });
  const api = new CorealmGameApi(
    store,
    events,
    {} as Navigation,
    {} as Movement,
    clock,
  );
  api.register("combat", combat.hook());
  return { api, enemy, store, tool: findTool(createTools(api), "corealm_attack") };
}

describe("magic agent command validation", () => {
  it("does not turn an automatic magic attack into a melee swing when no spell is compatible", async () => {
    const { enemy, store, tool } = magicCommandRuntime();
    store.get().equipment.mainHand = { itemId: "basic_wooden_wand", quantity: 1 };
    store.get().inventory.slots = store.get().inventory.slots.map(
      (slot) => slot?.itemId === "air_essence" ? null : slot,
    );

    await expect(Promise.resolve(tool.execute({ entityId: enemy.id }))).resolves.toMatchObject({
      error: "REQUIREMENTS_NOT_MET",
      message: expect.stringMatching(/matching Essence/i),
    });
    expect(store.get().combat.targetId).toBeNull();
    expect(store.get().combat.activeSpellId).toBeNull();
  });

  it("reports each incompatible explicit-cast loadout without starting combat or spending charge", async () => {
    const { enemy, store, tool } = magicCommandRuntime();
    const cast = () => Promise.resolve(tool.execute({ entityId: enemy.id, spellId: "voltrend" }));

    store.get().equipment.mainHand = null;
    await expect(cast()).resolves.toMatchObject({
      error: "REQUIREMENTS_NOT_MET",
      message: expect.stringMatching(/wand or staff/i),
    });

    store.get().equipment.mainHand = { itemId: "basic_wooden_wand", quantity: 1 };
    store.get().inventory.slots = store.get().inventory.slots.map(
      (slot) => slot?.itemId === "air_essence" ? null : slot,
    );
    await expect(cast()).resolves.toMatchObject({
      error: "REQUIREMENTS_NOT_MET",
      message: expect.stringMatching(/Carry 1 Air Essence/i),
    });

    store.get().equipment.mainHand = { itemId: "earth_wand", quantity: 1 };
    store.get().magic.weaponCharges.earth_wand = 1_000;
    await expect(cast()).resolves.toMatchObject({
      error: "REQUIREMENTS_NOT_MET",
      message: expect.stringMatching(/Carry 1 Air Essence/i),
    });

    store.get().equipment.mainHand = { itemId: "air_wand", quantity: 1 };
    store.get().magic.weaponCharges.air_wand = 0;
    await expect(cast()).resolves.toMatchObject({
      error: "REQUIREMENTS_NOT_MET",
      message: expect.stringMatching(/Carry 1 Air Essence/i),
    });

    expect(store.get().combat.targetId).toBeNull();
    expect(store.get().combat.activeSpellId).toBeNull();
    expect(store.get().magic.weaponCharges.air_wand).toBe(0);
  });

  it("uses api.attack for an omitted spell and api.cast for an explicit spell", async () => {
    const attack = vi.fn(() => ok({ targetId: "target", attackSpeedMs: 2_200 }));
    const cast = vi.fn(() => ok({ targetId: "target", castMs: 3_000 }));
    const api = { attack, cast } as unknown as GameApi;
    const tool = findTool(createTools(api), "corealm_attack");

    await expect(Promise.resolve(tool.execute({ entityId: "target" }))).resolves.toEqual({
      targetId: "target",
      attackSpeedMs: 2_200,
    });
    await expect(Promise.resolve(tool.execute({ entityId: "target", spellId: "voltrend" }))).resolves.toEqual({
      targetId: "target",
      castMs: 3_000,
      attackSpeedMs: 3_000,
    });
    expect(attack).toHaveBeenCalledOnce();
    expect(cast).toHaveBeenCalledWith("voltrend", "target");
  });
});

describe("magic tool schemas", () => {
  it("omits any focus slot and documents weapon recharge payloads", () => {
    const tools = createTools({} as GameApi);
    const equip = findTool(tools, "corealm_equip");
    const interact = findTool(tools, "corealm_interact");

    const properties = equip.inputSchema["properties"] as Record<string, Record<string, unknown>>;
    expect(properties["unequipSlot"]?.["enum"]).not.toContain("focus");
    expect(equip.description).not.toMatch(/focus slot/i);
    expect(interact.description).toMatch(/exactly 100 matching essence/i);
    expect(interact.description).toMatch(/1000 charges/i);
    // The payload documentation moved out of the tool description and into the manual's event
    // catalogue, which is what corealm_manual {topic:"events"} renders.
    expect(EVENT_CATALOGUE["spell.launched"].fields).toContain("remainingCharges");
    expect(EVENT_CATALOGUE["essence.recharged"].fields).toContain("essenceSpent");
  });

  it("requires spellId for select while accepting an explicit null to restore automatic selection", async () => {
    const select = vi.fn(() => ok({ preferredSpellId: null }));
    const api = { setPreferredSpell: select } as unknown as GameApi;
    const spellbook = findTool(createTools(api), "corealm_spellbook");

    await expect(Promise.resolve(spellbook.execute({ op: "select" }))).resolves.toEqual({
      error: "INVALID_ARGUMENT",
      message: "spellId is required when op is select",
    });
    await expect(Promise.resolve(spellbook.execute({ op: "select", spellId: null }))).resolves.toEqual({
      preferredSpellId: null,
    });
    expect(select).toHaveBeenCalledWith(null);
  });
});

describe("routed interaction outcomes", () => {
  it("publishes the altar handler's final rejection after walking into range", () => {
    const store = new Store(731, 0);
    store.get().player.position = [0, 0, 0];
    const events = new EventBus();
    const clock = new SimClock();
    const altar: SemanticEntity = {
      id: "test_essence_altar",
      archetype: "station",
      name: "Essence Altar",
      tier: 1,
      regionId: "fallowmarch",
      position: [12, 0, 0],
      state: "available",
      interactions: ["recharge"],
    };
    const movement = {
      planPath: () => ({ points: [[0, 0, 0], [12, 0, 0]], pathLength: 12, etaMs: 3_000 }),
      startPath: () => ({ pathLength: 12, etaMs: 3_000 }),
    } as unknown as Movement;
    const nav = { isReady: () => true, planRouteVia: () => null } as unknown as Navigation;
    const api = new CorealmGameApi(store, events, nav, movement, clock);
    api.register("entities", {
      get: (id) => id === altar.id ? altar : undefined,
      all: () => [altar],
      observe: () => [],
    });
    api.register("interactions", {
      rangeFor: () => 2.4,
      run: () => err("NOT_ENOUGH_ITEMS", "Air Orb needs 100 Air Essence; you have 40.", altar.id),
    });
    const listener = vi.fn();
    api.subscribePendingResult(listener);

    expect(api.interact(altar.id, "recharge")).toEqual({
      ok: true,
      value: { started: "walking to Essence Altar" },
    });
    store.get().player.position = [...altar.position];

    const finalResult = api.resumePending();
    expect(finalResult).toEqual({
      ok: false,
      error: {
        code: "NOT_ENOUGH_ITEMS",
        message: "Air Orb needs 100 Air Essence; you have 40.",
        entityId: altar.id,
      },
    });
    expect(listener).toHaveBeenCalledWith({
      entityId: altar.id,
      interaction: "recharge",
      result: finalResult,
    });
  });
});
