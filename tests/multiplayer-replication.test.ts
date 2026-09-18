import { expect, it, vi } from "vitest";
import { EventBus } from "../game/src/core/events.js";
import { WORLD_CONTENT_VERSION, WORLD_PROTOCOL_VERSION } from "../game/src/contracts.js";
import { HeadlessWorld } from "../game/src/multiplayer/headlessWorld.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { ReplicatedState, Replicator, ReplicationFrame } from "../game/src/multiplayer/replication.js";

it("publishes replicated outcomes to presentation and agents without executing local reward listeners", () => {
  const events = new EventBus(); const reward = vi.fn(); const presentation = vi.fn();
  events.subscribeSimulation(reward); events.subscribe(presentation);
  events.setSimulationEnabled(false); events.emit("quest.updated", {questId:"test"}); events.flush();
  expect(reward).not.toHaveBeenCalled(); expect(presentation).toHaveBeenCalledOnce(); expect(events.since(0).events).toHaveLength(1);
  events.setSimulationEnabled(true); events.emit("quest.updated", {questId:"test"}); events.flush(); expect(reward).toHaveBeenCalledOnce();
});

it("keeps crowded health changes immediate while cosmetic transforms use compact updates", async () => {
  const world=new HeadlessWorld({providerId:"test",worldId:"crowd",name:"Crowd",endpoint:"ws://127.0.0.1/",protocolVersion:WORLD_PROTOCOL_VERSION,
    contentVersion:WORLD_CONTENT_VERSION,seed:1337,capacity:1000,population:0,availability:"available"},await createMultiplayerLabWorld());
  for(let i=0;i<130;i++)world.join(`player-${i}`);
  const prior=new Map<string,string>(); const replicator=new Replicator("session","player-0"); const replica=new ReplicatedState("session");
  replica.apply(replicator.update(world,0,new ReplicationFrame(world,prior),true));
  const other=world.players.get("player-1")!; other.store.get().player.health=7;other.store.get().player.position=[2.123456,0,1];
  world.clock.commitTick();
  const changed=replicator.update(world,0,new ReplicationFrame(world,prior));
  expect(changed.players.find(player=>player.id==="player-1")?.health).toBe(7); replica.apply(changed);
  for(let tick=0;tick<5;tick++){
    world.clock.commitTick();other.store.get().player.position=[3.123456,0,1];
    const update=replicator.update(world,0,new ReplicationFrame(world,prior)); replica.apply(update);
  }
  expect(replica.players.get("player-1")!.position[0]).toBeCloseTo(3.123456,4);
  world.players.get("player-2")!.store.get().player.regionId="gravelmaw";
  world.clock.commitTick();
  const portal=replicator.update(world,0,new ReplicationFrame(world,prior));
  expect(portal.removedPlayers).toContain("player-2");
  world.leave("player-1");
  const left=replicator.update(world,0,new ReplicationFrame(world,prior));expect(left.removedPlayers).toContain("player-1");
});

it("merges private deltas atomically without disclosing another player's state", async () => {
  const world=new HeadlessWorld({providerId:"test",worldId:"private",name:"Private",endpoint:"ws://127.0.0.1/",protocolVersion:WORLD_PROTOCOL_VERSION,
    contentVersion:WORLD_CONTENT_VERSION,seed:1337,capacity:1000,population:0,availability:"available"},await createMultiplayerLabWorld());
  const owner=world.join("owner"); world.join("other").store.get().currency=987654;
  const replicator=new Replicator("session","owner"), replica=new ReplicatedState("session","owner");
  replica.apply(replicator.update(world,0,new Map(),true));
  const inventory=structuredClone(replica.privateState!.inventory);
  owner.store.get().currency=5;
  const update=replicator.update(world,0,new Map());
  expect(update.privateState).toBeUndefined(); expect(update.privateDelta).toEqual({currency:5});
  expect(JSON.stringify(update)).not.toContain("987654");
  const forged={...structuredClone(update),privateDelta:{player:{...owner.store.get().player,id:"other"}}};
  expect(()=>replica.apply(forged)).toThrow("Invalid private owner state");
  expect(replica.privateState!.currency).toBe(0);
  replica.apply(update); expect(replica.privateState!.currency).toBe(5); expect(replica.privateState!.inventory).toEqual(inventory);
});
