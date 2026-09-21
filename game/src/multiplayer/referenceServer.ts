import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { PlayerCharacter, Vec3, WorldDescriptor, WorldKey, WorldStorage } from "../contracts.js";
import { adminUnavailable, createAdminApi } from "./adminApi.js";
import { ACCOUNT_ID, banMessage, hashSecret, newSetupCode, setupCodeDigits, type AdminActor, type ServerAdminStorage } from "./adminStorage.js";
import { createAdminUi, type AdminUiSource } from "./adminUi.js";
import { applyPlayerOps, editDiff, EditFailure, PLACE_SNAP_METRES, type PlayerPatch } from "./playerEdits.js";
import { playerRevision } from "./playerRevision.js";
import { createDirectoryHeartbeat, DEFAULT_SERVER_NAME, effectiveSettings, settingsPatch, type ServerSettings } from "./serverSettings.js";
import { playerSessionState } from "../state/store.js";
import { createCatalogHost, seedCatalog, serveCatalog, type CatalogHost } from "./catalogHost.js";
import { MemoryCatalogStorage, type CatalogStorage } from "./catalogStorage.js";
import { createAssetHost, type AssetHostOptions } from "./assetManifest.js";
import { createContentPublisher } from "./contentPublish.js";
import { RESOLVED_CATALOG } from "../content/resolvedCatalog.js";
import type { HeadlessWorldPorts } from "./headlessWorld.js";
import { MAX_MESSAGE_BYTES, SessionFailure, worldKey } from "./protocol.js";
import { MAX_OUTBOUND_BYTES } from "./replication.js";
import { createWorldHost, type AuthenticatedPlayer, type AuthenticationAdapter, type HostedWorld as CoreHostedWorld, type PeerLink, type ServerEvent, type WorldHostMetrics } from "./worldHost.js";

/**
 * The reference server is the host core of `worldHost.ts` behind a WebSocket transport, plus what only
 * a network server has: HTTP routes, the catalog endpoint, administration, publishing, settings and
 * the directory heartbeat. Everything about worlds, peers, joins, commands and ticks is the core's.
 */
export type { AuthenticatedPlayer, AuthenticationAdapter, ServerEvent } from "./worldHost.js";
export type ReferenceServerMetrics = WorldHostMetrics;
export type HostedWorld = CoreHostedWorld<WebSocketLink>;
/** What an HTTP extension may read. Worlds and metrics are live objects, not copies. */
export interface ReferenceServerContext { worlds: ReadonlyMap<string, HostedWorld>; metrics: ReferenceServerMetrics; events: readonly ServerEvent[]; catalog: CatalogHost }
export interface ReferenceServerOptions {
  worlds: WorldDescriptor[];
  storage: WorldStorage;
  /**
   * Published catalogs. Its active revision must be the catalog this process was started on: a host
   * seeds the store, installs the active catalog, and only then imports this module. Without one the
   * server keeps the catalog compiled into the build in memory, which is what tests and harnesses want.
   */
  catalog?: CatalogStorage;
  /**
   * Where a publish checks asset ids: the manifest of the asset host the worlds point clients at, or
   * the manifest shipped with this server. With neither, asset ids are not checked.
   */
  assets?: AssetHostOptions;
  build(world: WorldDescriptor): Promise<HeadlessWorldPorts>;
  authentication: AuthenticationAdapter;
  /**
   * Roles, bans, admin sessions, API tokens and the audit log. Supplying it mounts `/admin/*`,
   * which needs account authentication; without it every admin path answers 501.
   */
  admin?: ServerAdminStorage;
  /** Makes this account owner with no setup code, and stops one being generated. */
  ownerAccount?: string;
  /** Defaults for the settings an admin may change while the server runs. World capacity defaults come from `worlds`. */
  settings?: Partial<Pick<ServerSettings, "name" | "description" | "registerWithDirectory">>;
  /** The identity service: where the admin UI signs in, and whose public directory this server may register with. */
  identityUrl?: string;
  /** The directory heartbeat's transport and cadence, for tests. */
  directory?: { fetch?: typeof fetch; intervalMs?: number };
  /** The devdocs server-mode build, served under `/admin/`. Null or absent answers with how to build it. */
  adminUi?: AdminUiSource | null;
  /** Runs after the ban check and before the player lease is claimed. Throw a SessionFailure to refuse the join. */
  beforeAdmission?(player: AuthenticatedPlayer, world: WorldDescriptor): Promise<void>;
  /** Routes beyond /healthz, /readyz, /worlds and /admin. Return true when the request was answered. */
  http?(request: IncomingMessage, response: ServerResponse, server: ReferenceServerContext): boolean | Promise<boolean>;
  port?: number;
  host?: string;
  allowedOrigins?: string[];
  /** Wall clock in milliseconds. Admin session expiry and ban expiry use it. */
  now?(): number;
  /** One JSON object per event. The owner setup code is printed through this, once. */
  log?(event: Record<string, unknown>): void;
}
/** What `PATCH /admin/players/<id>` did. `live` names the world whose player was edited. */
export interface PlayerEditOutcome { applied: "live" | "stored"; world: WorldKey | null; changed: boolean; warnings: string[] }

/** A peer silent for this long, pings included, is dead. Only a socket can go silent without closing. */
const PEER_SILENCE_MS = 30_000;
/**
 * One WebSocket as the core sees it. The socket's own limits live here: messages are JSON text, a
 * peer that cannot drain its outbound queue is dropped, and a peer that stopped answering pings is
 * no longer `open`.
 */
export class WebSocketLink implements PeerLink {
  lastSeen = Date.now();
  constructor(readonly ws: WebSocket, private readonly metrics: WorldHostMetrics, private readonly origin: string | undefined, private readonly allowedOrigins: readonly string[] | undefined) {}
  get silent(): boolean { return Date.now() - this.lastSeen > PEER_SILENCE_MS; }
  get open(): boolean { return this.ws.readyState === WebSocket.OPEN && !this.silent; }
  send(value: unknown): boolean {
    const ws = this.ws;
    if (ws.readyState !== WebSocket.OPEN) return false;
    const json = JSON.stringify(value); const size = Buffer.byteLength(json);
    if (size > MAX_OUTBOUND_BYTES || ws.bufferedAmount + size > MAX_OUTBOUND_BYTES) {
      this.metrics.backlogDisconnects++; ws.close(4008, "BACKLOG: outbound queue exceeded"); setTimeout(() => ws.terminate(), 1000).unref(); return false;
    }
    this.metrics.bytesOut += size; ws.send(json); return true;
  }
  close(code: number, reason: string): void { this.ws.close(code, reason); }
  admit(): void {
    if (this.origin && this.allowedOrigins && !this.allowedOrigins.includes(this.origin)) throw new SessionFailure("UNAUTHORIZED", "Origin is not allowed");
  }
}

/**
 * The catalog this process simulates is the one its content modules loaded, or the one a publish
 * moved it onto since (`contentSwap.ts` keeps `RESOLVED_CATALOG` in step), so the store can only
 * agree with it. A store whose active revision is another catalog means the host imported the server
 * before installing, and every table would disagree with what clients are told.
 */
async function runningCatalog(storage: CatalogStorage | undefined, now: () => number): Promise<CatalogHost> {
  const running = RESOLVED_CATALOG.revision;
  if (!storage) {
    storage = new MemoryCatalogStorage();
    // No sources: nothing can be published against a catalog that only exists in memory.
    await seedCatalog(storage, { catalog: RESOLVED_CATALOG, sources: {} }, () => {}, { now });
  }
  const active = await storage.activeRevision();
  if (active !== running) throw new Error(`This process runs catalog ${running} but the store's active catalog is ${active}. Install the active catalog before importing the server.`);
  const host = createCatalogHost(storage, running);
  // Compress in the background so the first join does not wait for it.
  void host.served(running).catch(() => {});
  return host;
}

export async function startReferenceServer(options: ReferenceServerOptions) {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((event: Record<string, unknown>) => console.log(JSON.stringify(event)));
  const catalog = await runningCatalog(options.catalog, now);
  // Administration is account work. A guest or module host keeps its storage and answers 501.
  const accounts = options.authentication.authentication === "account" ? options.admin : undefined;
  /** A banned account never reaches the lease claim, in any world of this server. */
  async function refuseBanned(playerId: string): Promise<void> {
    const ban = accounts && await accounts.banOf(playerId, now());
    if (ban) throw new SessionFailure("BANNED", banMessage(ban));
  }
  const host = await createWorldHost<WebSocketLink>({ worlds: options.worlds, storage: options.storage, build: options.build, authentication: options.authentication,
    catalogRevision: catalog.revision, now, log,
    async beforeAdmission(player, world) { await refuseBanned(player.playerId); await options.beforeAdmission?.(player, world); } });
  const { worlds, metrics, events } = host, recordEvent = host.record;
  const startedAt = now();
  const settingDefaults: ServerSettings = { name: options.settings?.name ?? DEFAULT_SERVER_NAME, description: options.settings?.description ?? null,
    registerWithDirectory: options.settings?.registerWithDirectory ?? false,
    capacity: Object.fromEntries([...worlds.values()].map(hosted => [hosted.runtime.descriptor.worldId, hosted.admission.capacity])) };
  let settings = accounts ? effectiveSettings(settingDefaults, await accounts.settings()) : settingDefaults;
  const directory = accounts && options.identityUrl ? createDirectoryHeartbeat({ identityUrl: options.identityUrl, log, settings: () => settings,
    endpoint: () => [...worlds.values()][0]!.runtime.descriptor.endpoint, ...options.directory }) : null;
  /** Bring the running worlds in line with `settings`. Players already in a world stay when its capacity drops. */
  function applySettings(): void {
    for (const { runtime, admission } of worlds.values()) {
      admission.capacity = runtime.descriptor.capacity = settings.capacity[runtime.descriptor.worldId] ?? admission.capacity;
      if (settings.description) runtime.descriptor.description = settings.description; else delete runtime.descriptor.description;
    }
  }
  applySettings();
  if (accounts && options.ownerAccount !== undefined) {
    if (!ACCOUNT_ID.test(options.ownerAccount)) throw new Error("ownerAccount must be an identity account id");
    await accounts.setSetupCodeHash(null);
    if ((await accounts.roleOf(options.ownerAccount))?.role !== "owner") {
      await accounts.setRole(options.ownerAccount, "owner", { accountId: options.ownerAccount, credential: "config", at: startedAt });
      log({ event: "admin.owner", accountId: options.ownerAccount, via: "config" });
    }
  } else if (accounts && !(await accounts.listRoles()).some(role => role.role === "owner")) {
    // No owner yet: a fresh code every start, printed once and stored only as its hash.
    const code = newSetupCode();
    await accounts.setSetupCodeHash(hashSecret(setupCodeDigits(code)!));
    log({ event: "owner-setup-code", code, message: "Sign in to devdocs and enter this code to become the owner of this server. It is shown once and is replaced on the next start." });
  }
  /** Every HTTP request is routed here and nowhere else. */
  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = request.url?.split("?")[0];
    if (request.method === "GET" && (path === "/healthz" || path === "/readyz")) {
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      response.writeHead(path === "/readyz" && host.closed ? 503 : 200);
      response.end(JSON.stringify({ ready: !host.closed })); return;
    }
    if (request.method === "GET" && path === "/worlds") {
      response.setHeader("Content-Type", "application/json"); response.setHeader("Access-Control-Allow-Origin", "*");
      // A capacity an admin lowered under the players already in is still a full world, not an invalid one.
      response.end(JSON.stringify([...worlds.values()].map(({ runtime, admission }) => ({ ...runtime.descriptor,
        population: Math.min(admission.population, admission.capacity), availability: host.closed ? "unavailable" : admission.population >= admission.capacity ? "full" : "available" })))); return;
    }
    if (await serveCatalog(request, response, catalog)) return;
    if (adminApi ? await adminApi(request, response) : adminUnavailable(request, response)) return;
    if (await options.http?.(request, response, { worlds, metrics, events, catalog })) return;
    response.writeHead(404).end();
  }
  const http = createServer((request, response) => {
    route(request, response).catch(() => { metrics.errors++; if (!response.headersSent) response.writeHead(500); response.end(); });
  });
  const sockets = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
  const keyOf = (hosted: HostedWorld): WorldKey => ({ providerId: hosted.runtime.descriptor.providerId, worldId: hosted.runtime.descriptor.worldId });
  const snapIn = (hosted: HostedWorld | null | undefined) => (position: Vec3): Vec3 | null => hosted?.runtime.ports.nav.nearestWalkable(position, PLACE_SNAP_METRES) ?? null;
  /**
   * Edit one player through the running server. Both paths run inside the publisher's hold, so no
   * tick and no commit is in flight while the edit is computed and applied.
   *
   * A held account is edited in memory, where its world would otherwise overwrite the database, and
   * the audit row rides the next tick commit, in the transaction that writes the edited character.
   * The answer waits for that commit. A crash before it loses the edit and the row together; a
   * fenced lease writes neither. An account nobody holds is edited in storage by compare and set
   * under the lease, with its row in the same transaction. A join that claimed the lease a moment
   * ago makes that refuse, and the edit is tried again against the world the player then is in.
   */
  async function editPlayer(accountId: string, patch: PlayerPatch, by: AdminActor): Promise<PlayerEditOutcome> {
    const storage = options.storage, stored = accounts!;
    for (let attempt = 0; ; attempt++) {
      let durable: Promise<void> | null = null;
      const outcome = await host.betweenTicks(async (): Promise<PlayerEditOutcome | "retry"> => {
        if (host.closed) throw new EditFailure(503, "unavailable", "The server is shutting down");
        const expected = (revision: string): void => {
          if (patch.expect !== null && patch.expect !== revision) throw new EditFailure(409, "revision_mismatch", `The player changed since revision ${patch.expect} was read. It is now ${revision}`);
        };
        const live = host.holder(accountId);
        if (live) {
          const { ownedWorld: _owned, ...before } = playerSessionState(live.runtime.players.get(accountId)!.store.get());
          expected(playerRevision(before));
          const result = applyPlayerOps(before, patch.ops, { world: keyOf(live), snap: snapIn(live) });
          const diff = editDiff(before, result.character);
          if (!diff) return { applied: "live", world: keyOf(live), changed: false, warnings: result.warnings };
          live.runtime.adoptCharacter(accountId, result.character, result.moved);
          durable = new Promise<void>((resolve, reject) => live.audits.push({ accountId, by,
            entry: { action: "player.edit", target: accountId, before: diff.before, after: { ...diff.after, applied: "live", world: live.runtime.descriptor.worldId } },
            settle: outcome => outcome === "saved" ? resolve() : reject(outcome === "fenced" ? new EditFailure(409, "player_busy", "This player's session ended before the edit was saved")
              : new EditFailure(503, "unavailable", "World storage failed before the edit was saved")) }));
          return { applied: "live", world: keyOf(live), changed: true, warnings: result.warnings };
        }
        const detail = await stored.player(accountId, now());
        if (!detail) throw new EditFailure(409, "not_found", "No such player on this server");
        if (!detail.character) throw new EditFailure(409, "no_character", "This player has joined but has never been saved, so there is nothing to edit yet");
        if (!storage.editStoredPlayer) throw new EditFailure(503, "unavailable", "This server's storage cannot edit a stored player");
        expected(playerRevision(detail.character));
        const last = detail.lastWorld && worlds.get(worldKey(detail.lastWorld));
        const result = applyPlayerOps(detail.character, patch.ops, { world: last ? detail.lastWorld : null, snap: snapIn(last) });
        const diff = editDiff(detail.character, result.character);
        if (!diff) return { applied: "stored", world: null, changed: false, warnings: result.warnings };
        const written = await storage.editStoredPlayer({ accountId, expected: detail.character, character: result.character, by,
          entry: { action: "player.edit", target: accountId, before: diff.before, after: { ...diff.after, applied: "stored" } } });
        if (written === "missing") throw new EditFailure(409, "not_found", "No such player on this server");
        if (written !== "written") return "retry";
        // A world that keeps this player for their campfire or cache holds a copy of the character. Nothing reads
        // it on a join, which takes the stored one, but a publish asks it who holds an item.
        for (const hosted of worlds.values()) if (!hosted.leases.has(accountId)) hosted.runtime.adoptCharacter(accountId, result.character, false);
        return { applied: "stored", world: null, changed: true, warnings: result.warnings };
      });
      if (outcome !== "retry") { await durable; return outcome; }
      if (attempt >= 20) throw new EditFailure(409, "player_busy", "This player is joining or leaving. Try again in a moment");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  async function patchSettings(body: Record<string, unknown>, by: AdminActor) {
    const changes = settingsPatch(body, [...worlds.values()].map(hosted => hosted.runtime.descriptor.worldId), directory !== null);
    const overrides = await accounts!.setSettings(changes, by);
    settings = effectiveSettings(settingDefaults, overrides); applySettings(); directory?.sync();
    return { settings, overrides, defaults: settingDefaults };
  }
  function serverInfo() {
    const first = [...worlds.values()][0]!.runtime.descriptor;
    return { name: settings.name, description: settings.description, endpoint: first.endpoint, assetBaseUrl: first.assetBaseUrl ?? null,
      identityUrl: options.identityUrl ?? null, authentication: first.authentication ?? "guest", catalogRevision: catalog.revision,
      host: options.host ?? "127.0.0.1", registerWithDirectory: settings.registerWithDirectory,
      worlds: [...worlds.values()].map(({ runtime, admission }) => ({ providerId: runtime.descriptor.providerId, worldId: runtime.descriptor.worldId,
        name: runtime.descriptor.name, seed: runtime.descriptor.seed, capacity: admission.capacity })) };
  }
  function liveCharacter(accountId: string): { world: WorldKey; character: PlayerCharacter } | null {
    for (const hosted of worlds.values()) {
      if (!hosted.leases.has(accountId)) continue;
      const player = hosted.runtime.players.get(accountId); if (!player) continue;
      const { ownedWorld, ...character } = playerSessionState(player.store.get());
      return { world: { providerId: hosted.runtime.descriptor.providerId, worldId: hosted.runtime.descriptor.worldId }, character };
    }
    return null;
  }
  const publisher = accounts ? createContentPublisher({
    catalog, admin: accounts, assets: createAssetHost({ ...options.assets, now }), now, log, betweenTicks: host.betweenTicks, failClosed: host.failClosed, broadcast: host.broadcast,
    worlds: () => [...worlds.values()].map(hosted => hosted.runtime),
  }) : null;
  const adminApi = accounts && publisher ? createAdminApi({
    admin: accounts, catalog, publisher, allowedOrigins: options.allowedOrigins ?? [], now, log,
    ui: createAdminUi({ source: options.adminUi ?? null, identityUrl: options.identityUrl, assetBaseUrl: [...worlds.values()][0]?.runtime.descriptor.assetBaseUrl }),
    authenticate: token => options.authentication.authenticate(token, [...worlds.values()][0]!.runtime.descriptor),
    server: {
      startedAt, metrics, events: () => events, record: recordEvent, liveCharacter, disconnect: host.disconnectAccount, connected: host.connected, editPlayer, info: serverInfo,
      settings: { get: async () => ({ settings, overrides: await accounts.settings(), defaults: settingDefaults }), patch: patchSettings },
      worlds: () => [...worlds.values()].map(({ runtime, admission }) => ({ key: { providerId: runtime.descriptor.providerId, worldId: runtime.descriptor.worldId },
        name: runtime.descriptor.name, playersOnline: admission.population, capacity: admission.capacity, tick: runtime.clock.tick })),
    },
  }) : null;
  sockets.on("connection", (ws, request) => {
    const link = new WebSocketLink(ws, metrics, request.headers.origin, options.allowedOrigins);
    const connection = host.connect(link); if (!connection) return;
    const authDeadline = setTimeout(() => ws.close(4001, "Authentication timeout"), 5000);
    ws.on("error", () => { metrics.errors++; });
    ws.on("pong", () => { link.lastSeen = Date.now(); });
    ws.on("message", async (bytes, binary) => {
      link.lastSeen = Date.now();
      let message: unknown;
      try {
        if (binary) throw new SessionFailure("INVALID_MESSAGE", "Text messages required");
        message = JSON.parse(bytes.toString());
      } catch (error) { connection.refuse(error); return; }
      await connection.accept(message);
      if (connection.joined) clearTimeout(authDeadline);
    });
    ws.on("close", () => { clearTimeout(authDeadline); connection.closed(); });
  });
  await new Promise<void>((resolve, reject) => { http.once("error", reject); http.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve); });
  const address = http.address(); if (!address || typeof address === "string") throw new Error("Server did not bind");
  for (const hosted of worlds.values()) if (new URL(hosted.runtime.descriptor.endpoint).port === "0") {
    hosted.runtime.descriptor.endpoint = `ws://127.0.0.1:${address.port}/`;
  }
  host.start();
  const heartbeat = setInterval(() => { for (const ws of sockets.clients) ws.ping(); }, 10_000);
  // A MessagePort peer has no ping and is never silent. A socket that stopped answering is dropped here, and the core saves its player.
  const silence = setInterval(() => { for (const hosted of worlds.values()) for (const peer of hosted.peers.values()) if (peer.link.silent) peer.link.ws.terminate(); }, 1000);
  directory?.sync();
  return { port: address.port, worlds, metrics, catalog, events, directory,
    /** The settings in force: configuration defaults under the overrides an admin stored. */
    get settings(): ServerSettings { return settings; },
    async close() {
      // Stops the loop at once, then waits for the tick in flight before the sockets go.
      const stopped = host.close(async () => {
        for (const ws of sockets.clients) ws.terminate();
        await new Promise<void>((resolve) => sockets.close(() => resolve()));
      });
      clearInterval(heartbeat); clearInterval(silence); directory?.close();
      await stopped;
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await options.storage.close();
    },
  };
}
