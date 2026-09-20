import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { WORLD_PROTOCOL_VERSION, type CommandEnvelope, type CommandOutcome, type PlayerCharacter, type PlayerLeaseWrite, type SessionErrorCode, type Vec3, type WorldDescriptor, type WorldKey, type WorldStorage, type WorldStorageRecord } from "../contracts.js";
import { adminUnavailable, createAdminApi } from "./adminApi.js";
import { ACCOUNT_ID, banMessage, hashSecret, newSetupCode, setupCodeDigits, type AdminActor, type AuditWrite, type ServerAdminStorage } from "./adminStorage.js";
import { createAdminUi, type AdminUiSource } from "./adminUi.js";
import { applyPlayerOps, editDiff, EditFailure, PLACE_SNAP_METRES, playerRevision, type PlayerPatch } from "./playerEdits.js";
import { createDirectoryHeartbeat, DEFAULT_SERVER_NAME, effectiveSettings, settingsPatch, type ServerSettings } from "./serverSettings.js";
import { playerSessionState } from "../state/store.js";
import { Admission } from "./admission.js";
import { createCatalogHost, seedCatalog, serveCatalog, type CatalogHost } from "./catalogHost.js";
import { MemoryCatalogStorage, type CatalogStorage } from "./catalogStorage.js";
import { createAssetHost, type AssetHostOptions } from "./assetManifest.js";
import { createContentPublisher } from "./contentPublish.js";
import { RESOLVED_CATALOG } from "../content/resolvedCatalog.js";
import { HeadlessWorld, type HeadlessWorldPorts } from "./headlessWorld.js";
import { compatible, descriptor, envelope, MAX_MESSAGE_BYTES, MAX_PENDING_COMMANDS, RECEIPT_LIMIT, record, SessionFailure, worldKey } from "./protocol.js";
import { MAX_OUTBOUND_BYTES, Replicator, ReplicationFrame } from "./replication.js";

export interface AuthenticatedPlayer { playerId: string; name: string }
export interface AuthenticationAdapter {
  /** What descriptors tell clients to present. Absent means the adapter takes an opaque token, advertised as "guest". */
  readonly authentication?: "account" | "guest";
  authenticate(token: string, world: WorldDescriptor): Promise<AuthenticatedPlayer>;
}
/** What an HTTP extension may read. Worlds and metrics are live objects, not copies. */
export interface ReferenceServerContext { worlds: ReadonlyMap<string, HostedWorld>; metrics: ReferenceServerMetrics; events: readonly ServerEvent[]; catalog: CatalogHost }
/** One entry of the bounded ring `GET /admin/stats` returns and M6's TUI draws. */
export interface ServerEvent { at: number; kind: "join" | "leave" | "rejected" | "ban" | "unban" | "kick" | "admin-session" | "owner-setup"; accountId: string | null; detail: string | null }
const EVENT_RING = 256;
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
interface Peer {
  ws: WebSocket; playerId: string; sessionId: string; replicator: Replicator;
  sequence: number; committed: number; queue: CommandEnvelope[]; receipts: Map<number, { json: string; outcome: CommandOutcome }>;
  rateStart: number; rateCount: number; lastSeen: number; explicitLeave: boolean;
}
export interface HostedWorld {
  runtime: HeadlessWorld; admission: Admission; peers: Map<string, Peer>; receipts: WorldStorageRecord["receipts"]; publicGameplay: Map<string,string>;
  /** Accounts whose character this world writes, and what the next commit does with each lease. */
  leases: Map<string, PlayerLeaseWrite>;
  /** Admin edits applied to live players since the last commit. The next commit writes each row with the character it describes. */
  audits: PendingAudit[];
}
interface PendingAudit { accountId: string; by: AdminActor; entry: AuditWrite; resolve(): void; reject(error: Error): void }
/** What `PATCH /admin/players/<id>` did. `live` names the world whose player was edited. */
export interface PlayerEditOutcome { applied: "live" | "stored"; world: WorldKey | null; changed: boolean; warnings: string[] }
export interface ReferenceServerMetrics {
  ticks: number[]; stages: { simulationMs: number; snapshotMs: number; commitMs: number; replicationMs: number; samples: number };
  commands: number; rejected: number; bytesOut: number; backlogDisconnects: number; errors: number;
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
  const worlds = new Map<string, HostedWorld>();
  for (const input of options.worlds) {
    const world = descriptor({ ...input, catalogRevision: catalog.revision, authentication: input.authentication ?? options.authentication.authentication ?? "guest" }); compatible(world);
    if (worlds.has(worldKey(world))) throw new Error("Duplicate hosted world");
    const saved = await options.storage.openWorld(world);
    worlds.set(worldKey(world), { runtime: new HeadlessWorld(world, await options.build(world), saved), admission: new Admission(world.capacity), peers: new Map(),
      receipts: Object.assign(Object.create(null), saved?.receipts ?? {}), publicGameplay: new Map(), leases: new Map(), audits: [] });
  }
  // Establish the complete entity baseline before accepting clients. Subsequent ticks only
  // clone and persist changed rows. Failure here never advertises a ready world.
  if (options.storage.entityPatches) for (const hosted of worlds.values()) {
    const initial = hosted.runtime.snapshot(hosted.receipts, true);
    await options.storage.commit(initial);
    hosted.runtime.committed(initial);
  }
  const metrics: ReferenceServerMetrics = { ticks: [], stages: { simulationMs: 0, snapshotMs: 0, commitMs: 0, replicationMs: 0, samples: 0 }, commands: 0, rejected: 0, bytesOut: 0, backlogDisconnects: 0, errors: 0 };
  const startedAt = now();
  // Administration is account work. A guest or module host keeps its storage and answers 501.
  const accounts = options.authentication.authentication === "account" ? options.admin : undefined;
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
  const events: ServerEvent[] = [];
  const recordEvent = (event: Omit<ServerEvent, "at">): void => { events.push({ at: now(), ...event }); if (events.length > EVENT_RING) events.shift(); };
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
      response.writeHead(path === "/readyz" && closed ? 503 : 200);
      response.end(JSON.stringify({ ready: !closed })); return;
    }
    if (request.method === "GET" && path === "/worlds") {
      response.setHeader("Content-Type", "application/json"); response.setHeader("Access-Control-Allow-Origin", "*");
      // A capacity an admin lowered under the players already in is still a full world, not an invalid one.
      response.end(JSON.stringify([...worlds.values()].map(({ runtime, admission }) => ({ ...runtime.descriptor,
        population: Math.min(admission.population, admission.capacity), availability: closed ? "unavailable" : admission.population >= admission.capacity ? "full" : "available" })))); return;
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
  let closed = false; let failed = false; let ticking = false; let inFlight: Promise<void> = Promise.resolve();
  // A closed connection saves and frees its account on the next commit. A join by that account waits for it here.
  const releasing = new Map<string, { done: Promise<void>; resolve(): void }>();
  function released(playerId: string): void { releasing.get(playerId)?.resolve(); releasing.delete(playerId); }
  /** Remove a session whose lease this world no longer holds. Its character is never written again. */
  function evict(hosted: HostedWorld, playerId: string, sessionId: string): void {
    if (hosted.leases.get(playerId)?.sessionId !== sessionId) return;
    hosted.leases.delete(playerId); hosted.runtime.leave(playerId); hosted.admission.leave(playerId, sessionId, false); released(playerId);
    const stale = hosted.peers.get(sessionId); if (!stale) return;
    send(stale.ws, { type: "error", error: { code: "SESSION_EXPIRED", message: "This player joined from another connection" } }); stale.ws.close(4000, "SESSION_EXPIRED");
  }
  function send(ws: WebSocket, value: unknown): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    const json = JSON.stringify(value); const size = Buffer.byteLength(json);
    if (size > MAX_OUTBOUND_BYTES || ws.bufferedAmount + size > MAX_OUTBOUND_BYTES) {
      metrics.backlogDisconnects++; ws.close(4008, "BACKLOG: outbound queue exceeded"); setTimeout(() => ws.terminate(), 1000).unref(); return false;
    }
    metrics.bytesOut += size; ws.send(json); return true;
  }
  /** Refuse a live session from every world, through the ordinary leave path: save, then release. */
  function disconnectAccount(accountId: string, code: SessionErrorCode, message: string): boolean {
    let found = false;
    for (const hosted of worlds.values()) for (const peer of [...hosted.peers.values()]) {
      if (peer.playerId !== accountId) continue;
      peer.explicitLeave = true; found = true;
      send(peer.ws, { type: "error", error: { code, message } }); peer.ws.close(4000, code);
    }
    return found;
  }
  /** The world that writes this account's character: connected, or disconnected and not yet saved. */
  function holder(accountId: string): HostedWorld | null {
    for (const hosted of worlds.values()) if (hosted.leases.has(accountId) && hosted.runtime.players.has(accountId)) return hosted;
    return null;
  }
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
      const outcome = await betweenTicks(async (): Promise<PlayerEditOutcome | "retry"> => {
        if (closed) throw new EditFailure(503, "unavailable", "The server is shutting down");
        const expected = (revision: string): void => {
          if (patch.expect !== null && patch.expect !== revision) throw new EditFailure(409, "revision_mismatch", `The player changed since revision ${patch.expect} was read. It is now ${revision}`);
        };
        const live = holder(accountId);
        if (live) {
          const { ownedWorld: _owned, ...before } = playerSessionState(live.runtime.players.get(accountId)!.store.get());
          expected(playerRevision(before));
          const result = applyPlayerOps(before, patch.ops, { world: keyOf(live), snap: snapIn(live) });
          const diff = editDiff(before, result.character);
          if (!diff) return { applied: "live", world: keyOf(live), changed: false, warnings: result.warnings };
          live.runtime.adoptCharacter(accountId, result.character, result.moved);
          durable = new Promise<void>((resolve, reject) => live.audits.push({ accountId, by, resolve, reject,
            entry: { action: "player.edit", target: accountId, before: diff.before, after: { ...diff.after, applied: "live", world: live.runtime.descriptor.worldId } } }));
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
  /** Hand the audit rows of live edits to a commit, and tell each edit what became of it. */
  function auditsOf(hosted: HostedWorld): { rows: PendingAudit[]; settle(fenced: readonly string[] | null): void } {
    const rows = hosted.audits.splice(0);
    return { rows, settle(fenced) {
      for (const row of rows) {
        if (fenced && !fenced.includes(row.accountId)) row.resolve();
        else row.reject(new EditFailure(fenced ? 409 : 503, fenced ? "player_busy" : "unavailable", fenced ? "This player's session ended before the edit was saved" : "World storage failed before the edit was saved"));
      }
    } };
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
  /** A banned account never reaches the lease claim, in any world of this server. */
  async function refuseBanned(playerId: string): Promise<void> {
    const ban = accounts && await accounts.banOf(playerId, now());
    if (ban) throw new SessionFailure("BANNED", banMessage(ban));
  }
  /** No further acknowledgements or snapshots. A failed commit and a failed catalog swap both end here. */
  function failClosed(): void {
    closed = true; failed = true;
    for (const hosted of worlds.values()) auditsOf(hosted).settle(null);
    for (const waiting of [...releasing.keys()]) released(waiting);
    for (const client of sockets.clients) { send(client, { type: "error", error: { code: "UNAVAILABLE", message: "World storage or simulation failed" } }); client.close(1011, "World unavailable"); }
  }
  /** A publish swaps content between ticks: the tick in flight finishes, and the next one waits for `run` to settle. */
  let hold: Promise<void> | null = null; let running: Promise<void> = Promise.resolve();
  async function betweenTicks<T>(run: () => Promise<T>): Promise<T> {
    while (hold) await hold;
    let release!: () => void; hold = new Promise<void>(settle => { release = settle; });
    // `running` is the last tick that actually started. `inFlight` may be a tick that is itself waiting on this hold.
    try { await running; return await run(); } finally { hold = null; release(); }
  }
  const publisher = accounts ? createContentPublisher({
    catalog, admin: accounts, assets: createAssetHost({ ...options.assets, now }), now, log, betweenTicks, failClosed,
    worlds: () => [...worlds.values()].map(hosted => hosted.runtime),
    broadcast(message) {
      let told = 0;
      for (const hosted of worlds.values()) for (const peer of hosted.peers.values()) if (send(peer.ws, message)) told++;
      return told;
    },
  }) : null;
  const adminApi = accounts && publisher ? createAdminApi({
    admin: accounts, catalog, publisher, allowedOrigins: options.allowedOrigins ?? [], now, log,
    ui: createAdminUi({ source: options.adminUi ?? null, identityUrl: options.identityUrl, assetBaseUrl: [...worlds.values()][0]?.runtime.descriptor.assetBaseUrl }),
    authenticate: token => options.authentication.authenticate(token, [...worlds.values()][0]!.runtime.descriptor),
    server: {
      startedAt, metrics, events: () => events, record: recordEvent, liveCharacter, disconnect: disconnectAccount, editPlayer, info: serverInfo,
      connected: accountId => [...worlds.values()].some(hosted => [...hosted.peers.values()].some(peer => peer.playerId === accountId)),
      settings: { get: async () => ({ settings, overrides: await accounts.settings(), defaults: settingDefaults }), patch: patchSettings },
      worlds: () => [...worlds.values()].map(({ runtime, admission }) => ({ key: { providerId: runtime.descriptor.providerId, worldId: runtime.descriptor.worldId },
        name: runtime.descriptor.name, playersOnline: admission.population, capacity: admission.capacity, tick: runtime.clock.tick })),
    },
  }) : null;
  sockets.on("connection", (ws, request) => {
    if (closed) {
      send(ws, { type: "error", error: { code: "UNAVAILABLE", message: "World unavailable" } });
      ws.close(1011, "World unavailable"); return;
    }
    let peer: Peer | null = null; let hosted: HostedWorld | null = null; let authenticating = false;
    const authDeadline = setTimeout(() => ws.close(4001, "Authentication timeout"), 5000);
    ws.on("error", () => { metrics.errors++; });
    ws.on("pong", () => { if (peer) peer.lastSeen = Date.now(); });
    ws.on("message", async (bytes, binary) => {
      try {
        if (binary) throw new SessionFailure("INVALID_MESSAGE", "Text messages required");
        const message: unknown = JSON.parse(bytes.toString());
        if (!record(message)) throw new SessionFailure("INVALID_MESSAGE", "Invalid message");
        if (!peer) {
          if (authenticating) throw new SessionFailure("RATE_LIMITED", "Authentication already in progress");
          authenticating = true;
          if (message.type !== "join" || typeof message.providerId !== "string" || typeof message.worldId !== "string"
            || typeof message.token !== "string" || message.token.length > 4096) throw new SessionFailure("UNAUTHORIZED", "Authentication required");
          if (message.protocolVersion !== WORLD_PROTOCOL_VERSION) throw new SessionFailure("INCOMPATIBLE", "Incompatible game version");
          if (request.headers.origin && options.allowedOrigins && !options.allowedOrigins.includes(request.headers.origin)) throw new SessionFailure("UNAUTHORIZED", "Origin is not allowed");
          hosted = worlds.get(worldKey({ providerId: message.providerId, worldId: message.worldId })) ?? null;
          if (!hosted) throw new SessionFailure("UNAVAILABLE", "World is unavailable");
          const identity = await options.authentication.authenticate(message.token, hosted.runtime.descriptor);
          if (typeof identity?.playerId!=="string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(identity.playerId) || typeof identity.name!=="string") throw new SessionFailure("UNAUTHORIZED", "Invalid authenticated identity");
          const name = identity.name.slice(0,64);
          await refuseBanned(identity.playerId);
          await options.beforeAdmission?.({ playerId: identity.playerId, name }, hosted.runtime.descriptor);
          hosted.admission.check(identity.playerId);
          await releasing.get(identity.playerId)?.done;
          if (ws.readyState !== WebSocket.OPEN) return;
          if (closed) throw new SessionFailure("UNAVAILABLE", "World unavailable");
          // The lease is the server-wide login: one live session per account across every world.
          const sessionId = randomUUID();
          const claim = await options.storage.claimPlayer(hosted.runtime.descriptor, identity.playerId, sessionId, name);
          if (!claim) throw new SessionFailure("DUPLICATE_LOGIN", "This player is already connected");
          let admitted = false;
          try {
            await inFlight;
            if (ws.readyState !== WebSocket.OPEN) { await options.storage.releasePlayer(hosted.runtime.descriptor, identity.playerId, sessionId); return; }
            if (closed) throw new SessionFailure("UNAVAILABLE", "World unavailable");
            hosted.admission.join(identity.playerId, sessionId); admitted = true;
            // The claim proves any other session of this account lost its lease, and a place held elsewhere is moot.
            for (const other of worlds.values()) {
              const stale = other.leases.get(identity.playerId); if (stale) evict(other, identity.playerId, stale.sessionId);
              if (other !== hosted) other.admission.forget(identity.playerId);
            }
            hosted.leases.set(identity.playerId, { sessionId, action: "hold" });
            if (claim.world) hosted.receipts[identity.playerId] = claim.world.receipts;
          const player = hosted.runtime.join(identity.playerId, claim); player.store.get().player.name = name;
          peer = { ws, playerId: identity.playerId, sessionId, replicator: new Replicator(sessionId, identity.playerId), sequence: 0, committed: 0,
            queue: [], receipts: new Map(), rateStart: Date.now(), rateCount: 0, lastSeen: Date.now(), explicitLeave: false };
          hosted.peers.set(sessionId, peer); clearTimeout(authDeadline);
          send(ws, { type: "joined", sessionId, playerId: identity.playerId, world: hosted.runtime.descriptor,
            nextOperation: (hosted.receipts[identity.playerId]?.at(-1)?.operation ?? 0) + 1 });
          recordEvent({ kind: "join", accountId: identity.playerId, detail: hosted.runtime.descriptor.worldId });
          send(ws, { type: "update", update: peer.replicator.update(hosted.runtime, 0, new Map(), true) });
          } catch(error){
            if (admitted) { hosted.admission.leave(identity.playerId,sessionId,false); hosted.runtime.leave(identity.playerId); }
            if (hosted.leases.get(identity.playerId)?.sessionId === sessionId) hosted.leases.delete(identity.playerId);
            await options.storage.releasePlayer(hosted.runtime.descriptor, identity.playerId, sessionId).catch(() => {});
            throw error;
          }
          return;
        }
        peer.lastSeen = Date.now();
        if (Date.now() - peer.rateStart >= 1000) { peer.rateStart = Date.now(); peer.rateCount = 0; }
        if (++peer.rateCount > 40) throw new SessionFailure("RATE_LIMITED", "Input rate exceeded");
        if (message.type === "leave") { peer.explicitLeave = true; ws.close(1000, "Left world"); return; }
        if (message.type === "snapshot") {
          await inFlight;
          if (!closed && ws.readyState === WebSocket.OPEN) send(ws, { type: "update", update: peer.replicator.update(hosted!.runtime, peer.committed, new Map(), true) });
          return;
        }
        if (message.type !== "command") throw new SessionFailure("INVALID_MESSAGE", "Unknown message type");
        const input = envelope(message.envelope);
        if (input.sessionId !== peer.sessionId) throw new SessionFailure("SESSION_EXPIRED", "Stale session");
        const receipt = peer.receipts.get(input.sequence);
        if (receipt) {
          if (receipt.json !== JSON.stringify(input.command)) throw new SessionFailure("INVALID_MESSAGE", "Sequence reused with a different command");
          if (input.sequence <= peer.committed) send(ws, { type: "ack", outcome: receipt.outcome });
          return;
        }
        const queued = peer.queue.find((command) => command.sequence === input.sequence);
        if (queued) {
          if (JSON.stringify(queued.command) !== JSON.stringify(input.command)) throw new SessionFailure("INVALID_MESSAGE", "Sequence reused with a different command");
          return;
        }
        if (input.sequence !== peer.sequence + peer.queue.length + 1) throw new SessionFailure("OUT_OF_ORDER", "Command sequence gap or expired receipt");
        if (peer.queue.length >= MAX_PENDING_COMMANDS) throw new SessionFailure("BACKLOG", "Command queue exceeded");
        peer.queue.push(input);
      } catch (error) {
        metrics.rejected++;
        const failure = error instanceof SessionFailure ? error : new SessionFailure("INVALID_MESSAGE", "Invalid request");
        if (!peer) recordEvent({ kind: "rejected", accountId: null, detail: failure.code });
        send(ws, { type: "error", error: { code: failure.code, message: failure.message } }); ws.close(4000, failure.code);
      }
    });
    ws.on("close", () => {
      clearTimeout(authDeadline);
      if (!peer || !hosted) return;
      hosted.peers.delete(peer.sessionId);
      const lease = hosted.leases.get(peer.playerId);
      if (lease?.sessionId !== peer.sessionId) return;
      hosted.runtime.leave(peer.playerId);
      // The next commit saves the character, then frees the account or keeps it for the reconnect window.
      lease.action = peer.explicitLeave ? "release" : "reserve";
      recordEvent({ kind: "leave", accountId: peer.playerId, detail: hosted.runtime.descriptor.worldId });
      let resolve!: () => void; const done = new Promise<void>(settle => { resolve = settle; });
      releasing.set(peer.playerId, { done, resolve });
      hosted.admission.leave(peer.playerId, peer.sessionId, !peer.explicitLeave);
    });
  });
  let committing: ReturnType<typeof auditsOf> | null = null;
  async function tick(): Promise<void> {
    if (closed || ticking) return; ticking = true; const start = performance.now();
    try {
      for (const hosted of worlds.values()) {
        const pending: { peer: Peer; outcome: CommandOutcome }[] = [];
        for (const peer of hosted.peers.values()) {
          for (const input of peer.queue.splice(0)) {
            const ledger = hosted.receipts[peer.playerId] ??= [];
            const prior = ledger.find((receipt) => receipt.operation === input.operation);
            const json = JSON.stringify(input.command);
            const latestOperation = ledger.at(-1)?.operation ?? 0;
            const result = prior ? prior.command === json
              ? prior.outcome.status === "accepted" ? { ok: true as const, value: prior.outcome.result }
                : { ok: false as const, error: prior.outcome.error }
              : { ok: false as const, error: { code: "INVALID_MESSAGE", message: "Operation reused with a different command" } }
              : input.operation !== latestOperation + 1
                ? { ok: false as const, error: { code: "OUT_OF_ORDER", message: "Operation is expired or out of order" } }
                : hosted.runtime.execute(peer.playerId, input.command);
            const outcome: CommandOutcome = result.ok ? { status: "accepted", sequence: input.sequence, tick: hosted.runtime.clock.tick, result: result.value }
              : { status: "rejected", sequence: input.sequence, tick: hosted.runtime.clock.tick, error: result.error };
            peer.sequence = input.sequence; peer.receipts.set(input.sequence, { json: JSON.stringify(input.command), outcome });
            if (!prior && input.operation === latestOperation + 1) {
              ledger.push({ operation: input.operation, command: json, sequence: input.sequence, outcome });
              if (ledger.length > RECEIPT_LIMIT) ledger.shift();
            }
            if (peer.receipts.size > RECEIPT_LIMIT) peer.receipts.delete(peer.receipts.keys().next().value!);
            pending.push({ peer, outcome }); metrics.commands++;
          }
        }
        const simulationStart = performance.now(); hosted.runtime.tick();
        const snapshotStart = performance.now(); const snapshot = hosted.runtime.snapshot(hosted.receipts, options.storage.entityPatches === true);
        const written = [...hosted.leases].map(([id, lease]) => [id, { ...lease }] as const);
        snapshot.leases = Object.assign(Object.create(null), Object.fromEntries(written));
        const edits = auditsOf(hosted); committing = edits;
        if (edits.rows.length) snapshot.audits = edits.rows.map(({ accountId, by, entry }) => ({ accountId, by, entry }));
        const commitStart = performance.now(); const { fenced } = await options.storage.commit(snapshot);
        committing = null; edits.settle(fenced);
        hosted.runtime.committed(snapshot);
        for (const [id, lease] of written) {
          if (fenced.includes(id)) evict(hosted, id, lease.sessionId);
          else if (lease.action !== "hold" && hosted.leases.get(id)?.sessionId === lease.sessionId) { hosted.leases.delete(id); released(id); }
        }
        const replicationStart = performance.now();
        for (const { peer, outcome } of pending) { peer.committed = outcome.sequence; send(peer.ws, { type: "ack", outcome }); }
        const cache = new ReplicationFrame(hosted.runtime,hosted.publicGameplay); const entityCache = new Map();
        for (const peer of hosted.peers.values()) {
          if (Date.now() - peer.lastSeen > 30_000) { peer.ws.terminate(); continue; }
          try { send(peer.ws, { type: "update", update: peer.replicator.update(hosted.runtime, peer.committed, cache, false, entityCache, snapshot.players[peer.playerId]) }); }
          catch { metrics.backlogDisconnects++; send(peer.ws, { type: "error", error: { code: "BACKLOG", message: "Client interest exceeds replication limit" } }); peer.ws.close(4008, "BACKLOG"); }
        }
        metrics.stages.simulationMs += snapshotStart-simulationStart; metrics.stages.snapshotMs += commitStart-snapshotStart;
        metrics.stages.commitMs += replicationStart-commitStart; metrics.stages.replicationMs += performance.now()-replicationStart; metrics.stages.samples++;
        for(const id of hosted.runtime.evictInactive(id=>hosted.leases.has(id)))delete hosted.receipts[id];
      }
    } catch {
      metrics.errors++;
      // No further acknowledgements or snapshots after a failed commit. Fail closed.
      committing?.settle(null); committing = null;
      failClosed();
    } finally {
      metrics.ticks.push(performance.now() - start); if (metrics.ticks.length > 36_000) metrics.ticks.shift(); ticking = false;
    }
  }
  await new Promise<void>((resolve, reject) => { http.once("error", reject); http.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve); });
  const address = http.address(); if (!address || typeof address === "string") throw new Error("Server did not bind");
  for (const hosted of worlds.values()) if (new URL(hosted.runtime.descriptor.endpoint).port === "0") {
    hosted.runtime.descriptor.endpoint = `ws://127.0.0.1:${address.port}/`;
  }
  let timer: ReturnType<typeof setTimeout>;
  const scheduleTick = (delay = 100) => {
    timer = setTimeout(() => {
      const started = performance.now();
      inFlight = (async () => { while (hold) await hold; await (running = tick()); })().finally(() => {
        // An overloaded simulation must yield to socket and HTTP work between ticks.
        if (!closed) scheduleTick(Math.max(5, 100 - (performance.now() - started)));
      });
    }, delay);
  };
  scheduleTick();
  const heartbeat = setInterval(() => { for (const ws of sockets.clients) ws.ping(); }, 10_000);
  directory?.sync();
  return { port: address.port, worlds, metrics, catalog, events: events as readonly ServerEvent[], directory,
    /** The settings in force: configuration defaults under the overrides an admin stored. */
    get settings(): ServerSettings { return settings; },
    async close() {
      closed = true; clearTimeout(timer); clearInterval(heartbeat); directory?.close();
      await inFlight;
      for (const ws of sockets.clients) ws.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      // Save every held character and free its account, unless storage already failed closed.
      if (!failed) for (const hosted of worlds.values()) if (hosted.leases.size) {
        const snapshot = hosted.runtime.snapshot(hosted.receipts, options.storage.entityPatches === true);
        snapshot.leases = Object.assign(Object.create(null), Object.fromEntries([...hosted.leases].map(([id, lease]) => [id, { sessionId: lease.sessionId, action: "release" as const }])));
        const edits = auditsOf(hosted);
        if (edits.rows.length) snapshot.audits = edits.rows.map(({ accountId, by, entry }) => ({ accountId, by, entry }));
        await options.storage.commit(snapshot).then(({ fenced }) => edits.settle(fenced), () => { metrics.errors++; edits.settle(null); });
      }
      for (const hosted of worlds.values()) auditsOf(hosted).settle(null);
      for (const waiting of [...releasing.keys()]) released(waiting);
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await options.storage.close();
    },
  };
}
