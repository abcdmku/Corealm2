import { beforeEach, describe, expect, it, vi } from "vitest";
import { SKILL_IDS, type EquipmentBonuses, type RegionId, type SemanticEntity, type SkillId } from "../game/src/contracts.js";
import { content } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { SPELLS } from "../game/src/content/spells.js";
import { EventBus } from "../game/src/core/events.js";
import { RngStreams } from "../game/src/core/rng.js";
import { Store } from "../game/src/state/store.js";
import { CombatSystem } from "../game/src/systems/combat.js";
import { InventorySystem } from "../game/src/systems/inventory.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

type Weapon = "melee" | "essence" | "charge";
type Participant = "source" | "target" | "both";
const GEAR: EquipmentBonuses = {
  meleeAccuracy: 500, meleePower: 50,  magicAccuracy: 500, magicPower: 50, defence: 0, health: 0, vitality: 0 };

function fixture(weapon: Weapon = "melee") {
  const store = new Store(7, 0);
  const state = store.get();
  state.player.regionId = "fallowmarch";
  state.player.position = [0, 0, 0];
  state.player.health = state.player.maxHealth = 10_000;
  state.inventory.slots.fill(null);
  state.equipment.mainHand = {
    itemId: weapon === "melee" ? "worn_sword" : weapon === "charge" ? "air_wand" : "basic_wooden_wand",
    quantity: 1,
  };
  state.magic.weaponCharges.air_wand = 10;
  state.combat.preferredSpellId = "voltrend";
  const target: SemanticEntity = {
    id: "realm_target", name: "Realm target", archetype: "enemy", tier: 1, regionId: "vellenwood",
    position: [0, 0, weapon === "melee" ? 1.2 : 14], state: "alive", interactions: ["attack", "cast"],
    combat: { health: 10_000, maxHealth: 10_000, level: 1, aggroRadius: 0 },
  };
  const events = new EventBus();
  let now = -100;
  const inventory = new InventorySystem({ store, events, now: () => now });
  expect(inventory.addItem("air_essence", 10).ok).toBe(true);
  const entities = { get: (id: string) => id === target.id ? target : undefined, all: () => [target] };
  const movement = { startPath: vi.fn(() => ({ pathLength: 1, etaMs: 100 })), stop: vi.fn(() => true) };
  const combat = new CombatSystem({
    store, events, inventory, entities, movement, rng: new RngStreams(7),
    equipment: { totals: () => GEAR, slots: () => state.equipment },
    meleeTiming: () => ({ contactMs: 735, recoveryMs: 1_425 }),
    dispatcher: new InteractionDispatcher({
      get: entities.get, playerPosition: () => state.player.position,
      skillLevels: () => Object.fromEntries(SKILL_IDS.map((id) => [id, state.skills[id].level])) as Record<SkillId, number>,
    }),
  });
  const provoked = vi.fn();
  combat.onEnemyProvoked(provoked);
  const advanceTo = (untilMs: number) => {
    while (now + 100 <= untilMs) {
      now += 100;
      combat.tick(100, now);
      events.flush();
    }
  };
  const changeRealm = (participant: Participant, regionId: RegionId) => {
    const y = regionId === "gravelmaw" ? -25 : 0;
    if (participant !== "target") {
      state.player.regionId = regionId;
      state.player.position = [0, y, 0];
    }
    if (participant !== "source") {
      target.regionId = regionId;
      target.position = [target.position[0], y, target.position[2]];
    }
  };
  const paidState = () => ({
    essence: inventory.countItem("air_essence"), charges: state.magic.weaponCharges.air_wand,
    meleeXp: state.skills.melee.xp, magicXp: state.skills.magic.xp,
    currency: state.currency, loot: structuredClone(state.world.lootPiles),
  });
  return { state, target, events, inventory, movement, combat, provoked, advanceTo, changeRealm, paidState };
}

beforeEach(() => content.register({ items: ALL_ITEMS, spells: SPELLS }));

describe("combat realm ownership", () => {
  it.each(["melee", "essence", "charge"] as const)("refuses direct off-realm %s commands in both directions without side effects", (weapon) => {
    for (const sourceRegion of ["fallowmarch", "gravelmaw"] as const) {
      const sim = fixture(weapon);
      sim.changeRealm("source", sourceRegion);
      sim.changeRealm("target", sourceRegion === "gravelmaw" ? "karrowmoor" : "gravelmaw");
      const before = structuredClone(sim.state);
      expect(sim.combat.attack(sim.target.id)).toMatchObject({ ok: false, error: { code: "OUT_OF_RANGE" } });
      if (weapon !== "melee") {
        expect(sim.combat.cast("voltrend", sim.target.id)).toMatchObject({ ok: false, error: { code: "OUT_OF_RANGE" } });
      }
      expect(sim.state).toEqual(before);
      sim.advanceTo(5_000);
      expect(sim.paidState()).toEqual({
        essence: 10, charges: 10, meleeXp: 0, magicXp: 0, currency: before.currency, loot: {},
      });
      expect(sim.combat.hits()).toEqual([]);
      expect(sim.movement.startPath).not.toHaveBeenCalled();
      expect(sim.provoked).not.toHaveBeenCalled();
      expect(sim.events.since(0, ["spell.launched", "combat.started"]).events).toEqual([]);
    }
  });

  it.each(["melee", "essence", "charge"] as const)("cancels a queued %s command before launch if both participants change realm", (weapon) => {
    const sim = fixture(weapon);
    sim.state.combat.nextAttackAtMs = 1_200;
    expect(sim.combat.attack(sim.target.id).ok).toBe(true);
    const before = sim.paidState();
    sim.changeRealm("both", "gravelmaw");
    sim.advanceTo(5_000);
    expect(sim.state.combat.targetId).toBeNull();
    expect(sim.state.combat.activeSpellId).toBeNull();
    expect(sim.state.combat.nextAttackAtMs).toBe(1_200);
    expect(sim.paidState()).toEqual(before);
    expect(sim.combat.hits()).toEqual([]);
    expect(sim.combat.consumeAttackStarts()).toEqual([]);
    expect(sim.events.since(0, ["spell.launched"]).events).toEqual([]);
  });

  it.each(["source", "target", "both"] as const)("permanently cancels a player melee windup when its %s changes realm", (participant) => {
    const sim = fixture();
    expect(sim.combat.attack(sim.target.id).ok).toBe(true);
    sim.advanceTo(0);
    const attack = sim.combat.consumeAttackStarts()[0]!;
    expect(attack.contactAtMs).toBe(735);
    expect(sim.combat.isAttackCommitted(sim.state.player.id)).toBe(true);
    const before = sim.paidState();
    const cooldown = sim.state.combat.nextAttackAtMs;
    sim.changeRealm(participant, "gravelmaw");
    sim.advanceTo(100);
    expect(sim.combat.isAttackCommitted(sim.state.player.id)).toBe(false);
    sim.changeRealm(participant, "karrowmoor");
    sim.advanceTo(5_000);
    expect(sim.combat.hits()).toEqual([]);
    expect(sim.target.combat!.health).toBe(10_000);
    expect(sim.paidState()).toEqual(before);
    expect(sim.state.combat.nextAttackAtMs).toBe(cooldown);
    expect(sim.state.combat.targetId).toBeNull();
    expect(sim.provoked).not.toHaveBeenCalled();
  });

  it.each([
    ["essence", "source"], ["essence", "target"], ["essence", "both"],
    ["charge", "source"], ["charge", "target"], ["charge", "both"],
  ] as const)("cancels an in-flight %s spell when its %s changes realm, even after returning", (weapon, participant) => {
    const sim = fixture(weapon);
    sim.target.combat!.health = 1; // The seeded hit would otherwise kill and pay its rewards.
    expect(sim.combat.cast("voltrend", sim.target.id).ok).toBe(true);
    sim.advanceTo(0);
    const launch = sim.events.since(0, ["spell.launched"]).events[0]!;
    expect(launch.data.hit).toBe(true);
    expect(Number(launch.data.flightMs)).toBeGreaterThan(200);
    const paid = sim.paidState();
    expect(paid.magicXp).toBe(SPELLS.find((spell) => spell.id === "voltrend")!.baseXp);
    expect(paid.essence).toBe(weapon === "essence" ? 9 : 10);
    expect(paid.charges).toBe(weapon === "charge" ? 9 : 10);
    sim.changeRealm(participant, "gravelmaw");
    sim.advanceTo(100);
    sim.changeRealm(participant, "karrowmoor");
    sim.advanceTo(5_000);
    // A legitimate launch remains paid. Travel cannot refund it or produce another receipt/hit.
    expect(sim.paidState()).toEqual(paid);
    expect(sim.combat.hits()).toEqual([]);
    expect(sim.target.combat!.health).toBe(1);
    expect(sim.target.state).toBe("alive");
    expect(sim.provoked).not.toHaveBeenCalled();
    expect(sim.events.since(0, ["spell.launched"]).events).toHaveLength(1);
    expect(sim.events.since(0, ["combat.ended"]).events.some((event) => event.data.reason === "killed")).toBe(false);
  });

  it.each(["melee", "essence", "charge"] as const)("allows a committed %s attack to finish across surface region borders", (weapon) => {
    const sim = fixture(weapon);
    expect(sim.combat.attack(sim.target.id).ok).toBe(true);
    sim.advanceTo(0);
    const paid = sim.paidState();
    sim.changeRealm("source", "kilnhalt");
    sim.changeRealm("target", "karrowmoor");
    sim.advanceTo(1_000);
    const hits = sim.combat.consumeHits();
    expect(hits).toHaveLength(1);
    expect(hits[0]!.damage).toBeGreaterThan(0);
    expect(sim.target.combat!.health).toBe(10_000 - hits[0]!.damage);
    const after = sim.paidState();
    expect(after.essence).toBe(paid.essence);
    expect(after.charges).toBe(paid.charges);
    expect(weapon === "melee" ? after.meleeXp : after.magicXp)
      .toBe((weapon === "melee" ? paid.meleeXp : paid.magicXp) + hits[0]!.damage * 4);
    expect(sim.provoked).toHaveBeenCalledOnce();
  });
});
