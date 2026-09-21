import { expect, it } from "vitest";
import { WORLD_PROTOCOL_VERSION, type GameCommand, type WorldDescriptor, type WorldUpdate } from "../game/src/contracts.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { MemoryWorldStorage } from "../game/src/multiplayer/memoryStorage.js";
import { SessionFailure } from "../game/src/multiplayer/protocol.js";
import { createWorldHost, type PeerConnection, type PeerLink, type WorldHostOptions } from "../game/src/multiplayer/worldHost.js";

/**
 * The host core with no socket anywhere: a link that hands values over by structured clone, as a
 * MessagePort does, and a test that owns time by stepping ticks itself.
 */
const world: WorldDescriptor = { providerId: "local", worldId: "yard", name: "Yard", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "lab", seed: 1337, population: 0, capacity: 4, availability: "available" };
const KEY = { providerId: "local", worldId: "yard" };

class MemoryLink implements PeerLink {
  open = true;
  readonly received: any[] = [];
  closedWith: { code: number; reason: string } | null = null;
  connection: PeerConnection | null = null;
  send(value: unknown): boolean { if (!this.open) return false; this.received.push(structuredClone(value)); return true; }
  close(code: number, reason: string): void {
    if (!this.open) return;
    this.open = false; this.closedWith = { code, reason }; this.connection?.closed();
  }
  of(type: string): any[] { return this.received.filter(message => message.type === type); }
}
async function host(overrides: Partial<WorldHostOptions> = {}) {
  const storage = new MemoryWorldStorage();
  const core = await createWorldHost<MemoryLink>({ worlds: [world], storage, build: () => createMultiplayerLabWorld(),
    authentication: { authenticate: async token => ({ playerId: token, name: token }) }, ...overrides });
  const connect = (): MemoryLink => { const link = new MemoryLink(); link.connection = core.connect(link); return link; };
  const join = async (token: string): Promise<MemoryLink> => {
    const link = connect();
    await link.connection!.accept({ type: "join", providerId: "local", worldId: "yard", token, protocolVersion: WORLD_PROTOCOL_VERSION });
    return link;
  };
  return { core, storage, connect, join };
}
const command = (link: MemoryLink, sequence: number, body: GameCommand) =>
  link.connection!.accept({ type: "command", envelope: { sessionId: link.of("joined")[0].sessionId, sequence, operation: sequence, command: body } });

it("joins, acknowledges a command, replicates the change and frees the account on leave, over an in-memory link", async () => {
  const { core, storage, join } = await host();
  const alice = await join("alice");
  expect(alice.received.map(message => message.type)).toEqual(["joined", "update"]);
  expect(alice.received[0]).toMatchObject({ playerId: "alice", nextOperation: 1, world: { worldId: "yard", authentication: "guest" } });
  const first: WorldUpdate = alice.received[1].update;
  expect([first.snapshot, first.privateState!.player.id, first.entities.some(entity => entity.id === "multiplayer:ore")]).toEqual([true, "alice", true]);
  expect((await storage.admin.player("alice", Date.now()))!.online).toEqual(KEY);

  const bob = await join("bob");
  await command(alice, 1, { method: "steer", args: [1, 0] });
  expect(alice.of("ack")).toEqual([]);
  await core.step();
  expect(alice.of("ack").map(message => [message.outcome.status, message.outcome.sequence])).toEqual([["accepted", 1]]);
  for (let tick = 0; tick < 5; tick++) await core.step();
  const own: WorldUpdate[] = alice.of("update").slice(1).map(message => message.update);
  expect(own.at(-1)!.acknowledgedCommand).toBe(1);
  const startX = first.privateState!.player.position[0];
  expect(own.map(update => update.privateDelta?.player?.position[0]).filter(x => x !== undefined).at(-1)).toBeGreaterThan(startX);
  // The other peer sees the move as public state and none of alice's private state.
  const seen: WorldUpdate[] = bob.of("update").map(message => message.update);
  expect(seen.some(update => update.players.some(player => player.id === "alice" && player.position[0] > startX))).toBe(true);
  expect(seen.every(update => !update.privateState || update.privateState.player.id === "bob")).toBe(true);

  // A repeated sequence is answered from the receipt, not run again.
  await command(alice, 1, { method: "steer", args: [1, 0] });
  expect(alice.of("ack")).toHaveLength(2);
  expect(core.metrics.commands).toBe(1);

  await alice.connection!.accept({ type: "leave" });
  expect(alice.closedWith).toEqual({ code: 1000, reason: "Left world" });
  expect((await storage.admin.player("alice", Date.now()))!.online).toEqual(KEY);
  await core.step();
  expect((await storage.admin.player("alice", Date.now()))!.online).toBeNull();
  expect([...core.worlds.values()][0]!.leases.has("alice")).toBe(false);
  expect(core.events.map(event => [event.kind, event.accountId])).toEqual([["join", "alice"], ["join", "bob"], ["leave", "alice"]]);

  await core.close();
  expect(bob.closedWith).toEqual({ code: 1001, reason: "World closed" });
  expect((await storage.admin.player("bob", Date.now()))!.online).toBeNull();
  expect(core.metrics.errors).toBe(0);
}, 60_000);

it("refuses a second join by a connected account, and a malformed join, without touching the first session", async () => {
  const { core, join, connect } = await host();
  const alice = await join("alice");
  const again = await join("alice");
  expect(again.received).toEqual([{ type: "error", error: { code: "DUPLICATE_LOGIN", message: "This player is already connected" } }]);
  expect(again.closedWith).toEqual({ code: 4000, reason: "DUPLICATE_LOGIN" });
  const garbage = connect();
  await garbage.connection!.accept("join");
  expect(garbage.received).toEqual([{ type: "error", error: { code: "INVALID_MESSAGE", message: "Invalid message" } }]);
  const refused = connect();
  refused.connection!.refuse(new SyntaxError("not JSON"));
  expect(refused.received).toEqual([{ type: "error", error: { code: "INVALID_MESSAGE", message: "Invalid request" } }]);
  expect([alice.open, core.metrics.rejected, [...core.worlds.values()][0]!.peers.size]).toEqual([true, 3, 1]);
  await core.step();
  expect(alice.of("update")).toHaveLength(2);
  await core.close();
}, 60_000);

it("runs the injected admission port before the lease is claimed", async () => {
  const { core, storage, join } = await host({ beforeAdmission: async player => { if (player.playerId === "mallory") throw new SessionFailure("BANNED", "Banned from this server"); } });
  const mallory = await join("mallory");
  expect(mallory.received).toEqual([{ type: "error", error: { code: "BANNED", message: "Banned from this server" } }]);
  expect(await storage.admin.player("mallory", Date.now())).toBeNull();
  await core.close();
}, 60_000);

it("fails closed when a commit throws: no acknowledgement, every link told, no new link served", async () => {
  const { core, storage, join, connect } = await host();
  const alice = await join("alice"), waiting = connect();
  await command(alice, 1, { method: "stop", args: [] });
  storage.commit = async () => { throw new Error("disk unavailable"); };
  await core.step();
  const unavailable = { type: "error", error: { code: "UNAVAILABLE", message: "World storage or simulation failed" } };
  expect(alice.of("ack")).toEqual([]);
  expect(alice.received.at(-1)).toEqual(unavailable);
  expect([alice.closedWith, waiting.closedWith]).toEqual([{ code: 1011, reason: "World unavailable" }, { code: 1011, reason: "World unavailable" }]);
  expect(waiting.received).toEqual([unavailable]);
  expect([core.closed, core.metrics.errors]).toEqual([true, 1]);
  const late = new MemoryLink();
  expect(core.connect(late)).toBeNull();
  expect(late.received).toEqual([{ type: "error", error: { code: "UNAVAILABLE", message: "World unavailable" } }]);
  const ticks = core.metrics.ticks.length;
  await core.step();
  expect(core.metrics.ticks).toHaveLength(ticks);
  await core.close();
}, 60_000);

it("holds ticks for betweenTicks and runs the held work only after the tick in flight", async () => {
  const { core, storage, join } = await host();
  await join("alice");
  const order: string[] = [];
  const commit = storage.commit.bind(storage);
  storage.commit = async record => { order.push("commit"); await new Promise(resolve => setTimeout(resolve, 20)); return commit(record); };
  const ticking = core.step();
  const held = core.betweenTicks(async () => { order.push("held"); const next = core.step().then(() => order.push("next tick")); await new Promise(resolve => setTimeout(resolve, 20)); order.push("released"); return { next }; });
  await ticking; await (await held).next;
  expect(order).toEqual(["commit", "held", "released", "commit", "next tick"]);
  await core.close();
}, 60_000);
