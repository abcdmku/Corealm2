import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { WorldSession, WorldUpdate } from "../game/src/contracts.js";
import { RESOLVED_CATALOG } from "../game/src/content/resolvedCatalog.js";
import { createServerCatalogOverlay } from "../game/src/multiplayer/clientCatalogFetch.js";
import { MemoryWorldStorage } from "../game/src/multiplayer/memoryStorage.js";
import { descriptor, discoverWorlds, LOCAL_ENDPOINT, localWorld } from "../game/src/multiplayer/protocol.js";
import { ProviderRegistry, SessionController } from "../game/src/multiplayer/providers.js";
import { readServerWorldPackHeader, SERVER_WORLD_PACK_REPO_PATH } from "../game/src/multiplayer/worldPack.js";
import { WorkerWorldProvider, resolveLocalSeed, type LocalWorkerLike } from "../game/src/multiplayer/workerProvider.js";
import { LOCAL_ACCOUNT_ID, localWorldDescriptor, parseLocalWorldManifest, type LegacyImport, type LocalHostReply, type LocalHostRequest } from "../game/src/worker/localHostProtocol.js";
import { startLocalHost, type LocalHost } from "../game/src/worker/localHostRuntime.js";
import { legacySaveImport } from "../game/src/persistence/localSaveMigration.js";
import { createInitialState } from "../game/src/state/store.js";
import { localWorldFiles } from "../tools/lib/local-world-files.js";
import { gameRoot, repoRoot } from "../tools/lib/paths.js";

/**
 * Local play end to end without a browser: the real provider, the real client session code, a real
 * MessageChannel, and the real host core over the lab world. Only the Worker itself is stood in for,
 * by an object that answers the worker protocol from this thread. The test owns time by stepping the host.
 */
class StandInWorker implements LocalWorkerLike {
  host: LocalHost | null = null; terminated = false; requests: LocalHostRequest["type"][] = [];
  private readonly listeners: { message: ((event: { data: LocalHostReply }) => void)[]; error: ((event: unknown) => void)[] } = { message: [], error: [] };
  constructor(private readonly storage: MemoryWorldStorage, private readonly refuse: string | null = null) {}
  private reply(data: LocalHostReply): void { for (const listener of this.listeners.message) listener({ data: structuredClone(data) }); }
  addEventListener(type: "message" | "error" | "messageerror", listener: (event: never) => void): void {
    if (type === "message") this.listeners.message.push(listener as never); else if (type === "error") this.listeners.error.push(listener as never);
  }
  crash(): void { for (const listener of this.listeners.error) listener(new Error("worker died")); }
  terminate(): void { this.terminated = true; }
  postMessage(message: LocalHostRequest): void {
    this.requests.push(message.type);
    void (async () => {
      if (message.type === "start") {
        if (this.refuse) { this.reply({ type: "failed", code: "UNAVAILABLE", message: this.refuse }); return; }
        this.host = await startLocalHost({ fixture: message.fixture, seed: message.seed, storage: this.storage, manual: true, ...(message.legacy ? { legacy: structuredClone(message.legacy) } : {}) });
        this.reply({ type: "ready", world: this.host.world, catalogRevision: RESOLVED_CATALOG.revision, seed: this.host.seed, legacy: this.host.legacy, storage: "memory",
          timings: { manifestMs: 0, catalogMs: 0, packMs: 0, installMs: 0, storageMs: 0, importMs: this.host.timings.importMs, worldMs: this.host.timings.worldMs, totalMs: 0 } });
      } else if (message.type === "connect") this.host!.connect(message.port as never);
      else if (message.type === "catalog") this.reply({ type: "catalog", id: message.id, catalog: this.host!.clientCatalog() });
      else if (message.type === "close") { await this.host!.close(); this.reply({ type: "closed", id: message.id }); }
    })();
  }
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function page(options: { legacy?: LegacyImport; refuse?: string } = {}) {
  const storage = new MemoryWorldStorage(), workers: StandInWorker[] = []; let migrated = 0;
  const provider = new WorkerWorldProvider({ fixture: "lab", seed: 1337, assetBase: "http://127.0.0.1/", memory: true,
    spawn: () => { const worker = new StandInWorker(storage, options.refuse ?? null); workers.push(worker); return worker; },
    ...(options.legacy ? { legacy: { read: () => migrated ? null : options.legacy!, migrated: () => { migrated++; } } } : {}) });
  return { storage, workers, provider, migrations: () => migrated };
}
/** Step the host until `done`, as the tick loop would over that many tenths of a second. */
async function until(worker: StandInWorker, done: () => boolean, ticks = 600): Promise<void> {
  for (let tick = 0; tick < ticks && !done(); tick++) { await worker.host!.host.step(); await new Promise(resolve => setTimeout(resolve, 0)); }
  expect(done()).toBe(true);
}

describe("a local descriptor", () => {
  const local = localWorldDescriptor("authored", 1337);
  it("is legal as the page's own and names no address to dial", () => {
    expect(descriptor(local)).toMatchObject({ providerId: "local", worldId: "authored-1337", endpoint: LOCAL_ENDPOINT, capacity: 1 });
    expect(localWorld(local)).toBe(true);
  });
  it("is refused from anything remote: a directory, a /worlds reply, a socket's joined message", async () => {
    expect(() => descriptor(local, "socket")).toThrow("Endpoints require encrypted transport or loopback");
    await expect(discoverWorlds([local])).rejects.toMatchObject({ code: "INVALID_MESSAGE" });
    expect(() => descriptor({ ...local, endpoint: "local:other" })).toThrow();
    expect(() => descriptor({ ...local, endpoint: "ws://example.com/" })).toThrow();
  });
});

describe("local play over a message port", () => {
  it("joins, plays by commands, reads its catalog from the worker, and ends the worker on leaving", async () => {
    const { provider, workers, storage } = page();
    expect(await provider.discover()).toEqual([localWorldDescriptor("lab", 1337)]);
    const session = await provider.connect(provider.world, await provider.authenticate()); cleanups.push(() => session.close());
    const worker = workers[0]!;
    expect([session.playerId, session.world, session.catalog?.revision]).toEqual([LOCAL_ACCOUNT_ID, { ...provider.world, catalogRevision: RESOLVED_CATALOG.revision }, RESOLVED_CATALOG.revision]);

    const updates: WorldUpdate[] = []; session.subscribe(update => updates.push(update));
    expect([updates[0]!.snapshot, updates[0]!.privateState!.player.name, updates[0]!.entities.some(entity => entity.id === "multiplayer:ore")]).toEqual([true, "Adventurer", true]);

    // The inventory changes only because the host ran the command: walk to the ore and mine it.
    const state = (session as WorldSession & { state: { privateState: { inventory: { slots: ({ itemId: string } | null)[] } } | null } }).state;
    const ore = () => state.privateState!.inventory.slots.filter(slot => slot?.itemId === "grithe_ore").length;
    expect(ore()).toBe(0);
    const mining = session.command({ method: "interact", args: ["multiplayer:ore", "mine"] });
    await until(worker, () => ore() > 0);
    expect(await mining).toMatchObject({ status: "accepted", sequence: 1 });

    // The overlay takes the catalog through the session, and the session asks the worker for it.
    const names: string[] = [];
    const overlay = createServerCatalogOverlay({ register(tables) { names.push(...(tables.items ?? []).slice(0, 1).map(item => item.id)); },
      allItems: () => [], allResources: () => [], allRecipes: () => [], allSpells: () => [], allEnemies: () => [], allShops: () => [] });
    await overlay.enter(session.catalog!);
    expect([overlay.revision, worker.requests.includes("catalog"), names.length]).toEqual([RESOLVED_CATALOG.revision, true, 1]);

    await session.close();
    expect([worker.requests.at(-1), worker.terminated, worker.host!.host.closed]).toEqual(["close", true, true]);
    // The character was saved on the way out, with what it mined.
    const saved = (await storage.load(provider.world))!.players[LOCAL_ACCOUNT_ID]!;
    expect(saved.inventory.slots.some(slot => slot?.itemId === "grithe_ore")).toBe(true);

    // A new session is a new worker over the same store, and the character is still there.
    const again = await provider.connect(provider.world, await provider.authenticate()); cleanups.push(() => again.close());
    expect(workers.length).toBe(2);
    let first: WorldUpdate | null = null; again.subscribe(update => { first ??= update; });
    expect(first!.privateState!.inventory.slots.some(slot => slot?.itemId === "grithe_ore")).toBe(true);
  }, 60_000);

  it("goes through the session controller like a socket world, and surfaces a dead worker as unavailable until the player restarts it", async () => {
    const { provider, workers } = page();
    const registry = new ProviderRegistry(); registry.register(provider);
    const phases: string[] = []; const messages: (string | undefined)[] = [];
    const controller = new SessionController(registry, { clear() {}, apply() {}, async offline() {}, phase(phase, message) { phases.push(phase); messages.push(message); } });
    cleanups.push(() => controller.leave());
    await controller.join(provider.world);
    expect(phases).toEqual(["connecting", "connected"]);

    workers[0]!.crash();
    expect(workers[0]!.terminated).toBe(true);
    await expect.poll(() => phases.at(-1), { timeout: 5000 }).toBe("unavailable");
    expect(phases.slice(2)).toEqual(["reconnecting", "connecting", "unavailable"]);
    expect(messages.at(-1)).toBe("Local play stopped unexpectedly. Choose Play local to start it again.");
    expect(workers.length).toBe(1);

    await controller.join(provider.world);
    expect([phases.at(-1), workers.length, provider.observe()]).toMatchObject(["connected", 2, { starts: 2, running: true, crashed: false }]);
  }, 60_000);

  it("joins the worker it started ahead of time instead of starting another", async () => {
    const { provider, workers } = page();
    provider.prestart(); provider.prestart();
    await expect.poll(() => workers[0]?.host !== null && workers[0]?.host !== undefined).toBe(true);
    const session = await provider.connect(provider.world, await provider.authenticate()); cleanups.push(() => session.close());
    expect([workers.length, workers[0]!.requests, provider.observe().starts]).toEqual([1, ["start", "connect"], 1]);
  }, 60_000);

  it("reports a worker that refuses to start, such as a store another tab holds", async () => {
    const { provider, workers } = page({ refuse: "Local play is already open in another tab. Close that tab, then choose Play local again." });
    await expect(provider.connect(provider.world, await provider.authenticate())).rejects.toMatchObject({ code: "UNAVAILABLE", message: expect.stringContaining("already open in another tab") });
    expect([workers[0]!.terminated, provider.observe().running]).toEqual([true, false]);
  });
});

describe("an old main-thread save", () => {
  function save(): LegacyImport {
    const state = createInitialState(1337);
    state.player.name = "Maren"; state.currency = 431;
    return legacySaveImport(state);
  }
  it("becomes the local character once, is acknowledged, and is never laid over a character the store already has", async () => {
    const { provider, storage, migrations } = page({ legacy: save() });
    const session = await provider.connect(provider.world, await provider.authenticate()); cleanups.push(() => session.close());
    expect([provider.observe().ready!.legacy, migrations()]).toEqual(["imported", 1]);
    let first: WorldUpdate | null = null; session.subscribe(update => { first ??= update; });
    expect([first!.privateState!.player.name, first!.privateState!.currency]).toEqual(["Maren", 431]);
    await session.close();

    // The marker was lost (a storage that refused the write), so the same save is offered again.
    const stale = save(); stale.character.currency = 1;
    const second = new WorkerWorldProvider({ fixture: "lab", seed: 1337, assetBase: "http://127.0.0.1/", memory: true, spawn: () => new StandInWorker(storage),
      legacy: { read: () => stale, migrated() {} } });
    const later = await second.connect(second.world, await second.authenticate()); cleanups.push(() => later.close());
    expect(second.observe().ready!.legacy).toBe("existing");
    let kept: WorldUpdate | null = null; later.subscribe(update => { kept ??= update; });
    expect([kept!.privateState!.player.name, kept!.privateState!.currency]).toEqual(["Maren", 431]);
  }, 60_000);

  it("from a seed the pack does not hold keeps what it carries and starts at the safe spawn", async () => {
    const legacy = save(); legacy.seed = 99; legacy.character.player.position = [40, 0, 40];
    const host = await startLocalHost({ fixture: "lab", seed: 1337, legacy, manual: true }); cleanups.push(() => host.close());
    expect(host.legacy).toBe("imported");
    const stored = host.host.worlds.values().next().value!.runtime.snapshot().players[LOCAL_ACCOUNT_ID]!;
    expect([stored.player.position, stored.currency, stored.meta.seed]).toEqual([[0, 0, 0], 431, 1337]);
  });
});

describe("the files published for the worker", () => {
  it("names the catalog by its bytes and the pack by its revision, and the manifest parses", async () => {
    const files = localWorldFiles(gameRoot);
    const header = readServerWorldPackHeader(new Uint8Array(await readFile(path.join(repoRoot, SERVER_WORLD_PACK_REPO_PATH))));
    expect(parseLocalWorldManifest(JSON.parse(JSON.stringify(files.manifest)))).toEqual(files.manifest);
    expect(files.manifest).toMatchObject({ version: 1, catalog: { revision: RESOLVED_CATALOG.revision, formulaRevision: RESOLVED_CATALOG.formulaRevision, file: files.catalogFile },
      pack: { file: "server-world.pack", revision: header.revision, seeds: header.seeds } });
    expect(files.catalogFile).toMatch(/^server-catalog-[0-9a-f]{16}\.json$/);
    const catalog = JSON.parse(files.catalogText) as { revision: string; formulaRevision: string; tables: Record<string, unknown> };
    // The server catalog, whole: the tables the client build strips are the ones spawn planning reads.
    expect(Object.keys(catalog)).toEqual(["version", "revision", "formulaRevision", "tables"]);
    expect(Object.keys(catalog.tables)).toEqual(expect.arrayContaining(["lootTables", "placements", "world", "enemies", "quests", "dialogue"]));
    expect(() => parseLocalWorldManifest({ ...files.manifest, catalog: { ...files.manifest.catalog, file: "../catalog.json" } })).toThrow("malformed");
  });
  it("settles local play on a seed the pack holds", async () => {
    const manifest = JSON.stringify(localWorldFiles(gameRoot).manifest), asked: string[] = [];
    const fetcher = (async (url: string) => { asked.push(url); return new Response(manifest); }) as typeof fetch;
    expect(await resolveLocalSeed("https://assets.example.com/corealm/", 1337, fetcher)).toEqual({ seed: 1337, fallback: false });
    expect(await resolveLocalSeed("https://assets.example.com/corealm/", 99, fetcher)).toEqual({ seed: 1337, fallback: true });
    expect(asked[0]).toBe("https://assets.example.com/corealm/generated/local-world.json");
  });
});
