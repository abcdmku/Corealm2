import type { WorldFixture, WorldStorage } from "../contracts.js";
import { clientCatalog, type ClientCatalog } from "../content/clientCatalog.js";
import { RESOLVED_CATALOG } from "../content/resolvedCatalog.js";
import { createMultiplayerLabWorld } from "../multiplayer/labWorld.js";
import { MemoryWorldStorage } from "../multiplayer/memoryStorage.js";
import { serveMessagePort, type MessagePortLike } from "../multiplayer/messagePortLink.js";
import { createWorldHost, type WorldHost } from "../multiplayer/worldHost.js";
import { createPackedWorld, loadServerWorldPack } from "../multiplayer/worldPack.js";
import { DEFAULT_LOCAL_NAME, LOCAL_ACCOUNT_ID, localWorldDescriptor, packedSeed, type LegacyImport, type LegacyOutcome } from "./localHostProtocol.js";

/**
 * The local-play host: the same `createWorldHost` a server runs, over a world pack and a local
 * store, for one fixed account. The worker entry `import()`s this module only after it has installed
 * the catalog, because everything imported above reads content tables as it loads.
 */

/** Storage that keeps its writes in memory between flushes. `MemoryWorldStorage` has nothing to flush. */
export type LocalStorage = WorldStorage & { flush?(): Promise<void> };
export interface LocalHostOptions {
  fixture: WorldFixture;
  seed: number;
  /** The bytes of `server-world.pack`. Absent for the lab, which builds its own pad. */
  pack?: Uint8Array;
  legacy?: LegacyImport;
  /** Defaults to a store that keeps nothing. The worker passes the IndexedDB one. */
  storage?: LocalStorage;
  /** The caller steps the host by hand, as a test that owns time does. The tick loop is not started. */
  manual?: boolean;
}
export interface LocalHost {
  readonly host: WorldHost;
  readonly world: ReturnType<typeof localWorldDescriptor>;
  readonly seed: { requested: number; used: number };
  readonly legacy: LegacyOutcome;
  readonly timings: { importMs: number; worldMs: number };
  connect(port: MessagePortLike): void;
  clientCatalog(): ClientCatalog;
  flush(): Promise<void>;
  /** Drop the peer, save the character, flush and close the store. */
  close(): Promise<void>;
}

export async function startLocalHost(options: LocalHostOptions): Promise<LocalHost> {
  const storage: LocalStorage = options.storage ?? new MemoryWorldStorage();
  const pack = options.fixture === "authored" ? loadServerWorldPack(options.pack ?? new Uint8Array(0)) : null;
  const used = pack ? packedSeed(pack.seeds, options.seed) : options.seed;
  const world = localWorldDescriptor(options.fixture, used);
  const legacy = options.legacy;
  let name = legacy?.character.player.name || null;
  const worldStart = performance.now();
  const host = await createWorldHost({
    worlds: [world], storage, catalogRevision: RESOLVED_CATALOG.revision,
    build: target => pack ? createPackedWorld(pack, target.seed) : createMultiplayerLabWorld(target.seed),
    // Local play needs no login: whoever holds the port is the one local player.
    authentication: { authentication: "guest", authenticate: async () => ({ playerId: LOCAL_ACCOUNT_ID, name: name ?? DEFAULT_LOCAL_NAME }) },
  });
  const worldMs = performance.now() - worldStart, importStart = performance.now();
  const hosted = host.worlds.values().next().value!;
  let outcome: LegacyOutcome = "none";
  // The claim is how a store is asked what it holds for an account. It is given back before anyone joins.
  const sessionId = crypto.randomUUID();
  const claim = await storage.claimPlayer(world, LOCAL_ACCOUNT_ID, sessionId, name ?? DEFAULT_LOCAL_NAME);
  if (claim && legacy && !claim.character) {
    // Only an account this store has never saved takes the old save. It joins the way a player from another world does:
    // a save from a seed this pack does not hold keeps what it carries and starts at the safe spawn.
    const here = legacy.seed === used;
    // The old game called its one player "player". Here the character carries the account's id, as every hosted character does.
    const character = { ...legacy.character, player: { ...legacy.character.player, id: LOCAL_ACCOUNT_ID } };
    hosted.runtime.join(LOCAL_ACCOUNT_ID, { character, lastWorld: here ? world : null, world: here ? { ownedWorld: legacy.owned, receipts: [] } : null });
    hosted.runtime.leave(LOCAL_ACCOUNT_ID);
    const snapshot = hosted.runtime.snapshot(hosted.receipts, storage.entityPatches === true);
    snapshot.leases = Object.assign(Object.create(null), { [LOCAL_ACCOUNT_ID]: { sessionId, action: "release" as const } });
    await storage.commit(snapshot); hosted.runtime.committed(snapshot);
    outcome = "imported";
  } else {
    // A claim refused is a store that could not be asked, so the old save stays unmigrated and is offered again next start.
    if (legacy && claim) outcome = "existing";
    // The character keeps the name it was saved with.
    name ??= claim?.character?.player.name || null;
    if (claim) await storage.releasePlayer(world, LOCAL_ACCOUNT_ID, sessionId);
  }
  const importMs = performance.now() - importStart;
  if (!options.manual) host.start();
  return {
    host, world, seed: { requested: options.seed, used }, legacy: outcome, timings: { importMs, worldMs },
    connect(port) { serveMessagePort(port, host); },
    clientCatalog: () => clientCatalog(RESOLVED_CATALOG),
    flush: async () => { await storage.flush?.(); },
    async close() { await host.close(); await storage.flush?.(); await storage.close(); },
  };
}
