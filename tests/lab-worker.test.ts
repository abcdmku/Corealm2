import { afterEach, describe, expect, it } from "vitest";
import type { GameState } from "../game/src/state/store.js";
import type { SemanticEntity, WorldSession, WorldUpdate } from "../game/src/contracts.js";
import { labFixtureSpec } from "../game/src/featureLab/labSpec.js";
import { FEATURE_LAB_BOOT_PROFILE } from "../game/src/app/bootProfile.js";
import { WorkerWorldProvider, type LocalWorkerLike } from "../game/src/multiplayer/workerProvider.js";
import { Navigation } from "../game/src/systems/navigation.js";
import { labOp, labWorldData, type LabOp, type LabWorldData } from "../game/src/worker/labProtocol.js";
import type { DebugOp } from "../game/src/worker/localDebugProtocol.js";
import type { LocalHostReply, LocalHostRequest } from "../game/src/worker/localHostProtocol.js";
import { startLocalHost, type LocalHost } from "../game/src/worker/localHostRuntime.js";
import { RESOLVED_CATALOG } from "../game/src/content/resolvedCatalog.js";

/**
 * A lab session without a browser: the real provider and client session over a real MessageChannel
 * and the real host core over a lab world built from a spec and a world description, with a
 * stand-in for the Worker object only. The description here is what a page would send for a flat
 * yard: a baked navmesh, a height lattice, the bank and one ore face.
 */
class StandInLabWorker implements LocalWorkerLike {
  host: LocalHost | null = null;
  private start: Extract<LocalHostRequest, { type: "start" }> | null = null;
  private readonly listeners: ((event: { data: LocalHostReply }) => void)[] = [];
  private reply(data: LocalHostReply): void { for (const listener of this.listeners) listener({ data: structuredClone(data) }); }
  addEventListener(type: "message" | "error" | "messageerror", listener: (event: never) => void): void { if (type === "message") this.listeners.push(listener as never); }
  terminate(): void {}
  postMessage(message: LocalHostRequest): void {
    void (async () => {
      if (message.type === "start") this.start = message;
      else if (message.type === "lab-world") {
        // The worker entry waits for this message before it builds the world, and so does this.
        this.host = await startLocalHost({ fixture: "lab", seed: this.start!.seed, lab: { spec: this.start!.lab!, data: labWorldData(message.data) }, manual: true });
        this.reply({ type: "ready", world: this.host.world, catalogRevision: RESOLVED_CATALOG.revision, seed: this.host.seed, legacy: this.host.legacy, storage: "memory",
          timings: { manifestMs: 0, catalogMs: 0, packMs: 0, installMs: 0, storageMs: 0, importMs: 0, worldMs: 0, totalMs: 0 } });
      } else if (message.type === "connect") this.host!.connect(message.port as never);
      else if (message.type === "catalog") this.reply({ type: "catalog", id: message.id, catalog: this.host!.clientCatalog() });
      else if (message.type === "close") { await this.host!.close(); this.reply({ type: "closed", id: message.id }); }
    })();
  }
}

async function flatYard(): Promise<LabWorldData> {
  await Navigation.initLibrary();
  const nav = new Navigation();
  if (!nav.buildFromTriangles({ positions: new Float32Array([-48, 0, -48, 48, 0, -48, -48, 0, 48, 48, 0, 48]), indices: new Uint32Array([0, 2, 1, 2, 3, 1]) })) throw new Error("no navmesh");
  const baked = nav.exportNavData();
  const cols = 65, rows = 65;
  const bank = FEATURE_LAB_BOOT_PROFILE.buildSemanticWorld(1337, () => 0).entities;
  return {
    terrain: { bounds: { minX: -64, maxX: 64, minZ: -64, maxZ: 64 }, coast: null, regions: [{ regionId: "fallowmarch", rect: { minX: -64, maxX: 64, minZ: -64, maxZ: 64 } }],
      lattice: { heights: new Float32Array(cols * rows).fill(0.5), cols, rows, minX: -64, minZ: -64, stepX: 2, stepZ: 2 }, coastGrid: null, waterBodies: [], roads: [] },
    fairyTerrain: null, dungeon: null,
    nav: { navData: baked.navData.slice(), strategy: baked.strategy, sourceMeshes: baked.sourceMeshes, sourceTriangles: baked.sourceTriangles, polyCount: baked.polyCount },
    routeNodes: [], routeEdges: [], knownLocations: [], solids: [], surfaceBounds: [], doorBarriers: [], habitats: [], entities: bank, trees: [],
    spawn: { position: [0, 0.5, 0], regionId: "fallowmarch", facingRad: 0 }, assets: { chest_wood: { size: { x: 1, y: 1, z: 1 } } }, fixtureData: {},
  };
}

const frog: SemanticEntity = { id: "feature-lab:creature:1", archetype: "enemy", name: "Frog", tier: 1, regionId: "fallowmarch", position: [3, 0.5, 9], state: "alive",
  interactions: ["inspect", "attack"], combat: { health: 6, maxHealth: 6, level: 1, aggroRadius: 5, moveSpeedMps: 0.8, bodyRadius: 0.3 } as SemanticEntity["combat"],
  meta: { family: "frog", groupId: "redsill_frogs" }, view: { assetId: "frog" } };

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

type Observed = WorldSession & { state: { privateState: GameState | null; entities: Map<string, SemanticEntity> } };
async function lab(search = "?mode=combat") {
  const workers: StandInLabWorker[] = [];
  const spec = labFixtureSpec(search)!;
  const provider = new WorkerWorldProvider({ fixture: "lab", seed: spec.seed, assetBase: "http://127.0.0.1/", memory: true, lab: spec, spawn: () => { const worker = new StandInLabWorker(); workers.push(worker); return worker; } });
  provider.prestart();
  provider.provideLabWorld(await flatYard());
  const session = await provider.connect(provider.world, await provider.authenticate()) as Observed; cleanups.push(() => session.close());
  const updates: WorldUpdate[] = []; session.subscribe(update => updates.push(update));
  const seen = () => session.state.privateState!;
  const held = (itemId: string) => seen().inventory.slots.reduce((sum, slot) => sum + (slot?.itemId === itemId ? slot.quantity : 0), 0);
  const world = () => workers[0]!.host!.host.worlds.values().next().value!.runtime;
  return { provider, session, updates, seen, held, world, host: () => workers[0]!.host!.host, op: (op: LabOp | DebugOp) => provider.debug(op) };
}

describe("a lab session in the lab worker", () => {
  it("hosts the lab-<seed> world, built from the page's description", async () => {
    const { provider, session, world } = await lab();
    expect(provider.world.worldId).toBe("lab-1337");
    expect(provider.world.fixture).toBe("lab");
    expect(world().ports.interestRadius).toBe(400);
    // The spawn, and the ground under it, are the description's.
    expect(session.state.privateState!.player.position).toEqual([0, 0.5, 0]);
    expect(session.state.entities.get("feature-lab:bank")?.archetype).toBe("bank");
  });

  it("sets the lab character up, and the page sees it before the answer", async () => {
    const { op, seen, held, world } = await lab();
    const ticks = world().clock.tick;
    await op({ op: "lab.init" });
    expect(world().clock.tick).toBe(ticks);
    expect(seen().skills.melee.level).toBe(99);
    expect(seen().skills.agility.level).toBe(99);
    expect(seen().bank.slots).toEqual([{ itemId: "grithe_ore", quantity: 25 }, { itemId: "duskoak_log", quantity: 12 }, { itemId: "seared_trout", quantity: 5 }]);
    expect(held("air_essence")).toBe(100_000);
    expect(held("air_orb")).toBe(1);
    expect(held("grithe_ore")).toBe(8);
    expect(held("palewood_log")).toBe(6);
    expect(held("grithe_hatchet")).toBe(0);
  });

  it("hands the forest lab its hatchet and the presentation lab its tools", async () => {
    const forest = await lab("?mode=combat&forest=1");
    await forest.op({ op: "lab.init" });
    expect(forest.held("grithe_hatchet")).toBe(1);
    const presentation = await lab("?mode=combat&presentation=1");
    await presentation.op({ op: "lab.init" });
    expect(presentation.held("grithe_hatchet")).toBe(1);
    expect(presentation.held("grithe_pickaxe")).toBe(1);
  });

  it("sets a level, equips into a slot and clears it", async () => {
    const { op, seen, held } = await lab();
    await op({ op: "lab.init" });
    expect(await op({ op: "lab.setLevel", skill: "mining", level: 12 })).toBe(12);
    expect(seen().skills.mining.level).toBe(12);
    await op({ op: "lab.equip", slot: "mainHand", itemId: "worn_sword" });
    expect(seen().equipment.mainHand?.itemId).toBe("worn_sword");
    // Setup gear comes from nowhere and goes nowhere: nothing is left in the pack.
    expect(held("worn_sword")).toBe(0);
    await op({ op: "lab.equip", slot: "mainHand", itemId: null });
    expect(seen().equipment.mainHand).toBeNull();
    expect(held("worn_sword")).toBe(0);
  });

  it("spawns the target, replaces it, and reports its AI runtime, which is never replicated", async () => {
    const { op, session, host, world } = await lab();
    await op({ op: "lab.init" });
    await op({ op: "lab.spawnTarget", entity: frog, replaces: null });
    expect(session.state.entities.get(frog.id)?.name).toBe("Frog");
    expect(await op({ op: "lab.view", targetId: frog.id })).toEqual({ targetAi: null });
    await host().step();
    const view = await op({ op: "lab.view", targetId: frog.id }) as { targetAi: { state: string; spawnPosition: number[]; distanceFromPlayer: number; respawnInMs: number | null } };
    expect(view.targetAi.state).toBe("idle");
    expect(view.targetAi.spawnPosition).toEqual([3, 0.5, 9]);
    expect(view.targetAi.distanceFromPlayer).toBe(9.49);
    expect(view.targetAi.respawnInMs).toBeNull();
    // The page needs no round trip for it: the runtime rides on the entity, in the update of the tick that produced it.
    expect(session.state.entities.get(frog.id)?.meta?.labAi).toBe("{\"state\":\"idle\",\"spawnPos\":[3,0.5,9],\"respawnAtMs\":null}");
    await op({ op: "lab.spawnTarget", entity: { ...frog, id: "feature-lab:creature:2" }, replaces: frog.id });
    expect(session.state.entities.has(frog.id)).toBe(false);
    expect(session.state.entities.has("feature-lab:creature:2")).toBe(true);
    expect(Object.keys(world().shared.enemies)).toEqual([]);
  });

  it("takes a new navmesh, collision and entities while it runs", async () => {
    const { op, session, world } = await lab();
    const yard = await flatYard();
    const altar: SemanticEntity = { id: "lab:altar", archetype: "station", name: "Altar", tier: 1, regionId: "fallowmarch", position: [4, 0.5, 4], state: "dormant",
      interactions: ["inspect", "awaken"], meta: { essenceAltar: true, essenceElement: "wind" }, view: { assetId: "chest_wood" } };
    await op({ op: "lab.world", patch: { nav: yard.nav, solids: [{ id: "lab:wall", kind: "box", position: [10, 0, 0], size: [2, 3, 2], rotationY: 0 }], surfaceBounds: [], addEntities: [altar] } });
    expect(session.state.entities.get("lab:altar")?.state).toBe("dormant");
    // Collision is the patch's: a step into the wall is pushed out of it.
    const resolved = world().ports.movement.solids!.resolve([10, 0.5, 0], [8, 0.5, 0], 0.35);
    expect(Math.abs(resolved[0] - 10) >= 1).toBe(true);
    await op({ op: "lab.world", patch: { removeEntities: ["lab:altar"] } });
    expect(session.state.entities.has("lab:altar")).toBe(false);
    // The lab scene survives a reset: the altar stays gone and the bank stays.
    await op({ op: "reset" });
    expect(session.state.entities.has("feature-lab:bank")).toBe(true);
    expect(session.state.entities.has("lab:altar")).toBe(false);
  });

  it("skips time in one call: every tick runs, and the page gets few updates", async () => {
    const { op, updates, world } = await lab();
    const tick = world().clock.tick, before = updates.length;
    expect(await op({ op: "lab.skipTicks", ticks: 120 })).toEqual({ tick: tick + 120, simMs: (tick + 120) * 100 });
    // Ticks 50, 100 and 120 are whole. The rest simulate and send nothing.
    expect(updates.length - before).toBe(3);
    const stepped = updates.length;
    await op({ op: "advanceTicks", ticks: 40 });
    expect(world().clock.tick).toBe(tick + 160);
    expect(updates.length - stepped).toBe(1);
  });

  it("refuses a fixture the session did not ask for, and an operation with a bad shape", async () => {
    const { op } = await lab();
    await expect(op({ op: "lab.call", fixture: "creatureLoot", method: "getState", args: [] })).rejects.toThrow("This lab session did not ask for the creatureLoot fixture");
    await expect(op({ op: "lab.setLevel", skill: "juggling", level: 3 } as never)).rejects.toThrow("Invalid lab operation: skill must be one of");
    await expect(op({ op: "lab.nothing" } as never)).rejects.toThrow("Invalid lab operation: unknown op \"lab.nothing\"");
  });

  it("hosts a fixture's methods behind lab.call", async () => {
    const { op, session } = await lab("?mode=combat&creatureLoot=1");
    await op({ op: "lab.init" });
    await op({ op: "lab.call", fixture: "creatureLoot", method: "prepare", args: [] });
    expect(session.state.entities.get("feature-lab:creature-loot:crafting-table")?.archetype).toBe("station");
    await expect(op({ op: "lab.call", fixture: "creatureLoot", method: "constructor", args: [] })).rejects.toThrow("has no method constructor");
  });
});

describe("the lab protocol at the worker boundary", () => {
  it("refuses operations and world data that are not shaped right", async () => {
    expect(() => labOp({ op: "lab.skipTicks", ticks: 0 })).toThrow("ticks must be an integer from 1 to 36000");
    expect(() => labOp({ op: "lab.equip", slot: "tail", itemId: null })).toThrow("slot must be one of");
    expect(() => labOp({ op: "lab.call", fixture: "agility", method: "__proto__", args: [] })).toThrow("method must be a method name");
    expect(() => labOp({ op: "lab.spawnTarget", entity: { id: "x" }, replaces: null })).toThrow("entity must be a semantic entity");
    expect(labOp({ op: "lab.setLevel", skill: "melee", level: 140.7 })).toEqual({ op: "lab.setLevel", skill: "melee", level: 99 });
    const yard = await flatYard();
    expect(labWorldData(yard)).toBe(yard);
    expect(() => labWorldData({ ...yard, nav: { ...yard.nav, navData: [1, 2, 3] } })).toThrow("nav must be {navData: Uint8Array");
    expect(() => labWorldData({ ...yard, terrain: { ...yard.terrain, lattice: { ...yard.terrain.lattice, cols: 3 } } })).toThrow("terrain must be terrain sampler data");
    expect(() => labWorldData({ ...yard, solids: [{ id: "s", kind: "sphere", position: [0, 0, 0] }] })).toThrow("solids must be box or cylinder volumes");
  });
});
