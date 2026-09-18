import { beforeAll, expect, it } from "vitest";
import { WORLD_LAB_CONTENT_VERSION, WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { HeadlessWorld, type HeadlessWorldPorts } from "../game/src/multiplayer/headlessWorld.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { Replicator, ReplicatedState, ReplicationFrame } from "../game/src/multiplayer/replication.js";
import { PublicActions, publicPresentation } from "../game/src/multiplayer/publicActions.js";
import { ActorInterpolation } from "../game/src/multiplayer/interpolation.js";
import { ALL_SPELLS, SPELL_RUNES } from "../game/src/content/spells.js";
import { setSkillLevel } from "../game/src/state/store.js";
import { command } from "../game/src/multiplayer/protocol.js";

const descriptor: WorldDescriptor = { providerId: "reference", worldId: "actions", name: "Actions", endpoint: "ws://127.0.0.1/",
  protocolVersion: WORLD_PROTOCOL_VERSION, contentVersion: WORLD_LAB_CONTENT_VERSION, seed: 1337, capacity: 1000, population: 0, availability: "available" };
let ports: HeadlessWorldPorts;
beforeAll(async () => { ports = await createMultiplayerLabWorld(); });

it("retains ordered recent public actions across the bounded log's wrap",()=>{
  const world=new HeadlessWorld(descriptor,ports),state=world.join("alice").store.get(),log=new PublicActions();
  for(let i=0;i<4200;i++)log.publish(state,{type:"gesture",pose:"bank",atMs:i});
  expect(log.since(0)).toHaveLength(4096);
  expect(log.since(4197).map(action=>action.sequence)).toEqual([4198,4199,4200]);
  expect(log.since(4200)).toEqual([]);
  expect(log.since(0)[0]!.sequence).toBe(105);
});

it("does not rewind a remote actor when RAF predates a socket callback",()=>{
  const actor=new ActorInterpolation([0,0,0]);actor.push([1,0,0],0,Math.PI/2,500);
  const position=actor.sample(120),facing=actor.facing(120);
  expect(actor.sample(105)).toEqual(position);expect(actor.facing(105)).toBe(facing);
  expect(actor.sample(140)[0]).toBeGreaterThan(position[0]);
});

it.each(ALL_SPELLS)("publishes the production $id cast to another player", spell => {
  const world=new HeadlessWorld(descriptor,ports),a=world.join("alice");world.join("bob");
  const state=a.store.get();state.player.position=[10,0,0];setSkillLevel(state,"magic",99);
  state.inventory.slots.fill(null);
  for(const [index,itemId] of ["air_essence","earth_essence","water_essence","fire_essence",...SPELL_RUNES.map(r=>r.itemId)].entries())
    state.inventory.slots[index]={itemId,quantity:100,slotIndex:index};
  const r=new Replicator("b","bob");r.update(world,0,new Map(),true);
  const input=command(spell.aoe?{method:"castArea",args:[spell.id,[12,0,0]]}:{method:"cast",args:[spell.id,"multiplayer:frog"]});
  const result=world.execute("alice",input);expect(result.ok,JSON.stringify(result)).toBe(true);world.tick();
  expect(r.update(world,0,new Map()).actions?.some(action=>action.type==="spell"&&action.spellId===spell.id)).toBe(true);
});

it("keeps death cues at the combat scene and hides recovery cache contents from observers",()=>{
  const world=new HeadlessWorld(descriptor,ports),a=world.join("alice"),b=world.join("bob");
  a.store.get().player.position=[30,0,0];b.store.get().player.position=[30,0,2];world.tick();
  const r=new Replicator("b","bob");r.update(world,0,new Map(),true);
  a.store.get().player.health=0;world.tick();
  const update=r.update(world,0,new Map());
  expect(update.actions?.find(a=>a.type==="death")?.position).toEqual([30,0,0]);
  expect(a.store.get().player.position).toEqual(ports.spawn);
  expect(update.entities.some(e=>e.archetype==="recovery_cache")).toBe(false);
  expect(JSON.stringify(update.actions)).not.toMatch(/itemsLost|expires|cacheId/);
});

it("publishes an actual fatal enemy hit at its pre-respawn position",()=>{
  const world=new HeadlessWorld(descriptor,ports),a=world.join("alice"),b=world.join("bob");
  const caster=world.entities.get("multiplayer:caster")!,position:[number,number,number]=[caster.position[0]-2,0,caster.position[2]];
  a.store.get().player.position=position;a.store.get().player.health=1;
  b.store.get().player.position=[position[0]-3,0,position[2]-3];
  a.combat.engageEnemy(caster.id,0);world.tick();
  const r=new Replicator("b","bob");r.update(world,0,new Map(),true);
  for(let i=0;i<100&&!a.store.get().world.recoveryCache;i++){a.random.get("combat").setState(0);world.tick();}
  const update=r.update(world,0,new Map()),fatal=update.actions?.find(action=>action.type==="hit"&&action.hit.targetId==="alice"&&action.hit.killed);
  expect(fatal?.position).toEqual(position);expect(a.store.get().player.position).toEqual(ports.spawn);
  expect(update.actions?.some(action=>action.type==="death"&&action.playerId==="alice")).toBe(true);
});

it("hands off an aggro enemy without retaining its previous target's attack or engagement",()=>{
  const world=new HeadlessWorld(descriptor,ports),a=world.join("alice"),b=world.join("bob");
  const caster=world.entities.get("multiplayer:caster")!;
  a.store.get().player.position=[caster.position[0]-2,0,caster.position[2]];
  b.store.get().player.position=[caster.position[0]-4,0,caster.position[2]-3];
  world.tick();a.combat.engageEnemy(caster.id,0);
  for(let i=0;i<80&&!a.combat.isAttackCommitted(caster.id);i++)world.tick();
  expect(a.combat.isAttackCommitted(caster.id)).toBe(true);
  const oldPosition=[...a.store.get().player.position],sequence=world.actions.currentSequence();
  a.store.get().player.position=[-100,0,-100];world.tick();
  expect(a.combat.isEngaged(caster.id)).toBe(false);expect(a.combat.isAttackCommitted(caster.id)).toBe(false);
  expect(b.combat.isEngaged(caster.id)).toBe(true);
  expect(world.actions.since(sequence).find(action=>action.type==="attackCancelled"&&action.playerId==="alice")?.position).toEqual(oldPosition);
});

it("replicates production melee windup and impact once to the owner and observer", () => {
  const world = new HeadlessWorld(descriptor, ports), a = world.join("alice"); world.join("bob");
  const frog = world.entities.get("multiplayer:frog")!;
  a.store.get().player.position = [11, 0, 0];
  a.store.get().equipment.mainHand = { itemId: "worn_sword", quantity: 1 };
  const replicas = [new Replicator("a", "alice"), new Replicator("b", "bob")];
  for (const r of replicas) r.update(world, 0, new Map(), true);
  expect(world.execute("alice", { method: "attack", args: [frog.id] }).ok).toBe(true);
  const received = replicas.map(() => [] as string[]);
  for (let i = 0; i < 20; i++) {
    world.tick(); replicas.forEach((r, index) => received[index]!.push(...(r.update(world, 0, new Map()).actions ?? [])
      .filter(action => action.playerId === "alice").map(action => action.type)));
  }
  expect(received[0]).toContain("attack"); expect(received[0]).toContain("hit"); expect(received[1]).toEqual(received[0]);
  expect(replicas[1]!.update(world, 0, new Map()).actions).toBeUndefined();
  expect(replicas[1]!.update(world, 0, new Map(), true).actions).toBeUndefined();
});

it("publishes only allowed spell fields and filters by realm and distance", () => {
  const world = new HeadlessWorld(descriptor, ports), a = world.join("alice"), b = world.join("bob");
  const r = new Replicator("b", "bob"); r.update(world, 0, new Map(), true);
  const cast = () => { a.events.emit("spell.launched", { spellId: "voltrend", targetId: "multiplayer:frog", flightMs: 700, hit: true,
    remainingEssence: 987654, remainingCharges: 345678, fuelSource: "private", aim: [12,0,0] }); a.events.flush(); };
  cast();
  const update = r.update(world, 0, new Map());
  expect(update.actions).toHaveLength(1); expect(update.events).toEqual([]);
  expect(JSON.stringify(update.actions)).not.toMatch(/remaining|fuelSource|987654|345678/);
  a.events.emit("quest.updated", { secret: "quest" }); a.events.emit("item.received", { secret: "inventory" }); a.events.flush();
  expect(r.update(world, 0, new Map()).actions).toBeUndefined();
  b.store.get().player.position = [100,0,0]; cast(); expect(r.update(world, 0, new Map()).actions).toBeUndefined();
  b.store.get().player.position = [0,0,0]; b.store.get().player.regionId = "gravelmaw";
  cast(); expect(r.update(world, 0, new Map()).actions).toBeUndefined();
});

it("sends activity transitions immediately in a crowd and restores them in snapshots", () => {
  const world = new HeadlessWorld(descriptor, ports);
  for (let i=0;i<140;i++) world.join(`p${i}`);
  const a = world.players.get("p139")!, r = new Replicator("b", "p0"), cache = new Map<string,string>();
  r.update(world, 0, new ReplicationFrame(world, cache), true);
  a.store.get().activity = { kind: "gathering", skill: "mining", entityId: "multiplayer:ore", nodeTier: 1, startedAtMs: 0, nextRollAtMs: 3000, yieldsThisSession: 3 };
  const delta = r.update(world, 0, new ReplicationFrame(world, cache));
  expect(delta.players.find(p => p.id === "p139")?.presentation).toMatchObject({ pose: "mine", toolItemId: "worn_pickaxe" });
  expect(JSON.stringify(delta.players)).not.toContain("yieldsThisSession");
  expect(r.update(world, 0, new Map(), true).players.find(p=>p.id === "p139")?.presentation?.pose).toBe("mine");
  a.store.get().activity = null;
  expect(r.update(world, 0, new ReplicationFrame(world, cache)).players.find(p=>p.id === "p139")?.presentation?.pose).toBe("idle");
});

it("projects every persistent player activity without private fields", () => {
  const world = new HeadlessWorld(descriptor, ports), state = world.join("a").store.get();
  const examples = [
    [{kind:"gathering",skill:"woodcutting"},"chop"], [{kind:"gathering",skill:"fishing"},"fish"],
    [{kind:"production",recipeId:"secret"},"produce"], [{kind:"building_campfire"},"produce"],
    [{kind:"eating",itemId:"secret"},"eat"], [{kind:"traversing"},"climb"],
  ] as const;
  for (const [activity, pose] of examples) {
    state.activity = activity as typeof state.activity;
    expect(publicPresentation(state).pose).toBe(pose); expect(JSON.stringify(publicPresentation(state))).not.toContain("secret");
  }
  state.player.health = 0; expect(publicPresentation(state).pose).toBe("death");
});

it("rejects a malformed action before mutating the replica", () => {
  const world = new HeadlessWorld(descriptor, ports); world.join("a");
  const r = new Replicator("s","a"), client = new ReplicatedState("s"); client.apply(r.update(world,0,new Map(),true));
  const update = r.update(world,0,new Map());
  update.actions = [{sequence:1,playerId:"a",position:[0,0,0],regionId:"fallowmarch",type:"spell",atMs:0,spellId:"voltrend",targetId:"x",flightMs:NaN,hit:true}];
  expect(()=>client.apply(update)).toThrow("Invalid public action payload"); expect(client.sequence).toBe(1);
});

it("blends distant crowd movement over its actual cadence without a 400ms stationary gap", () => {
  const motion = new ActorInterpolation([0,0,0]); motion.push([3,0,0],0,0,500);
  expect(motion.sample(100)[0]).toBeCloseTo(.6); expect(motion.sample(400)[0]).toBeCloseTo(2.4);
  motion.push([6,0,0],500,0,500); expect(motion.sample(750)[0]).toBeCloseTo(4.5);
});
