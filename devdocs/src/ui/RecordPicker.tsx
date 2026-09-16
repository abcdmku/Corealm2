import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { Ban, Plus, Search, X } from "lucide-react";
import { collectionQuery } from "../api/client.js";
import type { ContentRow } from "../model/contracts.js";
import type { RefOption } from "../model/refs.js";
import { contentRows, rowId, rowName } from "../model/rows.js";
import { summarize, type SummaryContext, type ThumbSpec, noContext } from "../model/summaries.js";
import { Thumb } from "./Thumb.js";
import { labelFor } from "./library.js";
import { Button } from "../components/ui/index.js";

/**
 * Pick a record from a collection by name, id or badge text. Rendered as a popover so it can sit
 * inside dense editors (loot grids, recipe rows, set slots) without a page change.
 *
 * Two extra rows are opt-in: "None" at the top (`allowNone` + `onClear`) for optional references,
 * and "Create new…" at the bottom (`onCreate`, also Ctrl+Enter). Kinds with no collection pass
 * `options` instead of `collection`; the same search and keys work over the fixed list, and the
 * picked option arrives as a synthetic `{ id, name }` row.
 */
export interface RecordPickerProps {
  collection: string;
  value?: string;
  onPick: (id: string, record: ContentRow) => void;
  ctx?: SummaryContext;
  trigger: ReactNode;
  exclude?: ReadonlySet<string>;
  placeholder?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Show a "None" row first. A string replaces the row's label. */
  allowNone?: boolean | string;
  onClear?: () => void;
  /** Show a "Create new…" row last (and run it on Ctrl+Enter). */
  onCreate?: () => void | Promise<void>;
  createLabel?: string;
  /** A fixed option list instead of the collection's rows. */
  options?: readonly RefOption[];
}

export function RecordPicker({ collection, value, onPick, ctx = noContext, trigger, exclude, placeholder, open: controlledOpen, onOpenChange, allowNone, onClear, onCreate, createLabel, options }: RecordPickerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => { setUncontrolledOpen(next); onOpenChange?.(next); };
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>{trigger}</Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="popover" align="start" sideOffset={6} collisionPadding={12} onOpenAutoFocus={event => event.preventDefault()}>
        {open && <PickerBody collection={collection} value={value} ctx={ctx} exclude={exclude} placeholder={placeholder} options={options}
          allowNone={allowNone} createLabel={createLabel}
          onPick={(id, record) => { onPick(id, record); setOpen(false); }}
          onClear={onClear && allowNone ? () => { onClear(); setOpen(false); } : undefined}
          onCreate={onCreate ? () => { setOpen(false); void onCreate(); } : undefined}
          onClose={() => setOpen(false)} />}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}

interface Entry { id: string; row: ContentRow; title: string; subtitle?: string; tier?: number; thumb: ThumbSpec; score: number }
type Line = { kind: "none" } | { kind: "row"; entry: Entry } | { kind: "create" };

const LIMIT = 80;

function PickerBody({ collection, value, ctx, exclude, placeholder, options, allowNone, createLabel, onPick, onClear, onCreate, onClose }: {
  collection: string; value?: string; ctx: SummaryContext; exclude?: ReadonlySet<string>; placeholder?: string; options?: readonly RefOption[];
  allowNone?: boolean | string; createLabel?: string;
  onPick: (id: string, record: ContentRow) => void; onClear?: () => void; onCreate?: () => void; onClose: () => void;
}) {
  const query = useQuery({ ...collectionQuery(collection), enabled: !options });
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const idKey = query.data?.collection.idKey ?? "id";
  const total = options ? options.length : query.data ? contentRows(query.data).length : 0;
  const rows = useMemo<Entry[]>(() => {
    const needle = search.trim().toLowerCase();
    const scoreOf = (title: string, id: string, haystack: string): number | undefined => {
      if (!needle) return 0;
      if (!haystack.includes(needle)) return undefined;
      return title.toLowerCase().startsWith(needle) ? 0 : id.toLowerCase().startsWith(needle) ? 1 : title.toLowerCase().includes(needle) ? 2 : 3;
    };
    const scored: Entry[] = options
      ? options.flatMap(option => {
        if (exclude?.has(option.value)) return [];
        const score = scoreOf(option.label, option.value, `${option.label} ${option.value}`.toLowerCase());
        if (score === undefined) return [];
        return [{ id: option.value, row: { id: option.value, name: option.label }, title: option.label, thumb: option.thumb ?? { kind: "glyph", icon: Ban, letter: option.value.slice(0, 2).toUpperCase() }, score }];
      })
      : (query.data ? contentRows(query.data) : []).flatMap(row => {
        const id = rowId(row, idKey);
        if (exclude?.has(id)) return [];
        const summary = summarize(collection, row, ctx);
        const score = scoreOf(summary.title, id, `${summary.title} ${id} ${summary.subtitle ?? ""} ${summary.badges.map(badge => badge.text).join(" ")}`.toLowerCase());
        if (score === undefined) return [];
        return [{ id, row, title: summary.title, subtitle: summary.subtitle, tier: summary.tier, thumb: summary.thumb, score }];
      });
    // A fixed option list keeps its authored order; collection rows sort by match, tier, name.
    const sorted = options && !needle ? scored : scored.sort((a, b) => a.score - b.score || (a.tier ?? 0) - (b.tier ?? 0) || a.title.localeCompare(b.title));
    return sorted.slice(0, LIMIT);
  }, [query.data, search, idKey, exclude, collection, ctx, options]);
  const lines = useMemo<Line[]>(() => [
    ...(onClear && !search.trim() ? [{ kind: "none" } as Line] : []),
    ...rows.map(entry => ({ kind: "row", entry } as Line)),
    ...(onCreate ? [{ kind: "create" } as Line] : []),
  ], [rows, onClear, onCreate, search]);
  useEffect(() => { setActive(0); }, [search]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);
  const choose = (line: Line | undefined) => {
    if (!line) return;
    if (line.kind === "none") onClear?.();
    else if (line.kind === "create") onCreate?.();
    else onPick(line.entry.id, line.entry.row);
  };
  function keys(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => Math.min(lines.length - 1, index + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
    else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && onCreate) { event.preventDefault(); onCreate(); }
    else if (event.key === "Enter") { event.preventDefault(); choose(lines[active]); }
    else if (event.key === "Escape") { event.preventDefault(); onClose(); }
  }
  const noneLabel = typeof allowNone === "string" ? allowNone : "None";
  const loading = !options && query.isPending;
  const loaded = options !== undefined || query.data !== undefined;
  return <>
    <div className="popover-search"><Search size={15} /><input ref={input} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={keys} placeholder={placeholder ?? `Search ${labelFor(collection).toLowerCase()}…`} aria-label={`Search ${labelFor(collection)}`} />{search && <Button variant="ghost" size="icon-sm" aria-label="Clear" onClick={() => setSearch("")}><X size={14} /></Button>}</div>
    <div className="popover-list" ref={listRef} role="listbox">
      {loading && <p className="popover-empty">Loading…</p>}
      {!options && query.isError && <p className="popover-empty">{query.error.message}</p>}
      {loaded && !rows.length && <p className="popover-empty">No matches</p>}
      {lines.map((line, index) => {
        const isActive = index === active;
        if (line.kind === "none") return <button type="button" role="option" aria-selected={value === undefined} data-index={index} data-kind="none" key="none" className={`popover-item popover-item-none${isActive ? " is-active" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => choose(line)}>
          <span className="thumb popover-item-glyph" data-size="s"><Ban size={12} /></span><span>{noneLabel}</span><small>clear</small>
        </button>;
        if (line.kind === "create") return <button type="button" role="option" aria-selected={false} data-index={index} data-kind="create" key="create" className={`popover-item popover-item-create${isActive ? " is-active" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => choose(line)}>
          <span className="thumb popover-item-glyph" data-size="s"><Plus size={12} /></span><span>{createLabel ?? "Create new…"}</span><small><kbd>Ctrl</kbd><kbd>↵</kbd></small>
        </button>;
        const { entry } = line;
        return <button type="button" role="option" aria-selected={entry.id === value} data-index={index} key={entry.id} className={`popover-item${isActive ? " is-active" : ""}`} onMouseEnter={() => setActive(index)} onClick={() => choose(line)}>
          <Thumb spec={entry.thumb} size="s" />
          <span>{entry.title}{entry.tier !== undefined && <span className="muted"> · T{entry.tier}</span>}</span>
          <small>{entry.id}</small>
        </button>;
      })}
    </div>
    <div className="popover-footer"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> pick</span>{onCreate && <span><kbd>Ctrl</kbd><kbd>↵</kbd> new</span>}<span style={{ marginLeft: "auto" }}>{loaded ? `${rows.length}${rows.length === LIMIT ? "+" : ""} of ${total}` : ""}</span></div>
  </>;
}

export function pickerRecordName(row: ContentRow | undefined, id: string): string { return row ? rowName(row) : id; }
