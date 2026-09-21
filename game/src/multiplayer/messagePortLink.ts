import type { SessionCatalog, WorldDescriptor } from "../contracts.js";
import { SessionFailure } from "./protocol.js";
import type { SessionTransport, TransportListener } from "./sessionClient.js";
import type { PeerConnection, PeerLink } from "./worldHost.js";

/**
 * Both ends of a session over a MessagePort: the host's `PeerLink` inside the local-play worker and
 * the client's `SessionTransport` on the page. Messages cross by structured clone, never as JSON, so
 * there is nothing to parse and no size to count.
 *
 * A port has no close event a page can rely on and no ping, so closing is a message. Whoever ends the
 * link posts one `PortClose` frame and then closes its own end; the other side treats that frame the
 * way a socket treats a close event. A worker that dies cannot post it, which is why the transport
 * also has `lost()`: the provider calls it when the worker reports an error.
 */
interface PortClose { "@port": "close"; code: number; reason: string }
const isPortClose = (value: unknown): value is PortClose => typeof value === "object" && value !== null && (value as { "@port"?: unknown })["@port"] === "close";
/**
 * Local play's debug channel rides the same port, as frames the session never sees. It is ordered
 * with the session's updates, which is the point: the host replicates an operation's effect and then
 * answers, so the page has the effect before it has the answer. A socket has no such frame; to the
 * host core `{"@port": ...}` is an unknown message and refuses the peer.
 */
interface PortDebug { "@port": "debug"; id: number; op: unknown }
interface PortDebugReply { "@port": "debug-reply"; id: number; reply: unknown }
const portFrame = (value: unknown): string | null => typeof value === "object" && value !== null && typeof (value as { "@port"?: unknown })["@port"] === "string"
  ? (value as { "@port": string })["@port"] : null;

/** The part of a MessagePort both ends use. The DOM's port and Node's both fit. */
export interface MessagePortLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message" | "messageerror", listener: (event: { data: unknown }) => void): void;
  start(): void;
  close(): void;
}

/**
 * The host end. Hands the port to the host core as a `PeerLink` and feeds the core what arrives.
 * There is no liveness timeout: a port cannot go quiet while its page lives, and when the page goes
 * the worker goes with it.
 */
export function serveMessagePort(port: MessagePortLike, host: { connect(link: PeerLink): PeerConnection | null },
  options: { /** Answers one debug operation. It must not settle before the effect has been replicated to this link. Absent refuses them all. */ debug?(op: unknown): Promise<unknown> } = {}): PeerLink {
  let open = true; let connection: PeerConnection | null = null;
  const end = (): void => { if (!open) return; open = false; port.close(); connection?.closed(); };
  const link: PeerLink = {
    get open() { return open; },
    send(value) {
      if (!open) return false;
      // A value structured clone refuses is a bug in the sender, not a reason to take the host down.
      try { port.postMessage(value); return true; } catch { return false; }
    },
    close(code, reason) {
      if (!open) return;
      try { port.postMessage({ "@port": "close", code, reason } satisfies PortClose); } catch { /* The page is already gone. */ }
      end();
    },
  };
  port.addEventListener("message", (event) => {
    if (!open) return;
    if (isPortClose(event.data)) { end(); return; }
    if (portFrame(event.data) === "debug") {
      const { id, op } = event.data as PortDebug;
      const answer = (reply: unknown): void => { if (open) try { port.postMessage({ "@port": "debug-reply", id, reply } satisfies PortDebugReply); } catch { /* A reply that cannot be cloned is dropped; the caller times out. */ } };
      if (!options.debug || !connection?.joined) { answer({ ok: false, error: options.debug ? "Join the world before using the debug channel" : "This host has no debug channel" }); return; }
      void options.debug(op).then(answer, error => answer({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return;
    }
    void connection?.accept(event.data);
  });
  port.addEventListener("messageerror", () => { if (open) connection?.refuse(new SessionFailure("INVALID_MESSAGE", "Message could not be read")); });
  // A host that no longer serves says so through the link and closes it before this returns.
  connection = host.connect(link);
  if (connection && !open) connection.closed();
  if (open) port.start();
  return link;
}

export interface MessagePortTransport extends SessionTransport {
  /** The far side died without saying so. Ends the link exactly as its close frame would have. */
  lost(): void;
  /** One debug operation. Settles after every session message the host sent before its reply has been delivered. Rejects when the link ends first. */
  debug(op: unknown, timeoutMs?: number): Promise<unknown>;
}

/** The client end. `catalog` is how this session's client catalog is reached, which for local play is the worker. */
export function messagePortTransport(port: MessagePortLike, options: { catalog(world: WorldDescriptor, revision: string): SessionCatalog; joinTimeoutMs?: number }): MessagePortTransport {
  let open = true; let listener: TransportListener | null = null;
  let settle!: () => void; const gone = new Promise<void>(resolve => { settle = resolve; });
  const calls = new Map<number, { resolve(reply: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>(); let nextCall = 1;
  const end = (): void => {
    if (!open) return; open = false; port.close(); settle();
    for (const call of calls.values()) { clearTimeout(call.timer); call.reject(new Error("UNAVAILABLE: the local world closed before the debug operation was answered")); }
    calls.clear(); listener?.closed();
  };
  port.addEventListener("message", (event) => {
    if (!open) return;
    if (isPortClose(event.data)) { end(); return; }
    if (portFrame(event.data) === "debug-reply") {
      const { id, reply } = event.data as PortDebugReply, call = calls.get(id);
      if (call) { calls.delete(id); clearTimeout(call.timer); call.resolve(reply); }
      return;
    }
    listener?.message(event.data);
  });
  port.addEventListener("messageerror", () => { if (open) listener?.invalid(); });
  port.start();
  return {
    remote: false, joinTimeoutMs: options.joinTimeoutMs ?? 15_000, ackTimeoutMs: null,
    get open() { return open; },
    send(message) { if (open) port.postMessage(message); },
    close(code, reason) {
      if (!open) return;
      try { port.postMessage({ "@port": "close", code, reason } satisfies PortClose); } catch { /* The worker is already gone. */ }
      end();
    },
    listen(next) { listener = next; },
    whenClosed: () => gone,
    catalog: options.catalog,
    lost: end,
    debug(op, timeoutMs = 120_000) {
      return new Promise((resolve, reject) => {
        if (!open) { reject(new Error("UNAVAILABLE: the local world is closed")); return; }
        const id = nextCall++;
        const timer = setTimeout(() => { calls.delete(id); reject(new Error("UNAVAILABLE: the local world did not answer the debug operation")); }, timeoutMs);
        calls.set(id, { resolve, reject, timer });
        try { port.postMessage({ "@port": "debug", id, op } satisfies PortDebug); }
        catch (error) { calls.delete(id); clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); }
      });
    },
  };
}
