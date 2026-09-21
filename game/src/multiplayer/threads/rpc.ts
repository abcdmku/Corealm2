import { SessionFailure } from "../protocol.js";
import type { SessionErrorCode } from "../../contracts.js";

/**
 * Requests, replies and one-way notes over anything that posts messages: a `Worker`, the `parentPort`
 * of one, or a `MessagePort` between two threads. Everything that crosses is plain data, cloned by
 * the structured clone algorithm. An error crosses as its fields and is rebuilt as the class the
 * caller tests for, so a `SessionFailure` thrown on the main thread still refuses a join in a world
 * thread with its own code.
 *
 * Node only by use, not by import: nothing here names a `node:` module.
 */
export interface Endpoint {
  postMessage(value: unknown, transfer?: readonly Transferable[]): void;
  on(event: "message", listener: (value: unknown) => void): unknown;
}
type Transferable = object;

export interface WireError { name: string; message: string; code?: string; status?: number; opIndex?: number | null; details?: Record<string, unknown>; stack?: string }
/** An error from the other side that is none of the classes below. `name` keeps the original's. */
export class RemoteFailure extends Error {
  constructor(readonly remote: WireError) { super(remote.message); this.name = remote.name || "RemoteFailure"; if (remote.stack) this.stack = remote.stack; }
}
/** The thread at the other end is gone, or the wait for it ran out. */
export class ThreadUnavailable extends Error {
  constructor(message: string) { super(message); this.name = "ThreadUnavailable"; }
}
type Reviver = (error: WireError) => Error | null;
const revivers: Reviver[] = [
  error => error.name === "SessionFailure" && error.code ? new SessionFailure(error.code as SessionErrorCode, error.message) : null,
];
/**
 * Teach the wire another error class. `EditFailure` and `PublishFailure` are registered by the main thread's host, because their
 * modules read content tables and this one loads before a catalog is installed.
 */
export function reviveWith(reviver: Reviver): void { revivers.push(reviver); }

export function wireError(error: unknown): WireError {
  if (!(error instanceof Error)) return { name: "Error", message: String(error) };
  const fields = error as Error & { code?: unknown; status?: unknown; opIndex?: unknown; details?: unknown };
  return { name: error.name, message: error.message, ...(typeof fields.code === "string" ? { code: fields.code } : {}), ...(typeof fields.status === "number" ? { status: fields.status } : {}),
    ...(typeof fields.opIndex === "number" || fields.opIndex === null ? { opIndex: fields.opIndex } : {}),
    ...(fields.details && typeof fields.details === "object" ? { details: fields.details as Record<string, unknown> } : {}), ...(error.stack ? { stack: error.stack } : {}) };
}
export function reviveError(error: WireError): Error {
  for (const reviver of revivers) { const revived = reviver(error); if (revived) return revived; }
  return new RemoteFailure(error);
}

type Handler = (...args: never[]) => unknown;
export type Handlers = Record<string, Handler>;
interface Request { k: "q"; id: number; m: string; a: unknown[] }
interface Reply { k: "r"; id: number; ok: boolean; v?: unknown; e?: WireError }
interface Note { k: "n"; m: string; a: unknown[] }

export interface Rpc {
  /** Ask the other side and wait for its answer. Rejects with `ThreadUnavailable` when the link fails first. */
  call<T = unknown>(method: string, args?: unknown[], options?: { transfer?: readonly Transferable[]; timeoutMs?: number }): Promise<T>;
  /** Tell the other side. No answer, no error. */
  note(method: string, args?: unknown[], transfer?: readonly Transferable[]): void;
  /** Requests sent and not yet answered. */
  readonly pending: number;
  /** Reject everything in flight and everything after: the other side is gone. */
  fail(reason: string): void;
}

/**
 * `handlers` answer the other side's calls and notes. A handler may be async. One that throws answers
 * the call with the error; a note's error goes to `onError`, because nobody is waiting for it.
 */
export function createRpc(endpoint: Endpoint, handlers: Handlers, onError: (error: unknown, method: string) => void = () => {}): Rpc {
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> | null }>();
  let serial = 0; let failed: string | null = null;
  const run = (method: string, args: unknown[]): unknown => {
    const handler = Object.hasOwn(handlers, method) ? handlers[method] as ((...values: unknown[]) => unknown) : null;
    if (!handler) throw new Error(`Unknown thread message ${JSON.stringify(method)}`);
    return handler(...args);
  };
  endpoint.on("message", (raw: unknown) => {
    const message = raw as Request | Reply | Note | null;
    if (!message || typeof message !== "object") return;
    if (message.k === "r") {
      const entry = waiting.get(message.id); if (!entry) return;
      waiting.delete(message.id); if (entry.timer) clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.v); else entry.reject(reviveError(message.e!));
    } else if (message.k === "q") {
      const { id, m } = message;
      Promise.resolve().then(() => run(m, message.a)).then(
        value => { try { endpoint.postMessage({ k: "r", id, ok: true, v: value } satisfies Reply); } catch (error) { endpoint.postMessage({ k: "r", id, ok: false, e: wireError(error) } satisfies Reply); } },
        error => { try { endpoint.postMessage({ k: "r", id, ok: false, e: wireError(error) } satisfies Reply); } catch { /* The port closed under us. The caller's own failure path covers it. */ } });
    } else if (message.k === "n") {
      Promise.resolve().then(() => run(message.m, message.a)).catch(error => onError(error, message.m));
    }
  });
  return {
    get pending() { return waiting.size; },
    call<T>(method: string, args: unknown[] = [], options: { transfer?: readonly Transferable[]; timeoutMs?: number } = {}): Promise<T> {
      if (failed !== null) return Promise.reject(new ThreadUnavailable(failed));
      const id = ++serial;
      return new Promise<T>((resolve, reject) => {
        const timer = options.timeoutMs === undefined ? null : setTimeout(() => { waiting.delete(id); reject(new ThreadUnavailable(`No answer to ${method} within ${options.timeoutMs} ms`)); }, options.timeoutMs);
        waiting.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        try { endpoint.postMessage({ k: "q", id, m: method, a: args } satisfies Request, options.transfer); }
        catch (error) { waiting.delete(id); if (timer) clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); }
      });
    },
    note(method, args = [], transfer) {
      if (failed !== null) return;
      try { endpoint.postMessage({ k: "n", m: method, a: args } satisfies Note, transfer); } catch (error) { onError(error, method); }
    },
    fail(reason) {
      failed ??= reason;
      for (const [id, entry] of [...waiting]) { waiting.delete(id); if (entry.timer) clearTimeout(entry.timer); entry.reject(new ThreadUnavailable(reason)); }
    },
  };
}
