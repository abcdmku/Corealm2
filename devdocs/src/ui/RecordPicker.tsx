import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { collectionQuery } from "../api/client.js";
import type { ContentRow } from "../model/contracts.js";
import { contentRows, rowId, rowName } from "../model/rows.js";
import { summarize, type SummaryContext, noContext } from "../model/summaries.js";
import { Thumb } from "./Thumb.js";
import { labelFor } from "./library.js";

/**
 * Pick a record from a collection by name, id or badge text. Rendered as a popover so it can sit
 * inside dense editors (loot grids, recipe rows, set slots) without a page change.
 */
export function RecordPicker({ collection, value, onPick, ctx = noContext, trigger, exclude, placeholder, open: controlledOpen, onOpenChange }: {
  collection: string;
  value?: string;
  onPick: (id: string, record: ContentRow) => void;
  ctx?: SummaryContext;
  trigger: ReactNode;
  exclude?: ReadonlySet<string>;
  placeholder?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => { setUncontrolledOpen(next); onOpenChange?.(next); };
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>{trigger}</Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="popover" align="start" sideOffset={6} collisionPadding={12} onOpenAutoFocus={event => event.preventDefault()}>
        {open && <PickerBody collection={collection} value={value} ctx={ctx} exclude={exclude} placeholder={placeholder} onPick={(id, record) => { onPick(id, record); setOpen(false); }} onClose={() => setOpen(false)} />}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}

function PickerBody({ collection, value, ctx, exclude, placeholder, onPick, onClose }: { collection: string; value?: string; ctx: SummaryContext; exclude?: ReadonlySet<string>; placeholder?: string; onPick: (id: string, record: ContentRow) => void; onClose: () => void }) {
  const query = useQuery(collectionQuery(collection));
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const idKey = query.data?.collection.idKey ?? "id";
  const rows = useMemo(() => {
    const all = query.data ? contentRows(query.data) : [];
    const needle = search.trim().toLowerCase();
    const scored = all.flatMap(row => {
      const id = rowId(row, idKey);
      if (exclude?.has(id)) return [];
      const summary = summarize(collection, row, ctx);
      const haystack = `${summary.title} ${id} ${summary.subtitle ?? ""} ${summary.badges.map(badge => badge.text).join(" ")}`.toLowerCase();
      if (!needle) return [{ row, id, summary, score: 0 }];
      if (!haystack.includes(needle)) return [];
      const score = summary.title.toLowerCase().startsWith(needle) ? 0 : id.toLowerCase().startsWith(needle) ? 1 : summary.title.toLowerCase().includes(needle) ? 2 : 3;
      return [{ row, id, summary, score }];
    });
    return scored.sort((a, b) => a.score - b.score || (a.summary.tier ?? 0) - (b.summary.tier ?? 0) || a.summary.title.localeCompare(b.summary.title)).slice(0, 80);
  }, [query.data, search, idKey, exclude, collection, ctx]);
  useEffect(() => { setActive(0); }, [search]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);
  function keys(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => Math.min(rows.length - 1, index + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
    else if (event.key === "Enter") { event.preventDefault(); const row = rows[active]; if (row) onPick(row.id, row.row); }
    else if (event.key === "Escape") { event.preventDefault(); onClose(); }
  }
  return <>
    <div className="popover-search"><Search size={15} /><input ref={input} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={keys} placeholder={placeholder ?? `Search ${labelFor(collection).toLowerCase()}…`} aria-label={`Search ${labelFor(collection)}`} />{search && <button type="button" className="icon-button" aria-label="Clear" onClick={() => setSearch("")}><X size={14} /></button>}</div>
    <div className="popover-list" ref={listRef} role="listbox">
      {query.isPending && <p className="popover-empty">Loading…</p>}
      {query.isError && <p className="popover-empty">{query.error.message}</p>}
      {query.data && !rows.length && <p className="popover-empty">No matches</p>}
      {rows.map((entry, index) => <button type="button" role="option" aria-selected={entry.id === value} data-index={index} key={entry.id} className={`popover-item${index === active ? " is-active" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => onPick(entry.id, entry.row)}>
        <Thumb spec={entry.summary.thumb} size="s" />
        <span>{entry.summary.title}{entry.summary.tier !== undefined && <span className="muted"> · T{entry.summary.tier}</span>}</span>
        <small>{entry.id}</small>
      </button>)}
    </div>
    <div className="popover-footer"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> pick</span><span style={{ marginLeft: "auto" }}>{query.data ? `${rows.length}${rows.length === 80 ? "+" : ""} of ${contentRows(query.data).length}` : ""}</span></div>
  </>;
}

export function pickerRecordName(row: ContentRow | undefined, id: string): string { return row ? rowName(row) : id; }
