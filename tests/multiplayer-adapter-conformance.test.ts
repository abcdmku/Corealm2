import { afterEach, describe, expect, it } from "vitest";
import { WORLD_CONTENT_VERSION, WORLD_PROTOCOL_VERSION, type WorldDescriptor, type WorldProvider, type WorldSession, type WorldUpdate } from "../game/src/contracts.js";
import { HeadlessWorld } from "../game/src/multiplayer/headlessWorld.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { WebSocketProvider } from "../game/src/multiplayer/webSocketProvider.js";
import { SqliteWorldStorage } from "../game/src/multiplayer/sqliteStorage.js";
import { Admission } from "../game/src/multiplayer/admission.js";
import { command, compatible, SessionFailure } from "../game/src/multiplayer/protocol.js";
import { Replicator } from "../game/src/multiplayer/replication.js";

const descriptor: WorldDescriptor = { providerId: "conformance", worldId: "yard", name: "Conformance yard",
  endpoint: "ws://127.0.0.1:0/", protocolVersion: WORLD_PROTOCOL_VERSION, contentVersion: WORLD_CONTENT_VERSION,
  seed: 1337, capacity: 2, population: 0, availability: "available" };

/** Separate transport adapter: deterministic steps, production rules, no sockets or wall clock. */
async function deterministicProvider(): Promise<WorldProvider> {
  const world = new HeadlessWorld(descriptor, await createMultiplayerLabWorld());
  const admission = new Admission(2); let serial = 0;
  return {
    id: descriptor.providerId,
    discover: async () => [structuredClone(descriptor)],
    authenticate: async () => ({ token: "alice" }),
    async connect(input, credentials, signal) {
      compatible(input);
      if (signal?.aborted) throw new SessionFailure("SESSION_EXPIRED", "Cancelled");
      const id = `deterministic-${++serial}`; const playerId = credentials.token;
      admission.join(playerId, id); world.join(playerId);
      const replicator = new Replicator(id, playerId); let sequence = 0; let closed = false;
      const listeners = new Set<(update: WorldUpdate) => void>();
      return { id, playerId, world: descriptor,
        async command(value) {
          if (closed) throw new SessionFailure("SESSION_EXPIRED", "Closed");
          const result = world.execute(playerId, command(value)); world.tick();
          const update = replicator.update(world, ++sequence, new Map());
          for (const listener of listeners) listener(update);
          return result.ok ? { status: "accepted", sequence, tick: world.clock.tick, result: result.value }
            : { status: "rejected", sequence, tick: world.clock.tick, error: result.error };
        },
        subscribe(listener) { listeners.add(listener); listener(replicator.update(world, sequence, new Map(), true)); return () => { listeners.delete(listener); }; },
        async close() { if (closed) return; closed = true; listeners.clear(); world.leave(playerId); admission.leave(playerId, id, false); },
      };
    },
  };
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

for (const kind of ["deterministic", "websocket"] as const) describe(`${kind} provider conformance`, () => {
  it("replays an owning snapshot, awaits rules, validates input, enforces admission, and releases sessions", async () => {
    let provider: WorldProvider;
    if (kind === "deterministic") provider = await deterministicProvider();
    else {
      const server = await startReferenceServer({ worlds: [descriptor], storage: new SqliteWorldStorage(":memory:"),
        build: () => createMultiplayerLabWorld(), authentication: { authenticate: async (token) => ({ playerId: token, name: token }) } });
      cleanups.push(() => server.close());
      provider = new WebSocketProvider(descriptor.providerId, [{ ...descriptor, endpoint: `ws://127.0.0.1:${server.port}/` }], async () => ({ token: "alice" }));
    }
    const [world] = await provider.discover(); expect(world).toBeDefined();
    const session = await provider.connect(world!, await provider.authenticate(world!)); cleanups.push(() => session.close());
    let initial: WorldUpdate | undefined; session.subscribe((update) => { initial ??= update; });
    expect(initial?.snapshot).toBe(true); expect(initial?.privateState?.player.id).toBe("alice");
    const result = await session.command({ method: "steer", args: [1, 0] }); expect(result.status).toBe("accepted");
    await expect(session.command({ method: "grantGold", args: [99] } as never)).rejects.toBeDefined();
    await expect(provider.connect(world!, { token: "alice" })).rejects.toMatchObject({ code: "DUPLICATE_LOGIN" });
    const other: WorldSession = await provider.connect(world!, { token: "bob" }); cleanups.push(() => other.close());
    await expect(provider.connect(world!, { token: "third" })).rejects.toMatchObject({ code: "FULL" });
    await session.close(); await expect(session.command({ method: "stop", args: [] })).rejects.toBeDefined();
    const replacement = await provider.connect(world!, { token: "third" }); cleanups.push(() => replacement.close());
    await expect(provider.connect({ ...world!, protocolVersion: 999 }, { token: "fourth" })).rejects.toMatchObject({ code: "INCOMPATIBLE" });
  });
});
