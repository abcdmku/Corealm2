/**
 * Miniboss loot: the independent 10% rare-weapon rolls and the singleton Fire Orb.
 *
 * The rolls run through the REAL kill path — `CombatSystem.killEnemy` -> `rollDrops` on the
 * seeded `loot` stream — not through a re-implementation of the table. Sweeping seeds proves all
 * four outcomes (neither, sword only, staff only, both) are reachable and that the observed rate
 * sits near the authored 10%; a dependent roll (one flag deciding both weapons) would make the
 * exclusive outcomes unreachable and fail here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EquipmentBonuses, ItemStack, SemanticEntity, SkillId } from "../game/src/contracts.js";
import { SKILL_IDS, ok } from "../game/src/contracts.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { ENEMIES } from "../game/src/content/enemies.js";
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
  content.register({ items: ALL_ITEMS, spells: SPELLS, enemies: ENEMIES });
});

afterAll(() => {
  content.register(originalContent);
});

const HERO_BONUSES: EquipmentBonuses = {
  meleeAccuracy: 500, meleePower: 500,
  magicAccuracy: 0, magicPower: 0, defence: 500, health: 0, vitality: 0 };

function minibossEntity(
  groupId: string,
  family: string,
  tier: number,
  position: readonly [number, number, number],
): SemanticEntity {
  return {
    id: groupId,
    archetype: "boss",
    name: groupId,
    tier,
    regionId: "kilnhalt",
    position: [position[0], position[1], position[2] + 1.2],
    state: "alive",
    interactions: ["inspect", "attack"],
    // One health: the first landed swing kills, so a seed sweep is cheap.
    combat: { health: 1, maxHealth: 1, level: 1, aggroRadius: 0 },
    meta: { family, groupId, rank: "miniboss", behaviour: "territorial", spawnX: 0, spawnZ: 2 },
  };
}

/** Kills the named miniboss under one seed and returns the loot pile's stacks (may be empty). */
function killOnce(seed: number, groupId: string, family: string, tier: number): ItemStack[] {
  const store = new Store(seed, 0);
  const state = store.get();
  state.skills.melee.level = 99;
  state.equipment.mainHand = { itemId: "worn_sword", quantity: 1 };

  // Spawn within melee reach of wherever a fresh save actually stands.
  const target = minibossEntity(groupId, family, tier, state.player.position);
  const targets = new Map([[target.id, target]]);
  const events = new EventBus();
  const skillLevels = (): Record<SkillId, number> => {
    const levels = {} as Record<SkillId, number>;
    for (const id of SKILL_IDS) levels[id] = store.get().skills[id].level;
    return levels;
  };
  const combat = new CombatSystem({
    store,
    events,
    rng: new RngStreams(seed),
    entities: { get: (id) => targets.get(id), all: () => [...targets.values()] },
    equipment: { totals: () => HERO_BONUSES, slots: () => state.equipment },
    inventory: {
      addItem: (_itemId, quantity) => ok(quantity),
      removeItem: (_itemId, quantity) => ok(quantity),
      countItem: () => 0,
      freeSlots: () => 28,
      hasRoomFor: () => true,
    },
    dispatcher: new InteractionDispatcher({
      get: (id) => targets.get(id),
      playerPosition: () => store.get().player.position,
      skillLevels,
    }),
  });

  expect(combat.attack(target.id).ok).toBe(true);
  for (let atMs = 0; atMs <= 60_000 && target.state === "alive"; atMs += 100) {
    combat.tick(100, atMs);
  }
  expect(target.state, `seed ${seed} never landed a killing swing`).toBe("dead");
  const piles = Object.values(state.world.lootPiles);
  return piles.flatMap((pile) => pile.items);
}

describe("independent 10% rare-weapon rolls", () => {
  it("reaches all four outcomes across seeds at a rate near the authored 10%", () => {
    const outcomes = { neither: 0, swordOnly: 0, staffOnly: 0, both: 0 };
    let swordDrops = 0;
    const SEEDS = 260;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const items = killOnce(seed, "galeskin", "galeskin", 1);
      const sword = items.some((stack) => stack.itemId === "galeskin_sword");
      const staff = items.some((stack) => stack.itemId === "galeskin_staff");
      if (sword) swordDrops += 1;
      if (sword && staff) outcomes.both += 1;
      else if (sword) outcomes.swordOnly += 1;
      else if (staff) outcomes.staffOnly += 1;
      else outcomes.neither += 1;
    }
    // Every outcome must be reachable: a shared roll could never produce the exclusive cases,
    // and "both" at 1% needs a real sweep to show up (P(none in 260) < 8%; this is seeded, so
    // the sweep is deterministic and these counts are frozen numbers, not flaky sampling).
    expect(outcomes.neither).toBeGreaterThan(0);
    expect(outcomes.swordOnly).toBeGreaterThan(0);
    expect(outcomes.staffOnly).toBeGreaterThan(0);
    expect(outcomes.both).toBeGreaterThan(0);
    // The sword rate over the sweep sits near 10%: far from 0 and far from a 19% "either" rate.
    expect(swordDrops / SEEDS).toBeGreaterThan(0.04);
    expect(swordDrops / SEEDS).toBeLessThan(0.18);
  });
});

describe("the singleton Fire Orb", () => {
  it("always drops from Cinderwake until owned, then is suppressed by custody", () => {
    for (const seed of [3, 11, 47]) {
      const items = killOnce(seed, "cinderwake", "cinderwake", 20);
      expect(items.some((stack) => stack.itemId === "fire_orb"), `seed ${seed}`).toBe(true);
    }
  });

  it("withholds a duplicate Orb once the save has consumed one", () => {
    const store = new Store(5, 0);
    const state = store.get();
    state.skills.melee.level = 99;
    state.equipment.mainHand = { itemId: "worn_sword", quantity: 1 };
    state.magic.consumedOrbs["fire_orb"] = true;

    const target = minibossEntity("cinderwake", "cinderwake", 20, state.player.position);
    const targets = new Map([[target.id, target]]);
    const skillLevels = (): Record<SkillId, number> => {
      const levels = {} as Record<SkillId, number>;
      for (const id of SKILL_IDS) levels[id] = store.get().skills[id].level;
      return levels;
    };
    const combat = new CombatSystem({
      store,
      events: new EventBus(),
      rng: new RngStreams(5),
      entities: { get: (id) => targets.get(id), all: () => [...targets.values()] },
      equipment: { totals: () => HERO_BONUSES, slots: () => state.equipment },
      inventory: {
        addItem: (_itemId, quantity) => ok(quantity),
        removeItem: (_itemId, quantity) => ok(quantity),
        countItem: () => 0,
        freeSlots: () => 28,
        hasRoomFor: () => true,
      },
      dispatcher: new InteractionDispatcher({
        get: (id) => targets.get(id),
        playerPosition: () => store.get().player.position,
        skillLevels,
      }),
    });

    expect(combat.attack(target.id).ok).toBe(true);
    for (let atMs = 0; atMs <= 60_000 && target.state === "alive"; atMs += 100) {
      combat.tick(100, atMs);
    }
    expect(target.state).toBe("dead");
    const items = Object.values(state.world.lootPiles).flatMap((pile) => pile.items);
    expect(items.some((stack) => stack.itemId === "fire_orb")).toBe(false);
  });
});
