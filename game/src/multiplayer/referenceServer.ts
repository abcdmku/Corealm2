import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { WORLD_CONTENT_VERSION, WORLD_PROTOCOL_VERSION, type CommandEnvelope, type CommandOutcome, type WorldDescriptor, type WorldStorage, type WorldStorageRecord } from "../contracts.js";
import { Admission } from "./admission.js";
import { HeadlessWorld, type HeadlessWorldPorts } from "./headlessWorld.js";
import { compatible, descriptor, envelope, MAX_MESSAGE_BYTES, MAX_PENDING_COMMANDS, RECEIPT_LIMIT, record, SessionFailure, worldKey } from "./protocol.js";
import { MAX_OUTBOUND_BYTES, Replicator, ReplicationFrame } from "./replication.js";

export interface AuthenticationAdapter {
  authenticate(token: string, world: WorldDescriptor): Promise<{ playerId: string; name: string }>;
}
export interface ReferenceServerOptions {
  worlds: WorldDescriptor[];
  storage: WorldStorage;
  build(world: WorldDescriptor): Promise<HeadlessWorldPorts>;
  authentication: AuthenticationAdapter;
  port?: number;
  host?: string;
  allowedOrigins?: string[];
}
interface Peer {
  ws: WebSocket; playerId: string; sessionId: string; replicator: Replicator;
  sequence: number; committed: number; queue: CommandEnvelope[]; receipts: Map<number, { json: string; outcome: CommandOutcome }>;
  rateStart: number; rateCount: number; lastSeen: number; explicitLeave: boolean;
}
interface HostedWorld { runtime: HeadlessWorld; admission: Admission; peers: Map<string, Peer>; receipts: WorldStorageRecord["receipts"]; publicGameplay: Map<string,string> }

export async function startReferenceServer(options: ReferenceServerOptions) {
  const incremental=Boolean(options.storage.loadResident&&options.storage.loadPlayer);
  const worlds = new Map<string, HostedWorld>();
  for (const input of options.worlds) {
    const world = descriptor(input); compatible(world);
    if (worlds.has(worldKey(world))) throw new Error("Duplicate hosted world");
    const saved = incremental ? await options.storage.loadResident!(world) : await options.storage.load(world);
    worlds.set(worldKey(world), { runtime: new HeadlessWorld(world, await options.build(world), saved), admission: new Admission(world.capacity), peers: new Map(), receipts: Object.assign(Object.create(null), saved?.receipts ?? {}), publicGameplay: new Map() });
  }
  // Establish the complete entity baseline before accepting clients. Subsequent ticks only
  // clone and persist changed rows. Failure here never advertises a ready world.
  if (options.storage.entityPatches) for (const hosted of worlds.values()) {
    const initial = hosted.runtime.snapshot(hosted.receipts, true);
    if (incremental) initial.playerWrites = "patch";
    await options.storage.commit(initial);
    hosted.runtime.committed(initial);
  }
  const http = createServer((request, response) => {
    if (request.method === "GET" && (request.url === "/healthz" || request.url === "/readyz")) {
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      response.writeHead(request.url === "/readyz" && closed ? 503 : 200);
      response.end(JSON.stringify({ ready: !closed })); return;
    }
    if (request.url !== "/worlds" || request.method !== "GET") { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", "application/json"); response.setHeader("Access-Control-Allow-Origin", "*");
    response.end(JSON.stringify([...worlds.values()].map(({ runtime, admission }) => ({ ...runtime.descriptor,
      population: admission.population, availability: closed ? "unavailable" : admission.population >= admission.capacity ? "full" : "available" }))));
  });
  const sockets = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
  let closed = false; let ticking = false; let inFlight: Promise<void> = Promise.resolve();
  const metrics = { ticks: [] as number[], stages: { simulationMs: 0, snapshotMs: 0, commitMs: 0, replicationMs: 0, samples: 0 }, commands: 0, rejected: 0, bytesOut: 0, backlogDisconnects: 0, errors: 0 };
  function send(ws: WebSocket, value: unknown): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    const json = JSON.stringify(value); const size = Buffer.byteLength(json);
    if (size > MAX_OUTBOUND_BYTES || ws.bufferedAmount + size > MAX_OUTBOUND_BYTES) {
      metrics.backlogDisconnects++; ws.close(4008, "BACKLOG: outbound queue exceeded"); setTimeout(() => ws.terminate(), 1000).unref(); return false;
    }
    metrics.bytesOut += size; ws.send(json); return true;
  }
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
          if(message.contentVersion!==hosted.runtime.descriptor.contentVersion)throw new SessionFailure("INCOMPATIBLE","Incompatible world content");
          const identity = await options.authentication.authenticate(message.token, hosted.runtime.descriptor);
          await inFlight;
          if (typeof identity?.playerId!=="string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(identity.playerId) || typeof identity.name!=="string") throw new SessionFailure("UNAUTHORIZED", "Invalid authenticated identity");
          if (ws.readyState !== WebSocket.OPEN) return;
          if (closed) throw new SessionFailure("UNAVAILABLE", "World unavailable");
          const sessionId = randomUUID(); hosted.admission.join(identity.playerId, sessionId);
          try {
            if(incremental&&!hosted.runtime.players.has(identity.playerId)) {
              const saved=await options.storage.loadPlayer!(hosted.runtime.descriptor,identity.playerId);
              await inFlight;
              if(ws.readyState!==WebSocket.OPEN||closed){hosted.admission.leave(identity.playerId,sessionId,false);return;}
              if(saved){hosted.runtime.restorePlayer(identity.playerId,saved);hosted.receipts[identity.playerId]=saved.receipts;}
            }
          const player = hosted.runtime.join(identity.playerId); player.store.get().player.name = identity.name.slice(0,64);
          peer = { ws, playerId: identity.playerId, sessionId, replicator: new Replicator(sessionId, identity.playerId), sequence: 0, committed: 0,
            queue: [], receipts: new Map(), rateStart: Date.now(), rateCount: 0, lastSeen: Date.now(), explicitLeave: false };
          hosted.peers.set(sessionId, peer); clearTimeout(authDeadline);
          send(ws, { type: "joined", sessionId, playerId: identity.playerId, world: hosted.runtime.descriptor,
            nextOperation: (hosted.receipts[identity.playerId]?.at(-1)?.operation ?? 0) + 1 });
          send(ws, { type: "update", update: peer.replicator.update(hosted.runtime, 0, new Map(), true) });
          } catch(error){hosted.admission.leave(identity.playerId,sessionId,false);hosted.runtime.leave(identity.playerId);throw error;}
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
        send(ws, { type: "error", error: { code: failure.code, message: failure.message } }); ws.close(4000, failure.code);
      }
    });
    ws.on("close", () => {
      clearTimeout(authDeadline);
      if (peer && hosted) {
        hosted.peers.delete(peer.sessionId);
        if (hosted.admission.owns(peer.playerId, peer.sessionId)) hosted.runtime.leave(peer.playerId);
        hosted.admission.leave(peer.playerId, peer.sessionId, !peer.explicitLeave);
      }
    });
  });
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
        if(incremental)snapshot.playerWrites="patch";
        const commitStart = performance.now(); await options.storage.commit(snapshot);
        hosted.runtime.committed(snapshot);
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
        if(incremental)for(const id of hosted.runtime.evictInactive())delete hosted.receipts[id];
      }
    } catch {
      metrics.errors++;
      // No further acknowledgements or snapshots after a failed commit. Fail closed.
      closed = true;
      for (const client of sockets.clients) { send(client, { type: "error", error: { code: "UNAVAILABLE", message: "World storage or simulation failed" } }); client.close(1011, "World unavailable"); }
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
      inFlight = tick().finally(() => {
        // An overloaded simulation must yield to socket and HTTP work between ticks.
        if (!closed) scheduleTick(Math.max(5, 100 - (performance.now() - started)));
      });
    }, delay);
  };
  scheduleTick();
  const heartbeat = setInterval(() => { for (const ws of sockets.clients) ws.ping(); }, 10_000);
  return { port: address.port, worlds, metrics,
    async close() {
      closed = true; clearTimeout(timer); clearInterval(heartbeat);
      await inFlight;
      for (const ws of sockets.clients) ws.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await options.storage.close();
    },
  };
}
