import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { WebSocket as RawSocket } from "ws";
import { WORLD_CONTENT_VERSION, WORLD_PROTOCOL_VERSION, type WorldDescriptor, type WorldStorageRecord } from "../game/src/contracts.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { MemoryWorldStorage } from "../game/src/multiplayer/memoryStorage.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { WebSocketProvider } from "../game/src/multiplayer/webSocketProvider.js";
import { HeadlessWorld } from "../game/src/multiplayer/headlessWorld.js";
import { Replicator, ReplicatedState } from "../game/src/multiplayer/replication.js";

const descriptor: WorldDescriptor = { providerId: "reference", worldId: "yard", name: "Yard", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, contentVersion: WORLD_CONTENT_VERSION, seed: 1337, population: 0, capacity: 4, availability: "available" };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function serverAt(file = ":memory:") {
  const server = await startReferenceServer({ worlds: [descriptor], storage: new SqliteWorldStorage(file), build: () => createMultiplayerLabWorld(),
    authentication: { authenticate: async (token) => ({ playerId: token, name: token }) } });
  return server;
}
async function connectRaw(port: number, playerId: string) {
  const ws = new RawSocket(`ws://127.0.0.1:${port}/`); const messages: any[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve) => ws.once("open", resolve));
  ws.send(JSON.stringify({ type: "join", providerId: "reference", worldId: "yard", token: playerId,
    protocolVersion: WORLD_PROTOCOL_VERSION, contentVersion: WORLD_CONTENT_VERSION }));
  await expect.poll(() => messages.some((message) => message.type === "joined"), { timeout: 1500, interval: 10 }).toBe(true);
  const sessionId = messages.find((message) => message.type === "joined").sessionId as string;
  cleanups.push(async () => { ws.terminate(); });
  return { ws, messages, sessionId };
}
describe("multiplayer recovery and privacy", () => {
  it("disconnects an excessive outbound queue without stalling another player's commands",async()=>{
    const server=await serverAt();cleanups.push(()=>server.close());
    const slow=await connectRaw(server.port,"slow"),healthy=await connectRaw(server.port,"healthy");
    const hosted=[...server.worlds.values()][0]!,peer=hosted.peers.get(slow.sessionId)!;
    const closed=new Promise<{code:number;reason:string}>(resolve=>slow.ws.once("close",(code,reason)=>resolve({code,reason:reason.toString()})));
    // The workload exercises real paused TCP consumers. Here pin the exact production queue boundary.
    Object.defineProperty(peer.ws,"bufferedAmount",{get:()=>2*1024*1024});
    healthy.ws.send(JSON.stringify({type:"command",envelope:{sessionId:healthy.sessionId,sequence:1,operation:1,command:{method:"stop",args:[]}}}));
    expect(await closed).toMatchObject({code:4008,reason:"BACKLOG: outbound queue exceeded"});
    await expect.poll(()=>healthy.messages.some(message=>message.type==="ack"),{timeout:1500,interval:10}).toBe(true);
    expect(healthy.messages.find(message=>message.type==="ack").outcome.status).toBe("accepted");
    expect(server.metrics.errors).toBe(0);expect(server.metrics.backlogDisconnects).toBeGreaterThan(0);
  });
  it("persists receipt head eviction even when the last immutable receipt is unchanged", async () => {
    const storage=new SqliteWorldStorage(":memory:");cleanups.push(()=>storage.close());
    const world=new HeadlessWorld(descriptor,await createMultiplayerLabWorld());world.join("alice");
    const receipts=[1,2].map(operation=>({operation,sequence:operation,command:JSON.stringify({method:"stop",args:[]}),
      outcome:{status:"accepted" as const,sequence:operation,tick:0,result:{}}}));
    await storage.claimPlayer(descriptor,"alice","s1","Alice");const leases={alice:{sessionId:"s1",action:"hold" as const}};
    await storage.commit({...world.snapshot({alice:receipts}),leases});
    await storage.commit({...world.snapshot({alice:[receipts[1]!]}),leases});
    expect((await storage.load(descriptor))!.receipts.alice!.map(receipt=>receipt.operation)).toEqual([2]);
  });
  it("archives inactive players while retaining durable progression and random cursors", async () => {
    const storage=new SqliteWorldStorage(":memory:");cleanups.push(()=>storage.close());
    const world=new HeadlessWorld(descriptor,await createMultiplayerLabWorld());
    const a=world.join("alice"),b=world.join("bob");a.store.get().currency=42;b.store.get().currency=7;
    a.random.get("loot").next();const random=a.random.snapshot();
    await storage.claimPlayer(descriptor,"alice","s-alice","Alice");await storage.claimPlayer(descriptor,"bob","s-bob","Bob");
    const leases={alice:{sessionId:"s-alice",action:"hold" as const},bob:{sessionId:"s-bob",action:"hold" as const}};
    await storage.commit({...world.snapshot(),leases});world.leave("alice");
    expect(world.evictInactive(id=>id==="alice")).toEqual([]);
    await storage.commit({...world.snapshot(),leases:{...leases,alice:{sessionId:"s-alice",action:"release"}}});
    expect(world.evictInactive()).toEqual(["alice"]);
    await storage.commit({...world.snapshot(),leases:{bob:leases.bob}});
    expect((await storage.openWorld(descriptor))!.players).toEqual({});
    const archived=(await storage.claimPlayer(descriptor,"alice","s-return","Alice"))!;
    expect(archived.character!.currency).toBe(42);expect(archived.world!.random).toEqual(random);expect(archived.lastWorld).toEqual({providerId:"reference",worldId:"yard"});
    const returned=world.join("alice",archived);expect(returned.store.get().currency).toBe(42);expect(returned.random.snapshot()).toEqual(random);
    expect((await storage.load(descriptor))!.players.bob!.currency).toBe(7);
  });
  it("evicts a disconnected network player after commit and restores it on rejoin", async () => {
    const server=await serverAt();cleanups.push(()=>server.close());
    const peer=await connectRaw(server.port,"alice");const hosted=[...server.worlds.values()][0]!;
    hosted.runtime.players.get("alice")!.store.get().currency=31;
    peer.ws.send(JSON.stringify({type:"leave"}));
    await expect.poll(()=>hosted.runtime.players.has("alice"),{timeout:1500,interval:10}).toBe(false);
    const returning=await connectRaw(server.port,"alice");
    await expect.poll(()=>returning.messages.find(message=>message.type==="update")?.update.privateState?.currency,{timeout:1500,interval:10}).toBe(31);
  });
  it("does not publish requested snapshots while a reward commit is pending or after it fails", async () => {
    let failCommit: ((reason:Error)=>void)|undefined;
    const server=await startReferenceServer({worlds:[descriptor],build:()=>createMultiplayerLabWorld(),
      authentication:{authenticate:async token=>({playerId:token,name:token})},
      storage:Object.assign(new MemoryWorldStorage(),{commit:async(record:WorldStorageRecord)=>{
        if(record.receipts.alice?.length)await new Promise<void>((_resolve,reject)=>{failCommit=reject;});
        return {fenced:[]};
      }})});
    cleanups.push(()=>server.close());
    const peer=await connectRaw(server.port,"alice");
    peer.ws.send(JSON.stringify({type:"command",envelope:{sessionId:peer.sessionId,sequence:1,operation:1,command:{method:"stop",args:[]}}}));
    await expect.poll(()=>!!failCommit,{timeout:1500,interval:10}).toBe(true);
    const before=peer.messages.filter(message=>message.type==="update").length;
    peer.ws.send(JSON.stringify({type:"snapshot"}));
    await new Promise(resolve=>setTimeout(resolve,40));
    expect(peer.messages.filter(message=>message.type==="update")).toHaveLength(before);
    failCommit!(new Error("Durability failure"));
    await expect.poll(()=>server.metrics.errors,{timeout:1500,interval:10}).toBe(1);
    expect(peer.messages.some(message=>message.type==="ack")).toBe(false);
    expect(peer.messages.filter(message=>message.type==="update")).toHaveLength(before);
  });
  it("expires an offline owner's shared campfire against the running world clock", async () => {
    const world=new HeadlessWorld(descriptor,await createMultiplayerLabWorld());const owner=world.join("owner");world.join("visitor");
    owner.store.get().player.position=[-8,0,0];owner.store.get().inventory.slots[0]={itemId:"palewood_log",quantity:1,slotIndex:0};
    expect(world.execute("owner",{method:"buildCampfire",args:["palewood_log"]}).ok).toBe(true);
    for(let tick=0;tick<40;tick++)world.tick();
    const fire=owner.store.get().world.campfire;expect(fire).not.toBeNull();
    expect(world.entities.get("campfire:owner")).toBeDefined();world.leave("owner");
    world.clock.skipMs((fire!.expiresAtPlaySeconds-owner.store.get().meta.playSeconds+1)*1000);world.tick();
    expect(world.entities.get("campfire:owner")).toBeUndefined();expect(owner.store.get().world.campfire).toBeNull();
  });
  it("rejects cross-realm entity intents even at matching horizontal coordinates", async () => {
    const world=new HeadlessWorld(descriptor,await createMultiplayerLabWorld());const player=world.join("surface");
    const node=world.entities.get("multiplayer:ore")!;node.regionId="gravelmaw";player.store.get().player.position=node.position;
    expect(world.execute("surface",{method:"interact",args:[node.id,"mine"]})).toMatchObject({ok:false,error:{code:"NOT_FOUND"}});
    expect(world.execute("surface",{method:"takeLoot",args:[node.id]})).toMatchObject({ok:false,error:{code:"NOT_FOUND"}});
    expect(player.store.get().activity).toBeNull();
  });
  it("persists operation receipts with the write and deduplicates after restart", async () => {
    const file = join(tmpdir(), `corealm-multiplayer-${randomUUID()}.sqlite`);
    cleanups.push(async () => { for (const suffix of ["", "-wal", "-shm"]) await rm(file + suffix, { force: true }); });
    let server = await serverAt(file); cleanups.push(async () => server.close());
    const first = await connectRaw(server.port, "alice");
    const hosted = [...server.worlds.values()][0]!;
    hosted.runtime.players.get("alice")!.store.get().inventory.slots[0] = { slotIndex: 0, itemId: "grithe_ore", quantity: 4 };
    const command = { method: "bank", args: ["deposit", { itemId: "grithe_ore", quantity: 1 }] };
    first.ws.send(JSON.stringify({ type: "command", envelope: { sessionId: first.sessionId, sequence: 1, operation: 1, command } }));
    await expect.poll(() => first.messages.some((message) => message.type === "ack"), { timeout: 1500, interval: 10 }).toBe(true);
    expect(first.messages.find((message) => message.type === "ack").outcome.status).toBe("accepted");
    await server.close(); server = await serverAt(file);
    const second = await connectRaw(server.port, "alice");
    second.ws.send(JSON.stringify({ type: "command", envelope: { sessionId: second.sessionId, sequence: 1, operation: 1, command } }));
    await expect.poll(() => second.messages.some((message) => message.type === "ack"), { timeout: 1500, interval: 10 }).toBe(true);
    const state = [...server.worlds.values()][0]!.runtime.players.get("alice")!.store.get();
    expect(state.bank.slots).toEqual([{ itemId: "grithe_ore", quantity: 1 }]);
    expect(state.inventory.slots[0]?.quantity).toBe(3);
  });
  it("rejects a second database owner and releases the lock on close", async () => {
    const file = join(tmpdir(), `corealm-lock-${randomUUID()}.sqlite`);
    cleanups.push(async () => { for (const suffix of ["", "-wal", "-shm"]) await rm(file + suffix, { force: true }); });
    const first = new SqliteWorldStorage(file);
    expect(() => new SqliteWorldStorage(file)).toThrow(); await first.close();
    const second = new SqliteWorldStorage(file); await second.close();
  });
  it("supports identities matching Object prototype property names", async () => {
    const server = await serverAt(); cleanups.push(() => server.close());
    const world = { ...descriptor, endpoint: `ws://127.0.0.1:${server.port}/` };
    const provider = new WebSocketProvider("reference", [world], async () => ({ token: "constructor" }));
    const session = await provider.connect(world, { token: "constructor" }); cleanups.push(() => session.close());
    expect((await session.command({ method: "stop", args: [] })).status).toBe("accepted");
  });
  it("keeps recovery caches independent and suspends interrupted activity on restart", async () => {
    const ports = await createMultiplayerLabWorld(); const world = new HeadlessWorld(descriptor, ports);
    const a = world.join("a"); const b = world.join("b");
    a.store.get().player.health = 0; b.store.get().player.health = 0; world.tick();
    expect(a.store.get().world.recoveryCache?.id).toBe("recovery:a");
    expect(b.store.get().world.recoveryCache?.id).toBe("recovery:b");
    expect(world.entities.get("recovery:a")).toBeDefined(); expect(world.entities.get("recovery:b")).toBeDefined();
    a.store.get().activity = { kind: "gathering", skill: "mining", entityId: "multiplayer:ore", nodeTier: 1, startedAtMs: 0, nextRollAtMs: 1800, yieldsThisSession: 0 };
    const saved = world.snapshot(); const restored = new HeadlessWorld(descriptor, ports, saved);
    for (let tick = 0; tick < 100; tick++) restored.tick();
    expect(restored.join("a").store.get().activity).toBeNull();
  });
  it("filters private loot, quest overlays, and other realms before serialization", async () => {
    const world = new HeadlessWorld(descriptor, await createMultiplayerLabWorld()); const a = world.join("a"); const b = world.join("b");
    b.store.get().player.regionId = "gravelmaw";
    const bank = world.entities.get("feature-lab:bank")!;
    a.questEntities.set(bank.id, { ...bank, state: "private-open" });
    const update = new Replicator("s", "a").update(world, 0, new Map(), true);
    expect(update.players).toEqual([]); expect(update.privateState?.player.id).toBe("a");
    expect(update.entities.find((entity) => entity.id === bank.id)?.state).toBe("private-open");
    expect(world.entities.get(bank.id)?.state).not.toBe("private-open");
    const replica = new ReplicatedState("s"); expect(replica.apply(update)).toBe(true);
    expect(replica.apply({ ...update, sessionId: "old", sequence: 99 })).toBe(false);
    expect(() => replica.apply({ ...update, sequence: 3, snapshot: false, baseSequence: 2 })).toThrow();
  });
});
