import { useSyncExternalStore } from "react";

/*
  The records an author is working through. A list view publishes the ids it is showing, in the
  order and under the filter it is showing them; the record page reads that set to draw its record
  rail and to answer "next" and "previous". So filtering the bestiary to "frog" and opening the first
  one means Alt+Down walks the frogs, not all 510 creatures.

  Keyed by the view route (`creatures/bestiary`), kept in sessionStorage so a reload or a detour
  through Ctrl+K lands back in the same run.
*/

export interface RecordSetEntry { id: string; title: string; subtitle?: string }
export interface RecordSet {
  /** The filter or grouping the set was published under, for the rail's heading. */
  label?: string;
  entries: readonly RecordSetEntry[];
}

const STORAGE = "corealm-codex-record-set:";
const sets = new Map<string, RecordSet>();
const listeners = new Set<() => void>();

function load(key: string): RecordSet | undefined {
  if (sets.has(key)) return sets.get(key);
  try {
    const raw = sessionStorage.getItem(STORAGE + key);
    if (raw) { const parsed = JSON.parse(raw) as RecordSet; if (Array.isArray(parsed.entries)) { sets.set(key, parsed); return parsed; } }
  } catch { /* Storage is optional. */ }
  return undefined;
}

const same = (a: RecordSet | undefined, b: RecordSet): boolean =>
  Boolean(a) && a!.label === b.label && a!.entries.length === b.entries.length && a!.entries.every((entry, index) => entry.id === b.entries[index]!.id && entry.title === b.entries[index]!.title);

export function publishRecordSet(key: string, set: RecordSet): void {
  if (same(load(key), set)) return;
  sets.set(key, set);
  try { sessionStorage.setItem(STORAGE + key, JSON.stringify(set)); } catch { /* A large set may not fit; the in-memory copy still works. */ }
  for (const listener of listeners) listener();
}

export function useRecordSet(key: string | undefined): RecordSet | undefined {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => listeners.delete(listener); },
    () => key ? load(key) : undefined,
  );
}

/** The id `step` places away from `id` in the set, or undefined at either end. */
export function neighbour(set: RecordSet | undefined, id: string, step: 1 | -1): string | undefined {
  if (!set) return undefined;
  const index = set.entries.findIndex(entry => entry.id === id);
  if (index < 0) return set.entries[step > 0 ? 0 : set.entries.length - 1]?.id;
  return set.entries[index + step]?.id;
}

/* ---- list state that should survive opening a record and coming back ---- */

export function readListState<T>(key: string, fallback: T): T {
  try { const raw = sessionStorage.getItem(`corealm-codex-list:${key}`); if (raw) return { ...fallback, ...JSON.parse(raw) as Partial<T> }; } catch { /* optional */ }
  return fallback;
}

export function writeListState(key: string, state: unknown): void {
  try { sessionStorage.setItem(`corealm-codex-list:${key}`, JSON.stringify(state)); } catch { /* optional */ }
}
