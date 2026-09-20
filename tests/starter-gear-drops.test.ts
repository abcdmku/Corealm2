/**
 * Tier 0 salvage armour dropped by the basic creatures around Coldbrace.
 *
 * The rates run through the REAL kill path - `CombatSystem.tick` -> `rollDrops` on the seeded
 * `loot` stream - so a wiring mistake between the creature row, its shared table and the item
 * catalog fails here rather than in a hand-rolled copy of the table.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EquipmentBonuses, ItemStack, SemanticEntity, SkillId } from "../game/src/contracts.js";
import { SKILL_IDS, ok } from "../game/src/contracts.js";
import { ENEMIES } from "../game/src/content/enemies.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { SPELLS } from "../game/src/content/spells.js";
import { content, type ContentTables } from "../game/src/content/index.js";
import { EventBus } from "../game/src/core/events.js";
import { RngStreams } from "../game/src/core/rng.js";
import { Store } from "../game/src/state/store.js";
import { CombatSystem } from "../game/src/systems/combat.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const MELEE_SET = ["worn_helm", "worn_cuirass", "worn_greaves", "worn_gloves", "worn_boots"] as const;
const MAGIC_SET = ["worn_hide_hood", "worn_hide_robe", "worn_hide_leggings", "worn_hide_wraps", "worn_hide_boots"] as const;
const JEWELRY = ["crafted_ring_t10", "crafted_earring_t10"] as const;
/** Every level 1 basic creature placed within 150 m of Coldbrace. */
const NEAR_BASE = [
  "red_worm_t1", "granary_rat_t1", "redsill_cattle", "bracken_hens", "marchfield_hens",
  "marchfield_coneys", "march_road_reavers", "redbrush_fox_t1", "regional_redbrush_fox",
  "regional_gloam_fox", "redsill_frogs", "marchfield_turkey_t1", "reedbank_goose_t1",
  "open_march_goats", "creek_crab_t1",
] as const;

const originalContent: ContentTables = {
  items: [...content.allItems()], resources: [...content.allResources()], recipes: [...content.allRecipes()],
  spells: [...content.allSpells()], enemies: [...content.allEnemies()], shops: [...content.allShops()],
};
beforeAll(() => { content.register({ items: ALL_ITEMS, spells: SPELLS, enemies: ENEMIES }); });
afterAll(() => { content.register(originalContent); });

const HERO_BONUSES: EquipmentBonuses = {
  meleeAccuracy: 500, meleePower: 500, magicAccuracy: 0, magicPower: 0,
  defence: 500, health: 0, vitality: 0,
};

/** Kills one creature under one seed and returns the loot pile's stacks (may be empty). */
function killOnce(seed: number, enemyId: string): ItemStack[] {
  const store = new Store(seed, 0);
  const state = store.get();
  state.skills.melee.level = 99;
  state.equipment.mainHand = { itemId: "worn_sword", quantity: 1 };

  const position = state.player.position;
  const target: SemanticEntity = {
    id: `${enemyId}_1`,
    archetype: "enemy",
    name: enemyId,
    tier: 1,
    regionId: "fallowmarch",
    position: [position[0], position[1], position[2] + 1.2],
    state: "alive",
    interactions: ["inspect", "attack"],
    // One health: the first landed swing kills, so a seed sweep stays cheap.
    combat: { health: 1, maxHealth: 1, level: 1, aggroRadius: 0 },
    meta: { enemyId, behaviour: "passive", spawnX: 0, spawnZ: 2 },
  };
  const targets = new Map([[target.id, target]]);
  const skillLevels = (): Record<SkillId, number> => {
    const levels = {} as Record<SkillId, number>;
    for (const id of SKILL_IDS) levels[id] = store.get().skills[id].level;
    return levels;
  };
  const combat = new CombatSystem({
    store,
    events: new EventBus(),
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
  for (let atMs = 0; atMs <= 60_000 && target.state === "alive"; atMs += 100) combat.tick(100, atMs);
  expect(target.state, `seed ${seed} never landed a killing swing`).toBe("dead");
  return Object.values(state.world.lootPiles).flatMap((pile) => pile.items);
}

describe("tier 0 starter gear", () => {
  it("drops every armour piece near the authored 5% and the Cobalt jewelry near 2%", () => {
    const SEEDS = 400;
    const counts = new Map<string, number>();
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      for (const stack of killOnce(seed, "red_worm_t1")) {
        counts.set(stack.itemId, (counts.get(stack.itemId) ?? 0) + 1);
      }
    }
    for (const itemId of [...MELEE_SET, ...MAGIC_SET]) {
      const rate = (counts.get(itemId) ?? 0) / SEEDS;
      expect(rate, itemId).toBeGreaterThan(0.02);
      expect(rate, itemId).toBeLessThan(0.09);
    }
    for (const itemId of JEWELRY) {
      const rate = (counts.get(itemId) ?? 0) / SEEDS;
      expect(rate, itemId).toBeGreaterThan(0.002);
      expect(rate, itemId).toBeLessThan(0.05);
    }
    // The worms used to drop nothing at all; their own materials now roll too.
    expect(counts.get("march_stone"), "march_stone").toBeGreaterThan(0);
  });

  it("gives the whole near-base population the same starter block and leaves the rest alone", () => {
    for (const enemyId of NEAR_BASE) {
      const def = ENEMIES.find((row) => row.id === enemyId);
      expect(def, enemyId).toBeDefined();
      const drops = new Map(def!.lootRolls.flatMap(roll => roll.drops).map((row) => [row.itemId, row.chance]));
      for (const itemId of [...MELEE_SET, ...MAGIC_SET]) expect(drops.get(itemId), `${enemyId} ${itemId}`).toBe(0.05);
      for (const itemId of JEWELRY) expect(drops.get(itemId), `${enemyId} ${itemId}`).toBe(0.02);
      // Materials survive the rewrite: every creature keeps at least one non-gear drop.
      const gear = new Set<string>([...MELEE_SET, ...MAGIC_SET, ...JEWELRY]);
      expect(def!.lootRolls.flatMap(roll => roll.drops).some((row) => !gear.has(row.itemId)), enemyId).toBe(true);
    }
    const starter = new Set<string>(NEAR_BASE);
    const elsewhere = ENEMIES.filter((row) => !starter.has(row.id)
      && row.lootRolls.flatMap(roll => roll.drops).some((drop) => drop.itemId === "worn_cuirass"));
    expect(elsewhere.map((row) => row.id)).toEqual([]);
  });
});
