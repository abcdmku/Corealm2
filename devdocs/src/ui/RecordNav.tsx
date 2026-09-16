import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { collectionQuery } from "../api/client.js";
import { neighbour, useRecordSet, type RecordSet } from "../model/recordSet.js";
import { contentRows, rowId, rowName } from "../model/rows.js";
import { useDraftState } from "../model/store.js";

/*
  The record rail: the run of records an author is working through, beside the one being edited.

  Opening a record no longer means leaving the list. The rail shows the set the list published
  (same filter, same order), marks the current and the unsaved records, and moves with:

    Alt+Down / Alt+Up   next / previous record, from anywhere, including inside a field
    J / K               the same, when focus is not in a text control
    Tab                 one stop for the whole list (the current record), then into the record
    the rail's filter   narrows the rail without touching the list's own filter

  Moving keeps the caret where it was: the field that had focus in one record is focused in the
  next, so "type, Enter, Alt+Down" edits the same value down a whole run of records.
*/

export interface RecordNavProps {
  /** The view route the set was published under, e.g. `creatures/bestiary`. */
  setKey: string;
  /** Collection to fall back on when no list has published a set yet. */
  collection: string;
  currentId: string;
  open: (id: string) => void;
}

interface FocusMemo { name: string; nth: number; previous: Element }

const nameOf = (element: Element): string => {
  const labelled = element.getAttribute("aria-labelledby");
  const byId = labelled ? document.getElementById(labelled)?.textContent?.trim() : undefined;
  return byId || element.getAttribute("aria-label")?.trim() || "";
};
const CONTROLS = "input:not([type=hidden]), textarea, select, .ref-chip";

function captureFocus(root: HTMLElement | null): FocusMemo | undefined {
  const active = document.activeElement;
  if (!root || !(active instanceof HTMLElement) || !root.contains(active) || !active.matches(CONTROLS)) return undefined;
  const name = nameOf(active);
  if (!name) return undefined;
  const same = Array.from(root.querySelectorAll(CONTROLS)).filter(element => nameOf(element) === name);
  return { name, nth: Math.max(0, same.indexOf(active)), previous: active };
}

/** Waits for the next record to be the one on screen (the wrapper carries its id), then focuses the same field in it. */
function restoreFocus(id: string, memo: FocusMemo): void {
  const started = performance.now();
  const attempt = () => {
    const root = document.querySelector<HTMLElement>(".record-layout-main");
    const ready = root?.dataset.recordId === id && !root.contains(memo.previous);
    if (!root || !ready) { if (performance.now() - started < 2500) requestAnimationFrame(attempt); return; }
    const matches = Array.from(root.querySelectorAll<HTMLElement>(CONTROLS)).filter(element => nameOf(element) === memo.name);
    const target = matches[Math.min(memo.nth, matches.length - 1)];
    if (target) {
      target.focus({ preventScroll: false });
      target.scrollIntoView({ block: "nearest" });
      if (target instanceof HTMLInputElement) target.select();
      return;
    }
    if (performance.now() - started < 2500) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

const isTextControl = (target: EventTarget | null): boolean => target instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);

export function RecordNav({ setKey, collection, currentId, open }: RecordNavProps) {
  const published = useRecordSet(setKey);
  const fallbackQuery = useQuery({ ...collectionQuery(collection), enabled: !published });
  const set = useMemo<RecordSet | undefined>(() => {
    if (published) return published;
    if (!fallbackQuery.data) return undefined;
    const idKey = fallbackQuery.data.collection.idKey;
    const entries = contentRows(fallbackQuery.data).map(row => ({ id: rowId(row, idKey), title: rowName(row, idKey) }));
    return { entries: entries.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })) };
  }, [published, fallbackQuery.data]);

  // 56 creature names are shared by several definitions; where a title repeats, the id tells them apart.
  const repeated = useMemo(() => {
    const seen = new Map<string, number>();
    for (const entry of set?.entries ?? []) seen.set(entry.title, (seen.get(entry.title) ?? 0) + 1);
    return seen;
  }, [set]);
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const entries = set?.entries ?? [];
    return needle ? entries.filter(entry => `${entry.title} ${entry.id} ${entry.subtitle ?? ""}`.toLowerCase().includes(needle)) : entries;
  }, [set, filter]);
  const shownSet = useMemo<RecordSet>(() => ({ entries: shown }), [shown]);
  const position = shown.findIndex(entry => entry.id === currentId);
  const dirty = useDirtyIds(collection);

  const listRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ shownSet, currentId, open });
  latest.current = { shownSet, currentId, open };

  /** Commit the open edit, move, and put the caret back on the same field in the next record. */
  const go = (id: string | undefined) => {
    if (!id || id === latest.current.currentId) return;
    const main = document.querySelector<HTMLElement>(".record-layout-main");
    const memo = captureFocus(main);
    // Fields commit on blur, so blurring first lands the value in this record's draft.
    if (document.activeElement instanceof HTMLElement && main?.contains(document.activeElement)) document.activeElement.blur();
    latest.current.open(id);
    if (memo) restoreFocus(id, memo);
  };
  const step = (by: 1 | -1) => go(neighbour(latest.current.shownSet, latest.current.currentId, by));

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey) return;
      const down = event.key === "ArrowDown", up = event.key === "ArrowUp";
      if (event.altKey && (down || up)) { event.preventDefault(); step(down ? 1 : -1); return; }
      if (event.altKey || event.shiftKey || isTextControl(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k") { event.preventDefault(); step(key === "j" ? 1 : -1); }
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  // `step` reads everything through `latest`, so the listener is installed once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the current record in view as the author walks the run. A step to a neighbour that is already
  // on screen moves nothing; a record off screen (a jump, a first render) is brought to the middle.
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>("[aria-current='true']");
    if (!list || !current) return;
    const box = list.getBoundingClientRect(), row = current.getBoundingClientRect();
    if (row.top >= box.top && row.bottom <= box.bottom) return;
    const near = row.bottom > box.top - row.height * 2 && row.top < box.bottom + row.height * 2;
    list.scrollTop += near ? (row.top < box.top ? row.top - box.top : row.bottom - box.bottom) : row.top - box.top - box.height / 2 + row.height / 2;
  }, [currentId, shown]);

  const onListKeys = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); step(event.key === "ArrowDown" ? 1 : -1); }
    else if (event.key === "Escape" && filter) { event.preventDefault(); setFilter(""); }
  };

  return <nav className="record-nav" aria-label="Records in this list">
    <div className="record-nav-head">
      <label className="record-nav-filter"><Search size={13} />
        <input ref={filterRef} value={filter} placeholder={set?.label ? `Filter ${set.label}` : "Filter records"} aria-label="Filter records" onChange={event => setFilter(event.target.value)} onKeyDown={onListKeys} />
        {filter && <button type="button" className="icon-button" aria-label="Clear filter" onClick={() => setFilter("")}><X size={12} /></button>}
      </label>
      <div className="record-nav-step">
        <span className="record-nav-count">{position >= 0 ? `${position + 1} of ${shown.length}` : `${shown.length}`}</span>
        <button type="button" className="icon-button" aria-label="Previous record (Alt+Up)" title="Previous record · Alt+↑ or K" disabled={position <= 0} onClick={() => step(-1)}><ChevronUp size={14} /></button>
        <button type="button" className="icon-button" aria-label="Next record (Alt+Down)" title="Next record · Alt+↓ or J" disabled={position < 0 || position >= shown.length - 1} onClick={() => step(1)}><ChevronDown size={14} /></button>
      </div>
    </div>
    <div className="record-nav-list" ref={listRef} role="list" onKeyDown={onListKeys}>
      {!set && <p className="record-nav-empty">Loading…</p>}
      {set && !shown.length && <p className="record-nav-empty">No records match.</p>}
      {shown.map(entry => <button key={entry.id} type="button" role="listitem" className="record-nav-item" tabIndex={entry.id === currentId ? 0 : -1} aria-current={entry.id === currentId ? "true" : undefined} title={entry.id} onClick={() => go(entry.id)}>
        <span className="record-nav-title">{entry.title}</span>
        {(entry.subtitle || (repeated.get(entry.title) ?? 0) > 1) && <span className="record-nav-sub">{(repeated.get(entry.title) ?? 0) > 1 ? entry.id : entry.subtitle}</span>}
        {dirty.has(entry.id) && <span className="record-nav-dirty" aria-label="Unsaved" />}
      </button>)}
    </div>
  </nav>;
}

/** Ids with unsaved drafts in a collection, for the rail's dots. */
function useDirtyIds(collection: string): ReadonlySet<string> {
  const state = useDraftState();
  return useMemo(() => new Set([...state.entries.values()].filter(entry => entry.collection === collection && (entry.dirty || entry.conflict)).map(entry => entry.id)), [state, collection]);
}
