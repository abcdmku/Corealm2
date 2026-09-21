import { closeSync, mkdirSync, openSync, renameSync, statSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/**
 * One JSON object per line, one line per event, which is what journald and every log shipper want.
 *
 * Every part of the server already takes a `log(event)` option and the host used to hand each of
 * them `console.log(JSON.stringify(...))` of its own. They all go through one logger now, so a line
 * always has `t`, `level` and `event` first, and a credential can never reach a log file: the
 * redaction below is applied to every line, whoever wrote it.
 *
 * The TUI owns stdout while it runs, so the logger can be routed to a size-capped file instead.
 */

export type LogLevel = "info" | "warn" | "error";

/** Where finished lines go. Synchronous: a line written before a crash must be on disk after it. */
export interface LogWriter {
  write(line: string): void;
  close?(): void;
}

export interface ServerLogger {
  /**
   * The `log(event)` shape the server graph calls. `event` names the event, `level` sets the level
   * when the caller knows better than the table below, and every other key is written as it is.
   */
  emit(event: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  /** Send later lines somewhere else and close the previous writer. The TUI routes them to a file. */
  route(writer: LogWriter): void;
  close(): void;
}

/**
 * Keys whose value is a credential or a personal secret, wherever they appear. The one exception is
 * the owner setup code, which exists to be read by the person at the console, once.
 */
const REDACTED_KEYS: ReadonlySet<string> = new Set(["token", "tokens", "secret", "session", "password", "authorization", "apikey", "key", "code", "credential"]);
/** The event whose whole point is to print the setup code. */
export const SETUP_CODE_EVENT = "owner-setup-code";
/** Admin sessions and API tokens are recognisable wherever they turn up, including inside a message. */
const CREDENTIAL_TEXT = /\b(cas|cat)_[A-Za-z0-9_-]{8,}/g;
export const REDACTED = "[redacted]";

const WARN_EVENTS: ReadonlySet<string> = new Set([
  "directory.refused", "directory.unreachable", "admin.setup_refused",
  "session.rejected", "console.unavailable", "storage-migrated",
]);
const ERROR_EVENTS: ReadonlySet<string> = new Set(["error", "admin.error", "content.swap_failed", "storage.failed", "start.failed"]);

/** The level of an event that did not name one. Everything a server does is routine until it is not. */
export function logLevelOf(event: string): LogLevel {
  if (ERROR_EVENTS.has(event)) return "error";
  if (WARN_EVENTS.has(event)) return "warn";
  return "info";
}

function redactValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return value.replace(CREDENTIAL_TEXT, REDACTED);
  if (Array.isArray(value)) return depth > 6 ? REDACTED : value.map(entry => redactValue(entry, depth + 1));
  if (value && typeof value === "object") return depth > 6 ? REDACTED : redactFields(value as Record<string, unknown>, depth + 1, false);
  return value;
}

function redactFields(fields: Record<string, unknown>, depth: number, setupCode: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (REDACTED_KEYS.has(key.toLowerCase()) && !(setupCode && key === "code")) out[key] = REDACTED;
    else out[key] = redactValue(value, depth);
  }
  return out;
}

/** One finished line, without its newline. `t`, `level` and `event` lead, so `sort` and `grep` both work. */
export function logLine(level: LogLevel, event: string, fields: Record<string, unknown>, at: number): string {
  const { t: _t, level: _level, event: _event, ...rest } = fields;
  return JSON.stringify({ t: new Date(at).toISOString(), level, event, ...redactFields(rest, 0, event === SETUP_CODE_EVENT) });
}

export function streamWriter(stream: NodeJS.WritableStream): LogWriter {
  return { write: line => { stream.write(`${line}\n`); } };
}

export interface FileWriterOptions {
  /** Rotate once the file passes this. One rotation is kept, so the pair is capped at twice this. */
  maxBytes?: number;
}
export const DEFAULT_LOG_MAX_BYTES = 8 * 1024 * 1024;

/**
 * `server.log` in the data directory, with one rotation. A server left running with the TUI up for
 * months must not fill the disk, and an operator who comes back wants the last lines, not the first.
 */
export function fileWriter(path: string, options: FileWriterOptions = {}): LogWriter {
  const maxBytes = options.maxBytes ?? DEFAULT_LOG_MAX_BYTES;
  mkdirSync(dirname(path), { recursive: true });
  let handle = openSync(path, "a");
  let size = statSync(path).size;
  return {
    write(line) {
      const bytes = Buffer.from(`${line}\n`, "utf8");
      if (size + bytes.length > maxBytes && size > 0) {
        closeSync(handle);
        renameSync(path, `${path}.1`);
        handle = openSync(path, "a");
        size = 0;
      }
      writeSync(handle, bytes);
      size += bytes.length;
    },
    close() { closeSync(handle); },
  };
}

export interface ServerLoggerOptions {
  writer?: LogWriter;
  now?(): number;
}

export function createServerLogger(options: ServerLoggerOptions = {}): ServerLogger {
  const now = options.now ?? Date.now;
  let writer = options.writer ?? streamWriter(process.stdout);
  const at = (level: LogLevel, event: string, fields: Record<string, unknown>): void => {
    writer.write(logLine(level, event, fields, now()));
  };
  return {
    emit(event) {
      const name = typeof event.event === "string" ? event.event : "event";
      const level = event.level === "warn" || event.level === "error" || event.level === "info" ? event.level : logLevelOf(name);
      at(level, name, event);
    },
    info: (event, fields = {}) => at("info", event, fields),
    warn: (event, fields = {}) => at("warn", event, fields),
    error: (event, fields = {}) => at("error", event, fields),
    route(next) { const previous = writer; writer = next; previous.close?.(); },
    close() { writer.close?.(); },
  };
}
