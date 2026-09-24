import { runtimeTables } from "../game/src/content/runtimeCatalog.js";
import { CREATURE_MOTION_TIMING } from "../game/src/content/creatureMotionTiming.js";
import { ALL_SPELLS } from "../game/src/content/spells.js";
import { content } from "../game/src/content/index.js";
import { beforeAll, describe, expect, it } from "vitest";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { HeadlessWorld, type HeadlessWorldPorts } from "../game/src/multiplayer/headlessWorld.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { playerSessionState } from "../game/src/state/store.js";

const descriptor: WorldDescriptor = { providerId: "reference", worldId: "yard", name: "Yard", endpoint: "ws://127.0.0.1:4180/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 1000, availability: "available" };
let ports: HeadlessWorldPorts;
beforeAll(async () => { ports = await createMultiplayerLabWorld(); });
describe("headless production world", () => {
  it.each(["authored", "lab"] as const)("uses the browser's resolved content for the %s fixture", fixture => {
    new HeadlessWorld({ ...descriptor, fixture }, ports);
    const expected = runtimeTables(fixture === "lab");
    expect(content.allItems()).toEqual(expected.items);
    expect(content.allRecipes()).toEqual(expected.recipes);
    expect(content.allResources()).toEqual(expected.resources);
    expect(content.allEnemies()).toEqual([...new Map(expected.enemies.map(enemy => [enemy.id, enemy])).values()]);
  });
  it("registers the complete production spellbook on the authority", () => {
    new HeadlessWorld(descriptor, ports);
    expect(content.allSpells().map(spell => spell.id)).toEqual(ALL_SPELLS.map(spell => spell.id));
  });
  it("leaves unobserved idle actors dormant and resumes them near an active player", () => {
    const world = new HeadlessWorld(descriptor, ports);
    const enemy = world.entities.get("multiplayer:frog")!;
    const before = structuredClone(enemy.position);
    for (let i = 0; i < 30; i++) world.tick();
    expect(enemy.position).toEqual(before);
    expect(world.shared.enemies[enemy.id]).toBeUndefined();
    const player = world.join("nearby");
    player.store.get().player.position = [enemy.position[0] - 1, 0, enemy.position[2]];
    world.tick();
    expect(world.shared.enemies[enemy.id]).toBeDefined();
  });
  it.each(["fixture frog", "Beetle Golem", "fast Beetle Golem"] as const)("publishes %s contact and recovery while preserving player melee timing", (creature) => {
    const world = new HeadlessWorld(descriptor, ports);
    const player = world.join("timing");
    const frog = world.entities.get("multiplayer:frog")!;
    if (creature !== "fixture frog") {
      frog.view = { ...frog.view!, assetId: "creature_beetle_golem" };
      player.combat.setEnemyOverride(frog.id, { attackSpeedMs: creature === "fast Beetle Golem" ? 600 : 3_000 });
    }
    const timing = CREATURE_MOTION_TIMING[frog.view!.assetId];
    expect(timing).toBeDefined();
    frog.combat!.health = frog.combat!.maxHealth = 10_000;
    player.store.get().player.position = [frog.position[0] - 1, 0, frog.position[2]];
    player.store.get().equipment.mainHand = { itemId: "worn_sword", quantity: 1 };
    world.tick();
    const sequence = world.actions.currentSequence();
    expect(world.execute("timing", { method: "attack", args: [frog.id] }).ok).toBe(true);
    player.combat.engageEnemy(frog.id, world.clock.elapsedMs);
    let attacks: Extract<ReturnType<typeof world.actions.since>[number], { type: "attack" }>[] = [];
    for (let i = 0; i < 50 && (!attacks.some((action) => action.attack.attacker === "enemy")
      || !attacks.some((action) => action.attack.attacker === "player")); i++) {
      world.tick();
      attacks = world.actions.since(sequence).filter((action) => action.type === "attack");
    }
    const enemy = attacks.find((action) => action.attack.attacker === "enemy")?.attack;
    const own = attacks.find((action) => action.attack.attacker === "player")?.attack;
    expect(enemy).toBeDefined();
    expect(own).toBeDefined();
    expect(enemy!.sourceId).toBe(frog.id);
    const recoveryMs = creature === "fast Beetle Golem" ? 600 : timing!.seconds * 1000;
    expect(enemy!.contactAtMs - enemy!.atMs).toBeCloseTo(recoveryMs * timing!.contactNormalized, 3);
    expect(enemy!.recoverAtMs - enemy!.atMs).toBeCloseTo(recoveryMs, 3);
    if (creature === "Beetle Golem") {
      expect(enemy!.contactAtMs - enemy!.atMs).toBeCloseTo(560, 3);
      expect(enemy!.recoverAtMs - enemy!.atMs).toBeCloseTo(1_140, 3);
    }
    expect(own!.contactAtMs - own!.atMs).toBe(350);
    expect(own!.recoverAtMs - own!.atMs).toBe(900);
  });
  it("expires shared loot while no players are connected",()=>{
    const world=new HeadlessWorld(descriptor,ports);
    world.shared.lootPiles.pile={position:[0,0,0],items:[{itemId:"grithe_ore",quantity:1}],expiresAtMs:100,ownerOnly:false};
    world.entities.add({id:"pile",archetype:"loot",name:"Loot",tier:1,regionId:"fallowmarch",position:[0,0,0],state:"available",interactions:["loot"]});
    world.tick();expect(world.shared.lootPiles.pile).toBeDefined();world.tick();
    expect(world.shared.lootPiles.pile).toBeUndefined();expect(world.entities.get("pile")).toBeUndefined();
    expect(world.players.size).toBe(0);
  });
  it("persists independent server random streams without placing them in private replication", () => {
    const world=new HeadlessWorld(descriptor,ports),a=world.join("a"),b=world.join("b");
    expect(a.random.get("combat").next()).not.toBe(b.random.get("combat").next());
    for(let i=0;i<9;i++)a.random.get("loot").next();
    const saved=world.snapshot(); const expected=a.random.get("loot").next();
    const restored=new HeadlessWorld(descriptor,ports,saved);
    expect(restored.join("a").random.get("loot").next()).toBe(expected);
    expect(saved.players.a).not.toHaveProperty("random");
  });
  it("uses each player's door state with one shared navmesh", () => {
    const door={id:"private-door",name:"Gate",archetype:"door" as const,tier:1,regionId:"fallowmarch" as const,
      position:[0,0,4] as [number,number,number],state:"locked",interactions:[]};
    const world=new HeadlessWorld(descriptor,{...ports,entities:[...ports.entities,door],
      doorBarriers:[{id:door.id,position:door.position,size:[30,5,.5],rotationY:0}]});
    const a=world.join("a"),b=world.join("b"); a.questEntities.set(door.id,{...door,state:"open"});
    world.execute("a",{method:"moveTo",args:[{position:[0,0,8]}]});
    world.execute("b",{method:"moveTo",args:[{position:[0,0,8]}]});
    for(let tick=0;tick<40;tick++)world.tick();
    expect(a.store.get().player.position[2]).toBeGreaterThan(6);
    expect(b.store.get().player.position[2]).toBeLessThan(4);
    expect(world.entities.get(door.id)!.state).toBe("locked");
  });
  it("runs hunt commands against private durable progression and rejects forged rewards", () => {
    const world = new HeadlessWorld(descriptor, ports); const a = world.join("a"); const b = world.join("b");
    const before = structuredClone(b.store.get().huntContracts);
    const serial = a.store.get().huntContracts.offerSerial;
    expect(world.execute("a", { method: "hunt", args: ["refresh"] }).ok).toBe(true);
    expect(a.store.get().huntContracts.offerSerial).toBe(serial + 1);
    expect(world.execute("a", { method: "hunt", args: ["accept", "forged"] }).ok).toBe(false);
    expect(world.execute("a", { method: "hunt", args: ["claim"] }).ok).toBe(false);
    expect(b.store.get().huntContracts).toEqual(before);
    const restored = new HeadlessWorld(descriptor, ports, world.snapshot());
    expect(restored.join("a").store.get().huntContracts).toEqual(a.store.get().huntContracts);
  });
  it("walks into range and starts gathering through the production command API", () => {
    const world = new HeadlessWorld(descriptor, ports); const a = world.join("a");
    a.store.get().skills.mining.level = 99;
    const result = world.execute("a", { method: "interact", args: ["multiplayer:ore", "mine"] });
    expect(result.ok).toBe(true);
    for (let i = 0; i < 80; i++) world.tick();
    expect(a.store.get().inventory.slots.some((slot) => slot?.itemId === "grithe_ore")).toBe(true);
  });
  it("shares one world while player progression remains private", () => {
    const world = new HeadlessWorld(descriptor, ports); const a = world.join("a"); const b = world.join("b");
    expect(a.store.get().world.nodes).toBe(b.store.get().world.nodes);
    expect(a.store.get().inventory).not.toBe(b.store.get().inventory);
    a.store.get().currency = 50;
    expect(b.store.get().currency).toBe(0);
    expect(playerSessionState(a.store.get())).not.toHaveProperty("world");
    expect(playerSessionState(a.store.get())).not.toHaveProperty("settings");
  });
  it("moves through production navigation and expires lost steering input", () => {
    const world = new HeadlessWorld(descriptor, ports); const a = world.join("a");
    world.execute("a", { method: "steer", args: [1, 0] });
    for (let i = 0; i < 25; i++) world.tick();
    const stopped = [...a.store.get().player.position];
    expect(stopped[0]).toBeGreaterThan(0); expect(stopped[0]).toBeLessThan(4);
    for (let i = 0; i < 10; i++) world.tick();
    expect(a.store.get().player.position).toEqual(stopped);
  });
  it("resolves the last resource yield once for two competing gatherers", () => {
    const world = new HeadlessWorld(descriptor, ports); const a = world.join("a"); const b = world.join("b");
    const node = world.entities.get("multiplayer:ore")!;
    node.resource!.remaining = 1; node.resource!.maxYields = 1;
    for (const player of [a, b]) {
      player.store.get().player.position = [5, 0, 0];
      player.store.get().skills.mining = { level: 99, xp: 0 };
      expect(player.gathering.begin(node, "mine").ok).toBe(true);
    }
    const before = [a, b].map((player) => player.store.get().inventory.slots.reduce((sum, slot) => sum + (slot?.itemId === "grithe_ore" ? slot.quantity : 0), 0));
    for (let i = 0; i < 100 && node.resource!.remaining > 0; i++) world.tick();
    const after = [a, b].map((player) => player.store.get().inventory.slots.reduce((sum, slot) => sum + (slot?.itemId === "grithe_ore" ? slot.quantity : 0), 0));
    expect(after[0]! + after[1]! - before[0]! - before[1]!).toBe(1);
    expect(world.shared.nodes[node.id]?.remaining).toBe(0);
  });
  it("rejects another player's private loot and restores independent progression", () => {
    const world = new HeadlessWorld(descriptor, ports); const a = world.join("a"); world.join("b");
    world.entities.add({ id: "pile", name: "Drop", archetype: "loot", tier: 1, regionId: "fallowmarch", position: [0, 0, 0], state: "available", interactions: ["inspect", "loot"] });
    world.shared.lootPiles.pile = { position: [0, 0, 0], items: [{ itemId: "grithe_ore", quantity: 1 }], expiresAtMs: 60_000, ownerOnly: true, ownerId: "a" };
    expect(world.execute("b", { method: "takeLoot", args: ["pile"] }).ok).toBe(false);
    expect(world.execute("a", { method: "takeLoot", args: ["pile"] }).ok).toBe(true);
    a.store.get().currency = 77; const saved = world.snapshot();
    const restored = new HeadlessWorld(descriptor, ports, saved);
    expect(restored.join("a").store.get().currency).toBe(77);
    expect(restored.join("b").store.get().currency).toBe(0);
    expect(restored.shared.lootPiles.pile).toBeUndefined();
  });
});
