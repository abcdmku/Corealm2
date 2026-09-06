import { describe, expect, it } from "vitest";
import type { EquipmentBonuses, SemanticEntity, SkillId, Vec3 } from "../game/src/contracts.js";
import { SKILL_IDS, ok } from "../game/src/contracts.js";
import { CREATURE_RUN_SPEED } from "../game/src/app/config.js";
import { EventBus } from "../game/src/core/events.js";
import { RngStreams } from "../game/src/core/rng.js";
import { Store } from "../game/src/state/store.js";
import { CombatSystem, type CombatAttackStart } from "../game/src/systems/combat.js";
import { EnemyAiSystem } from "../game/src/systems/enemyAI.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const NO_GEAR: EquipmentBonuses = {
  accuracy: 0, power: 0, armour: 0,
  magicAccuracy: 0, magicPower: 0, magicArmour: 0, vitality: 0,
};

function fixture(neighbour?: "idle" | "attacking") {
  const store = new Store(7, 0);
  const state = store.get();
  state.player.position = [0, 0, 0];
  state.player.health = state.player.maxHealth = 10_000;
  const attacker: SemanticEntity = {
    id: "committed_attacker", archetype: "enemy", name: "Attacker", tier: 1,
    regionId: "fallowmarch", position: [0, 0, 1.35], state: "alive", interactions: ["attack"],
    combat: { health: 100, maxHealth: 100, level: 1, aggroRadius: 0, bodyRadius: 0.4 },
    view: { assetId: "animal_bear", rotationY: Math.PI },
  };
  // A guarding boss does not wander, so its displacement below can only come from separation.
  const other: SemanticEntity = {
    ...attacker, id: "guarding_neighbour", name: "Neighbour", archetype: "boss",
    position: [-1.35, 0, 0], combat: { ...attacker.combat! },
    view: { assetId: "animal_bear", rotationY: Math.PI / 2 },
  };
  const entities = [attacker, ...(neighbour ? [other] : [])];
  const entityPort = {
    get: (id: string) => entities.find((entity) => entity.id === id),
    all: () => entities,
  };
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
      get: entityPort.get,
      playerPosition: () => state.player.position,
      skillLevels: () => Object.fromEntries(SKILL_IDS.map((id) => [id, state.skills[id].level])) as Record<SkillId, number>,
    }),
  });
  for (const entity of entities) combat.setEnemyOverride(entity.id, {
    behaviour: "passive", aggroRadius: 0, attackSpeedMs: 2_400,
  });
  const ai = new EnemyAiSystem({ store, events, entities: entityPort, combat });
  ai.provoke(attacker.id, 0);
  if (neighbour === "attacking") ai.provoke(other.id, 0);
  let now = -100;
  const advanceTo = (untilMs: number) => {
    while (now + 100 <= untilMs) {
      now += 100;
      // The production loop runs AI before combat on each simulation tick.
      ai.tick(100, now);
      combat.tick(100, now);
    }
  };
  let attack: CombatAttackStart | undefined;
  while (!attack && now < 6_000) {
    advanceTo(now + 100);
    attack = combat.consumeAttackStarts().find((start) => start.sourceId === attacker.id);
  }
  if (!attack) throw new Error("The provoked enemy never began its attack");
  return { attacker, other, state, combat, advanceTo, attack };
}

describe("enemy attack movement commitment", () => {
  it("plants the attacker through a missed contact and recovery, then resumes pursuit", () => {
    const { attacker, state, combat, advanceTo, attack } = fixture();
    const planted: Vec3 = [...attacker.position];
    state.player.position = [0, 0, -5];

    advanceTo(attack.contactAtMs - 1);
    expect(attacker.position).toEqual(planted);
    expect(combat.hits()).toEqual([]);
    advanceTo(Math.ceil(attack.contactAtMs / 100) * 100);
    expect(combat.consumeHits()).toMatchObject([{
      sourceId: attacker.id, atMs: attack.contactAtMs, damage: 0, hit: false,
    }]);
    expect(attacker.position).toEqual(planted);
    advanceTo(attack.recoverAtMs - 1);
    expect(attacker.position).toEqual(planted);
    expect(combat.isAttackCommitted(attacker.id)).toBe(true);

    const releasedTick = Math.ceil(attack.recoverAtMs / 100) * 100;
    advanceTo(releasedTick);
    expect(combat.isAttackCommitted(attacker.id)).toBe(false);
    advanceTo(releasedTick + 100);
    expect(attacker.position[2]).toBeLessThan(planted[2]);
    expect(planted[2] - attacker.position[2]).toBeLessThanOrEqual(CREATURE_RUN_SPEED * .1 + 1e-8);
    expect(combat.consumeHits()).toEqual([]);
  });

  it("gives way with the idle neighbour while the attacking creature stays planted", () => {
    const { attacker, other, combat, advanceTo, attack } = fixture("idle");
    other.position = [0.2, 0, attacker.position[2]];
    const planted: Vec3 = [...attacker.position];
    const neighbourBefore: Vec3 = [...other.position];
    expect(combat.isAttackCommitted(attacker.id)).toBe(true);
    expect(combat.isAttackCommitted(other.id)).toBe(false);

    advanceTo(attack.atMs + 100);
    expect(attacker.position).toEqual(planted);
    const displacement = Math.hypot(
      other.position[0] - neighbourBefore[0], other.position[2] - neighbourBefore[2],
    );
    expect(displacement).toBeGreaterThan(0);
    expect(displacement).toBeLessThanOrEqual(0.11 + 1e-8);
    expect(other.position[0]).toBeGreaterThan(neighbourBefore[0]);
  });

  it("holds an overlapping attacking pair until both recover, then separates them", () => {
    const { attacker, other, combat, advanceTo, attack } = fixture("attacking");
    other.position = [0.2, 0, attacker.position[2]];
    const positions = [[...attacker.position], [...other.position]];
    expect(combat.isAttackCommitted(attacker.id)).toBe(true);
    expect(combat.isAttackCommitted(other.id)).toBe(true);

    advanceTo(attack.recoverAtMs - 1);
    expect([attacker.position, other.position]).toEqual(positions);
    advanceTo(Math.ceil(attack.recoverAtMs / 100) * 100 + 100);
    expect(combat.isAttackCommitted(attacker.id)).toBe(false);
    expect(combat.isAttackCommitted(other.id)).toBe(false);
    expect(attacker.position).not.toEqual(positions[0]);
    expect(other.position).not.toEqual(positions[1]);
    expect(Math.hypot(
      other.position[0] - attacker.position[0], other.position[2] - attacker.position[2],
    )).toBeGreaterThan(0.2);
  });

  it("releases an explicitly cancelled windup so the AI can pursue again", () => {
    const { attacker, state, combat, advanceTo, attack } = fixture();
    const planted: Vec3 = [...attacker.position];
    state.player.position = [0, 0, -5];
    combat.disengageEnemy(state, attacker.id, attack.atMs);

    advanceTo(attack.atMs + 100);
    expect(combat.isAttackCommitted(attacker.id)).toBe(false);
    expect(attacker.position[2]).toBeLessThan(planted[2]);
    advanceTo(Math.ceil(attack.recoverAtMs / 100) * 100);
    expect(combat.consumeHits()).toEqual([]);
  });

  it("cancels a committed attack when it crosses the leash and walks home immediately", () => {
    const { attacker, state, combat, advanceTo, attack } = fixture();
    attacker.position = [0, 0, 35];
    state.player.position = [0, 0, 34];
    advanceTo(attack.atMs + 100);

    expect(combat.isAttackCommitted(attacker.id)).toBe(false);
    expect(combat.isEngaged(attacker.id)).toBe(false);
    expect(state.world.enemies[attacker.id]?.state).toBe("returning");
    expect(attacker.position[2]).toBeLessThan(35);
    advanceTo(Math.ceil(attack.recoverAtMs / 100) * 100);
    expect(combat.consumeHits()).toEqual([]);
  });

  it("returns home after the player dies and later resumes ordinary idle wandering", () => {
    const { attacker, state, combat, advanceTo, attack } = fixture();
    attacker.position = [0, 0, 8];
    state.player.health = 0;
    advanceTo(attack.atMs + 200);

    expect(combat.isAttackCommitted(attacker.id)).toBe(false);
    expect(combat.isEngaged(attacker.id)).toBe(false);
    expect(state.world.enemies[attacker.id]?.state).toBe("returning");
    expect(attacker.position[2]).toBeLessThan(8);
    advanceTo(attack.atMs + 3_000);
    expect(state.world.enemies[attacker.id]?.state).toBe("idle");
    const home: Vec3 = [...attacker.position];
    let wandered = false;
    for (let atMs = attack.atMs + 3_100; atMs <= attack.atMs + 24_000; atMs += 100) {
      advanceTo(atMs);
      if (Math.hypot(attacker.position[0] - home[0], attacker.position[2] - home[2]) > 0.5) {
        wandered = true;
        break;
      }
    }
    expect(wandered).toBe(true);
    expect(combat.consumeHits()).toEqual([]);
  });
});
