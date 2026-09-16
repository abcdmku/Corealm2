import { useSyncExternalStore } from "react";

/*
  The records selected on the current page, shared with the command palette and the single-letter
  hotkeys. CollectionPage writes it as its selection changes and clears it on unmount; anything
  that wants to act on "the selection" reads it. Ids are the record ids; `collection` is the
  served collection they belong to.
*/

export interface Selection { collection: string; ids: readonly string[] }

const EMPTY: Selection = { collection: "", ids: [] };
let current: Selection = EMPTY;
const listeners = new Set<() => void>();

function publish(next: Selection): void {
  if (next.collection === current.collection && next.ids.length === current.ids.length && next.ids.every((id, index) => id === current.ids[index])) return;
  current = next;
  for (const listener of listeners) listener();
}

export function setSelection(collection: string, ids: Iterable<string>): void {
  const list = [...ids];
  publish(list.length ? { collection, ids: list } : EMPTY);
}

/** Only clears when the page that owns the selection is the one clearing it. */
export function clearSelection(collection?: string): void {
  if (collection !== undefined && current.collection !== collection) return;
  publish(EMPTY);
}

export const getSelection = (): Selection => current;
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useSelection(): Selection { return useSyncExternalStore(subscribe, getSelection, getSelection); }
