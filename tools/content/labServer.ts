/**
 * A real game server, on a flat pad, for the content sync proofs.
 *
 * `tests/content-server-sync.test.ts` and `tools/content/selftest-server-sync.ts` both need the same
 * thing: `startReferenceServer` with real admin storage, a real admin session, real `cat_…` API
 * tokens, and a publish path that behaves exactly as devdocs' does. One copy, so the self-test the
 * workflow runs cannot drift away from the test the suite runs.
 *
 * Everything it touches is temporary: its SQLite file is made in the OS temp directory and removed
 * on `close()`. It seeds from this checkout's compiled catalog, which is what a fresh server does.
 */
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { WORLD_PROTOCOL_VERSION, type SemanticEntity, type Vec3, type WorldDescriptor } from "../../game/src/contracts.js";
import { createSigningKey, joinTokenClaims, signJoinToken, type IdentityKey } from "../../identity/src/joinToken.js";
import { RESOLVED_CATALOG, RESOLVED_TABLES } from "../../game/src/content/resolvedCatalog.js";
import type { CompiledWorld } from "../../game/src/content/worldData.js";
import { Navigation } from "../../game/src/systems/navigation.js";
import { Solids } from "../../game/src/systems/solids.js";
import { seedCatalog } from "../../game/src/multiplayer/catalogHost.js";
import type { HeadlessWorldPorts } from "../../game/src/multiplayer/headlessWorld.js";
import { createIdentityAuthentication } from "../../game/src/multiplayer/identityAuthentication.js";
import { startReferenceServer } from "../../game/src/multiplayer/referenceServer.js";
import { planSpawns, type SpawnContext } from "../../game/src/multiplayer/spawnPlan.js";
import { SqliteWorldStorage } from "../../game/src/multiplayer/sqliteStorage.js";
import { readContentSources } from "./compile.js";

export const LAB_OWNER = "acc_OOOOOOOOOOOOOOOOOOOOOO";
/** The placement the flat pad is built under, and its loot table. */
export const LAB_GROUP = "redsill_frogs", LAB_TABLE = "shared_t0_frog";

export type Sources = Record<string, any>;
export interface AdminCall { status: number; body: any }

const descriptor: WorldDescriptor = { providerId: "reference", worldId: "north", name: "north", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, fixture: "authored", seed: 1337, population: 0, capacity: 4, availability: "available" };

/** One flat pad under one real placement, with its creatures built by the production spawn planner. */
async function placementWorld(): Promise<HeadlessWorldPorts> {
  await Navigation.initLibrary();
  const ground = new Mesh(new PlaneGeometry(320, 320), new MeshBasicMaterial());
  ground.rotation.x = -Math.PI / 2; ground.position.set(-50, 0, -52); ground.updateMatrixWorld(true);
  const nav = new Navigation();
  if (!nav.build([ground])) throw new Error("placement pad navigation failed");
  ground.geometry.dispose(); ground.material.dispose();
  const context: SpawnContext = { seed: 1337, floorAt: () => 0, baseY: () => 0, assetSize: () => null, refinePopulation: false,
    spacing: () => ({ underground: () => false, place: (_entity, x, z) => nav.nearestWalkable([x, 0, z], .3) ? [x, 0, z] : null }) };
  const first = planSpawns(context, RESOLVED_TABLES.world as CompiledWorld, new Set([LAB_GROUP]), []);
  return { nav, entities: first.spawns as SemanticEntity[], habitats: first.habitats, spawn: [-50, 0, -40] as Vec3,
    planSpawns: (table, groupIds, residents) => planSpawns(context, table, groupIds, residents),
    movement: { solids: new Solids([]), heightAt: () => 0, regionAt: () => "fallowmarch" },
    campfirePlacement: { groundAt: () => ({ y: 0, normal: [0, 1, 0] }), withinPlayableBounds: () => true, distanceToWater: () => Infinity, clearAt: () => true } };
}

export interface LabServerOptions {
  /** Loopback port. The content tooling's range is 4320 to 4329. */
  port?: number;
}

export interface LabServer {
  url: string;
  port: number;
  /** What the server calls itself at `GET /admin/info`, which is what a publish must confirm. */
  name: string;
  /** An owner admin session, the credential devdocs holds. */
  session: string;
  call(route: string, init?: { method?: string; token?: string; body?: unknown }): Promise<AdminCall>;
  /** A real `cat_…` API token with exactly these scopes. */
  mintToken(label: string, scopes: string[]): Promise<string>;
  /** A save exactly as devdocs makes one: read whole collections, send the changed ones with the revision they were read at. */
  publishAsDevdocs(change: (draft: Sources) => void, note?: string): Promise<any>;
  sources(): Promise<Sources>;
  activeRevision(): Promise<string | null>;
  close(): Promise<void>;
}

export async function startLabServer(options: LabServerOptions = {}): Promise<LabServer> {
  const file = path.join(tmpdir(), `corealm-lab-${randomUUID()}.sqlite`);
  const clock = { ms: Date.now() };
  const created = createSigningKey();
  const keys: IdentityKey[] = [{ kid: created.signing.kid, alg: "EdDSA", publicKey: created.publicKey, status: "active" }];
  const storage = new SqliteWorldStorage(file, { log: () => {} });
  await seedCatalog(storage.catalog, { catalog: RESOLVED_CATALOG, sources: Object.fromEntries(await readContentSources()) }, () => {}, { now: () => clock.ms });
  const server = await startReferenceServer({ worlds: [descriptor], storage, admin: storage.admin, catalog: storage.catalog, build: placementWorld,
    ownerAccount: LAB_OWNER, now: () => clock.ms, log: () => {}, ...(options.port === undefined ? {} : { port: options.port }),
    assets: { bundledManifest: async () => JSON.parse(await readFile("game/public/assets/manifest.json", "utf8")) },
    authentication: await createIdentityAuthentication({ identityUrl: "https://identity.test/", fetch: (async () => new Response(JSON.stringify({ keys }))) as typeof fetch, now: () => clock.ms }) });

  const call: LabServer["call"] = async (route, init = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.port}${route}`, { method: init.method ?? "GET",
      headers: { ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };
  const join = signJoinToken(created.signing, joinTokenClaims({ accountId: LAB_OWNER, name: "Owner", endpoint: `ws://127.0.0.1:${server.port}/`, issuedAt: clock.ms / 1000 }));
  const opened = await call("/admin/session", { method: "POST", body: { token: join } });
  if (opened.status !== 200) throw new Error(`the lab server refused an owner session: ${opened.status} ${JSON.stringify(opened.body)}`);
  const session = opened.body.session as string;
  const name = (await call("/admin/info")).body.name as string;

  return {
    url: `http://127.0.0.1:${server.port}/`, port: server.port, name, session, call,
    async mintToken(label, scopes) {
      const minted = await call("/admin/tokens", { method: "POST", token: session, body: { label, scopes } });
      if (minted.status >= 300 || typeof minted.body?.token !== "string") throw new Error(`could not mint a ${scopes.join("+")} token: ${minted.status}`);
      return minted.body.token as string;
    },
    async sources() { return (await call("/admin/content/sources", { token: session })).body.sources as Sources; },
    async activeRevision() { return storage.catalog.activeRevision(); },
    async publishAsDevdocs(change, note) {
      const active = (await call("/admin/content/sources", { token: session })).body as { revision: string; revisions: Record<string, string>; sources: Sources };
      const draft = structuredClone(active.sources);
      change(draft);
      const collections = Object.fromEntries(Object.keys(draft).filter(collection => JSON.stringify(draft[collection]) !== JSON.stringify(active.sources[collection]))
        .map(collection => [collection, { revision: active.revisions[collection]!, value: draft[collection] }]));
      const answer = await call("/admin/content/publish", { method: "POST", token: session, body: { base: active.revision, collections, ...(note ? { note } : {}) } });
      if (answer.status !== 200) throw new Error(`the lab server refused a publish: ${answer.status} ${JSON.stringify(answer.body)}`);
      return answer.body;
    },
    async close() {
      await server.close();
      for (const suffix of ["", "-wal", "-shm"]) await rm(file + suffix, { force: true });
    },
  };
}
