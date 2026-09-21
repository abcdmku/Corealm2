import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { totalXpAt } from "../game/src/content/xp.js";
import { createSigningKey, joinTokenClaims, signJoinToken, type IdentityKey } from "../identity/src/joinToken.js";
import { createIdentityAuthentication } from "../game/src/multiplayer/identityAuthentication.js";
import type { DatabaseSpec } from "../game/src/multiplayer/threads/databaseThread.js";
import { restartBudget } from "../game/src/multiplayer/threads/threadedHost.js";
import type { WorldBuild } from "../game/src/multiplayer/threads/worldThread.js";
import { readContentSources } from "../tools/content/compile.js";
import { PLACEMENT_GROUP } from "./fixtures/placementWorld.js";
import type { ThreadWorldOptions } from "./fixtures/threadWorlds.js";
import { fixtureWorld, startThreadedServer } from "./helpers/threadedServer.js";

/**
 * A server whose worlds each run in a thread of their own, driven only the way its users drive it:
 * sockets, the admin API and `/worlds`. Nothing here reads a live world object, because there is none
 * in this thread to read. What a world holds is read from the database, one commit behind at most.
 */
const OWNER = "acc_OOOOOOOOOOOOOOOOOOOOOO", ALICE = "acc_AAAAAAAAAAAAAAAAAAAAAA", BOB = "acc_BBBBBBBBBBBBBBBBBBBBBB";
const world = (worldId: string, fixture: "lab" | "authored" = "lab"): WorldDescriptor => ({ providerId: "reference", worldId, name: worldId, endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture, seed: 1337, population: 0, capacity: 4, availability: "available" });
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function serve(options: { build?: WorldBuild; database?: DatabaseSpec; sources?: Record<string, unknown>; fixture?: "lab" | "authored"; holdTimeoutMs?: number; restart?: boolean; restartLimit?: number } = {}) {
  const created = createSigningKey(), logs: Record<string, unknown>[] = [];
  const keys: IdentityKey[] = [{ kid: created.signing.kid, alg: "EdDSA", publicKey: created.publicKey, status: "active" }];
  const server = await startThreadedServer({ worlds: [world("north", options.fixture), world("south", options.fixture)], admin: true, ownerAccount: OWNER, log: event => logs.push(event),
    ...(options.build ? { build: options.build } : {}), ...(options.database ? { database: options.database } : {}), ...(options.sources ? { sources: options.sources } : {}),
    assets: { bundledManifest: async () => JSON.parse(await readFile("game/public/assets/manifest.json", "utf8")) },
    threads: { ...(options.holdTimeoutMs ? { holdTimeoutMs: options.holdTimeoutMs } : {}), ...(options.restart === undefined ? {} : { restart: options.restart }),
      ...(options.restartLimit === undefined ? {} : { restartLimit: options.restartLimit }) },
    authentication: await createIdentityAuthentication({ identityUrl: "https://identity.test/", fetch: (async () => new Response(JSON.stringify({ keys }))) as typeof fetch }) });
  let closed = false; const close = async () => { if (!closed) { closed = true; await server.close(); } };
  cleanups.push(close);
  const token = (accountId: string, name: string) => signJoinToken(created.signing, joinTokenClaims({ accountId, name, endpoint: `ws://127.0.0.1:${server.port}/`, issuedAt: Date.now() / 1000 }));
  const call = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method: init.method ?? "GET",
      headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as any : null };
  };
  const owner = (await call("/admin/session", { method: "POST", body: { token: token(OWNER, "Owner") } })).body.session as string;
  const worlds = async () => Object.fromEntries(((await call("/worlds")).body as any[]).map(entry => [entry.worldId, entry]));
  const stored = (worldId: string) => server.database.storage.world.load({ providerId: "reference", worldId });
  return { server, logs, token, call, owner, worlds, stored, close };
}
type Served = Awaited<ReturnType<typeof serve>>;

/** One raw client. `verdict` is the server's first answer: `joined` or `error`. */
async function connect(served: Served, worldId: string, accountId: string, name: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${served.server.port}/`); const messages: any[] = [];
  cleanups.push(() => ws.terminate());
  ws.on("message", data => messages.push(JSON.parse(data.toString())));
  const closed = new Promise<[number, string]>(resolve => ws.once("close", (code, reason) => resolve([code, reason.toString()])));
  await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  ws.send(JSON.stringify({ type: "join", providerId: "reference", worldId, token: served.token(accountId, name), protocolVersion: WORLD_PROTOCOL_VERSION }));
  await expect.poll(() => messages.some(message => message.type === "joined" || message.type === "error"), { timeout: 10_000, interval: 5 }).toBe(true);
  const verdict = messages.find(message => message.type === "joined" || message.type === "error");
  let sequence = 0, operation = verdict.nextOperation as number;
  const command = (method: string, args: unknown[]) => { ws.send(JSON.stringify({ type: "command", envelope: { sessionId: verdict.sessionId, sequence: ++sequence, operation: operation++, command: { method, args } } })); return sequence; };
  const acked = (wanted: number) => expect.poll(() => messages.find(message => message.type === "ack" && message.outcome.sequence === wanted)?.outcome.status, { timeout: 10_000, interval: 5 });
  /** The owner's view of their own character, as the updates so far add up to. */
  const character = () => messages.filter(message => message.type === "update").reduce((state, message) => ({ ...state, ...message.update.privateState, ...message.update.privateDelta }), {} as any);
  const leave = async () => { ws.send(JSON.stringify({ type: "leave" })); return closed; };
  return { ws, messages, verdict, closed, command, acked, character, leave };
}
const edit = (served: Served, accountId: string, ops: unknown[]) => served.call(`/admin/players/${accountId}`, { method: "PATCH", token: served.owner, body: { ops } });
const carried = (state: any, itemId: string): number => (state.inventory?.slots ?? []).reduce((sum: number, slot: any) => sum + (slot?.itemId === itemId ? slot.quantity : 0), 0);

describe("accounts across worlds that share no memory", () => {
  it("refuses a second login from another world's thread, and a world switch saves in one thread before the other reads", async () => {
    const served = await serve();
    const alice = await connect(served, "north", ALICE, "Alice");
    expect(alice.verdict.type).toBe("joined");
    const second = await connect(served, "south", ALICE, "Alice");
    expect([second.verdict.error?.code, await second.closed]).toEqual(["DUPLICATE_LOGIN", [4000, "DUPLICATE_LOGIN"]]);

    // An edit of a live player happens in the thread of the world that holds them, which is the one the lease names.
    const given = await edit(served, ALICE, [{ op: "inventory.add", itemId: "grithe_ore", quantity: 7 }]);
    expect([given.status, given.body.applied, given.body.world, given.body.changed]).toEqual([200, "live", { providerId: "reference", worldId: "north" }, true]);
    await expect.poll(() => carried(alice.character(), "grithe_ore"), { timeout: 5000, interval: 10 }).toBe(7);

    // Leaving and joining the other world at once: north's next commit saves and releases her, and south's claim waits for it.
    expect(await alice.leave()).toEqual([1000, "Left world"]);
    const moved = await connect(served, "south", ALICE, "Alice");
    expect(moved.verdict.type).toBe("joined");
    await expect.poll(() => carried(moved.character(), "grithe_ore"), { timeout: 5000, interval: 10 }).toBe(7);
    const listed = await served.worlds();
    expect([listed.north.population, listed.south.population]).toEqual([0, 1]);

    // The same edit again finds her in the other thread.
    const again = await edit(served, ALICE, [{ op: "currency.set", amount: 4321 }]);
    expect([again.status, again.body.applied, again.body.world.worldId]).toEqual([200, "live", "south"]);
    await expect.poll(() => moved.character().currency, { timeout: 5000, interval: 10 }).toBe(4321);
    const audit = await served.call("/admin/audit?action=player.edit", { token: served.owner });
    expect(audit.body.entries.map((entry: any) => entry.after.world)).toEqual(["south", "north"]);
    expect((await served.call(`/admin/players/${ALICE}`, { token: served.owner })).body.online).toEqual({ providerId: "reference", worldId: "south" });
  }, 60_000);

  it("kicks and bans a player in a world thread, and changes a world's capacity while it runs", async () => {
    const served = await serve();
    const bob = await connect(served, "south", BOB, "Bob");
    const kicked = await served.call(`/admin/players/${BOB}/kick`, { method: "POST", token: served.owner, body: { reason: "testing" } });
    expect([kicked.status, kicked.body]).toEqual([200, { kicked: true }]);
    expect(await bob.closed).toEqual([4000, "KICKED"]);
    expect(bob.messages.at(-1)).toEqual({ type: "error", error: { code: "KICKED", message: "Kicked from this server: testing" } });

    const back = await connect(served, "north", BOB, "Bob");
    expect(back.verdict.type).toBe("joined");
    const banned = await served.call("/admin/bans", { method: "POST", token: served.owner, body: { accountId: BOB, reason: "griefing" } });
    expect([banned.status, banned.body.kicked]).toEqual([200, true]);
    expect((await back.closed)[1]).toBe("BANNED");
    const refused = await connect(served, "south", BOB, "Bob");
    expect(refused.verdict.error.code).toBe("BANNED");

    const patched = await served.call("/admin/settings", { method: "PATCH", token: served.owner, body: { worlds: { south: { capacity: 9 } } } });
    expect(patched.status).toBe(200);
    const listed = await served.worlds();
    expect([listed.north.capacity, listed.south.capacity]).toEqual([4, 9]);
    const stats = await served.call("/admin/stats", { token: served.owner });
    expect(stats.body.threads.worlds.map((entry: any) => [entry.worldId, entry.available])).toEqual([["north", true], ["south", true]]);
    expect(stats.body.events.map((event: any) => event.kind)).toEqual(expect.arrayContaining(["join", "kick", "leave", "ban"]));
  }, 60_000);
});

describe("failure", () => {
  it("fails the whole server closed when a world's commit fails", async () => {
    const file = join(tmpdir(), `corealm-threads-${randomUUID()}.sqlite`);
    cleanups.push(async () => { for (const suffix of ["", "-wal", "-shm"]) await rm(file + suffix, { force: true }); });
    const served = await serve({ restart: false, database: { kind: "sqlite", path: file } });
    const alice = await connect(served, "north", ALICE, "Alice");
    // The database goes away under the running worlds. Each world's next commit throws.
    await served.server.database.rpc.call("close");
    expect(await alice.closed).toEqual([1011, "World unavailable"]);
    expect(alice.messages.at(-1)).toEqual({ type: "error", error: { code: "UNAVAILABLE", message: "World storage or simulation failed" } });
    await expect.poll(async () => (await fetch(`http://127.0.0.1:${served.server.port}/readyz`)).status, { timeout: 5000, interval: 20 }).toBe(503);
    expect(Object.values(await served.worlds()).map((entry: any) => entry.availability)).toEqual(["unavailable", "unavailable"]);
    const late = await connect(served, "south", BOB, "Bob");
    expect(late.verdict.error.code).toBe("UNAVAILABLE");
    expect(served.logs.some(event => event.event === "world.failed")).toBe(true);
  }, 60_000);

  it("keeps the other worlds running when one world's thread dies, frees its players' accounts, and starts it again", async () => {
    const crashFlag = join(tmpdir(), `corealm-crash-${randomUUID()}`);
    cleanups.push(() => rm(crashFlag, { force: true }));
    const served = await serve({ build: fixtureWorld("threadWorlds.ts", { worldId: "south", crashFlag } satisfies ThreadWorldOptions) });
    const alice = await connect(served, "north", ALICE, "Alice"), bob = await connect(served, "south", BOB, "Bob");
    expect([alice.verdict.type, bob.verdict.type]).toEqual(["joined", "joined"]);

    await writeFile(crashFlag, "");
    expect(await bob.closed).toEqual([1011, "World unavailable"]);
    expect(bob.messages.at(-1)).toEqual({ type: "error", error: { code: "UNAVAILABLE", message: "World storage or simulation failed" } });
    await rm(crashFlag, { force: true });
    const crash = served.logs.find(event => event.event === "world.crashed")!;
    expect([crash.world, crash.level, String(crash.message)]).toEqual(["south", "error", "Error: The south world was told to crash"]);

    // North never noticed: it still answers its player, and the listing says which world is gone.
    await alice.acked(alice.command("stop", [])).toBe("accepted");
    const listed = await served.worlds();
    expect([listed.north.availability, listed.south.availability, listed.south.population]).toEqual(["available", "unavailable", 0]);
    expect((await connect(served, "south", "acc_CCCCCCCCCCCCCCCCCCCCCC", "Carol")).verdict.error).toEqual({ code: "UNAVAILABLE", message: "World is unavailable" });
    // The dead thread released nothing. The database freed Bob's lease, so he is not locked out for the lease's ninety seconds.
    const moved = await connect(served, "north", BOB, "Bob");
    expect(moved.verdict.type).toBe("joined");
    expect((await fetch(`http://127.0.0.1:${served.server.port}/readyz`)).status).toBe(200);

    // The world comes back by itself, on a fresh thread.
    await expect.poll(async () => (await served.worlds()).south.availability, { timeout: 30_000, interval: 100 }).toBe("available");
    expect(served.logs.some(event => event.event === "world.restarted" && event.world === "south")).toBe(true);
    const carol = await connect(served, "south", "acc_CCCCCCCCCCCCCCCCCCCCCC", "Carol");
    expect(carol.verdict.type).toBe("joined");
  }, 90_000);

  it("stops starting a world that keeps failing, and says so in the log and in the stats", async () => {
    const crashFlag = join(tmpdir(), `corealm-crash-${randomUUID()}`);
    cleanups.push(() => rm(crashFlag, { force: true }));
    // The flag stays put, so every thread this world gets dies the same way its first one did.
    const served = await serve({ restartLimit: 2, build: fixtureWorld("threadWorlds.ts", { worldId: "south", crashFlag } satisfies ThreadWorldOptions) });
    const bob = await connect(served, "south", BOB, "Bob");
    expect(bob.verdict.type).toBe("joined");
    await writeFile(crashFlag, "");
    await expect.poll(() => served.logs.filter(event => event.event === "world.abandoned").length, { timeout: 20_000, interval: 50 }).toBe(1);

    const abandoned = served.logs.find(event => event.event === "world.abandoned")!;
    expect([abandoned.world, abandoned.level, abandoned.failures, abandoned.message]).toEqual(["south", "error", 2,
      "World south failed 2 times and is not being started again. It stays unavailable until this server restarts."]);
    // It was started once, died again inside a second, and is not started a third time.
    expect(served.logs.filter(event => event.event === "world.crashed" && event.world === "south").length).toBe(2);
    expect(served.logs.filter(event => event.event === "world.restarted" && event.world === "south").length).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 2_500));
    expect(served.logs.filter(event => event.event === "world.restarted" && event.world === "south").length).toBe(1);

    const listed = await served.worlds();
    expect([listed.north.availability, listed.south.availability]).toEqual(["available", "unavailable"]);
    expect((await connect(served, "south", "acc_CCCCCCCCCCCCCCCCCCCCCC", "Carol")).verdict.error).toEqual({ code: "UNAVAILABLE", message: "World is unavailable" });
    const stats = await served.call("/admin/stats", { token: served.owner });
    expect(stats.body.threads.mode).toBe("auto");
    expect(stats.body.threads.worlds.map((entry: any) => [entry.worldId, entry.available, entry.abandoned, entry.failures]))
      .toEqual([["north", true, false, 0], ["south", false, true, 2]]);
    // The server itself is still serving: north never noticed.
    expect((await fetch(`http://127.0.0.1:${served.server.port}/readyz`)).status).toBe(200);
  }, 90_000);

  it("forgives failures older than the restart window", () => {
    // The clock is the test's, so ten minutes pass between two lines.
    const budget = restartBudget(3, 600_000);
    expect([budget.failed(0), budget.failed(500), budget.abandoned]).toEqual([1000, 2000, false]);
    // A world that ran past the window before it died starts counting from one again.
    expect(budget.failed(600_500)).toBe(1000);
    expect([budget.failures, budget.abandoned]).toEqual([1, false]);
    // Three inside the window is the limit, and the answer stays null however long the server runs after it.
    expect([budget.failed(600_600), budget.failed(600_700)]).toEqual([2000, null]);
    expect([budget.failures, budget.abandoned]).toEqual([3, true]);
    expect(budget.failed(2_000_000)).toBe(null);
  });

  it("refuses an operation that needs the tick hold when a world does not reach it in time, and recovers", async () => {
    const stallFlag = join(tmpdir(), `corealm-stall-${randomUUID()}`);
    cleanups.push(() => rm(stallFlag, { force: true }));
    const served = await serve({ holdTimeoutMs: 300, build: fixtureWorld("threadWorlds.ts", { worldId: "south", stallFlag, stallMs: 2000 } satisfies ThreadWorldOptions) });
    const alice = await connect(served, "north", ALICE, "Alice");
    await writeFile(stallFlag, "");
    await new Promise(resolve => setTimeout(resolve, 150));
    // South is blocked for two seconds and cannot stop at a tick boundary. The edit is refused whole, and north is let go again.
    const refused = await edit(served, ALICE, [{ op: "currency.set", amount: 77 }]);
    expect([refused.status, refused.body.error.code]).toEqual([503, "unavailable"]);
    await alice.acked(alice.command("stop", [])).toBe("accepted");
    // Once south answers again the late hold it took is already released, so the same edit goes through.
    await expect.poll(async () => (await edit(served, ALICE, [{ op: "currency.set", amount: 77 }])).status, { timeout: 10_000, interval: 250 }).toBe(200);
    await expect.poll(() => alice.character().currency, { timeout: 5000, interval: 10 }).toBe(77);
  }, 60_000);
});

// Last in the file: a publish moves this thread's own content registry, and a failure half way would leave it on another catalog than the next server seeds.
describe("publishing to worlds that each have their own content registry", () => {
  const TABLE = "shared_t0_frog", MARKER = "publish_marker";
  const markerItem = { id: MARKER, name: "Publish Marker", tier: 1, description: "Dropped only by a table a test published.", stackable: true, value: 1, category: "resource" };

  it("moves both worlds onto a published loot table, and both back on a rollback", async () => {
    const file = join(tmpdir(), `corealm-threads-${randomUUID()}.sqlite`);
    cleanups.push(async () => { for (const suffix of ["", "-wal", "-shm"]) await rm(file + suffix, { force: true }); });
    const served = await serve({ build: fixtureWorld("placementWorld.ts"), fixture: "authored", database: { kind: "sqlite", path: file }, sources: Object.fromEntries(await readContentSources()) });
    const seeded = served.server.catalog.revision;
    const players = { north: await connect(served, "north", ALICE, "Alice"), south: await connect(served, "south", BOB, "Bob") };
    const accounts = { north: ALICE, south: BOB };

    /** The player kills one frog of their world over their socket. Returns what the pile that kill dropped holds. */
    async function kill(worldId: "north" | "south", index: number): Promise<string[]> {
      const before = await served.stored(worldId);
      const frog = before!.entities.filter(entity => entity.meta?.groupId === PLACEMENT_GROUP).sort((a, b) => a.id.localeCompare(b.id))[index]!;
      const piles = new Set(Object.keys(before!.world.lootPiles));
      const placed = await edit(served, accounts[worldId], [{ op: "skill.setXp", skill: "melee", xp: totalXpAt(99) },
        { op: "position.set", world: { providerId: "reference", worldId }, regionId: frog.regionId, position: [frog.position[0] - 1.2, 0, frog.position[2]] }]);
      expect([placed.status, placed.body.applied]).toEqual([200, "live"]);
      players[worldId].command("attack", [frog.id]);
      await expect.poll(async () => (await served.stored(worldId))!.world.enemies[frog.id]?.state, { timeout: 60_000, interval: 100 }).toBe("dead");
      await expect.poll(async () => Object.keys((await served.stored(worldId))!.world.lootPiles).some(pile => !piles.has(pile)), { timeout: 5000, interval: 50 }).toBe(true);
      return Object.entries((await served.stored(worldId))!.world.lootPiles).filter(([pile]) => !piles.has(pile)).flatMap(([, pile]) => pile.items.map(stack => stack.itemId)).sort();
    }
    async function publish(change: (draft: Record<string, any>) => void) {
      const active = (await served.call("/admin/content/sources", { token: served.owner })).body, draft = structuredClone(active.sources);
      change(draft);
      const collections = Object.fromEntries(Object.keys(draft).filter(name => JSON.stringify(draft[name]) !== JSON.stringify(active.sources[name])).map(name => [name, { revision: active.revisions[name], value: draft[name] }]));
      return served.call("/admin/content/publish", { method: "POST", token: served.owner, body: { base: active.revision, collections } });
    }

    const published = await publish(draft => {
      draft.items.push(markerItem);
      const table = draft.lootTables.find((row: any) => row.id === TABLE);
      for (const roll of table.rolls) { roll.drops = roll.id === "items" ? [{ itemId: MARKER, quantity: [1, 1], chance: 1 }] : []; roll.tables = []; }
    });
    expect([published.status, published.body.stored, published.body.notified]).toEqual([200, true, 2]);
    const revision = published.body.revision as string;
    expect(revision).not.toBe(seeded);
    // Both sockets were told, and every world now says it runs the new catalog: in `/worlds`, and in what it saves.
    for (const player of Object.values(players)) await expect.poll(() => player.messages.some(message => message.type === "content-updated" && message.revision === revision), { timeout: 5000, interval: 10 }).toBe(true);
    const listed = await served.worlds();
    expect([listed.north.catalogRevision, listed.south.catalogRevision]).toEqual([revision, revision]);
    await expect.poll(async () => [(await served.stored("north"))!.catalogRevision, (await served.stored("south"))!.catalogRevision], { timeout: 5000, interval: 50 }).toEqual([revision, revision]);

    // The next kill in each world rolls the published table, with no restart.
    expect(await Promise.all([kill("north", 0), kill("south", 0)])).toEqual([["gold", MARKER], ["gold", MARKER]]);

    // A held marker blocks its removal, and the holder is found in the thread that has them.
    const given = await edit(served, BOB, [{ op: "inventory.add", itemId: MARKER, quantity: 1 }]);
    expect(given.status).toBe(200);
    const history = (await served.call("/admin/content/revision", { token: served.owner })).body;
    expect(history.revision).toBe(revision);
    const refused = await served.call("/admin/content/rollback", { method: "POST", token: served.owner, body: { revision: seeded } });
    expect([refused.status, refused.body.error.code]).toEqual([409, "definition_in_use"]);
    expect(refused.body.error.blockers.some((blocker: any) => blocker.id === MARKER && blocker.accountId === BOB)).toBe(true);
    expect((await edit(served, BOB, [{ op: "inventory.remove", itemId: MARKER, quantity: 1 }])).status).toBe(200);
    // The piles the kills dropped still hold the marker. They are the worlds' own, so empty them as a player would.
    for (const worldId of ["north", "south"] as const) for (const [pile, held] of Object.entries((await served.stored(worldId))!.world.lootPiles)) if (held.items.some(stack => stack.itemId === MARKER)) {
      await players[worldId].acked(players[worldId].command("takeLoot", [pile])).toBe("accepted");
      expect((await edit(served, accounts[worldId], [{ op: "inventory.remove", itemId: MARKER, quantity: 1 }])).status).toBe(200);
    }

    const rolled = await served.call("/admin/content/rollback", { method: "POST", token: served.owner, body: { revision: seeded } });
    expect([rolled.status, rolled.body.revision]).toEqual([200, seeded]);
    expect((await served.worlds()).south.catalogRevision).toBe(seeded);
    expect(await kill("south", 1)).not.toContain(MARKER);
  }, 240_000);
});
