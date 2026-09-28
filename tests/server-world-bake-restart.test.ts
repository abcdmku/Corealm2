import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { WORLD_PROTOCOL_VERSION, type Vec3, type WorldDescriptor } from "../game/src/contracts.js";
import { guestAuthentication } from "../game/src/multiplayer/guestAuthentication.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { startThreadedServer } from "./helpers/threadedServer.js";

/**
 * A finished world bake runs every world again on the new geometry: its players are told and
 * disconnected, their characters saved, and a player who joins again stands on the new navmesh.
 */
const REVISION = "b".repeat(64);
const NOTICE = { code: "UNAVAILABLE" as const, message: "The world is restarting on its new terrain. Join again in a moment." };
const world = (worldId: string): WorldDescriptor => ({ providerId: "reference", worldId, name: worldId, endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "lab", seed: 1337, population: 0, capacity: 4, availability: "available" });
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function connect(port: number, worldId: string, name: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`), messages: any[] = [];
  cleanups.push(() => ws.terminate());
  ws.on("message", data => messages.push(JSON.parse(data.toString())));
  const closed = new Promise<number>(resolve => ws.once("close", code => resolve(code)));
  await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  ws.send(JSON.stringify({ type: "join", providerId: "reference", worldId, token: `guest:${name}`, protocolVersion: WORLD_PROTOCOL_VERSION }));
  await expect.poll(() => messages.find(message => message.type === "joined" || message.type === "error"), { timeout: 10_000, interval: 5 }).toBeTruthy();
  return { ws, messages, closed, joined: messages.find(message => message.type === "joined") };
}
const worldsOf = async (port: number) => Object.fromEntries(((await (await fetch(`http://127.0.0.1:${port}/worlds`)).json()) as WorldDescriptor[]).map(entry => [entry.worldId, entry]));

describe("restarting worlds on a new world pack", () => {
  it("tells and saves the players, rebuilds the world, and settles a returning player on the new navmesh", async () => {
    const storage = new SqliteWorldStorage(":memory:");
    const server = await startReferenceServer({ worlds: [world("north")], storage, build: () => createMultiplayerLabWorld(), authentication: guestAuthentication });
    cleanups.push(() => server.close());
    const before = [...server.worlds.values()][0]!;
    const wren = await connect(server.port, "north", "Wren");
    expect(wren.joined).toBeTruthy();
    // Where the old geometry let them stand and the new one has no ground.
    const player = before.runtime.players.get("guest:Wren")!;
    player.store.get().player.position = [400, 0, 400]; player.store.markDirty();

    await server.restartWorlds({ build: () => createMultiplayerLabWorld(), thread: { kind: "lab" }, worldRevision: REVISION, notice: NOTICE });
    await expect.poll(() => wren.messages.at(-1)).toEqual({ type: "error", error: NOTICE });
    expect(await wren.closed).toBe(4000);
    const after = [...server.worlds.values()][0]!;
    expect(after).not.toBe(before);
    expect(after.runtime).not.toBe(before.runtime);
    expect(after.leases.size).toBe(0);
    expect((await worldsOf(server.port)).north).toMatchObject({ worldRevision: REVISION, population: 0 });
    // The character was saved as it stood.
    expect((await storage.load({ providerId: "reference", worldId: "north" }))?.players["guest:Wren"]?.player.position).toEqual([400, 0, 400]);

    const back = await connect(server.port, "north", "Wren");
    expect(back.joined.world.worldRevision).toBe(REVISION);
    const position = after.runtime.players.get("guest:Wren")!.store.get().player.position as Vec3;
    expect(position).not.toEqual([400, 0, 400]);
    expect(after.runtime.ports.nav.nearestWalkable(position, 0.5)).toBeTruthy();

    // Back to the build's own world: descriptors drop the revision.
    await server.restartWorlds({ build: () => createMultiplayerLabWorld(), thread: { kind: "lab" }, worldRevision: null, notice: NOTICE });
    expect((await worldsOf(server.port)).north?.worldRevision).toBeUndefined();
  }, 60_000);

  it("restarts every world thread of a threaded server", async () => {
    const server = await startThreadedServer({ worlds: [world("north"), world("south")], authentication: guestAuthentication });
    cleanups.push(() => server.close());
    const wren = await connect(server.port, "north", "Wren"), moss = await connect(server.port, "south", "Moss");
    expect(wren.joined && moss.joined).toBeTruthy();

    await server.restartWorlds({ build: () => Promise.reject(new Error("threads build their own")), thread: { kind: "lab" }, worldRevision: REVISION, notice: NOTICE });
    expect(await wren.closed).toBe(4000);
    expect(await moss.closed).toBe(4000);
    expect(wren.messages).toContainEqual({ type: "error", error: NOTICE });
    await server.refresh();
    const listed = await worldsOf(server.port);
    expect([listed.north?.worldRevision, listed.south?.worldRevision]).toEqual([REVISION, REVISION]);

    const back = await connect(server.port, "north", "Wren");
    expect(back.joined.world.worldRevision).toBe(REVISION);
    expect(server.status().map(status => status.available)).toEqual([true, true]);
  }, 120_000);
});
