import { WebSocket } from "ws";
import { SessionFailure } from "./protocol.js";
import { MAX_OUTBOUND_BYTES } from "./replication.js";
import type { PeerLink, WorldHostMetrics } from "./worldHost.js";

/** A peer silent for this long, pings included, is dead. Only a socket can go silent without closing. */
export const PEER_SILENCE_MS = 30_000;

/** What the socket's own outbound limits count into. */
export type SocketMetrics = Pick<WorldHostMetrics, "bytesOut" | "backlogDisconnects">;

/**
 * Write one frame of `size` bytes, or drop a peer that cannot drain its outbound queue. `data` is the
 * JSON text, or the same text already encoded as UTF-8 by a world thread, which goes out as a text
 * frame all the same. False when nothing was sent.
 */
export function sendFrame(ws: WebSocket, metrics: SocketMetrics, data: string | Uint8Array, size: number): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  if (size > MAX_OUTBOUND_BYTES || ws.bufferedAmount + size > MAX_OUTBOUND_BYTES) {
    metrics.backlogDisconnects++; ws.close(4008, "BACKLOG: outbound queue exceeded"); setTimeout(() => ws.terminate(), 1000).unref(); return false;
  }
  metrics.bytesOut += size;
  if (typeof data === "string") ws.send(data); else ws.send(data, { binary: false });
  return true;
}

/**
 * One WebSocket as the core sees it. The socket's own limits live here: messages are JSON text, a
 * peer that cannot drain its outbound queue is dropped, and a peer that stopped answering pings is
 * no longer `open`.
 */
export class WebSocketLink implements PeerLink {
  lastSeen = Date.now();
  constructor(readonly ws: WebSocket, private readonly metrics: SocketMetrics, private readonly origin: string | undefined, private readonly allowedOrigins: readonly string[] | undefined) {}
  get silent(): boolean { return Date.now() - this.lastSeen > PEER_SILENCE_MS; }
  get open(): boolean { return this.ws.readyState === WebSocket.OPEN && !this.silent; }
  /** Whether the transport admits this socket to a join: its Origin is allowed, or it sent none. */
  get originAllowed(): boolean { return !(this.origin && this.allowedOrigins && !this.allowedOrigins.includes(this.origin)); }
  send(value: unknown): boolean {
    if (this.ws.readyState !== WebSocket.OPEN) return false;
    const json = JSON.stringify(value);
    return sendFrame(this.ws, this.metrics, json, Buffer.byteLength(json));
  }
  close(code: number, reason: string): void { this.ws.close(code, reason); }
  admit(): void {
    if (!this.originAllowed) throw new SessionFailure("UNAUTHORIZED", "Origin is not allowed");
  }
}
