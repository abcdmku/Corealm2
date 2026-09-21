import { afterEach, expect, it } from "vitest";
import { WebSocket } from "ws";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { MemoryWorldStorage } from "../game/src/multiplayer/memoryStorage.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";

/**
 * The frames a socket peer receives, as text. Clients in the field parse these, so the text is the
 * contract: field order, error wording and close codes. Only the session id and tick numbers vary.
 */
const world: WorldDescriptor = { providerId: "reference", worldId: "yard", name: "Yard", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "lab", seed: 1337, population: 0, capacity: 2, availability: "available" };
const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

interface Raw { ws: WebSocket; frames: string[]; closed: Promise<[number, string]>; next(count: number): Promise<void> }
function raw(port: number, origin?: string): Promise<Raw> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`, origin ? { origin } : {}); cleanup.push(() => ws.terminate());
  const frames: string[] = [];
  ws.on("message", bytes => frames.push(bytes.toString()));
  const closed = new Promise<[number, string]>(resolve => ws.once("close", (code, reason) => resolve([code, reason.toString()])));
  const next = async (count: number) => { await expect.poll(() => frames.length, { timeout: 5000, interval: 5 }).toBeGreaterThanOrEqual(count); };
  return new Promise((resolve, reject) => { ws.once("open", () => resolve({ ws, frames, closed, next })); ws.once("error", reject); });
}
const join = (token: string, extra: Record<string, unknown> = {}) => JSON.stringify({ type: "join", providerId: "reference", worldId: "yard", token, protocolVersion: WORLD_PROTOCOL_VERSION, ...extra });
const varying = (frame: string) => frame.replace(/"sessionId":"[0-9a-f-]{36}"/g, '"sessionId":"<session>"').replace(/"tick":\d+/g, '"tick":<tick>');

it("sends a socket peer the same text for the same inputs", async () => {
  const server = await startReferenceServer({ worlds: [world], storage: new MemoryWorldStorage(), build: () => createMultiplayerLabWorld(), log: () => {},
    allowedOrigins: ["https://play.example"], authentication: { authenticate: async token => ({ playerId: token, name: `${token} the player` }) } });
  cleanup.push(() => server.close());
  const revision = [...server.worlds.values()][0]!.runtime.descriptor.catalogRevision;

  const alice = await raw(server.port, "https://play.example"); alice.ws.send(join("alice")); await alice.next(2);
  expect(varying(alice.frames[0]!)).toBe(`{"type":"joined","sessionId":"<session>","playerId":"alice","world":{"providerId":"reference","worldId":"yard","name":"Yard","endpoint":"ws://127.0.0.1:${server.port}/",`
    + `"protocolVersion":${WORLD_PROTOCOL_VERSION},"fixture":"lab","seed":1337,"population":0,"capacity":2,"availability":"available","catalogRevision":"${revision}","authentication":"guest"},"nextOperation":1}`);
  const snapshot = JSON.parse(alice.frames[1]!);
  expect([Object.keys(snapshot), snapshot.update.snapshot, snapshot.update.baseSequence, snapshot.update.privateState.player.name]).toEqual([["type", "update"], true, null, "alice the player"]);
  const sessionId = JSON.parse(alice.frames[0]!).sessionId;
  alice.ws.send(JSON.stringify({ type: "command", envelope: { sessionId, sequence: 1, operation: 1, command: { method: "stop", args: [] } } }));
  await expect.poll(() => alice.frames.find(frame => frame.startsWith('{"type":"ack"')), { timeout: 5000, interval: 5 }).toBeDefined();
  expect(varying(alice.frames.find(frame => frame.startsWith('{"type":"ack"'))!)).toBe('{"type":"ack","outcome":{"status":"accepted","sequence":1,"tick":<tick>,"result":{"stopped":[]}}}');

  const refusals: [string, (peer: Raw) => void, string, [number, string]][] = [
    ["binary frame", peer => peer.ws.send(Buffer.from(join("bob"))), '{"type":"error","error":{"code":"INVALID_MESSAGE","message":"Text messages required"}}', [4000, "INVALID_MESSAGE"]],
    ["not JSON", peer => peer.ws.send("join"), '{"type":"error","error":{"code":"INVALID_MESSAGE","message":"Invalid request"}}', [4000, "INVALID_MESSAGE"]],
    ["not an object", peer => peer.ws.send("[]"), '{"type":"error","error":{"code":"INVALID_MESSAGE","message":"Invalid message"}}', [4000, "INVALID_MESSAGE"]],
    ["no token", peer => peer.ws.send(JSON.stringify({ type: "join", providerId: "reference", worldId: "yard" })), '{"type":"error","error":{"code":"UNAUTHORIZED","message":"Authentication required"}}', [4000, "UNAUTHORIZED"]],
    ["old protocol", peer => peer.ws.send(join("bob", { protocolVersion: 1 })), '{"type":"error","error":{"code":"INCOMPATIBLE","message":"Incompatible game version"}}', [4000, "INCOMPATIBLE"]],
    ["unknown world", peer => peer.ws.send(join("bob", { worldId: "nowhere" })), '{"type":"error","error":{"code":"UNAVAILABLE","message":"World is unavailable"}}', [4000, "UNAVAILABLE"]],
    ["duplicate login", peer => peer.ws.send(join("alice")), '{"type":"error","error":{"code":"DUPLICATE_LOGIN","message":"This player is already connected"}}', [4000, "DUPLICATE_LOGIN"]],
  ];
  for (const [name, send, frame, close] of refusals) {
    const peer = await raw(server.port); send(peer);
    expect([name, await peer.closed, peer.frames]).toEqual([name, close, [frame]]);
  }
  // The Origin is judged after the protocol version and before the world is looked up.
  const foreign = await raw(server.port, "https://elsewhere.example"); foreign.ws.send(join("bob", { worldId: "nowhere" }));
  expect([await foreign.closed, foreign.frames]).toEqual([[4000, "UNAUTHORIZED"], ['{"type":"error","error":{"code":"UNAUTHORIZED","message":"Origin is not allowed"}}']]);
  const outdated = await raw(server.port, "https://elsewhere.example"); outdated.ws.send(join("bob", { protocolVersion: 1 }));
  expect((await outdated.closed)[1]).toBe("INCOMPATIBLE");

  const before = alice.frames.length;
  alice.ws.send(JSON.stringify({ type: "dance" }));
  expect(await alice.closed).toEqual([4000, "INVALID_MESSAGE"]);
  expect(alice.frames.slice(before).filter(frame => !frame.startsWith('{"type":"update"'))).toEqual(['{"type":"error","error":{"code":"INVALID_MESSAGE","message":"Unknown message type"}}']);
  // A client sees its own close before the server has run the close handler that drops the peer and
  // records the leave, so wait for the world to let go of alice rather than for her socket.
  await expect.poll(() => [...server.worlds.values()][0]!.peers.size, { timeout: 5000, interval: 5 }).toBe(0);
  expect([server.metrics.rejected, server.metrics.errors, server.metrics.bytesOut > 0]).toEqual([10, 0, true]);
  expect(server.events.map(event => [event.kind, event.accountId, event.detail])).toEqual([["join", "alice", "yard"],
    ...["INVALID_MESSAGE", "INVALID_MESSAGE", "INVALID_MESSAGE", "UNAUTHORIZED", "INCOMPATIBLE", "UNAVAILABLE", "DUPLICATE_LOGIN", "UNAUTHORIZED", "INCOMPATIBLE"].map(code => ["rejected", null, code]),
    ["leave", "alice", "yard"]]);
}, 60_000);

it("drops a socket peer that has been silent for thirty seconds and keeps its place for the reconnect window", async () => {
  const server = await startReferenceServer({ worlds: [world], storage: new MemoryWorldStorage(), build: () => createMultiplayerLabWorld(), log: () => {},
    authentication: { authenticate: async token => ({ playerId: token, name: token }) } });
  cleanup.push(() => server.close());
  const alice = await raw(server.port); alice.ws.send(join("alice")); await alice.next(2);
  const hosted = [...server.worlds.values()][0]!, peer = [...hosted.peers.values()][0]!;
  expect([peer.link.open, peer.link.silent]).toEqual([true, false]);
  peer.link.lastSeen = Date.now() - 30_001;
  expect([peer.link.open, peer.link.silent]).toEqual([false, true]);
  // Terminated, not closed: the peer gets no close frame, and the account is reserved rather than released.
  expect(await alice.closed).toEqual([1006, ""]);
  await expect.poll(() => [hosted.peers.size, hosted.admission.population], { timeout: 3000, interval: 5 }).toEqual([0, 1]);
  expect(server.events.map(event => event.kind)).toEqual(["join", "leave"]);
}, 60_000);
