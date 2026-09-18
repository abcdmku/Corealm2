import { beforeAll, describe, expect, it } from "vitest";
import { WORLD_LAB_CONTENT_VERSION, WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { HeadlessWorld, type HeadlessWorldPorts } from "../game/src/multiplayer/headlessWorld.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";

const descriptor: WorldDescriptor = { providerId: "reference", worldId: "aggro", name: "Aggro", endpoint: "ws://127.0.0.1/",
  protocolVersion: WORLD_PROTOCOL_VERSION, contentVersion: WORLD_LAB_CONTENT_VERSION, seed: 1337,
  capacity: 20, population: 0, availability: "available" };
let ports: HeadlessWorldPorts;
beforeAll(async () => { ports = await createMultiplayerLabWorld(); });

function fixture(order = ["bystander", "attacker"], twoFrogs = false): HeadlessWorld {
  const frog = structuredClone(ports.entities.find(entity => entity.id === "multiplayer:frog")!);
  // Keep the production creature alive long enough to observe several real retaliation beats.
  frog.combat!.health = frog.combat!.maxHealth = 1000;
  const entities = [frog];
  if (twoFrogs) {
    const other = structuredClone(frog); other.id = "multiplayer:other-frog"; other.position = [-12, 0, 0];
    entities.push(other);
  }
  const world = new HeadlessWorld(descriptor, { ...ports, entities,
    movement: { ...ports.movement, regionAt: (_point, currentRegion) => currentRegion } });
  for (const id of order) {
    const player = world.join(id).store.get().player;
    player.position = id === "bystander" ? [11.5, 0, 0] : [10.8, 0, 0];
    player.health = player.maxHealth = 1000;
    world.tick();
  }
  world.tick();
  return world;
}

function until(world: HeadlessWorld, predicate: () => boolean, ticks = 100): void {
  for (let i = 0; i < ticks && !predicate(); i++) world.tick();
  expect(predicate()).toBe(true);
}

function strike(world: HeadlessWorld, playerId = "attacker", enemyId = "multiplayer:frog"): void {
  const cursor = world.actions.currentSequence();
  expect(world.execute(playerId, { method: "attack", args: [enemyId] }).ok).toBe(true);
  until(world, () => world.actions.since(cursor).some(action => action.type === "hit"
    && action.hit.attacker === "player" && action.hit.sourceId === playerId && action.hit.targetId === enemyId));
  expect(world.execute(playerId, { method: "stop", args: [] }).ok).toBe(true);
}

function enemyStarts(world: HeadlessWorld, since = 0, enemyId = "multiplayer:frog") {
  return world.actions.since(since).flatMap(action => action.type === "attack"
    && action.attack.attacker === "enemy" && action.attack.sourceId === enemyId ? [action.attack] : []);
}

describe("authoritative multiplayer aggro ownership", () => {
  it.each([["bystander", "attacker"], ["attacker", "bystander"]])(
    "retaliates against the real attacker with join order %s, %s", (first, second) => {
      const world = fixture([first, second]);
      strike(world);
      const attacker = world.players.get("attacker")!, bystander = world.players.get("bystander")!;
      expect(attacker.combat.isEngaged("multiplayer:frog")).toBe(true);
      expect(bystander.combat.isEngaged("multiplayer:frog")).toBe(false);
      until(world, () => enemyStarts(world).length >= 2);
      expect(new Set(enemyStarts(world).map(attack => attack.targetId))).toEqual(new Set(["attacker"]));
      expect(bystander.store.get().player.health).toBe(bystander.store.get().player.maxHealth);
    },
  );

  it("uses the struck monster's owner rather than the last monster's AI context", () => {
    const world = fixture(["attacker", "bystander"], true);
    world.players.get("bystander")!.store.get().player.position = [-11, 0, 0];
    world.tick();
    strike(world);
    expect(world.players.get("attacker")!.combat.isEngaged("multiplayer:frog")).toBe(true);
    expect(world.players.get("bystander")!.combat.isEngaged("multiplayer:frog")).toBe(false);
    strike(world, "bystander", "multiplayer:other-frog");
    until(world, () => enemyStarts(world).length > 0 && enemyStarts(world, 0, "multiplayer:other-frog").length > 0);
    expect(enemyStarts(world).every(attack => attack.targetId === "attacker")).toBe(true);
    expect(enemyStarts(world, 0, "multiplayer:other-frog").every(attack => attack.targetId === "bystander")).toBe(true);
  });

  it("notices a later nearby player while an aggressive enemy is still idle", () => {
    const caster = structuredClone(ports.entities.find(entity => entity.id === "multiplayer:caster")!);
    const world = new HeadlessWorld(descriptor, { ...ports, entities: [caster] });
    const first = world.join("first");
    first.store.get().player.position = [caster.position[0] - 25, 0, caster.position[2]];
    world.tick();
    expect(first.combat.isEngaged(caster.id)).toBe(false);
    const later = world.join("later");
    later.store.get().player.position = [caster.position[0] - 2, 0, caster.position[2]];
    world.tick();
    expect(later.combat.isEngaged(caster.id)).toBe(true);
    expect(first.combat.isEngaged(caster.id)).toBe(false);
    until(world, () => enemyStarts(world, 0, caster.id).length > 0);
    expect(enemyStarts(world, 0, caster.id).every(attack => attack.targetId === "later")).toBe(true);
  });

  it("claims an idle enemy on spell arrival without provoking on the cast command", () => {
    const world = fixture(), player = world.players.get("attacker")!;
    player.store.get().player.position = [4, 0, 0];
    player.store.get().inventory.slots[0] = { itemId: "air_essence", quantity: 30, slotIndex: 0 };
    expect(world.execute("attacker", { method: "cast", args: ["voltrend", "multiplayer:frog"] }).ok).toBe(true);
    expect(player.combat.isEngaged("multiplayer:frog")).toBe(false);
    world.tick();
    expect(player.combat.isEngaged("multiplayer:frog")).toBe(false);
    until(world, () => player.combat.isEngaged("multiplayer:frog"));
    expect(world.players.get("bystander")!.combat.isEngaged("multiplayer:frog")).toBe(false);
    until(world, () => enemyStarts(world).length > 0);
    expect(enemyStarts(world)[0]!.targetId).toBe("attacker");
  });

  it("keeps an active enemy windup when another player hits the same monster", () => {
    const world = fixture();
    strike(world);
    until(world, () => enemyStarts(world).length > 0);
    const current = enemyStarts(world).at(-1)!;
    strike(world, "bystander");
    until(world, () => world.actions.since(0).some(action => action.type === "hit"
      && action.hit.attacker === "enemy" && action.hit.atMs === current.contactAtMs));
    expect(world.players.get("attacker")!.combat.isEngaged("multiplayer:frog")).toBe(true);
    expect(world.players.get("bystander")!.combat.isEngaged("multiplayer:frog")).toBe(false);
    expect(enemyStarts(world).every(attack => attack.targetId === "attacker")).toBe(true);
  });

  it.each(["leave", "death", "realm", "distance"] as const)(
    "cancels the old committed attack and hands off on target %s", reason => {
      const world = fixture(), attacker = world.players.get("attacker")!, bystander = world.players.get("bystander")!;
      strike(world);
      until(world, () => attacker.combat.isAttackCommitted("multiplayer:frog"));
      const cursor = world.actions.currentSequence();
      if (reason === "leave") world.leave("attacker");
      if (reason === "death") attacker.store.get().player.health = 0;
      if (reason === "realm") attacker.store.get().player.regionId = "gravelmaw";
      if (reason === "distance") attacker.store.get().player.position = [-100, 0, -100];
      until(world, () => bystander.combat.isEngaged("multiplayer:frog"));
      expect(attacker.combat.isEngaged("multiplayer:frog")).toBe(false);
      expect(attacker.combat.isAttackCommitted("multiplayer:frog")).toBe(false);
      until(world, () => enemyStarts(world, cursor).length > 0);
      const actions = world.actions.since(cursor);
      expect(actions.some(action => action.type === "attackCancelled" && action.playerId === "attacker"
        && action.sourceId === "multiplayer:frog")).toBe(true);
      expect(actions.some(action => action.type === "hit" && action.hit.attacker === "enemy"
        && action.hit.targetId === "attacker")).toBe(false);
      expect(enemyStarts(world, cursor).every(attack => attack.targetId === "bystander")).toBe(true);
    },
  );
});
