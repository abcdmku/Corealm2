import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { createSigningKey, joinTokenClaims, signJoinToken, type IdentityKey, type SigningKey } from "../identity/src/joinToken.js";
import { createIdentityAuthentication } from "../game/src/multiplayer/identityAuthentication.js";
import { guestAuthentication } from "../game/src/multiplayer/guestAuthentication.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { SessionFailure } from "../game/src/multiplayer/protocol.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";

const ALICE = "acc_AAAAAAAAAAAAAAAAAAAAAA", BOB = "acc_BBBBBBBBBBBBBBBBBBBBBB";
const world = (worldId: string, capacity = 4): WorldDescriptor => ({ providerId: "reference", worldId, name: worldId, endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity, availability: "available" });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** A stand-in for the identity service: real Ed25519 keys, a real key document, no network. */
function identity() {
  const published: IdentityKey[] = []; let signing!: SigningKey;
  const state = { fetches: 0, nowMs: 1_800_000_000_000, down: false };
  const rotate = () => { const created = createSigningKey(); signing = created.signing; published.push({ kid: signing.kid, alg: "EdDSA", publicKey: created.publicKey, status: "active" }); };
  const fetchKeys = (async (url: string | URL | Request) => {
    state.fetches++;
    if (state.down) throw new Error("connect ECONNREFUSED");
    expect(String(url)).toBe("https://identity.test/.well-known/corealm-keys.json");
    return new Response(JSON.stringify({ keys: published }));
  }) as typeof fetch;
  const token = (accountId: string, name: string, endpoint: string, issuedAtMs = state.nowMs, key = signing) =>
    signJoinToken(key, joinTokenClaims({ accountId, name, endpoint, issuedAt: issuedAtMs / 1000 }));
  rotate();
  return Object.assign(state, { rotate, fetch: fetchKeys, token });
}
async function serve(file = ":memory:", id = identity()) {
  const storage = new SqliteWorldStorage(file, { log: () => {} });
  const server = await startReferenceServer({ worlds: [world("north"), world("south")], storage, build: () => createMultiplayerLabWorld(),
    authentication: await createIdentityAuthentication({ identityUrl: "https://identity.test/", fetch: id.fetch, now: () => id.nowMs }) });
  let closed = false; const close = async () => { if (!closed) { closed = true; await server.close(); } };
  cleanups.push(close);
  const endpoint = `ws://127.0.0.1:${server.port}/`;
  const hosted = (worldId: string) => server.worlds.get(JSON.stringify(["reference", worldId]))!;
  return { server, storage, id, endpoint, hosted, close, token: (accountId = ALICE, name = "Alice") => id.token(accountId, name, endpoint) };
}
/** One raw client. Resolves with the server's first verdict: `joined` or `error`. */
async function connect(port: number, worldId: string, token: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`); const messages: any[] = [];
  ws.on("message", data => messages.push(JSON.parse(data.toString())));
  cleanups.push(async () => { ws.terminate(); });
  await new Promise<void>(resolve => ws.once("open", resolve));
  ws.send(JSON.stringify({ type: "join", providerId: "reference", worldId, token, protocolVersion: WORLD_PROTOCOL_VERSION }));
  await expect.poll(() => messages.some(message => message.type === "joined" || message.type === "error"), { timeout: 3000, interval: 5 }).toBe(true);
  const verdict = messages.find(message => message.type === "joined" || message.type === "error");
  const privateState = async () => {
    await expect.poll(() => messages.some(message => message.type === "update" && message.update.privateState), { timeout: 3000, interval: 5 }).toBe(true);
    return messages.find(message => message.type === "update" && message.update.privateState).update.privateState;
  };
  const leave = async () => { const gone = new Promise(resolve => ws.once("close", resolve)); ws.send(JSON.stringify({ type: "leave" })); await gone; };
  const drop = async () => { const gone = new Promise(resolve => ws.once("close", resolve)); ws.terminate(); await gone; };
  return { ws, messages, verdict, error: verdict.type === "error" ? verdict.error : null, privateState, leave, drop };
}
const ore = { itemId: "grithe_ore", quantity: 4, slotIndex: 5 };

describe("one account across the worlds of a server", () => {
  it("advertises account authentication and carries one character, inventory included, from world to world", async () => {
    const { server, hosted, token } = await serve();
    const listed = await (await fetch(`http://127.0.0.1:${server.port}/worlds`)).json();
    expect(listed.map((entry: WorldDescriptor) => [entry.worldId, entry.authentication])).toEqual([["north", "account"], ["south", "account"]]);

    const north = await connect(server.port, "north", token());
    expect(north.verdict).toMatchObject({ type: "joined", playerId: ALICE });
    const state = hosted("north").runtime.players.get(ALICE)!.store.get();
    expect(state.player.name).toBe("Alice");
    state.inventory.slots[5] = { ...ore }; state.currency = 61; state.player.position = [6, 0, 2];
    await north.leave();

    const south = await connect(server.port, "south", token());
    expect(south.verdict).toMatchObject({ type: "joined", playerId: ALICE, nextOperation: 1 });
    const arrived = await south.privateState();
    expect(arrived.inventory.slots[5]).toEqual(ore); expect(arrived.currency).toBe(61);
    // A different world than the last one: that world's safe spawn, not a position from another map.
    expect(arrived.player.position).toEqual([0, 0, 0]);
    expect(hosted("north").runtime.players.has(ALICE)).toBe(false);
    hosted("south").runtime.players.get(ALICE)!.store.get().player.position = [3, 0, -4];
    await south.leave();

    const again = await connect(server.port, "south", token());
    expect((await again.privateState()).player.position).toEqual([3, 0, -4]);
    expect(server.metrics.errors).toBe(0);
  });

  it("rejects a second simultaneous login in the same world and in another world, then admits it after the first leaves", async () => {
    const { server, token } = await serve();
    const first = await connect(server.port, "north", token());
    expect(first.verdict.type).toBe("joined");
    expect((await connect(server.port, "north", token())).error).toEqual({ code: "DUPLICATE_LOGIN", message: "This player is already connected" });
    expect((await connect(server.port, "south", token())).error).toEqual({ code: "DUPLICATE_LOGIN", message: "This player is already connected" });
    expect((await connect(server.port, "south", token(BOB, "Bob"))).verdict).toMatchObject({ type: "joined", playerId: BOB });
    await first.leave();
    expect((await connect(server.port, "south", token())).verdict).toMatchObject({ type: "joined", playerId: ALICE });
  });

  it("keeps a dropped player's account for the reconnect window, resumable in the same world or after the save in another", async () => {
    const { server, storage, hosted, token } = await serve();
    const lease = () => storage.database.prepare("SELECT world_key, reserved FROM player_leases WHERE account_id=?").get(ALICE) as { world_key: string; reserved: number } | undefined;
    const first = await connect(server.port, "north", token());
    expect({ ...lease() }).toEqual({ world_key: '["reference","north"]', reserved: 0 });
    hosted("north").runtime.players.get(ALICE)!.store.get().currency = 12;
    await first.drop();
    // No wait between the drop and the rejoin: the join itself waits for the dropped session's save.
    const resumed = await connect(server.port, "north", token());
    expect((await resumed.privateState()).currency).toBe(12);
    hosted("north").runtime.players.get(ALICE)!.store.get().currency = 13;
    await resumed.drop();
    await expect.poll(() => lease()?.reserved, { timeout: 3000, interval: 5 }).toBe(1);
    expect(hosted("north").admission.population).toBe(1);
    const elsewhere = await connect(server.port, "south", token());
    expect((await elsewhere.privateState()).currency).toBe(13);
    expect({ ...lease() }).toEqual({ world_key: '["reference","south"]', reserved: 0 });
    expect(hosted("north").admission.population).toBe(0);
  });

  it("gives a returning owner the character they played elsewhere and the campfire they left here", async () => {
    const { server, storage, hosted, token } = await serve();
    const north = await connect(server.port, "north", token());
    const builder = hosted("north").runtime.players.get(ALICE)!;
    builder.store.get().player.position = [-8, 0, 0]; builder.store.get().inventory.slots[0] = { itemId: "palewood_log", quantity: 1, slotIndex: 0 };
    north.ws.send(JSON.stringify({ type: "command", envelope: { sessionId: north.verdict.sessionId, sequence: 1, operation: 1, command: { method: "buildCampfire", args: ["palewood_log"] } } }));
    await expect.poll(() => builder.store.get().world.campfire?.id, { timeout: 8000, interval: 20 }).toBe("campfire:player");
    await north.leave();
    // The owner stays simulated in north as a resident copy while the fire burns.
    await expect.poll(() => hosted("north").leases.has(ALICE), { timeout: 3000, interval: 5 }).toBe(false);
    expect(hosted("north").runtime.players.has(ALICE)).toBe(true);

    const south = await connect(server.port, "south", token());
    expect((await south.privateState()).ownedWorld.campfire).toBeNull();
    const traveller = hosted("south").runtime.players.get(ALICE)!.store.get();
    traveller.inventory.slots[5] = { ...ore }; traveller.currency = 77;
    const ticks = hosted("north").runtime.clock.tick;
    await expect.poll(() => hosted("north").runtime.clock.tick - ticks, { timeout: 3000, interval: 20 }).toBeGreaterThan(3);
    await south.leave();
    await expect.poll(() => hosted("south").leases.has(ALICE), { timeout: 3000, interval: 5 }).toBe(false);
    // North kept ticking its stale copy the whole time and never wrote it over the character.
    expect(hosted("north").runtime.players.get(ALICE)!.store.get().currency).toBe(0);
    expect(JSON.parse(String(storage.database.prepare("SELECT character FROM players WHERE account_id=?").get(ALICE)!.character)).currency).toBe(77);

    const back = await connect(server.port, "north", token());
    expect(back.verdict).toMatchObject({ type: "joined", nextOperation: 2 });
    const returned = await back.privateState();
    expect(returned.currency).toBe(77); expect(returned.inventory.slots[5]).toEqual(ore);
    expect(returned.inventory.slots[0]).toBeNull();
    expect(returned.ownedWorld.campfire).toMatchObject({ id: "campfire:player", logItemId: "palewood_log", regionId: "fallowmarch" });
    expect(hosted("north").runtime.entities.get(`campfire:${ALICE}`)).toBeDefined();
    expect(server.metrics.errors).toBe(0);
  }, 20_000);

  it("keeps the character across a server restart and frees every account on close", async () => {
    const file = join(tmpdir(), `corealm-accounts-${randomUUID()}.sqlite`);
    cleanups.push(async () => { for (const suffix of ["", "-wal", "-shm"]) await rm(file + suffix, { force: true }); });
    const id = identity();
    const first = await serve(file, id);
    const session = await connect(first.server.port, "north", first.token());
    expect(session.verdict.type).toBe("joined");
    const state = first.hosted("north").runtime.players.get(ALICE)!.store.get();
    state.inventory.slots[5] = { ...ore }; state.currency = 40; state.player.position = [2, 0, 9];
    // Closed with the player still connected: the close itself saves and releases.
    await first.close();

    const second = await serve(file, id);
    const rows = second.storage.database.prepare("SELECT account_id, name, last_world, playtime_seconds FROM players").all().map(row => ({ ...row }));
    expect(rows).toEqual([{ account_id: ALICE, name: "Alice", last_world: '["reference","north"]', playtime_seconds: 0 }]);
    expect(second.storage.database.prepare("SELECT count(*) AS held FROM player_leases").get()!.held).toBe(0);
    const returned = await (await connect(second.server.port, "north", second.token())).privateState();
    expect(returned.inventory.slots[5]).toEqual(ore); expect(returned.currency).toBe(40); expect(returned.player.position).toEqual([2, 0, 9]);
  });

  it("runs the admission hook after authentication and before the claim, so a refused account holds nothing", async () => {
    const storage = new SqliteWorldStorage(":memory:"); const id = identity(); const seen: string[] = [];
    const server = await startReferenceServer({ worlds: [world("north")], storage, build: () => createMultiplayerLabWorld(),
      authentication: await createIdentityAuthentication({ identityUrl: "https://identity.test/", fetch: id.fetch, now: () => id.nowMs }),
      beforeAdmission: async (player, target) => { seen.push(`${player.playerId}@${target.worldId}`); if (player.playerId === BOB) throw new SessionFailure("UNAUTHORIZED", "Banned"); },
      http: (request, response, context) => { if (request.url !== "/probe") return false; response.end(JSON.stringify({ commands: context.metrics.commands, worlds: [...context.worlds.keys()] })); return true; } });
    cleanups.push(() => server.close());
    const endpoint = `ws://127.0.0.1:${server.port}/`;
    expect((await connect(server.port, "north", id.token(BOB, "Bob", endpoint))).error).toEqual({ code: "UNAUTHORIZED", message: "Banned" });
    expect((await connect(server.port, "north", "junk")).error).toEqual({ code: "UNAUTHORIZED", message: "Join token is invalid" });
    expect(seen).toEqual([`${BOB}@north`]);
    expect(storage.database.prepare("SELECT count(*) AS n FROM players").get()!.n).toBe(0);
    expect(await (await fetch(`http://127.0.0.1:${server.port}/probe`)).json()).toEqual({ commands: 0, worlds: ['["reference","north"]'] });
    expect((await fetch(`http://127.0.0.1:${server.port}/missing`)).status).toBe(404);
  });
});

describe("join token verification at the game server", () => {
  it("rejects a token minted for another endpoint, an expired token and a replayed token without saying more", async () => {
    const { server, id, endpoint, token } = await serve();
    expect((await connect(server.port, "north", id.token(ALICE, "Alice", "wss://other.example.com/"))).error)
      .toEqual({ code: "UNAUTHORIZED", message: "Join token was issued for another server" });
    expect((await connect(server.port, "north", id.token(ALICE, "Alice", endpoint, id.nowMs - 66_000))).error)
      .toEqual({ code: "UNAUTHORIZED", message: "Join token expired" });
    const forged = createSigningKey().signing;
    expect((await connect(server.port, "north", id.token(ALICE, "Alice", endpoint, id.nowMs, { ...forged, kid: "forged-kid" }))).error)
      .toEqual({ code: "UNAUTHORIZED", message: "Join token is invalid" });

    const once = token();
    const first = await connect(server.port, "north", once);
    expect(first.verdict.type).toBe("joined");
    await first.leave();
    expect((await connect(server.port, "north", once)).error).toEqual({ code: "UNAUTHORIZED", message: "Join token is invalid" });
    // Remembered until the token could no longer verify, then forgotten; by then it is expired.
    id.nowMs += 66_000;
    expect((await connect(server.port, "north", once)).error).toEqual({ code: "UNAUTHORIZED", message: "Join token expired" });
    expect((await connect(server.port, "north", token())).verdict.type).toBe("joined");
  });

  it("fetches keys once at start, refetches for a rotated key, and rations refetches under a flood of unknown keys", async () => {
    const { server, id, endpoint, token } = await serve();
    expect(id.fetches).toBe(1);
    const first = await connect(server.port, "north", token()); expect(first.verdict.type).toBe("joined"); await first.leave();
    expect(id.fetches).toBe(1);

    id.nowMs += 10_000; id.rotate();
    const rotated = await connect(server.port, "north", token());
    expect(rotated.verdict.type).toBe("joined"); expect(id.fetches).toBe(2);
    await rotated.leave();

    const stranger = createSigningKey().signing;
    const flood = await Promise.all(Array.from({ length: 8 }, () => connect(server.port, "north", id.token(BOB, "Bob", endpoint, id.nowMs, stranger))));
    expect(flood.map(attempt => attempt.error?.message)).toEqual(Array(8).fill("Join token is invalid"));
    expect(id.fetches).toBe(2);
    id.nowMs += 10_000;
    await Promise.all(Array.from({ length: 8 }, () => connect(server.port, "north", id.token(BOB, "Bob", endpoint, id.nowMs, stranger))));
    expect(id.fetches).toBe(3);
    // An identity outage after start changes nothing for keys already held.
    id.nowMs += 10_000; id.down = true;
    expect((await connect(server.port, "north", id.token(BOB, "Bob", endpoint, id.nowMs, stranger))).error?.message).toBe("Join token is invalid");
    expect((await connect(server.port, "north", token())).verdict.type).toBe("joined");
  });

  it("refuses to start when the identity service cannot be reached", async () => {
    const id = identity(); id.down = true;
    await expect(createIdentityAuthentication({ identityUrl: "https://identity.test/", fetch: id.fetch }))
      .rejects.toThrow("Identity service keys are unavailable at https://identity.test/.well-known/corealm-keys.json: connect ECONNREFUSED");
  });
});

describe("guest servers", () => {
  it("namespaces guest ids so no guest name can claim an account", async () => {
    expect(await guestAuthentication.authenticate("guest:Wren", world("north"))).toEqual({ playerId: "guest:Wren", name: "Wren" });
    expect(await guestAuthentication.authenticate(`guest:${ALICE}`, world("north"))).toEqual({ playerId: `guest:${ALICE}`, name: ALICE });
    await expect(guestAuthentication.authenticate(ALICE, world("north"))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(guestAuthentication.authenticate("guest:a b", world("north"))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const server = await startReferenceServer({ worlds: [world("north")], storage: new SqliteWorldStorage(":memory:"), build: () => createMultiplayerLabWorld(), authentication: guestAuthentication });
    cleanups.push(() => server.close());
    expect((await (await fetch(`http://127.0.0.1:${server.port}/worlds`)).json())[0].authentication).toBe("guest");
    expect((await connect(server.port, "north", "guest:Wren")).verdict).toMatchObject({ type: "joined", playerId: "guest:Wren" });
  });
});
