import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import type { Schema } from "../../../../game/src/content/schema/core.js";
import type { ContentRow } from "../../model/contracts.js";
import { getPath } from "../../model/draft.js";
import type { RecordRef, Resolved } from "../../model/origin.js";
import { rowId } from "../../model/rows.js";
import { draftKey, draftStore, type DraftStore, type RecordEntry } from "../../model/store.js";
import { ChoiceField, Field, NumberField, RefField, TextField, ToggleField, evaluateNumber, formatNumber, type NumberRules } from "../field/index.js";
import { usePeek } from "../Peek.js";
import { countText, defaultColumns, defaultVisible, isMixed, sortRows, type GridColumn } from "./columns.js";
import { applyEdit, type CellEdit } from "./edits.js";
import { Button, Checkbox } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";

/*
  One collection as an editable table (docs/devdocs-inputs.md §3.7). Rows are records, columns are
  the schema's scalar and reference fields, cells are the field components in a compact skin with
  the header as the label. Edits go through the draft store one commit per record, so the shell
  bar counts changed records, Ctrl+Z steps back one commit and Save all writes one transaction.

  Keys (Grist/Airtable, §Keyboard model): arrows move the active cell; typing, Enter or F2 edit;
  Enter commits and moves down; Tab commits and moves right; Escape cancels; Space peeks a
  reference or toggles the row; Shift+Up/Down extends the row selection; Ctrl+A selects every
  visible row; Ctrl+C / Ctrl+V copy and paste one cell; Ctrl+Enter opens the record. With several
  rows selected an edit lands on all of them and a disagreeing cell reads "Mixed" and takes `+10`.
*/

export interface RecordGridProps {
  collection: string;
  rows: readonly ContentRow[];
  schema: Schema;
  idKey?: string;
  /** The revision the rows were loaded with; drafts are opened against it. */
  revision: string;
  columns?: readonly GridColumn[];
  selected: ReadonlySet<string>;
  onSelect: (ids: Set<string>) => void;
  onOpen: (id: string) => void;
  readOnly?: boolean;
  /** Generated rows, for instance, are shown but never edited or selected. */
  isRowReadOnly?: (row: ContentRow) => boolean;
  /** Hook for derived values: when it returns a chain the cell draws the provenance dot and revert. */
  resolveCell?: (row: ContentRow, path: readonly string[]) => Resolved<unknown> | undefined;
  store?: DraftStore;
}

interface GridRecord { id: string; row: ContentRow; draft: ContentRow; entry?: RecordEntry; locked: boolean }
interface Active { row: number; col: number }
type Sort = { key: string; direction: "asc" | "desc" } | undefined;

const ROW = 28;

const TH = "flex h-7 min-w-0 items-center gap-1 border-r border-border-subtle px-2.5 text-left text-[11px] font-semibold whitespace-nowrap text-muted-foreground select-none [&_small]:font-normal [&_small]:text-faint [&_svg]:flex-none [&_svg]:text-primary [&>span]:min-w-0 [&>span]:truncate";
/**
 * A cell holds a field component in a compact skin: the column header is the label, the control
 * fills the cell and stays borderless until it has focus, and an error floats under the cell
 * instead of growing the row.
 */
const CELL = cn(
  "relative flex h-7 min-w-0 items-center border-r border-b border-border-subtle px-[3px] text-xs outline-none",
  "focus:z-1 focus:shadow-[inset_0_0_0_1px_var(--accent)] focus-within:z-1 data-dirty:shadow-[inset_2px_0_0_var(--accent)] data-dirty:focus:shadow-[inset_2px_0_0_var(--accent),inset_0_0_0_1px_var(--accent)] data-mixed:text-muted-foreground",
  "[&_.field]:w-full [&_.field]:min-w-0 [&_.field-label]:sr-only [&_.field-control]:min-h-6 [&_.field-control]:gap-[3px] [&_.field-dot]:flex-none [&_.field-revert]:flex-none [&_.field-toggle]:pl-1 [&_.field-static]:px-[7px]",
  "[&_.field-input]:h-6 [&_.field-input]:w-full [&_.field-input]:max-w-none [&_.field-input]:border-transparent [&_.field-input]:bg-transparent [&_.field-input]:px-1.5 [&_.field-input]:shadow-none [&_.field-input_input]:px-0 [&_.field-input:focus-within]:border-ring [&_.field-input:focus-within]:bg-background [&_.field-input[data-invalid]]:border-destructive [&_.field-input_input::placeholder]:[text-align:inherit]",
  "[&_.field-select]:h-6 [&_.field-select]:border-transparent [&_.field-select]:bg-transparent [&_.field-select]:pr-6 [&_.field-select]:pl-1.5 [&_.field-select]:shadow-none [&_.field-select:focus-visible]:border-ring [&_.field-select:focus-visible]:bg-background [&_.field-select[aria-invalid=true]]:border-destructive [&_[data-slot=native-select]]:w-full",
  "[&_.ref-control]:w-full [&_.ref-control]:flex-1 [&_.ref-chip]:h-[22px] [&_.ref-chip]:min-w-0 [&_.ref-chip]:flex-1",
  "[&_.field-error]:absolute [&_.field-error]:top-full [&_.field-error]:left-0 [&_.field-error]:z-3 [&_.field-error]:rounded-sm [&_.field-error]:border [&_.field-error]:border-destructive [&_.field-error]:bg-card [&_.field-error]:px-1.5 [&_.field-error]:py-0.5 [&_.field-error]:whitespace-nowrap",
);
const CHECK_COLUMN = 28;
const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function readVisible(collection: string, columns: readonly GridColumn[]): string[] {
  try {
    const raw = localStorage.getItem(`corealm-grid-columns:${collection}`);
    if (raw) { const parsed = JSON.parse(raw) as unknown; if (Array.isArray(parsed)) { const known = new Set(columns.map(column => column.key)); const kept = parsed.filter((key): key is string => typeof key === "string" && known.has(key)); if (kept.length) return kept; } }
  } catch { /* optional */ }
  return defaultVisible(columns);
}

export function RecordGrid({ collection, rows, schema, idKey = "id", revision, columns: givenColumns, selected, onSelect, onOpen, readOnly = false, isRowReadOnly, resolveCell, store = draftStore }: RecordGridProps) {
  const allColumns = useMemo(() => givenColumns ?? defaultColumns(schema), [givenColumns, schema]);
  const [visible, setVisible] = useState<string[]>(() => readVisible(collection, allColumns));
  useEffect(() => { try { localStorage.setItem(`corealm-grid-columns:${collection}`, JSON.stringify(visible)); } catch { /* optional */ } }, [collection, visible]);
  const shown = useMemo(() => allColumns.filter(column => visible.includes(column.key)), [allColumns, visible]);
  const [sort, setSort] = useState<Sort>(undefined);
  const [active, setActive] = useState<Active | undefined>(undefined);
  const pendingFocus = useRef<Active | undefined>(undefined);
  const anchor = useRef<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const peek = usePeek();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const records = useMemo<GridRecord[]>(() => rows.map(row => {
    const id = rowId(row, idKey);
    const entry = state.entries.get(draftKey(collection, id));
    return { id, row, draft: entry?.draft ?? row, entry, locked: readOnly || Boolean(isRowReadOnly?.(row)) };
  }), [rows, idKey, state.entries, collection, readOnly, isRowReadOnly]);
  const list = useMemo(() => {
    if (!sort) return records;
    const column = allColumns.find(candidate => candidate.key === sort.key);
    return column ? sortRows(records, record => getPath(record.draft, column.path), sort.direction) : records;
  }, [records, sort, allColumns]);
  const selectedRecords = useMemo(() => list.filter(record => selected.has(record.id)), [list, selected]);
  const selectableIds = useMemo(() => list.filter(record => !record.locked).map(record => record.id), [list]);

  const virtualizer = useVirtualizer({ count: list.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW, overscan: 12, getItemKey: index => list[index]?.id ?? index });
  const items = virtualizer.getVirtualItems();

  // Focus follows the active cell once it is in the DOM; rows outside the window are scrolled in first.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || !rootRef.current) return;
    const cell = rootRef.current.querySelector<HTMLElement>(`[data-row="${target.row}"][data-col="${target.col}"]`);
    if (cell) { pendingFocus.current = undefined; cell.focus({ preventScroll: true }); cell.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    else virtualizer.scrollToIndex(target.row, { align: "auto" });
  }, [active, items, virtualizer]);

  const go = useCallback((row: number, col: number) => {
    if (!list.length || !shown.length) return;
    const next = { row: Math.max(0, Math.min(list.length - 1, row)), col: Math.max(0, Math.min(shown.length - 1, col)) };
    pendingFocus.current = next;
    setActive(previous => previous && previous.row === next.row && previous.col === next.col ? { ...next } : next);
  }, [list.length, shown.length]);

  const select = useCallback((ids: Iterable<string>) => onSelect(new Set([...ids].filter(id => selectableIds.includes(id)))), [onSelect, selectableIds]);
  const toggleRow = useCallback((index: number, range: boolean) => {
    const record = list[index];
    if (!record || record.locked) return;
    const next = new Set(selected);
    if (range && anchor.current !== undefined) {
      for (let cursor = Math.min(anchor.current, index); cursor <= Math.max(anchor.current, index); cursor++) { const candidate = list[cursor]; if (candidate && !candidate.locked) next.add(candidate.id); }
    } else { if (next.has(record.id)) next.delete(record.id); else next.add(record.id); anchor.current = index; }
    select(next);
  }, [list, selected, select]);
  const extendTo = useCallback((from: number, to: number) => {
    const start = anchor.current ?? from;
    anchor.current = start;
    const next = new Set<string>();
    for (let cursor = Math.min(start, to); cursor <= Math.max(start, to); cursor++) { const candidate = list[cursor]; if (candidate && !candidate.locked) next.add(candidate.id); }
    select(next);
  }, [list, select]);

  const edit = useCallback((index: number, column: GridColumn, change: CellEdit) => {
    const record = list[index];
    if (!record || record.locked) return;
    const multi = selected.size > 1 && selected.has(record.id);
    const targets = (multi ? selectedRecords : [record]).filter(candidate => !candidate.locked).map(candidate => ({ id: candidate.id, row: candidate.row }));
    applyEdit({ store, collection, idKey, revision, schema }, targets, column.path, change);
  }, [list, selected, selectedRecords, store, collection, idKey, revision, schema]);

  // Which columns disagree across the selection, read for the active row only.
  const mixedKeys = useMemo(() => {
    const record = active ? list[active.row] : undefined;
    if (!record || selected.size < 2 || !selected.has(record.id)) return new Set<string>();
    return new Set(shown.filter(column => isMixed(selectedRecords.map(candidate => getPath(candidate.draft, column.path)))).map(column => column.key));
  }, [active, list, selected, selectedRecords, shown]);

  const cellAt = (target: EventTarget | null): HTMLElement | undefined => target instanceof HTMLElement ? target.closest<HTMLElement>("[role=gridcell]") ?? undefined : undefined;
  const position = (cell: HTMLElement): Active => ({ row: Number(cell.dataset.row), col: Number(cell.dataset.col) });

  const startEdit = (cell: HTMLElement, column: GridColumn, record: GridRecord) => {
    if (column.kind === "count" || column.kind === "static") { onOpen(record.id); return; }
    if (record.locked) return;
    if (column.kind === "ref") { cell.querySelector<HTMLElement>(".ref-edit, .ref-chip")?.click(); return; }
    cell.querySelector<HTMLElement>("input, select, textarea")?.focus();
  };

  // Enter and Tab while a control is editing: blur commits (the field's own commit point), then move.
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.target as Node)) return;
    const cell = cellAt(event.target);
    if (!cell || event.target === cell) return;
    const { row, col } = position(cell);
    const column = shown[col];
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && column?.kind !== "ref") {
      event.preventDefault(); event.stopPropagation();
      (event.target as HTMLElement).blur();
      go(row + (event.shiftKey ? -1 : 1), col);
    } else if (event.key === "Tab") {
      event.preventDefault(); event.stopPropagation();
      (event.target as HTMLElement).blur();
      go(row, col + (event.shiftKey ? -1 : 1));
    } else if (event.key === "Escape") {
      // The control restores its buffer first; focus then returns to the cell.
      requestAnimationFrame(() => cell.focus({ preventScroll: true }));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.target as Node)) return;
    const cell = cellAt(event.target);
    if (!cell || event.target !== cell) return;
    const { row, col } = position(cell);
    const column = shown[col];
    const record = list[row];
    if (!column || !record) return;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key;
    const stop = () => { event.preventDefault(); event.stopPropagation(); };
    if (key === "ArrowDown" || key === "ArrowUp") { stop(); const next = row + (key === "ArrowDown" ? 1 : -1); if (event.shiftKey) extendTo(row, Math.max(0, Math.min(list.length - 1, next))); go(next, col); return; }
    if (key === "ArrowRight") { stop(); go(row, col + 1); return; }
    if (key === "ArrowLeft") { stop(); go(row, col - 1); return; }
    if (key === "Home") { stop(); go(modifier ? 0 : row, 0); return; }
    if (key === "End") { stop(); go(modifier ? list.length - 1 : row, shown.length - 1); return; }
    if (key === "PageDown") { stop(); go(row + 20, col); return; }
    if (key === "PageUp") { stop(); go(row - 20, col); return; }
    if (key === "Enter" && modifier) { stop(); onOpen(record.id); return; }
    if (key === "Enter" || key === "F2") { stop(); startEdit(cell, column, record); return; }
    if (key === " ") {
      stop();
      if (column.kind === "ref" && !record.locked) { cell.querySelector<HTMLElement>(".ref-chip")?.click(); return; }
      if (column.kind === "boolean" && !record.locked) { cell.querySelector<HTMLInputElement>("input[type=checkbox]")?.click(); return; }
      toggleRow(row, event.shiftKey);
      return;
    }
    if (key === "Escape") { if (selected.size) { stop(); select([]); } return; }
    if (modifier && key.toLowerCase() === "a") { stop(); select(selectableIds); return; }
    if (modifier && key.toLowerCase() === "c") {
      stop();
      const value = getPath(record.draft, column.path);
      void navigator.clipboard?.writeText(value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value));
      return;
    }
    if (modifier && key.toLowerCase() === "v") {
      if (record.locked) return;
      stop();
      void navigator.clipboard?.readText().then(text => {
        const pasted = parsePaste(text, column);
        if (pasted !== undefined) edit(row, column, { kind: "set", value: pasted.value });
      });
      return;
    }
    if ((key === "Delete" || key === "Backspace") && column.spec.optional && !record.locked && (column.kind === "text" || column.kind === "number" || column.kind === "choice" || column.kind === "ref")) {
      stop(); edit(row, column, { kind: "set", value: undefined }); return;
    }
    // A printable character starts editing; focus moves during keydown so the character lands in the control.
    if (!modifier && !event.altKey && key.length === 1 && !record.locked && (column.kind === "text" || column.kind === "number" || column.kind === "choice")) startEdit(cell, column, record);
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const cell = cellAt(event.target);
    if (!cell) return;
    const next = position(cell);
    setActive(previous => previous && previous.row === next.row && previous.col === next.col ? previous : next);
  };

  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    const cell = cellAt(event.target);
    if (!cell) return;
    const { row } = position(cell);
    if (event.ctrlKey || event.metaKey) { event.preventDefault(); toggleRow(row, false); }
    else if (event.shiftKey) { event.preventDefault(); toggleRow(row, true); }
  };

  const toggleSort = (key: string) => setSort(previous => previous?.key !== key ? { key, direction: "asc" } : previous.direction === "asc" ? { key, direction: "desc" } : undefined);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selected.has(id));
  const template = `${CHECK_COLUMN}px ${shown.map(column => `${column.width}px`).join(" ")} minmax(0, 1fr)`;

  return <div className="flex max-w-full min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card" ref={rootRef} onKeyDownCapture={onKeyDownCapture} onKeyDown={onKeyDown} onFocus={onFocus} onMouseDown={onMouseDown}>
    <div className="flex h-[30px] items-center gap-2 border-b border-border-subtle pr-1.5 pl-2.5 text-[11px] text-muted-foreground">
      <span className="min-w-0 flex-1 truncate font-mono">{list.length} {list.length === 1 ? "row" : "rows"}{selected.size ? ` · ${selected.size} selected` : ""}{sort ? ` · sorted by ${allColumns.find(column => column.key === sort.key)?.label.toLowerCase() ?? sort.key}` : ""}</span>
      <ColumnChooser columns={allColumns} visible={visible} onChange={setVisible} />
    </div>
    <div className="relative max-h-[calc(100dvh-250px)] min-h-40 overflow-auto [scrollbar-width:thin]" ref={scrollRef}>
      <div className="w-max min-w-full" role="grid" aria-rowcount={list.length} aria-colcount={shown.length} aria-multiselectable style={{ "--rg-cols": template } as CSSProperties}>
        <div className="sticky top-0 z-2 grid h-7 grid-cols-(--rg-cols) border-b border-border bg-secondary" role="row">
          <span className={cn(TH, "justify-center px-0")} role="columnheader">
            {!readOnly && selectableIds.length > 0 && <Checkbox aria-label={allSelected ? "Clear selection" : "Select all rows"} checked={allSelected} onCheckedChange={() => select(allSelected ? [] : selectableIds)} />}
          </span>
          {shown.map(column => <button key={column.key} type="button" role="columnheader" className={cn(TH, column.kind === "number" && "justify-end", "cursor-pointer hover:bg-accent hover:text-foreground aria-[sort=ascending]:text-foreground aria-[sort=descending]:text-foreground")} aria-sort={sort?.key === column.key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"} title={column.spec.help ? `${column.label} · ${column.spec.help}` : column.label} onClick={() => toggleSort(column.key)}>
            <span>{column.label}</span>{column.spec.unit && <small>{column.spec.unit}</small>}
            {sort?.key === column.key && (sort.direction === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
          </button>)}
          <span className={cn(TH, "border-r-0")} role="columnheader" aria-hidden />
        </div>
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {items.map(item => {
            const record = list[item.index]!;
            const isSelected = selected.has(record.id);
            return <div key={item.key} role="row" className="absolute top-0 left-0 grid w-full grid-cols-(--rg-cols) hover:bg-accent data-locked:text-muted-foreground data-selected:bg-selected" aria-rowindex={item.index + 1} aria-selected={isSelected || undefined} data-selected={isSelected || undefined} data-locked={record.locked || undefined} style={{ transform: `translateY(${item.start}px)`, height: item.size }}>
              <span className={cn(CELL, "justify-center px-0")} role="gridcell">
                {!record.locked && <Checkbox aria-label={`Select ${record.id}`} checked={isSelected} tabIndex={-1} onClick={event => { event.preventDefault(); toggleRow(item.index, event.shiftKey); }} />}
              </span>
              {shown.map((column, col) => {
                const isActive = active?.row === item.index && active.col === col;
                const value = getPath(record.draft, column.path);
                const dirty = Boolean(record.entry?.dirty && !same(getPath(record.entry.base, column.path), value));
                return <Cell key={column.key} row={item.index} col={col} column={column} record={record} value={value} active={isActive} dirty={dirty} mixed={isActive && mixedKeys.has(column.key)}
                  resolved={resolveCell?.(record.draft, column.path)} onEdit={change => edit(item.index, column, change)} onOpen={() => onOpen(record.id)}
                  onOpenRef={ref => peek.open(ref)} />;
              })}
              <span className={cn(CELL, "border-r-0")} role="gridcell" aria-hidden />
            </div>;
          })}
        </div>
      </div>
    </div>
  </div>;
}

/** What a pasted string becomes for a column, or undefined when it does not fit. */
export function parsePaste(text: string, column: GridColumn): { value: unknown } | undefined {
  const trimmed = text.trim();
  switch (column.kind) {
    case "number": { const result = evaluateNumber(trimmed); return result.ok ? { value: result.value } : undefined; }
    case "text": return { value: text.replace(/\r?\n/g, " ") };
    case "choice": { const choice = column.spec.choices?.find(candidate => String(candidate) === trimmed); return choice === undefined ? undefined : { value: choice }; }
    case "ref": return trimmed ? { value: trimmed } : undefined;
    case "boolean": return /^(true|yes|1)$/i.test(trimmed) ? { value: true } : /^(false|no|0)$/i.test(trimmed) ? { value: false } : undefined;
    default: return undefined;
  }
}

interface CellProps {
  row: number; col: number; column: GridColumn; record: GridRecord; value: unknown;
  active: boolean; dirty: boolean; mixed: boolean; resolved?: Resolved<unknown>;
  onEdit: (change: CellEdit) => void; onOpen: () => void; onOpenRef: (ref: RecordRef) => void;
}

function Cell({ row, col, column, record, value, active, dirty, mixed, resolved, onEdit, onOpen, onOpenRef }: CellProps) {
  const locked = record.locked;
  const rules: NumberRules = { integer: column.spec.integer, min: column.spec.min, max: column.spec.max, step: column.spec.step };
  const set = (next: unknown) => onEdit({ kind: "set", value: next });
  const revert = resolved && !locked ? (next: unknown) => set(next) : undefined;
  let body: ReactNode;
  if (column.kind === "count") body = <button type="button" className="h-6 min-w-0 flex-1 cursor-pointer rounded-sm px-[7px] text-left font-mono text-[11px] text-muted-foreground hover:bg-accent hover:text-link" tabIndex={-1} onClick={onOpen} title="Open record">{countText(value, column.spec)}</button>;
  else if (column.kind === "static" || locked) body = <span className={cn("min-w-0 flex-1 truncate px-[7px]", column.spec.readOnly && "font-mono text-[11px] text-muted-foreground")} title={typeof value === "string" ? value : undefined}>{staticText(value, column)}</span>;
  else if (column.kind === "ref") body = <>
    <RefField kind={column.spec.ref} value={mixed ? undefined : typeof value === "string" ? value : undefined} onChange={id => set(id)} label={column.label} optional={column.spec.optional} compact resolved={resolved as Resolved<string | undefined> | undefined} onRevert={revert ? () => revert(resolved?.chain[1]?.value) : undefined} onOpenRef={onOpenRef} />
    {mixed && <span className="ml-0.5 flex-none text-[11px] text-muted-foreground" title="Selected records disagree">Mixed</span>}
  </>;
  else body = <Field label={column.label} compact mixed={mixed} resolved={resolved} onRevert={revert} onOpenRef={onOpenRef} unit={column.spec.unit}>
    {column.kind === "number" && <NumberField value={typeof value === "number" ? value : undefined} mixed={mixed} onChange={next => set(next)} onMixedEdit={(_, op) => onEdit({ kind: "op", op, rules })} integer={column.spec.integer} min={column.spec.min} max={column.spec.max} step={column.spec.step} optional={column.spec.optional} width="full" ariaLabel={column.label} />}
    {column.kind === "text" && <TextField value={mixed ? "" : typeof value === "string" ? value : value === undefined || value === null ? "" : String(value)} placeholder={mixed ? "Mixed" : column.spec.optional ? "—" : undefined} onChange={next => set(column.spec.optional && next === "" ? undefined : next)} width="full" ariaLabel={column.label} />}
    {column.kind === "choice" && <ChoiceField value={mixed ? undefined : value === undefined || value === null ? undefined : String(value)} options={(column.spec.choices ?? []).map(choice => ({ value: String(choice), label: String(choice) }))} allowEmpty={column.spec.optional ? "None" : mixed ? "Mixed" : undefined} width="full" ariaLabel={column.label}
      onChange={next => { if (next === undefined && !column.spec.optional) return; set(next === undefined ? undefined : coerceChoice(next, column)); }} />}
    {column.kind === "boolean" && <ToggleField value={Boolean(value)} onChange={next => set(next)} ariaLabel={column.label} />}
  </Field>;
  return <div role="gridcell" className={CELL} tabIndex={active ? 0 : -1} data-row={row} data-col={col} data-kind={column.kind} data-active={active || undefined} data-dirty={dirty || undefined} data-mixed={mixed || undefined} data-locked={locked || undefined}
    aria-colindex={col + 1} aria-readonly={locked || column.kind === "static" || column.kind === "count" || undefined}
    onDoubleClick={column.kind === "static" || column.kind === "count" || locked ? onOpen : undefined}>
    {body}
  </div>;
}

function staticText(value: unknown, column: GridColumn): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "number") return `${formatNumber(value)}${column.spec.unit ? ` ${column.spec.unit}` : ""}`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value.split("\n")[0] ?? "";
  return countText(value, column.spec);
}

/** Enum choices are strings, but a literal union can hold numbers or booleans; hand back the original type. */
function coerceChoice(next: string, column: GridColumn): unknown {
  const original = column.spec.choices?.find(choice => String(choice) === next);
  return original === undefined ? next : original;
}

function ColumnChooser({ columns, visible, onChange }: { columns: readonly GridColumn[]; visible: readonly string[]; onChange: (keys: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const toggle = (key: string) => onChange(visible.includes(key) ? visible.filter(candidate => candidate !== key) : columns.filter(column => column.key === key || visible.includes(column.key)).map(column => column.key));
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild><Button variant="secondary" size="sm" aria-label="Choose columns"><Columns3 size={13} /> Columns <small className="font-mono text-[11px] text-faint">{visible.length}/{columns.length}</small></Button></Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="popover z-[60] w-[260px] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl shadow-shadow" align="end" sideOffset={6} collisionPadding={12}>
        <div className="flex max-h-80 flex-col gap-px overflow-y-auto p-1.5 [scrollbar-width:thin]">
          {columns.map(column => <label key={column.key} className="flex h-[26px] cursor-pointer items-center gap-2 rounded-sm px-1.5 text-xs hover:bg-accent"><Checkbox checked={visible.includes(column.key)} disabled={visible.length === 1 && visible.includes(column.key)} onCheckedChange={() => toggle(column.key)} /><span className="min-w-0 flex-1 truncate">{column.label}</span><small className="font-mono text-[11px] text-faint">{column.kind}</small></label>)}
        </div>
        <div className="flex items-center gap-2.5 border-t border-border-subtle px-2 py-1 text-[11px] text-faint"><Button variant="link" size="inline" onClick={() => onChange(defaultVisible(columns))}>Reset to default</Button><span className="flex-1" /><Button variant="link" size="inline" onClick={() => onChange(columns.map(column => column.key))}>Show all</Button></div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
