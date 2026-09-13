import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { EquipmentBonuses, SemanticEntity, SkillId } from "../game/src/contracts.js";
import { SKILL_IDS, ok } from "../game/src/contracts.js";
import { SPELLS } from "../game/src/content/spells.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { content, type ContentTables } from "../game/src/content/index.js";
import { EventBus } from "../game/src/core/events.js";
import { RngStreams } from "../game/src/core/rng.js";
import { Store } from "../game/src/state/store.js";
import { CombatSystem, type CombatAttackStart, type CombatDeps } from "../game/src/systems/combat.js";
import { Movement } from "../game/src/systems/movement.js";
import { Navigation } from "../game/src/systems/navigation.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const originalContent: ContentTables = {
  items: [...content.allItems()], resources: [...content.allResources()],
  recipes: [...content.allRecipes()], spells: [...content.allSpells()],
  enemies: [...content.allEnemies()], shops: [...content.allShops()],
};
beforeAll(() => content.register({ items: ALL_ITEMS, spells: SPELLS }));
afterAll(() => content.register(originalContent));

const GEAR: EquipmentBonuses = {
  meleeAccuracy: 500, meleePower: 50,
  magicAccuracy: 0, magicPower: 0, defence: 0, health: 0, vitality: 0 };

function setup(meleeTiming?: CombatDeps["meleeTiming"], movement?: CombatDeps["movement"]) {
  const store = new Store(7, 0);
  const state = store.get();
  state.player.position = [0, 0, 0];
  state.player.health = state.player.maxHealth = 10_000;
  state.equipment.mainHand = { itemId: "worn_sword", quantity: 1 };
  const targets = new Map<string, SemanticEntity>(["target_a", "target_b"].map((id): [string, SemanticEntity] => [id, {
    id, archetype: "enemy", name: id, tier: 1, regionId: "fallowmarch",
    position: [0, 0, 1.2], state: "alive", interactions: ["attack"],
    combat: { health: 10_000, maxHealth: 10_000, level: 1, aggroRadius: 0 },
  }]));
  const combat = new CombatSystem({
    store,
    events: new EventBus(),
    rng: new RngStreams(7),
    ...(meleeTiming ? { meleeTiming } : {}),
    ...(movement ? { movement } : {}),
    entities: { get: (id) => targets.get(id), all: () => [...targets.values()] },
    equipment: { totals: () => GEAR, slots: () => state.equipment },
    inventory: {
      addItem: (_id, quantity) => ok(quantity), removeItem: (_id, quantity) => ok(quantity),
      countItem: () => 0, freeSlots: () => 28, hasRoomFor: () => true,
    },
    dispatcher: new InteractionDispatcher({
      get: (id) => targets.get(id),
      playerPosition: () => state.player.position,
      skillLevels: () => Object.fromEntries(SKILL_IDS.map((id) => [id, state.skills[id].level])) as Record<SkillId, number>,
    }),
  });
  combat.setEnemyOverride("target_a", { attackLevel: 99, accuracy: 500, maxHit: 10 });
  let now = -100;
  const advanceTo = (untilMs: number) => {
    while (now + 100 <= untilMs) {
      now += 100;
      combat.tick(100, now);
    }
  };
  const start = (attacker: "player" | "enemy"): CombatAttackStart => {
    if (attacker === "player") expect(combat.attack("target_a").ok).toBe(true);
    else combat.engageEnemy("target_a", 0);
    for (let untilMs = 0; untilMs <= 6_000; untilMs += 100) {
      advanceTo(untilMs);
      const started = combat.consumeAttackStarts().find((event) => event.attacker === attacker);
      if (started) return started;
    }
    throw new Error(`${attacker} did not begin an attack within 6 seconds`);
  };
  return { combat, state, targets, advanceTo, start };
}


function commanded(kind: "attack" | "cast", near = false) {
  const navigation = new Navigation();
  vi.spyOn(navigation, "findPathDetailed").mockImplementation((from, to) => ({ path: [from, to], partial: false, arrivalGap: 0 }));
  const movement = new Movement(navigation, new EventBus());
  const sim = setup(undefined, movement);
  sim.targets.get("target_a")!.position = [0, 0, near ? 1.2 : 20];
  if (kind === "cast") {
    sim.state.equipment.mainHand = { itemId: "air_wand", quantity: 1 };
    sim.state.magic.weaponCharges.air_wand = 100;
  }
  const command = (target = "target_a") => kind === "cast" ? sim.combat.cast("voltrend", target) : sim.combat.attack(target);
  movement.startPath(sim.state, [20, 0, 0], null, 0);
  return { ...sim, movement, command };
}

describe("explicit combat command ordering", () => {
  it.each(["attack", "cast"] as const)("%s replaces an earlier manual path and retains pursuit next tick", kind => {
    const sim = commanded(kind);
    expect(sim.command().ok).toBe(true);
    expect(sim.state.player.movement.destinationEntityId).toBe("target_a");
    sim.advanceTo(0);
    expect(sim.state.combat.targetId).toBe("target_a");
    expect(sim.state.player.movement.destinationEntityId).toBe("target_a");
    const path = sim.state.player.movement.path;
    expect(sim.command().ok).toBe(true);
    expect(sim.state.player.movement.path).toBe(path);
  });

  it.each(["attack", "cast"] as const)("%s stops an earlier manual path when already in reach", kind => {
    const sim = commanded(kind, true);
    expect(sim.command().ok).toBe(true);
    expect(sim.state.player.movement.mode).toBe("idle");
    sim.advanceTo(0);
    expect(sim.state.combat.targetId).toBe("target_a");
  });

  it.each(["attack", "cast"] as const)("invalid %s commands leave manual movement untouched", kind => {
    const sim = commanded(kind);
    const path = sim.state.player.movement.path;
    expect(sim.command("missing").ok).toBe(false);
    sim.targets.get("target_a")!.regionId = "gravelmaw";
    expect(sim.command().ok).toBe(false);
    sim.targets.get("target_a")!.regionId = "fallowmarch";
    sim.targets.get("target_a")!.position = [0, 0, 100];
    expect(sim.command().ok).toBe(false);
    expect(sim.state.player.movement.path).toBe(path);
    expect(sim.state.player.movement.destinationEntityId).toBe(null);
    expect(sim.state.combat.targetId).toBe(null);
  });

  it.each(["attack", "cast"] as const)("movement issued after %s still wins over passive pursuit", kind => {
    const sim = commanded(kind);
    expect(sim.command().ok).toBe(true);
    sim.movement.startPath(sim.state, [20, 0, 0], null, 1);
    const manualPath = sim.state.player.movement.path;
    sim.advanceTo(0);
    expect(sim.state.combat.targetId).toBe(null);
    expect(sim.state.player.movement.path).toBe(manualPath);
  });
});


describe("combat after a committed portal", () => {
  it.each(["attack", "cast"] as const)("%s cancels an idle portal continuation before its fade resolves", async kind => {
    const sim = commanded(kind, true);
    let commit!: () => void;
    let finish!: () => void;
    const fade = new Promise<void>(resolve => { finish = resolve; });
    sim.movement.setPorts({ portals: { transition: (_destination, _regionId, apply) => {
      commit = apply;
      return fade;
    } } });
    expect(sim.movement.startRoute(sim.state, [
      { kind: "portal", from: [0, 0, 0], to: [20, 0, 0], fromId: "entry", toId: "exit",
        portalId: "test_portal", toRegionId: "gravelmaw", durationMs: 100, cost: 0.1 },
      { kind: "walk", from: [20, 0, 0], to: [24, 0, 0], fromId: "exit", toId: "goal", cost: 1 },
    ], 0)).toBe(true);
    sim.movement.update(sim.state, 100, 100);
    commit();
    expect(sim.state.player.movement.mode).toBe("idle");
    expect(sim.movement.getRouteProgress()).toMatchObject({ active: true, traversing: true });
    const target = sim.targets.get("target_a")!;
    target.position = [21.2, 0, 0];
    target.regionId = "gravelmaw";
    expect(sim.command().ok).toBe(true);
    expect(sim.movement.getRouteProgress().active).toBe(false);
    finish();
    await Promise.resolve();
    commit();
    sim.movement.update(sim.state, 100, 200);
    sim.advanceTo(200);
    expect(sim.state.player.position).toEqual([20, 0, 0]);
    expect(sim.state.player.movement.mode).toBe("idle");
    expect(sim.movement.getRouteProgress().active).toBe(false);
    expect(sim.state.combat.targetId).toBe("target_a");
  });
});
