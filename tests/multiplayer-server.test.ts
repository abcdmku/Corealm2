import { afterEach, describe, expect, it } from "vitest";
import { WORLD_CONTENT_VERSION, WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { WebSocketProvider } from "../game/src/multiplayer/webSocketProvider.js";

const world: WorldDescriptor = { providerId: "reference", worldId: "yard", name: "Yard", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, contentVersion: WORLD_CONTENT_VERSION, seed: 1337, population: 0, capacity: 2, availability: "available" };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
describe("real reference transport", () => {
  it("reports failed storage as unavailable to readiness, discovery and new connections", async () => {
    const storage = new SqliteWorldStorage(":memory:");
    const server = await startReferenceServer({ worlds: [world], storage: {
      load: key => storage.load(key), close: () => storage.close(),
      commit: async () => { throw new Error("disk unavailable"); },
    }, build: () => createMultiplayerLabWorld(), authentication: {authenticate: async token => ({playerId:token,name:token})} });
    cleanup.push(() => server.close());
    await expect.poll(() => server.metrics.errors).toBe(1);
    const base = `http://127.0.0.1:${server.port}`;
    expect((await fetch(`${base}/readyz`)).status).toBe(503);
    expect((await (await fetch(`${base}/worlds`)).json())[0].availability).toBe("unavailable");
    const selected = {...world,endpoint:`ws://127.0.0.1:${server.port}/`};
    const provider = new WebSocketProvider("reference", [selected], async () => ({token:"a"}));
    await expect(provider.connect(selected,{token:"a"})).rejects.toMatchObject({code:"UNAVAILABLE"});
  });
  it("rejects invalid authentication identities before consuming admission",async()=>{
    const server=await startReferenceServer({worlds:[{...world,capacity:1}],storage:new SqliteWorldStorage(":memory:"),build:()=>createMultiplayerLabWorld(),
      authentication:{authenticate:async token=>({playerId:token,name:token==="invalid"?undefined as unknown as string:token})}});
    cleanup.push(()=>server.close());const selected={...world,capacity:1,endpoint:`ws://127.0.0.1:${server.port}/`};
    const provider=new WebSocketProvider("reference",[selected],async()=>({token:"valid"}));
    await expect(provider.connect(selected,{token:"invalid"})).rejects.toMatchObject({code:"UNAUTHORIZED"});
    const session=await provider.connect(selected,{token:"valid"});cleanup.push(()=>session.close());
    expect((await session.command({method:"stop",args:[]})).status).toBe("accepted");
  });
  it("rejects a server snapshot whose world seed differs from discovery",async()=>{
    const server=await startReferenceServer({worlds:[world],storage:new SqliteWorldStorage(":memory:"),build:()=>createMultiplayerLabWorld(),
      authentication:{authenticate:async token=>({playerId:token,name:token})}});
    cleanup.push(()=>server.close());const selected={...world,seed:999,endpoint:`ws://127.0.0.1:${server.port}/`};
    const provider=new WebSocketProvider("reference",[selected],async()=>({token:"a"}));
    await expect(provider.connect(selected,{token:"a"})).rejects.toMatchObject({code:"INCOMPATIBLE"});
  });
  it("authenticates, replicates movement privately, rejects full worlds, and acknowledges production commands", async () => {
    const server = await startReferenceServer({ worlds: [world], storage: new SqliteWorldStorage(":memory:"), build: () => createMultiplayerLabWorld(),
      authentication: { authenticate: async (token) => ({ playerId: token, name: token }) } });
    cleanup.push(() => server.close());
    const descriptor = { ...world, endpoint: `ws://127.0.0.1:${server.port}/` };
    const provider = new WebSocketProvider("reference", [descriptor], async () => ({ token: "a" }));
    const a = await provider.connect(descriptor, { token: "a" }); cleanup.push(() => a.close());
    const b = await provider.connect(descriptor, { token: "b" }); cleanup.push(() => b.close());
    await expect(provider.connect(descriptor, { token: "c" })).rejects.toMatchObject({ code: "FULL" });
    const received: unknown[] = []; b.subscribe((update) => received.push(update));
    const outcome = await a.command({ method: "steer", args: [1, 0] });
    expect(outcome.status).toBe("accepted");
    await new Promise((resolve) => setTimeout(resolve, 250));
    const updates = received as { players: { id: string; position: number[] }[]; privateState: { player: { id: string } } }[];
    expect(updates.some((update) => update.players.some((player) => player.id === "a" && player.position[0]! > 0))).toBe(true);
    expect(updates.every((update) => !update.privateState || update.privateState.player.id === "b")).toBe(true);
    expect(JSON.stringify(updates.flatMap((update) => update.players))).not.toContain("inventory");
    expect(server.metrics.errors).toBe(0);
  });
});
