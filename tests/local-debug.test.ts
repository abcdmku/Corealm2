import { afterEach, describe, expect, it } from "vitest";
import type { GameState } from "../game/src/state/store.js";
import { WORLD_PROTOCOL_VERSION, type SemanticEntity, type WorldDescriptor, type WorldSession, type WorldUpdate } from "../game/src/contracts.js";
import { HeadlessWorld } from "../game/src/multiplayer/headlessWorld.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { MemoryWorldStorage } from "../game/src/multiplayer/memoryStorage.js";
import { createWorldHost, type PeerLink } from "../game/src/multiplayer/worldHost.js";
import { WorkerWorldProvider, type LocalWorkerLike } from "../game/src/multiplayer/workerProvider.js";
import { debugOp, type DebugOp } from "../game/src/worker/localDebugProtocol.js";
import { LOCAL_ACCOUNT_ID, type LocalHostReply, type LocalHostRequest } from "../game/src/worker/localHostProtocol.js";
import { startLocalHost, type LocalHost } from "../game/src/worker/localHostRuntime.js";
import { loadSerializedSave, serializeSave } from "../game/src/persistence/storage.js";
import { createInitialState, SAVE_VERSION } from "../game/src/state/store.js";
import { RESOLVED_CATALOG } from "../game/src/content/resolvedCatalog.js";

/**
 * Local play's debug channel without a browser: the real provider and client session over a real
 * MessageChannel, the real host core over the lab world, and a stand-in for the Worker object only.
 * `manual` hosts tick when the test steps them, so "visible before the answer" is proven with no
 * tick running at all.
 */
class StandInWorker implements LocalWorkerLike {
  host: LocalHost | null = null;
  private readonly listeners: ((event: { data: LocalHostReply }) => void)[] = [];
  constructor(private readonly manual: boolean) {}
  private reply(data: LocalHostReply): void { for (const listener of this.listeners) listener({ data: structuredClone(data) }); }
  addEventListener(type: "message" | "error" | "messageerror", listener: (event: never) => void): void { if (type === "message") this.listeners.push(listener as never); }
  terminate(): void {}
  postMessage(message: LocalHostRequest): void {
    void (async () => {
      if (message.type === "start") {
        this.host = await startLocalHost({ fixture: message.fixture, seed: message.seed, storage: new MemoryWorldStorage(), manual: this.manual });
        this.reply({ type: "ready", world: this.host.world, catalogRevision: RESOLVED_CATALOG.revision, seed: this.host.seed, legacy: this.host.legacy, storage: "memory",
          timings: { manifestMs: 0, catalogMs: 0, packMs: 0, installMs: 0, storageMs: 0, importMs: 0, worldMs: 0, totalMs: 0 } });
      } else if (message.type === "connect") this.host!.connect(message.port as never);
      else if (message.type === "catalog") this.reply({ type: "catalog", id: message.id, catalog: this.host!.clientCatalog() });
      else if (message.type === "close") { await this.host!.close(); this.reply({ type: "closed", id: message.id }); }
    })();
  }
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

type Observed = WorldSession & { state: { privateState: GameState | null; entities: Map<string, SemanticEntity> } };
async function play(manual = true) {
  const workers: StandInWorker[] = [];
  const provider = new WorkerWorldProvider({ fixture: "lab", seed: 1337, assetBase: "http://127.0.0.1/", memory: true, spawn: () => { const worker = new StandInWorker(manual); workers.push(worker); return worker; } });
  const session = await provider.connect(provider.world, await provider.authenticate()) as Observed; cleanups.push(() => session.close());
  const updates: WorldUpdate[] = []; session.subscribe(update => updates.push(update));
  const seen = () => session.state.privateState!;
  const held = (itemId: string) => seen().inventory.slots.reduce((sum, slot) => sum + (slot?.itemId === itemId ? slot.quantity : 0), 0);
  return { provider, session, updates, seen, held, host: () => workers[0]!.host!, debug: (op: DebugOp) => provider.debug(op) };
}

describe("the debug channel of local play", () => {
  it("answers only after the page's replicated state shows the effect, with no tick running", async () => {
    const { debug, seen, held, host, updates } = await play();
    const ticksBefore = host().host.worlds.values().next().value!.runtime.clock.tick;

    expect(await debug({ op: "giveItem", itemId: "grithe_ore", quantity: 3, to: "inventory" })).toEqual({ ok: true, value: 3 });
    expect(held("grithe_ore")).toBe(3);
    await debug({ op: "removeItem", itemId: "grithe_ore", quantity: 1, from: "inventory" });
    expect(held("grithe_ore")).toBe(2);
    await debug({ op: "giveItem", itemId: "grithe_ore", quantity: 5, to: "bank" });
    expect(seen().bank.slots).toContainEqual({ itemId: "grithe_ore", quantity: 5 });

    expect(await debug({ op: "setSkillLevel", skill: "mining", level: 42 })).toBe(42);
    expect(seen().skills.mining.level).toBe(42);
    await debug({ op: "setCurrency", amount: 777 }); expect(seen().currency).toBe(777);
    await debug({ op: "setHealth", health: 3 }); expect(seen().player.health).toBe(3);
    await debug({ op: "setQuestStage", questId: "q_test", stage: 2 }); expect(seen().quests.q_test).toMatchObject({ status: "active", stage: 2 });
    await debug({ op: "place", position: [4, 0, -3], regionId: "fallowmarch", facingRad: 1 });
    expect([seen().player.position, seen().player.facingRad, seen().player.movement.mode]).toEqual([[4, 0, -3], 1, "idle"]);
    await debug({ op: "clearInventory" }); expect(seen().inventory.slots.every(slot => slot === null)).toBe(true);

    // Every effect above arrived by replication alone: the world never ticked.
    expect(host().host.worlds.values().next().value!.runtime.clock.tick).toBe(ticksBefore);
    expect(updates.length).toBeGreaterThan(8);
  }, 60_000);

  it("reads the whole world, not the interest set, and edits it through the game's own paths", async () => {
    const { debug, session, host } = await play();
    await debug({ op: "place", position: [500, 0, 500], regionId: "fallowmarch" });
    expect(session.state.entities.has("multiplayer:ore")).toBe(false);
    expect(await debug({ op: "getEntity", entityId: "multiplayer:ore" })).toMatchObject({ id: "multiplayer:ore", archetype: "ore", state: "available" });
    expect(await debug({ op: "getEntity", entityId: "nothing" })).toBeNull();
    const ores = await debug({ op: "findEntities", filter: { archetype: "ore" } }) as SemanticEntity[];
    expect(ores.map(entity => entity.id)).toContain("multiplayer:ore");
    expect((await debug({ op: "findEntities" }) as SemanticEntity[]).length).toBe(host().host.worlds.values().next().value!.runtime.entities.all().length);

    expect(await debug({ op: "depleteNode", entityId: "multiplayer:ore" })).toBe(true);
    expect(await debug({ op: "getEntity", entityId: "multiplayer:ore" })).toMatchObject({ state: "depleted", resource: { remaining: 0 } });
    expect(await debug({ op: "forceRespawn", entityId: "multiplayer:ore" })).toBe(true);
    await debug({ op: "advanceTicks", ticks: 2 });
    expect(await debug({ op: "getEntity", entityId: "multiplayer:ore" })).toMatchObject({ state: "available" });

    expect(await debug({ op: "killEntity", entityId: "multiplayer:frog" })).toBe(true);
    expect((await debug({ op: "getWorldState" }) as { enemies: Record<string, { state: string }> }).enemies["multiplayer:frog"]).toMatchObject({ state: "dead" });
    await debug({ op: "spawnEntity", entity: { id: "debug:crate", archetype: "landmark", name: "Crate", tier: 1, regionId: "fallowmarch", position: [1, 0, 1], state: "available", interactions: ["inspect"] } });
    expect(await debug({ op: "getEntity", entityId: "debug:crate" })).toMatchObject({ name: "Crate" });
    expect(await debug({ op: "despawnEntity", entityId: "debug:crate" })).toBe(true);
    expect(await debug({ op: "getEntity", entityId: "debug:crate" })).toBeNull();
  }, 60_000);

  it("drives time: pause stops the loop, a step is exactly one 100 ms tick, a jump moves the clock and runs one", async () => {
    const { debug, host, updates } = await play(false);
    const clock = () => host().host.worlds.values().next().value!.runtime.clock;
    expect(await debug({ op: "setPaused", paused: true })).toEqual({ paused: true, timeScale: 1 });
    const at = clock().tick; await new Promise(resolve => setTimeout(resolve, 350));
    expect(clock().tick).toBe(at);
    expect(await debug({ op: "advanceTicks", ticks: 7 })).toEqual({ tick: at + 7, simMs: (at + 7) * 100 });
    expect(updates.at(-1)!.tick).toBe(at + 7);
    expect(await debug({ op: "advanceGameTime", seconds: 60 })).toEqual({ tick: at + 7 + 600 + 1, simMs: (at + 7 + 600 + 1) * 100 });
    expect(updates.at(-1)!.simMs).toBe((at + 608) * 100);
    await debug({ op: "setTimeScale", scale: 20 }); await debug({ op: "setPaused", paused: false });
    const fast = clock().tick; await new Promise(resolve => setTimeout(resolve, 500));
    // Five ticks at scale 1. Anything well past that shows the scale took.
    expect(clock().tick - fast).toBeGreaterThan(25);
    await debug({ op: "setTimeScale", scale: 1 });
  }, 60_000);

  it("round-trips a save: the character, what it owns, and the world rows that name this world's entities", async () => {
    const { debug, seen, held } = await play();
    await debug({ op: "giveItem", itemId: "grithe_ore", quantity: 4, to: "inventory" });
    await debug({ op: "place", position: [3, 0, 2], regionId: "fallowmarch" });
    await debug({ op: "depleteNode", entityId: "multiplayer:ore" });
    const blob = serializeSave(await debug({ op: "getSave" }) as GameState);
    const parsed = JSON.parse(blob) as GameState;
    expect([parsed.meta.saveVersion, parsed.world.nodes["multiplayer:ore"]?.state, parsed.inventory.slots.reduce((sum, slot) => sum + (slot?.itemId === "grithe_ore" ? slot.quantity : 0), 0)]).toEqual([SAVE_VERSION, "depleted", 4]);

    await debug({ op: "reset" });
    expect([held("grithe_ore"), seen().player.position, seen().player.name]).toEqual([0, [0, 0, 0], "Adventurer"]);
    expect(await debug({ op: "getEntity", entityId: "multiplayer:ore" })).toMatchObject({ state: "available" });

    const loaded = loadSerializedSave(blob); expect(loaded.status).toBe("loaded");
    expect(await debug({ op: "loadSave", state: loaded.state! })).toEqual({ seedMatched: true });
    expect([held("grithe_ore"), seen().player.position]).toEqual([4, [3, 0, 2]]);
    await debug({ op: "advanceTicks", ticks: 1 });
    expect(await debug({ op: "getEntity", entityId: "multiplayer:ore" })).toMatchObject({ state: "depleted" });
    expect((await debug({ op: "getSave" }) as GameState).world.nodes["multiplayer:ore"]).toEqual(parsed.world.nodes["multiplayer:ore"]);

    // An old main-thread save from another seed still loads: the character arrives, its world does not.
    const old = createInitialState(99); old.currency = 250; old.world.nodes["somewhere:else"] = { remaining: 0, maxYields: 3, state: "depleted", respawnAtMs: 5 };
    expect(await debug({ op: "loadSave", state: loadSerializedSave(serializeSave(old)).state! })).toEqual({ seedMatched: false });
    expect([seen().currency, seen().meta.seed, seen().player.position]).toEqual([250, 1337, [0, 0, 0]]);
  }, 60_000);

  it("refuses malformed operations at the boundary and needs a joined session", async () => {
    const { debug, provider, session } = await play();
    await expect(debug({ op: "giveItem", itemId: "grithe_ore", quantity: -1, to: "inventory" })).rejects.toThrow(/quantity must be a positive integer/);
    await expect(debug({ op: "nonsense" } as never)).rejects.toThrow(/unknown op/);
    await expect(debug({ op: "reset", seed: 5 })).rejects.toThrow(/Reset cannot change it/);
    expect(() => debugOp({ op: "place", position: [0, Number.NaN, 0], regionId: "x" })).toThrow();
    await session.close();
    await expect(provider.debug({ op: "getWorldState" })).rejects.toThrow(/UNAVAILABLE/);
  }, 60_000);
});

describe("a sparse snapshot", () => {
  it("compares what is near a player every tick, and everything else at the next thorough snapshot, never losing a removal", async () => {
    const world: WorldDescriptor = { providerId: "local", worldId: "yard", name: "Yard", endpoint: "local:worker", protocolVersion: WORLD_PROTOCOL_VERSION,
      fixture: "lab", seed: 1337, population: 0, capacity: 1, availability: "available" };
    const runtime = new HeadlessWorld(world, await createMultiplayerLabWorld(), null);
    runtime.join("alice");
    const far = { id: "far:crate", archetype: "station" as const, name: "Crate", tier: 1, regionId: "fallowmarch" as const, position: [900, 0, 900] as [number, number, number], state: "available", interactions: ["inspect" as const] };
    runtime.entities.add(structuredClone(far));
    const baseline = runtime.snapshot({}, true); runtime.committed(baseline);
    expect(baseline.entities.length).toBe(runtime.entities.all().length);

    runtime.entities.get("far:crate")!.state = "used"; runtime.entities.get("multiplayer:ore")!.state = "depleted";
    const sparse = runtime.snapshot({}, true, false); runtime.committed(sparse);
    expect(sparse.entities.map(entity => entity.id)).toEqual(["multiplayer:ore"]);
    const thorough = runtime.snapshot({}, true, true); runtime.committed(thorough);
    expect(thorough.entities.map(entity => [entity.id, entity.state])).toEqual([["far:crate", "used"]]);

    runtime.entities.remove("far:crate");
    expect(runtime.snapshot({}, true, false).removedEntityIds).toEqual(["far:crate"]);
  });
});

describe("a socket peer", () => {
  it("has no debug channel: the host core refuses the frame before and after the join", async () => {
    const world: WorldDescriptor = { providerId: "socket", worldId: "yard", name: "Yard", endpoint: "ws://127.0.0.1:0/", protocolVersion: WORLD_PROTOCOL_VERSION,
      fixture: "lab", seed: 1337, population: 0, capacity: 4, availability: "available" };
    const host = await createWorldHost({ worlds: [world], storage: new MemoryWorldStorage(), build: () => createMultiplayerLabWorld(),
      authentication: { authenticate: async token => ({ playerId: token, name: token }) } });
    cleanups.push(() => host.close());
    const peer = () => { const sent: { type?: string; error?: { code: string } }[] = []; let open = true;
      const link: PeerLink = { get open() { return open; }, send(value) { sent.push(value as never); return open; }, close() { open = false; } };
      return { link, sent, connection: host.connect(link)!, isOpen: () => open }; };

    const stranger = peer();
    await stranger.connection.accept({ "@port": "debug", id: 1, op: { op: "giveItem", itemId: "grithe_ore", quantity: 1, to: "inventory" } });
    expect([stranger.isOpen(), stranger.sent.at(-1)?.error?.code]).toEqual([false, "UNAUTHORIZED"]);

    const joined = peer();
    await joined.connection.accept({ type: "join", providerId: world.providerId, worldId: world.worldId, token: "mallory", protocolVersion: world.protocolVersion });
    expect(joined.connection.joined).toBe(true);
    const before = structuredClone(host.worlds.values().next().value!.runtime.players.get("mallory")!.store.get().inventory);
    await joined.connection.accept({ "@port": "debug", id: 2, op: { op: "giveItem", itemId: "grithe_ore", quantity: 1, to: "inventory" } });
    expect([joined.isOpen(), joined.sent.at(-1)?.error?.code]).toEqual([false, "INVALID_MESSAGE"]);
    await joined.connection.accept({ type: "debug", id: 3, op: { op: "setCurrency", amount: 1_000_000 } });
    expect(host.worlds.values().next().value!.runtime.players.get("mallory")!.store.get().inventory).toEqual(before);
    expect(LOCAL_ACCOUNT_ID).toBe("local:player");
  }, 60_000);
});
