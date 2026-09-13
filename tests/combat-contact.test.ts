import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EquipmentBonuses, SemanticEntity, SkillId } from "../game/src/contracts.js";
import { SKILL_IDS, ok } from "../game/src/contracts.js";
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
beforeAll(() => content.register({ items: ALL_ITEMS }));
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

describe("melee contact timing", () => {
  it("awards damage XP only for health removed on an overkill hit", () => {
    const { state, targets, advanceTo, start, combat } = setup();
    targets.get('target_a')!.combat!.health = targets.get('target_a')!.combat!.maxHealth = 1;
    const attack = start('player');
    advanceTo(Math.ceil(attack.contactAtMs / 100) * 100);
    expect(combat.hits().find(hit => hit.attacker === 'player')!.damage).toBeGreaterThan(1);
    expect(targets.get('target_a')!.state).toBe('dead');
    expect(state.skills.melee.xp).toBe(6); // Four damage XP plus the two-XP defeat reward.
  });
  it.each(["player", "enemy"] as const)(
    "%s damage waits for contact, resolves once, and remains committed through recovery",
    (attacker) => {
      const { combat, state, targets, advanceTo, start } = setup();
      const attack = start(attacker);
      const target = targets.get("target_a")!;
      const healthBefore = attacker === "player" ? target.combat!.health : state.player.health;
      const xpBefore = state.skills.melee.xp;
      expect(attack.contactAtMs).toBeGreaterThan(attack.atMs);
      expect(attack.recoverAtMs).toBeGreaterThan(attack.contactAtMs);
      expect(combat.isAttackCommitted(attack.sourceId)).toBe(true);
      expect(combat.hits()).toEqual([]);

      advanceTo(attack.contactAtMs - 1);
      expect(target.combat!.health).toBe(10_000);
      expect(state.player.health).toBe(10_000);
      expect(state.skills.melee.xp).toBe(xpBefore);
      expect(combat.hits()).toEqual([]);

      const contactTick = Math.ceil(attack.contactAtMs / 100) * 100;
      advanceTo(contactTick);
      const hits = combat.consumeHits();
      expect(hits).toHaveLength(1);
      const hit = hits[0]!;
      expect(hit).toMatchObject({
        attacker, sourceId: attack.sourceId, targetId: attack.targetId, kind: "melee", hit: true,
      });
      expect(hit.atMs).toBeGreaterThanOrEqual(attack.contactAtMs);
      expect(hit.atMs).toBeLessThan(attack.contactAtMs + 100);
      const healthAfter = attacker === "player" ? target.combat!.health : state.player.health;
      expect(healthBefore - healthAfter).toBe(hit.damage);
      expect(hit.damage).toBeGreaterThan(0);
      expect(state.skills.melee.xp - xpBefore).toBe(attacker === "player" ? hit.damage * 4 : 0);
      expect(combat.isAttackCommitted(attack.sourceId)).toBe(true);

      advanceTo(Math.ceil(attack.recoverAtMs / 100) * 100);
      expect(combat.isAttackCommitted(attack.sourceId)).toBe(false);
      expect(combat.consumeHits()).toEqual([]);
      expect(attacker === "player" ? target.combat!.health : state.player.health).toBe(healthAfter);
    },
  );

  it.each(["player", "enemy"] as const)("%s uses its authored clip contact and recovery", (attacker) => {
    const { combat, state, targets, advanceTo, start } = setup(() => ({ contactMs: 735, recoveryMs: 1_425 }));
    const attack = start(attacker);
    expect(attack.contactAtMs - attack.atMs).toBe(735);
    expect(attack.recoverAtMs - attack.atMs).toBe(1_425);
    advanceTo(attack.contactAtMs - 1);
    expect(combat.hits()).toEqual([]);
    expect(targets.get("target_a")!.combat!.health).toBe(10_000);
    expect(state.player.health).toBe(10_000);
    advanceTo(Math.ceil(attack.contactAtMs / 100) * 100);
    expect(combat.consumeHits()).toMatchObject([{ atMs: attack.contactAtMs, attacker, hit: true }]);
    advanceTo(attack.recoverAtMs - 1);
    expect(combat.isAttackCommitted(attack.sourceId)).toBe(true);
    advanceTo(Math.ceil(attack.recoverAtMs / 100) * 100);
    expect(combat.isAttackCommitted(attack.sourceId)).toBe(false);
  });

  it.each(["stopped", "switched-target"] as const)("%s cancels a player windup without spending a new cooldown", (reason) => {
    const { combat, state, targets, advanceTo, start } = setup();
    const attack = start("player");
    const nextAttackAtMs = state.combat.nextAttackAtMs;
    if (reason === "stopped") expect(combat.disengagePlayer("stopped")).toBe(true);
    else expect(combat.attack("target_b").ok).toBe(true);

    advanceTo(Math.ceil(attack.recoverAtMs / 100) * 100);
    expect(combat.consumeHits()).toEqual([]);
    expect(combat.isAttackCommitted(state.player.id)).toBe(false);
    expect(state.skills.melee.xp).toBe(0);
    expect([...targets.values()].map((target) => target.combat!.health)).toEqual([10_000, 10_000]);
    expect(state.combat.nextAttackAtMs).toBe(nextAttackAtMs);
    if (reason === "switched-target") {
      advanceTo(nextAttackAtMs);
      expect(combat.consumeAttackStarts()).toMatchObject([
        { atMs: nextAttackAtMs, sourceId: state.player.id, targetId: "target_b" },
      ]);
    }
  });

  it.each(["direct", "path"] as const)("a new %s movement command cancels the player's windup", (mode) => {
    const { combat, state, targets, advanceTo, start } = setup();
    const attack = start("player");
    state.player.movement.mode = mode;
    state.player.movement.destinationEntityId = mode === "path" ? "target_b" : null;
    advanceTo(Math.ceil(attack.recoverAtMs / 100) * 100);
    expect(combat.consumeHits()).toEqual([]);
    expect(targets.get("target_a")!.combat!.health).toBe(10_000);
    expect(state.skills.melee.xp).toBe(0);
    expect(combat.isAttackCommitted(state.player.id)).toBe(false);
  });

  it.each([
    ["player", "source"], ["player", "target"], ["enemy", "source"], ["enemy", "target"],
  ] as const)("cancels a %s windup when its %s dies", (attacker, participant) => {
    const { combat, state, targets, advanceTo, start } = setup();
    const attack = start(attacker);
    const dyingId = participant === "source" ? attack.sourceId : attack.targetId;
    if (dyingId === state.player.id) combat.damagePlayer(10_000, "target_b", attack.atMs + 100);
    else combat.damageEnemy(dyingId, 10_000, attack.atMs + 100);
    combat.consumeHits();
    const playerHealth = state.player.health;
    const enemyHealth = targets.get("target_a")!.combat!.health;
    const xp = state.skills.melee.xp;

    advanceTo(Math.ceil(attack.recoverAtMs / 100) * 100);
    expect(combat.consumeHits()).toEqual([]);
    expect(state.player.health).toBe(playerHealth);
    expect(targets.get("target_a")!.combat!.health).toBe(enemyHealth);
    expect(state.skills.melee.xp).toBe(xp);
    expect(combat.isAttackCommitted(attack.sourceId)).toBe(false);
  });

  it.each(["player", "enemy"] as const)("%s misses when the victim leaves reach during windup", (attacker) => {
    const { combat, state, targets, advanceTo, start } = setup(() => ({ contactMs: 735, recoveryMs: 1_425 }));
    const attack = start(attacker);
    if (attacker === "player") targets.get("target_a")!.position = [0, 0, 12];
    else state.player.position = [0, 0, 12];

    // This windup crosses a 600 ms combat tick. Reconsidering pursuit on that tick must not
    // silently cancel the committed swing before it can visibly miss at contact.
    advanceTo(attack.atMs + 600);
    expect(combat.isAttackCommitted(attack.sourceId)).toBe(true);
    expect(combat.hits()).toEqual([]);
    advanceTo(Math.ceil(attack.contactAtMs / 100) * 100);
    expect(combat.consumeHits()).toMatchObject([
      { atMs: attack.contactAtMs, sourceId: attack.sourceId, targetId: attack.targetId, damage: 0, hit: false },
    ]);
    expect(state.player.health).toBe(10_000);
    expect(targets.get("target_a")!.combat!.health).toBe(10_000);
    expect(state.skills.melee.xp).toBe(0);
  });

  it.each(["target_a", "target_b"] as const)("an explicit attack command replaces any prior approach (%s)", (destinationEntityId) => {
    const movement = new Movement(new Navigation(), new EventBus());
    const { combat, state, start, advanceTo } = setup(undefined, movement);
    const path: [number, number, number][] = [[0, 0, 0], [0, 0, 1.2]];
    Object.assign(state.player.movement, {
      mode: "path", path, pathIndex: 1, destination: path[1], destinationEntityId,
    });
    if (destinationEntityId === "target_a") {
      start("player");
      expect(state.player.movement).toMatchObject({
        mode: "idle", path: null, destination: null, destinationEntityId: null,
      });
      expect(state.combat.targetId).toBe("target_a");
      expect(combat.isAttackCommitted(state.player.id)).toBe(true);
      const positionAtWindup = [...state.player.position];
      movement.update(state, 100, 100);
      expect(state.player.position).toEqual(positionAtWindup);
    } else {
      expect(combat.attack("target_a").ok).toBe(true);
      advanceTo(0);
      expect(state.player.movement).toMatchObject({ mode: "idle", path: null, destinationEntityId: null });
      expect(combat.isAttackCommitted(state.player.id)).toBe(true);
    }
  });

  it.each([
    ["new-world", "player"], ["new-world", "enemy"], ["death", "player"], ["death", "enemy"],
  ] as const)("%s reset drops unread %s start cues and pending damage", (reset, attacker) => {
    const { combat, state, targets, advanceTo } = setup();
    if (attacker === "player") expect(combat.attack("target_a").ok).toBe(true);
    else combat.engageEnemy("target_a", 0);
    const startAtMs = attacker === "player" ? 0 : 2_400;
    const sourceId = attacker === "player" ? state.player.id : "target_a";
    advanceTo(startAtMs);
    expect(combat.isAttackCommitted(sourceId)).toBe(true);
    if (reset === "new-world") combat.resetForNewWorld();
    else combat.resetOnDeath(startAtMs);

    expect(combat.consumeAttackStarts()).toEqual([]);
    expect(combat.isAttackCommitted(sourceId)).toBe(false);
    advanceTo(startAtMs + 2_300);
    expect(combat.consumeHits()).toEqual([]);
    expect(state.player.health).toBe(10_000);
    expect(targets.get("target_a")!.combat!.health).toBe(10_000);
    expect(state.skills.melee.xp).toBe(0);
  });

  it.each(["player", "enemy"] as const)("keeps the %s attack cadence at 2400 ms", (attacker) => {
    const { combat, advanceTo, start } = setup();
    const first = start(attacker);
    const starts = [first];
    for (let atMs = first.atMs + 100; atMs <= 7_200; atMs += 100) {
      advanceTo(atMs);
      starts.push(...combat.consumeAttackStarts());
    }
    expect(starts.map((attack) => attack.atMs)).toEqual(
      attacker === "player" ? [0, 2_400, 4_800, 7_200] : [2_400, 4_800, 7_200],
    );
    expect(new Set(starts.map((attack) => attack.id)).size).toBe(starts.length);
    const contacts = combat.consumeHits().map((hit) => hit.atMs);
    expect(contacts).toEqual(starts.slice(0, -1).map((attack) => attack.contactAtMs));
  });

  it("resolves a lethal earlier contact before a later strike during catch-up", () => {
    const simulate = (catchUp: boolean) => {
      const { combat, state, targets, advanceTo } = setup((attacker) => ({
        contactMs: attacker === "enemy" ? 1 : 599,
        recoveryMs: 1_200,
      }));
      expect(combat.attack("target_a").ok).toBe(true);
      combat.engageEnemy("target_a", 0);
      advanceTo(2_400);
      const starts = combat.consumeAttackStarts().filter((attack) => attack.atMs === 2_400);
      expect(starts.map((attack) => attack.attacker).sort()).toEqual(["enemy", "player"]);
      const enemyContact = starts.find((attack) => attack.attacker === "enemy")!.contactAtMs;
      const laterPlayerContact = starts.find((attack) => attack.attacker === "player")!.contactAtMs;
      expect(enemyContact).toBeLessThan(laterPlayerContact);
      combat.consumeHits();
      const enemyHealthBefore = targets.get("target_a")!.combat!.health;
      state.player.health = 1;

      const finalTick = Math.ceil(laterPlayerContact / 100) * 100;
      if (catchUp) combat.tick(finalTick - 2_400, finalTick);
      else advanceTo(finalTick);

      const hits = combat.consumeHits();
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({
        attacker: "enemy", atMs: enemyContact, targetId: state.player.id, killed: true,
      });
      expect(state.player.health).toBe(0);
      expect(targets.get("target_a")!.combat!.health).toBe(enemyHealthBefore);
      expect(combat.isAttackCommitted(state.player.id)).toBe(false);
      return { hits, playerHealth: state.player.health, enemyHealth: targets.get("target_a")!.combat!.health };
    };

    expect(simulate(true)).toEqual(simulate(false));
  });
});


describe("enemy ranged attack lifecycle", () => {
  it.each(["ranged", "magic"] as const)("%s attacks at authored reach and resolves only at contact", (attackStyle) => {
    const { combat, state, targets, advanceTo, start } = setup();
    targets.get("target_a")!.position = [0, 0, 8];
    combat.setEnemyOverride("target_a", { attackStyle, attackRangeM: 10, attackLevel: 99, accuracy: 500, maxHit: 10 });
    const attack = start("enemy");
    expect(attack.kind).toBe(attackStyle);
    expect(combat.isAttackCommitted("target_a")).toBe(true);
    advanceTo(attack.contactAtMs - 1);
    expect(state.player.health).toBe(10_000);
    advanceTo(Math.ceil(attack.contactAtMs / 100) * 100);
    expect(combat.consumeHits()).toMatchObject([{ kind: attackStyle, hit: true }]);
    expect(state.player.health).toBeLessThan(10_000);
    advanceTo(Math.ceil(attack.recoverAtMs / 100) * 100);
    expect(combat.isAttackCommitted("target_a")).toBe(false);
    expect(combat.consumeHits()).toEqual([]);
  });

  it.each(["range", "realm", "death"] as const)("cancels or misses a ranged windup after leaving %s", (reason) => {
    const { combat, state, targets, advanceTo, start } = setup();
    targets.get("target_a")!.position = [0, 0, 8];
    combat.setEnemyOverride("target_a", { attackStyle: "ranged", attackRangeM: 10, attackLevel: 99, accuracy: 500, maxHit: 10 });
    const attack = start("enemy");
    if (reason === "range") state.player.position = [0, 0, -10];
    if (reason === "realm") state.player.regionId = "gravelmaw";
    if (reason === "death") combat.damageEnemy("target_a", 20_000, attack.atMs + 1);
    advanceTo(Math.ceil(attack.recoverAtMs / 100) * 100);
    expect(state.player.health).toBe(10_000);
    expect(combat.hits().filter(hit => hit.attacker === "enemy" && hit.damage > 0)).toEqual([]);
  });
});
