import { beforeEach, describe, expect, it, vi } from "vitest";
import { CREATURE_RUN_SPEED } from "../game/src/app/config.js";
import { SKILL_IDS, ok, type EquipmentBonuses, type RegionId, type SemanticEntity, type SkillId, type Vec3 } from "../game/src/contracts.js";
import { content } from "../game/src/content/index.js";
import { ENEMIES } from "../game/src/content/enemies.js";
import { EventBus } from "../game/src/core/events.js";
import { RngStreams } from "../game/src/core/rng.js";
import { Store } from "../game/src/state/store.js";
import { CombatSystem } from "../game/src/systems/combat.js";
import { EnemyAiSystem } from "../game/src/systems/enemyAI.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const NO_GEAR: EquipmentBonuses = {
  meleeAccuracy: 0, meleePower: 0,  magicAccuracy: 0, magicPower: 0, defence: 0, health: 0, vitality: 0 };

function enemy(id: string, regionId: RegionId, position: Vec3, passive = false): SemanticEntity {
  return {
    id, regionId, position, name: id, archetype: passive ? "boss" : "enemy", tier: 1,
    state: "alive", interactions: ["attack"],
    combat: { health: 100, maxHealth: 100, level: 1, aggroRadius: 10, bodyRadius: 0.4 },
    meta: { behaviour: passive ? "passive" : "aggressive" },
  };
}

function fixture(entities: SemanticEntity[], playerRegion: RegionId = "fallowmarch") {
  const store = new Store(7, 0);
  const state = store.get();
  state.player.position = [0, playerRegion === "gravelmaw" ? -25 : 0, 0];
  state.player.regionId = playerRegion;
  state.player.health = state.player.maxHealth = 10_000;
  const entityPort = { get: (id: string) => entities.find((row) => row.id === id), all: () => entities };
  const events = new EventBus();
  const combat = new CombatSystem({
    store, events, entities: entityPort, rng: new RngStreams(7),
    meleeTiming: () => ({ contactMs: 735, recoveryMs: 1_425 }),
    equipment: { totals: () => NO_GEAR, slots: () => state.equipment },
    inventory: {
      addItem: (_id, quantity) => ok(quantity), removeItem: (_id, quantity) => ok(quantity),
      countItem: () => 0, freeSlots: () => 28, hasRoomFor: () => true,
    },
    dispatcher: new InteractionDispatcher({
      get: entityPort.get, playerPosition: () => state.player.position,
      skillLevels: () => Object.fromEntries(SKILL_IDS.map((id) => [id, state.skills[id].level])) as Record<SkillId, number>,
    }),
  });
  const nav = { nearestWalkable: vi.fn((wanted: Vec3): Vec3 => [...wanted]) };
  const ai = new EnemyAiSystem({ store, events, entities: entityPort, combat, nav });
  return { state, events, combat, ai, nav };
}

beforeEach(() => content.register({ enemies: ENEMIES }));

describe("enemy dungeon and surface isolation", () => {
  it.each([
    ["fallowmarch", "gravelmaw", -25],
    ["gravelmaw", "karrowmoor", 0],
  ] as const)("does not activate, wander, or accept provocation from %s into %s", (playerRegion, actorRegion, y) => {
    const aggressive = enemy("other_floor_attacker", actorRegion, [2, y, 0]);
    const passive = enemy("other_floor_wanderer", actorRegion, [3, y, 0]);
    passive.meta = { behaviour: "passive" };
    const sim = fixture([aggressive, passive], playerRegion);
    sim.ai.provoke(aggressive.id, 0);
    sim.ai.provoke(passive.id, 0);
    for (let atMs = 0; atMs <= 40_000; atMs += 100) sim.ai.tick(100, atMs);
    expect(sim.state.combat.engagedBy).toEqual([]);
    expect(sim.ai.modeOf(aggressive.id)).toBeUndefined();
    expect(sim.ai.modeOf(passive.id)).toBeUndefined();
    expect(sim.state.world.enemies).toEqual({});
    expect(sim.nav.nearestWalkable).not.toHaveBeenCalled();
    expect(aggressive.position).toEqual([2, y, 0]);
    expect(passive.position).toEqual([3, y, 0]);
  });

  it("keeps acquisition and movement active across adjacent surface region borders", () => {
    const attacker = enemy("surface_neighbour", "vellenwood", [5, 0, 0]);
    const sim = fixture([attacker], "fallowmarch");
    sim.ai.tick(100, 0);
    expect(sim.combat.isEngaged(attacker.id)).toBe(true);
    expect(sim.ai.modeOf(attacker.id)).toBe("aggro");
    expect(attacker.position[0]).toBeCloseTo(5 - CREATURE_RUN_SPEED * .1);
  });

  it("still separates overlapping enemies from different surface regions", () => {
    const a = enemy("surface_guard_a", "vellenwood", [5, 0, 0], true);
    const b = enemy("surface_guard_b", "karrowmoor", [5.1, 0, 0], true);
    const sim = fixture([a, b]);
    sim.ai.tick(100, 0);
    expect(a.position[0]).toBeLessThan(5);
    expect(b.position[0]).toBeGreaterThan(5.1);
  });

  it("rebuilds the active realm immediately instead of waiting for the two-second scan", () => {
    const surface = enemy("surface_guard", "karrowmoor", [5, 0, 0], true);
    const cave = enemy("cave_attacker", "gravelmaw", [5, -25, 0]);
    const sim = fixture([surface, cave]);
    sim.ai.tick(100, 0);
    expect(sim.ai.modeOf(cave.id)).toBeUndefined();
    sim.state.player.regionId = "gravelmaw";
    sim.state.player.position = [0, -25, 0];
    sim.ai.tick(100, 100);
    expect(sim.combat.isEngaged(cave.id)).toBe(true);
    expect(cave.position[0]).toBeLessThan(5);
    expect(surface.position).toEqual([5, 0, 0]);
  });

  it("returns and heals an old-realm pursuer without pushing an actor on the other floor", () => {
    const surface = enemy("returning_surface", "karrowmoor", [5, 0, 0]);
    const cave = enemy("cave_guard", "gravelmaw", [3, -25, 0], true);
    const sim = fixture([surface, cave]);
    sim.ai.provoke(surface.id, 0);
    const runtime = sim.state.world.enemies[surface.id]!;
    surface.position = [3, 0, 0];
    surface.combat!.health = runtime.health = 20;
    sim.state.player.regionId = "gravelmaw";
    sim.state.player.position = [0, -25, 0];
    sim.ai.tick(100, 100);
    expect(sim.combat.isEngaged(surface.id)).toBe(false);
    expect(sim.ai.modeOf(surface.id)).toBe("returning");
    expect(surface.position[0]).toBeCloseTo(3 + CREATURE_RUN_SPEED * .1);
    expect(surface.position[1]).toBe(0);
    expect(cave.position).toEqual([3, -25, 0]);
    for (let atMs = 200; atMs <= 2_000; atMs += 100) sim.ai.tick(100, atMs);
    expect(sim.ai.modeOf(surface.id)).toBe("idle");
    expect(runtime.health).toBe(100);
    expect(surface.combat!.health).toBe(100);
    const returned: Vec3 = [...surface.position];
    sim.nav.nearestWalkable.mockClear();
    for (let atMs = 2_100; atMs <= 30_000; atMs += 100) sim.ai.tick(100, atMs);
    expect(surface.position).toEqual(returned);
    expect(sim.nav.nearestWalkable).not.toHaveBeenCalled();
  });

  it("cancels a committed enemy contact before it can hit through the cavern roof", () => {
    const attacker = enemy("committed_surface", "karrowmoor", [0, 0, 1.35]);
    const sim = fixture([attacker]);
    sim.ai.provoke(attacker.id, 0);
    let atMs = 0;
    let attack;
    for (; atMs <= 6_000; atMs += 100) {
      sim.ai.tick(100, atMs);
      sim.combat.tick(100, atMs);
      attack = sim.combat.consumeAttackStarts().find((start) => start.sourceId === attacker.id);
      if (attack) break;
    }
    expect(attack).toBeDefined();
    expect(sim.combat.isAttackCommitted(attacker.id)).toBe(true);
    sim.state.player.regionId = "gravelmaw";
    sim.state.player.position = [0, -25, 0];
    sim.ai.tick(100, atMs + 100);
    expect(sim.combat.isAttackCommitted(attacker.id)).toBe(false);
    expect(sim.combat.isEngaged(attacker.id)).toBe(false);
    sim.combat.tick(100, attack!.recoverAtMs + 100);
    expect(sim.combat.consumeHits()).toEqual([]);
    expect(sim.state.player.health).toBe(10_000);
  });

  it.each([false, true])("resolves Ordrun's real slam only if the player remains in his realm (left=%s)", (left) => {
    const boss = enemy("ordrun", "gravelmaw", [0, -25, 0], true);
    boss.combat!.health = 50;
    const sim = fixture([boss], "gravelmaw");
    sim.ai.provoke(boss.id, 0);
    sim.ai.tick(100, 0);
    sim.ai.tick(100, 1_800);
    const telegraph = sim.ai.telegraphFor(boss.id)!;
    expect(telegraph.stage).toBe("windup");
    if (left) {
      sim.state.player.regionId = "karrowmoor";
      sim.state.player.position = [0, 0, 0];
    }
    sim.ai.tick(100, telegraph.firesAtMs);
    // 24, not the pre-expansion 21. The slam formula is unchanged — `enemyAI.fireSlam` still deals
    // round(phase.maxHit * SLAM_DAMAGE_MULTIPLIER 1.5) — but `content/enemies.ts` now derives
    // ORDRUN_PHASES from the block tuned to Ordrun's combat level 50 instead of the old authored
    // level-39 numbers. Base maxHit 12 -> 14, so the second phase's authored 14/12 escalation
    // reads 16, and 16 x 1.5 = 24. Leaving the realm still costs the player exactly nothing.
    expect(sim.state.player.health).toBe(left ? 10_000 : 9_976);
    if (left) {
      expect(sim.ai.telegraphs()).toEqual([]);
      expect(sim.combat.isEngaged(boss.id)).toBe(false);
    } else {
      expect(sim.ai.telegraphFor(boss.id)?.stage).toBe("active");
    }
  });

  it("processes exact respawn deadlines globally for off-realm corpses near and far away", () => {
    const near = enemy("near_corpse", "gravelmaw", [0, -25, 0]);
    const far = enemy("far_corpse", "gravelmaw", [800, -25, 800]);
    const sim = fixture([near, far]);
    for (const [actor, deadline] of [[near, 3_000], [far, 4_000]] as const) {
      const runtime = sim.combat.runtimeFor(sim.state, actor);
      runtime.health = actor.combat!.health = 0;
      runtime.state = "dead";
      actor.state = "dead";
      runtime.diedAtMs = 500;
      runtime.respawnAtMs = deadline;
      actor.position = [actor.position[0] + 3, -25, actor.position[2]];
    }
    sim.ai.tick(100, 2_999);
    expect(near.state).toBe("dead");
    expect(sim.state.world.enemies[near.id]!.respawnAtMs).toBe(3_000);
    sim.ai.tick(100, 3_000);
    expect(near.state).toBe("alive");
    expect(near.position).toEqual([0, -25, 0]);
    expect(near.combat!.health).toBe(100);
    expect(far.state).toBe("dead");
    sim.ai.tick(100, 4_000);
    expect(far.state).toBe("alive");
    expect(far.position).toEqual([800, -25, 800]);
    expect(far.combat!.health).toBe(100);
    expect(sim.state.world.enemies[far.id]!.respawnAtMs).toBeNull();
    expect(sim.state.combat.engagedBy).toEqual([]);
  });
});
