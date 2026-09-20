import type { ServerEvent } from "./referenceServer.js";

/**
 * `--tui`: a live console drawn with plain ANSI codes and nothing else.
 *
 * `renderConsole` is a pure function of a stats snapshot and a terminal size, so the layout has a
 * literal test and the driver below has nothing in it but terminal housekeeping. One frame is one
 * `write`, cursor-addressed rather than cleared, so nothing flickers.
 *
 * ASCII only. Box-drawing characters turn into mojibake on a Windows console left on code page 437,
 * and an operator over SSH is the person least able to fix that, so the frame is built from reverse
 * video and alignment instead.
 */

export interface ConsoleWorldStats { worldId: string; name: string; playersOnline: number; capacity: number; tick: number }
export interface ConsoleStats {
  /** What the public directory lists this server as. */
  name: string;
  host: string;
  port: number;
  authentication: string;
  catalogRevision: string;
  uptimeSeconds: number;
  worlds: ConsoleWorldStats[];
  tick: { lastMs: number; meanMs: number; p95Ms: number };
  memory: { rssBytes: number; heapUsedBytes: number };
  bytesOut: number;
  bytesOutPerSecond: number;
  commands: number;
  rejected: number;
  errors: number;
  /** The bounded ring `GET /admin/stats` returns, oldest first. */
  events: readonly ServerEvent[];
  /** Where log lines are going while the console owns stdout, or null when they are not written. */
  logPath: string | null;
}
export interface ConsoleSize { columns: number; rows: number }

const RESET = "[0m", DIM = "[2m", REVERSE = "[7m", YELLOW = "[33m", RED = "[31m";
/** Tick time above this is the plan's p95 target missed, and the only thing the frame ever paints red. */
export const TICK_ALERT_MS = 100;
const ANSI = /\[[0-9;]*m/g;
export const stripAnsi = (text: string): string => text.replace(ANSI, "");

interface Part { text: string; style?: string }
const plain = (text: string): Part => ({ text });
const dim = (text: string): Part => ({ text, style: DIM });

/** One row, styled, clipped to the width. Styles never survive the clip, so a truncated row cannot bleed. */
function row(parts: readonly Part[], width: number, style = ""): string {
  let left = width, out = "";
  for (const part of parts) {
    if (left <= 0) break;
    const text = part.text.length > left ? part.text.slice(0, left) : part.text;
    left -= text.length;
    out += part.style ? `${part.style}${text}${RESET}${style}` : text;
  }
  const padded = out + " ".repeat(Math.max(0, left));
  return style ? `${style}${padded}${RESET}` : padded;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

export function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400), hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60), rest = total % 60;
  if (days) return `${days}d ${pad2(hours)}h`;
  if (hours) return `${hours}h ${pad2(minutes)}m`;
  return `${minutes}m ${pad2(rest)}s`;
}

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;
export function formatBytes(value: number): string {
  let size = Math.max(0, value), unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) { size /= 1024; unit++; }
  return `${unit === 0 ? Math.round(size) : size.toFixed(1)} ${UNITS[unit]}`;
}
const formatMs = (value: number): string => `${value.toFixed(1)} ms`;
/** Epoch milliseconds as UTC wall clock, because an operator reading a server's log wants one clock. */
export const formatClock = (at: number): string => new Date(at).toISOString().slice(11, 19);

const ALERT_KINDS: ReadonlySet<ServerEvent["kind"]> = new Set(["rejected", "ban", "kick"]);

/** A whole frame, `rows` lines joined by newlines, every line exactly `columns` wide. */
export function renderConsole(stats: ConsoleStats, size: ConsoleSize): string {
  const width = Math.max(24, Math.floor(size.columns));
  const height = Math.max(6, Math.floor(size.rows));
  const label = (text: string): Part => dim(`  ${text.padEnd(9)}`);

  const address = `${stats.host}:${stats.port}`;
  const heading = `  COREALM  ${stats.name}`;
  const clockText = `up ${formatUptime(stats.uptimeSeconds)}   ${address}  `;
  const header = row([plain(heading), plain(" ".repeat(Math.max(1, width - heading.length - clockText.length))), plain(clockText)], width, REVERSE);

  const nameWidth = Math.max(8, ...stats.worlds.map(world => world.name.length));
  // Online right of the slash's left, capacity left of its right: the slashes line up down the column.
  const worlds = stats.worlds.map(world => row([plain("    "), plain(world.name.padEnd(nameWidth + 4)),
    plain(String(world.playersOnline).padStart(5)), dim(" / "), plain(String(world.capacity).padEnd(6)),
    dim("players"), plain(`    tick ${world.tick}`)], width));

  const tickStyle = stats.tick.p95Ms > TICK_ALERT_MS ? RED : undefined;
  const body = [
    row([label("tick"), plain(`last ${formatMs(stats.tick.lastMs).padEnd(9)}`), plain(`mean ${formatMs(stats.tick.meanMs).padEnd(9)}`),
      { text: `p95 ${formatMs(stats.tick.p95Ms)}`, ...(tickStyle ? { style: tickStyle } : {}) }], width),
    row([label("memory"), plain(`rss ${formatBytes(stats.memory.rssBytes).padEnd(10)}`), plain(`heap ${formatBytes(stats.memory.heapUsedBytes)}`)], width),
    row([label("traffic"), plain(`out ${formatBytes(stats.bytesOut).padEnd(10)}`), plain(`${formatBytes(stats.bytesOutPerSecond)}/s`)], width),
    row([label("commands"), plain(String(stats.commands).padEnd(14)), plain(`rejected ${String(stats.rejected).padEnd(5)}`), plain(`errors ${stats.errors}`)], width),
    row([label("catalog"), plain(stats.catalogRevision.slice(0, 16)), dim("   auth "), plain(stats.authentication)], width),
  ];

  const fixed = 1 + 1 + 1 + worlds.length + 1 + body.length + 1 + 1 + 1;
  const room = Math.max(0, height - fixed);
  const shown = stats.events.slice(Math.max(0, stats.events.length - room));
  const events = shown.map(event => row([plain("    "), dim(formatClock(event.at)), plain("  "),
    { text: event.kind.padEnd(14), ...(ALERT_KINDS.has(event.kind) ? { style: YELLOW } : {}) },
    plain((event.accountId ?? "-").padEnd(28)), dim(event.detail ?? "")], width));

  const quit = "Ctrl+C stops the server  ";
  // A data directory can be a long absolute path. Elide its front rather than lose the quit hint.
  const pathRoom = Math.max(8, width - quit.length - "  log lines to ".length - 2);
  const path = stats.logPath === null ? null : stats.logPath.length <= pathRoom ? stats.logPath : `...${stats.logPath.slice(-(pathRoom - 3))}`;
  const footerText = `  ${path === null ? "log lines are not being written" : `log lines to ${path}`}`;
  const footer = row([plain(footerText), plain(" ".repeat(Math.max(1, width - footerText.length - quit.length))), plain(quit)], width, REVERSE);

  const blank = row([], width);
  const lines = [header, blank, row([dim("  WORLDS")], width), ...worlds, blank, ...body, blank, row([dim("  EVENTS")], width), ...events];
  while (lines.length < height - 1) lines.push(blank);
  return [...lines.slice(0, height - 1), footer].join("\n");
}

export interface ConsoleHandle {
  /** Draw now instead of waiting for the next second. */
  draw(): void;
  /** Leave the alternate screen and put the cursor back. Safe to call twice. */
  stop(): void;
}
export interface ConsoleOptions {
  stats(): ConsoleStats;
  /** A TTY. `startServerConsole` does not check; the host decides whether a console is wanted at all. */
  stdout?: NodeJS.WriteStream;
  intervalMs?: number;
}

const ENTER = "[?1049h[?25l", LEAVE = "[?25h[?1049l";

/**
 * The terminal half. The alternate screen keeps the scrollback an operator had before they started
 * the server, and the exit handler puts the terminal back even when the process dies badly: a shell
 * left with a hidden cursor on the alternate screen is worse than no console at all.
 */
export function startServerConsole(options: ConsoleOptions): ConsoleHandle {
  const stdout = options.stdout ?? process.stdout;
  let stopped = false;
  const draw = (): void => {
    if (stopped) return;
    const size: ConsoleSize = { columns: stdout.columns || 80, rows: stdout.rows || 24 };
    // Home, then one clear-to-end-of-line per row: redrawing in place is what keeps it from flickering.
    const frame = renderConsole(options.stats(), size).split("\n").map(line => `[2K${line}`).join("\r\n");
    stdout.write(`[H${frame}[J`);
  };
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    stdout.removeListener("resize", draw);
    process.removeListener("exit", stop);
    stdout.write(LEAVE);
  };
  stdout.write(ENTER);
  const timer = setInterval(draw, options.intervalMs ?? 1_000);
  timer.unref?.();
  stdout.on("resize", draw);
  process.on("exit", stop);
  draw();
  return { draw, stop };
}
