import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  EquipmentBonuses, ItemId, SemanticEntity, SkillId,
} from "../game/src/contracts.js";
import { SKILL_IDS, ok } from "../game/src/contracts.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { content, type ContentTables } from "../game/src/content/index.js";
import { SPELLS } from "../game/src/content/spells.js";
import { EventBus } from "../game/src/core/events.js";
import { RngStreams } from "../game/src/core/rng.js";
import { Store } from "../game/src/state/store.js";
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
  accuracy: 0,
  power: 0,
  armour: 0,
  magicAccuracy: 0,
  magicPower: 0,
  magicArmour: 0,
  vitality: 0,
};

function enemy(id: string, position: [number, number, number]): SemanticEntity {
  return {
    id,
    archetype: "enemy",
    name: id,
    tier: 1,
    regionId: "fallowmarch",
    position,
    state: "alive",
    interactions: ["attack", "cast"],
    combat: { health: 10_000, maxHealth: 10_000, level: 1, aggroRadius: 0 },
  };
}

function skillLevels(store: Store): Record<SkillId, number> {
  const levels = {} as Record<SkillId, number>;
  for (const id of SKILL_IDS) levels[id] = store.get().skills[id].level;
  return levels;
}

function runtime(weaponItemId: ItemId, bonuses = NO_BONUSES) {
  const store = new Store(7, 0);
  const state = store.get();
  state.equipment.mainHand = { itemId: weaponItemId, quantity: 1 };
  state.magic.weaponCharges[weaponItemId] = 1_000;

  const targets = new Map<string, SemanticEntity>([
    ["target_a", enemy("target_a", [0, 0, 5])],
    ["target_b", enemy("target_b", [5, 0, 0])],
  ]);
  const events = new EventBus();
  const dispatcher = new InteractionDispatcher({
    get: (id) => targets.get(id),
    playerPosition: () => store.get().player.position,
    skillLevels: () => skillLevels(store),
  });
  const combat = new CombatSystem({
    store,
    events,
    rng: new RngStreams(7),
    entities: {
      get: (id) => targets.get(id),
      all: () => [...targets.values()],
    },
    equipment: {
      totals: () => bonuses,
      slots: () => store.get().equipment,
    },
    inventory: {
      addItem: (_itemId, quantity) => ok(quantity),
      removeItem: (itemId, quantity) => {
        let remaining = quantity;
        for (let index = 0; index < state.inventory.slots.length && remaining > 0; index += 1) {
          const stack = state.inventory.slots[index];
          if (stack?.itemId !== itemId) continue;
          const removed = Math.min(stack.quantity, remaining);
          stack.quantity -= removed;
          remaining -= removed;
          if (stack.quantity === 0) state.inventory.slots[index] = null;
        }
        return ok(quantity - remaining);
      },
      countItem: (itemId) => state.inventory.slots.reduce(
        (sum, stack) => sum + (stack?.itemId === itemId ? stack.quantity : 0),
        0,
      ),
      freeSlots: () => 28,
      hasRoomFor: () => true,
    },
    dispatcher,
  });
  return { combat, events, store, targets };
}

function tickThrough(combat: CombatSystem, lastAtMs: number): void {
  for (let atMs = 0; atMs <= lastAtMs; atMs += 100) combat.tick(100, atMs);
}

function launchTimes(events: EventBus): number[] {
  events.flush();
  return events.since(0, ["spell.launched"]).events.map((event) => event.atMs);
}

describe("magic weapon cadence", () => {
  it("caps projectile damage XP at the victim's remaining health", () => {
    const { combat, events, store, targets } = runtime('air_staff', { ...NO_BONUSES, magicPower: 300, magicAccuracy: 500 });
    targets.get('target_a')!.combat!.health = targets.get('target_a')!.combat!.maxHealth = 1;
    expect(combat.attack('target_a').ok).toBe(true);
    tickThrough(combat, 8000);
    const hits = combat.hits().filter(hit => hit.attacker === 'player' && hit.damage > 0);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.damage).toBeGreaterThan(1);
    expect(targets.get('target_a')!.state).toBe('dead');
    events.flush();
    const baseXp = events.since(0, ['spell.launched']).events.reduce((total, event) =>
      total + SPELLS.find(spell => spell.id === event.data.spellId)!.baseXp, 0);
    expect(store.get().skills.magic.xp).toBe(baseXp + 6);
  });
  it("lets the starter wand cast Voltrend by spending its starting Air Essence", () => {
    const { combat, events, store } = runtime("basic_wooden_wand");
    expect(combat.attack("target_a")).toEqual({
      ok: true,
      value: { targetId: "target_a", attackSpeedMs: 2_200 },
    });

    combat.tick(100, 0);
    events.flush();
    const launch = events.since(0, ["spell.launched"]).events[0];
    expect(launch?.data).toMatchObject({
      spellId: "voltrend",
      fuelSource: "essence",
      essenceItemId: "air_essence",
      remainingEssence: 49,
      weaponItemId: null,
      remainingCharges: null,
    });
    expect(store.get().inventory.slots.find((stack) => stack?.itemId === "air_essence")?.quantity)
      .toBe(49);
  });

  it.each([
    ["air_wand", 2_200, [0, 2_200, 4_400, 6_600]],
    ["air_staff", 3_000, [0, 3_000, 6_000]],
  ] as const)(
    "uses %s authored milliseconds without combat-tick rounding",
    (weapon, cadence, expected) => {
      const { combat, events, store } = runtime(weapon);

      const started = combat.attack("target_a");
      expect(started).toEqual({
        ok: true,
        value: { targetId: "target_a", attackSpeedMs: cadence },
      });

      tickThrough(combat, 6_600);
      expect(launchTimes(events)).toEqual([...expected]);
      expect(store.get().magic.weaponCharges[weapon]).toBe(1_000 - expected.length);
    },
  );

  it("keeps one cooldown while commands alternate between living targets", () => {
    const { combat, events, store } = runtime("air_wand");
    expect(combat.attack("target_a").ok).toBe(true);
    combat.tick(100, 0);
    expect(store.get().combat.nextAttackAtMs).toBe(2_200);

    for (let atMs = 100; atMs <= 4_400; atMs += 100) {
      combat.tick(100, atMs);
      const nextTarget = atMs % 200 === 0 ? "target_a" : "target_b";
      const switched = combat.attack(nextTarget);
      expect(switched.ok).toBe(true);

      const expectedDue = atMs < 2_200 ? 2_200 : atMs < 4_400 ? 4_400 : 6_600;
      expect(store.get().combat.nextAttackAtMs).toBe(expectedDue);
    }

    expect(launchTimes(events)).toEqual([0, 2_200, 4_400]);
    expect(store.get().magic.weaponCharges.air_wand).toBe(997);
  });
});
