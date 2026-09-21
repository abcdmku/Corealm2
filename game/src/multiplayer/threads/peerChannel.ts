import type { PeerLink } from "../worldHost.js";
import { SessionFailure } from "../protocol.js";

/**
 * A socket peer as a world thread sees it. The socket itself stays on the main thread; what crosses
 * is text in and frames out.
 *
 * Out is the hot path: ten updates a second to every peer. The world thread serialises each message
 * once, exactly as the socket link does (`JSON.stringify`), and the frames of one turn of its event
 * loop leave as one batch. In `bytes` mode the batch is a single buffer of UTF-8 that is transferred,
 * not copied, and the main thread writes slices of it to the sockets as text frames, so it neither
 * serialises nor encodes anything. In `text` mode the batch is an array of strings, which the clone
 * copies and the socket then encodes on the main thread. The bytes on the wire are the same.
 *
 * Backlog accounting stays with the socket, on the main thread, where `bufferedAmount` is. So `send`
 * here answers true for an open link without knowing whether the socket took the frame; a peer the
 * main thread drops for backlog is reported back as closed like any other.
 */
export type PeerEncoding = "bytes" | "text";
/** One operation of a batch, in order: a frame for a peer, or the closing of one. */
export type OutboundOp = [peer: number, offset: number, length: number] | [peer: number, text: string] | [peer: number, code: number, reason: string, close: true];
export interface OutboundBatch { ops: OutboundOp[]; bytes: ArrayBuffer | null }

export interface Outbox {
  frame(peer: number, json: string): void;
  close(peer: number, code: number, reason: string): void;
}

const INITIAL_BYTES = 256 * 1024;
/** Collects one event-loop turn's frames and hands them to `post` as one batch. */
export function createOutbox(encoding: PeerEncoding, post: (batch: OutboundBatch, transfer: ArrayBuffer[]) => void): Outbox {
  let ops: OutboundOp[] = []; let scratch = Buffer.allocUnsafeSlow(INITIAL_BYTES); let used = 0; let scheduled = false;
  const flush = (): void => {
    scheduled = false;
    if (!ops.length) return;
    const batch = ops; ops = [];
    if (encoding === "text" || used === 0) { used = 0; post({ ops: batch, bytes: null }, []); return; }
    // One copy of what was written, so the scratch buffer is kept. The copy is transferred.
    const bytes = scratch.buffer.slice(scratch.byteOffset, scratch.byteOffset + used) as ArrayBuffer; used = 0;
    post({ ops: batch, bytes }, [bytes]);
  };
  const schedule = (): void => { if (!scheduled) { scheduled = true; queueMicrotask(flush); } };
  return {
    frame(peer, json) {
      if (encoding === "text") { ops.push([peer, json]); schedule(); return; }
      // Three bytes is the most UTF-8 spends on one UTF-16 unit.
      const need = used + json.length * 3;
      if (need > scratch.length) { const grown = Buffer.allocUnsafeSlow(Math.max(need, scratch.length * 2)); scratch.copy(grown, 0, 0, used); scratch = grown; }
      const written = scratch.write(json, used, "utf8");
      ops.push([peer, used, written]); used += written; schedule();
    },
    close(peer, code, reason) { ops.push([peer, code, reason, true]); schedule(); },
  };
}

/** The `PeerLink` a world thread's core holds for one socket on the main thread. */
export class ThreadPeerLink implements PeerLink {
  private live = true;
  constructor(readonly id: number, private readonly outbox: Outbox, private readonly originAllowed: boolean) {}
  get open(): boolean { return this.live; }
  send(value: unknown): boolean {
    if (!this.live) return false;
    this.outbox.frame(this.id, JSON.stringify(value)); return true;
  }
  /** As a closing socket does, the link stops being open at once. The main thread closes the socket and reports it gone. */
  close(code: number, reason: string): void { if (!this.live) return; this.live = false; this.outbox.close(this.id, code, reason); }
  admit(): void { if (!this.originAllowed) throw new SessionFailure("UNAUTHORIZED", "Origin is not allowed"); }
  /** The main thread reported the socket gone. */
  gone(): void { this.live = false; }
}
