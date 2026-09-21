import type { SessionCredentials, WorldDescriptor, WorldProvider, WorldSession } from "../contracts.js";
import { compatible, discoverWorlds, SessionFailure } from "./protocol.js";
import { MAX_OUTBOUND_BYTES } from "./replication.js";
import { socketSessionCatalog } from "./clientCatalogFetch.js";
import { ClientWorldSession, joinWorldSession, RetryLedger, type SessionTransport, type TransportListener } from "./sessionClient.js";

/** A session that reached its world over a socket. The protocol itself lives in `sessionClient.ts`. */
export type WebSocketSession = ClientWorldSession;

/**
 * The wire half of a connected session: JSON text frames under the server's size limit, held until
 * the socket opens, a five second patience for the join and for each acknowledgement, and a close
 * that waits for the server's own close frame so the next join finds the account released.
 */
export function webSocketTransport(socket: WebSocket): SessionTransport {
  let listener: TransportListener | null = null; const held: string[] = [];
  socket.addEventListener("open", () => { for (const text of held.splice(0)) socket.send(text); }, { once: true });
  socket.addEventListener("message", (event) => {
    if (!listener) return;
    if (typeof event.data !== "string" || event.data.length > MAX_OUTBOUND_BYTES) { listener.invalid(); return; }
    let value: unknown;
    try { value = JSON.parse(event.data); } catch { listener.invalid(); return; }
    listener.message(value);
  });
  socket.addEventListener("close", () => listener?.closed());
  socket.addEventListener("error", () => listener?.failed());
  return {
    remote: true, joinTimeoutMs: 5000, ackTimeoutMs: 5000,
    get open() { return socket.readyState === WebSocket.OPEN; },
    send(message) {
      const text = JSON.stringify(message);
      if (socket.readyState === WebSocket.CONNECTING) held.push(text); else socket.send(text);
    },
    close(code, reason) { socket.close(code, reason); },
    listen(next) { listener = next; },
    whenClosed: () => new Promise<void>((resolve) => {
      if (socket.readyState === WebSocket.CLOSED) { resolve(); return; }
      const timeout = setTimeout(resolve, 1500);
      socket.addEventListener("close", () => { clearTimeout(timeout); resolve(); }, { once: true });
    }),
    catalog: (world, revision) => socketSessionCatalog(world.endpoint, revision),
  };
}

export class WebSocketProvider implements WorldProvider {
  private readonly retries = new RetryLedger();
  constructor(readonly id: string, private readonly worlds: WorldDescriptor[],
    private readonly authenticatePlayer: (world: WorldDescriptor, signal?: AbortSignal) => Promise<SessionCredentials>) {}
  discover(signal?: AbortSignal): Promise<WorldDescriptor[]> { return discoverWorlds(this.worlds, signal); }
  authenticate(world: WorldDescriptor, signal?: AbortSignal): Promise<SessionCredentials> { return this.authenticatePlayer(world, signal); }
  async connect(world: WorldDescriptor, credentials: SessionCredentials, signal?: AbortSignal): Promise<WorldSession> {
    compatible(world);
    if (world.providerId !== this.id) throw new SessionFailure("UNAVAILABLE", "Wrong provider");
    if (signal?.aborted) throw new SessionFailure("SESSION_EXPIRED", "Join cancelled");
    return joinWorldSession(webSocketTransport(new WebSocket(world.endpoint)), world, credentials, this.retries, signal);
  }
}
