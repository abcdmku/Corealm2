import { afterEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { WebSocket } from "ws";
import { WORLD_PROTOCOL_VERSION, type WorldDescriptor } from "../game/src/contracts.js";
import { createSigningKey, joinTokenClaims, signJoinToken, type IdentityKey } from "../identity/src/joinToken.js";
import { compileCatalog } from "../game/src/content/compiler/catalog.js";
import { RESOLVED_CATALOG } from "../game/src/content/resolvedCatalog.js";
import { seedCatalog, type BaseCatalog } from "../game/src/multiplayer/catalogHost.js";
import { createIdentityAuthentication } from "../game/src/multiplayer/identityAuthentication.js";
import { MemoryWorldStorage } from "../game/src/multiplayer/memoryStorage.js";
import { startReferenceServer } from "../game/src/multiplayer/referenceServer.js";
import { readContentSources } from "../tools/content/compile.js";
import placementWorld from "./fixtures/placementWorld.js";
import { fixtureWorld, startThreadedServer } from "./helpers/threadedServer.js";

/**
 * The update from base goes through the publish path, so with a thread per world it runs behind the
 * same barrier and every world thread moves. The same test, with threads off and on.
 */
const OWNER = "acc_OOOOOOOOOOOOOOOOOOOOOO", ALICE = "acc_AAAAAAAAAAAAAAAAAAAAAA", BOB = "acc_BBBBBBBBBBBBBBBBBBBBBB";
const world = (worldId: string): WorldDescriptor => ({ providerId: "reference", worldId, name: worldId, endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 4, availability: "available" });
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

describe.each(["off", "on"] as const)("an update from base with threads %s", threads => {
  it("lands every world on the bundled base exactly and tells every client", async () => {
    const seeded = RESOLVED_CATALOG.revision, sources = Object.fromEntries(await readContentSources()) as Record<string, any>, next = structuredClone(sources);
    next.lootTables.find((row: any) => row.id === "shared_t0_frog").rolls[0].drops[0].chance = 0.25;
    const compiled = compileCatalog(next, { formulaRevision: RESOLVED_CATALOG.formulaRevision });
    if (!compiled.ok) throw new Error("the newer base does not compile");
    const bundledBase: BaseCatalog = { version: "0.2.0", catalog: compiled.catalog, sources: next };
    const created = createSigningKey();
    const keys: IdentityKey[] = [{ kid: created.signing.kid, alg: "EdDSA", publicKey: created.publicKey, status: "active" }];
    const common = { worlds: [world("north"), world("south")], bundledBase, ownerAccount: OWNER, log: () => {},
      assets: { bundledManifest: async () => JSON.parse(await readFile("game/public/assets/manifest.json", "utf8")) },
      authentication: await createIdentityAuthentication({ identityUrl: "https://identity.test/", fetch: (async () => new Response(JSON.stringify({ keys }))) as typeof fetch }) };
    let server: Awaited<ReturnType<typeof startReferenceServer>>;
    if (threads === "on") server = await startThreadedServer({ ...common, admin: true, sources, build: fixtureWorld("placementWorld.ts"), threads: { mode: "on" } });
    else {
      const storage = new MemoryWorldStorage();
      await seedCatalog(storage.catalog, { version: "0.1.0", catalog: RESOLVED_CATALOG, sources }, () => {});
      server = await startReferenceServer({ ...common, storage, admin: storage.admin, catalog: storage.catalog, build: placementWorld });
    }
    cleanups.push(() => server.close());
    const token = (accountId: string, name: string) => signJoinToken(created.signing, joinTokenClaims({ accountId, name, endpoint: `ws://127.0.0.1:${server.port}/`, issuedAt: Date.now() / 1000 }));
    let session = "";
    const call = async (path: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { method: body === undefined ? "GET" : "POST",
        headers: { ...(session ? { Authorization: `Bearer ${session}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() as any };
    };
    session = (await call("/admin/session", { token: token(OWNER, "Owner") })).body.session;
    const listed = async () => { await server.refresh(); return ((await call("/worlds")).body as WorldDescriptor[]).map(entry => [entry.worldId, entry.baseVersion, entry.catalogRevision]); };
    async function join(worldId: string, accountId: string) {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`), messages: any[] = [];
      cleanups.push(() => ws.terminate());
      ws.on("message", data => messages.push(JSON.parse(data.toString())));
      await new Promise<void>(resolve => ws.once("open", resolve));
      ws.send(JSON.stringify({ type: "join", providerId: "reference", worldId, token: token(accountId, accountId), protocolVersion: WORLD_PROTOCOL_VERSION }));
      await expect.poll(() => messages.find(message => message.type === "joined")?.world.baseVersion, { timeout: 10_000, interval: 10 }).toBe("0.1.0");
      return messages;
    }
    const peers = [await join("north", ALICE), await join("south", BOB)];
    expect(await listed()).toEqual([["north", "0.1.0", seeded], ["south", "0.1.0", seeded]]);

    const preview = await call("/admin/content/base/preview", {});
    expect([preview.status, preview.body.conflicts, preview.body.validation.ok]).toEqual([200, [], true]);
    const applied = await call("/admin/content/base/apply", { expect: preview.body.expect, decisions: [] });
    expect([applied.status, applied.body.revision, applied.body.notified]).toEqual([200, compiled.catalog.revision, 2]);
    for (const messages of peers) await expect.poll(() => messages.some(message => message.type === "content-updated" && message.revision === compiled.catalog.revision), { timeout: 5000, interval: 10 }).toBe(true);
    expect(await listed()).toEqual([["north", "0.2.0", compiled.catalog.revision], ["south", "0.2.0", compiled.catalog.revision]]);

    // And back, which also leaves this process on the catalog the next case seeds.
    const back = await call("/admin/content/rollback", { revision: seeded });
    expect([back.status, back.body.base]).toEqual([200, { version: "0.1.0", revision: seeded }]);
    expect(await listed()).toEqual([["north", "0.1.0", seeded], ["south", "0.1.0", seeded]]);
  }, 120_000);
});
