/*
  Numbers and times as an operator reads them. One place, so a "last seen" in the player rail and a
  "granted" in the roles table are written the same way.
*/

const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

/** "just now", "12 m ago", "3 d ago". Past and future both read naturally. */
export function since(at: number | null | undefined, now = Date.now()): string {
  if (at === null || at === undefined || !Number.isFinite(at)) return "never";
  const delta = now - at, ahead = delta < 0, gap = Math.abs(delta);
  if (gap < 45 * SECOND) return "just now";
  const value = gap >= DAY ? `${Math.round(gap / DAY)} d` : gap >= HOUR ? `${Math.round(gap / HOUR)} h` : `${Math.round(gap / MINUTE)} m`;
  return ahead ? `in ${value}` : `${value} ago`;
}

/** The full moment, for a title attribute beside a relative time. */
export function moment(at: number | null | undefined): string {
  if (at === null || at === undefined || !Number.isFinite(at)) return "never";
  return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** A span of seconds as playtime: "4 h 12 m", "38 m", "12 s". */
export function duration(seconds: number | null | undefined): string {
  if (!Number.isFinite(seconds ?? NaN) || (seconds as number) < 0) return "—";
  const total = Math.round(seconds as number);
  if (total < 60) return `${total} s`;
  const hours = Math.floor(total / 3600), minutes = Math.round((total % 3600) / 60);
  return hours ? `${hours} h ${minutes} m` : `${minutes} m`;
}

export function bytes(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return "—";
  const size = Math.abs(value as number);
  if (size < 1024) return `${Math.round(size)} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let scaled = size / 1024, unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) { scaled /= 1024; unit++; }
  return `${scaled < 10 ? scaled.toFixed(1) : Math.round(scaled)} ${units[unit]}`;
}

/** Milliseconds with one decimal under ten, none above, so a column of tick times reads down. */
export function ms(value: number | null | undefined): string {
  if (!Number.isFinite(value ?? NaN)) return "—";
  const number = value as number;
  return `${number < 10 ? Math.round(number * 10) / 10 : Math.round(number)} ms`;
}

export const count = (value: number | null | undefined): string => Number.isFinite(value ?? NaN) ? (value as number).toLocaleString() : "—";

/** A 0-to-1 share as whole percent. Event loop utilization and the like. */
export const percent = (value: number | null | undefined): string => Number.isFinite(value ?? NaN) ? `${Math.round((value as number) * 100)}%` : "—";

/** A 64 character content hash, short enough to read and long enough to tell two apart. */
export const shortRevision = (revision: string | null | undefined): string => revision ? revision.slice(0, 12) : "—";

/** A datetime-local input value from epoch milliseconds, in the reader's own zone. */
export function toLocalInput(at: number): string {
  const date = new Date(at - new Date(at).getTimezoneOffset() * MINUTE);
  return date.toISOString().slice(0, 16);
}
/** The reverse, or null when the box is empty or unparseable. */
export function fromLocalInput(value: string): number | null {
  if (!value.trim()) return null;
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : null;
}
