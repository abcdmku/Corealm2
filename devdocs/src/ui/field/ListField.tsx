import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight, GripVertical, Plus, X } from "lucide-react";
import { Field } from "./Field.js";
import { ROW_COLUMNS, SheetLevel } from "../Sheet.js";
import { Button } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { move } from "./reorder.js";

/*
  One ordered list for every array (docs/devdocs-inputs.md §3.6). A row is

    ⠿  content …                         aside  ⟲

  28px tall, no card inside a card. The row itself is focusable: Backspace or Delete on the row
  (not on a control inside it) removes it with the same glyph and key `Field` uses to revert;
  Alt+Up/Down moves it; the handle drags it with plain pointer events. A list given `summarize`
  shows each row collapsed to one sentence and expands it on Enter or click.
*/

export interface ListItemApi<T> {
  index: number;
  update: (next: T) => void;
  remove: () => void;
  /** Focus the row element itself. */
  focus: () => void;
  expanded: boolean;
}

export interface ListFieldProps<T> {
  /** Without a label the list renders bare, for nesting inside another field. */
  label?: ReactNode;
  hint?: string;
  items: readonly T[];
  onChange: (items: T[]) => void;
  renderItem: (item: T, api: ListItemApi<T>) => ReactNode;
  /** Right-edge cell before the remove glyph (the weight cell of a `WeightedList`). */
  renderAside?: (item: T, api: ListItemApi<T>) => ReactNode;
  addLabel?: string;
  /** A typed add returns a default; a picker-backed add returns a promise, `undefined` to cancel. */
  onAdd?: () => T | undefined | Promise<T | undefined>;
  /** Replaces the add button with a control of the caller's (a key chooser on a `MapField`). */
  addControl?: ReactNode;
  /** Enter in a text input on the last row adds another row, for lists typed in one go. */
  addOnEnter?: boolean;
  /** Show the drag handle and take Alt+Up/Down. */
  ordered?: boolean;
  keyOf?: (item: T, index: number) => string | number;
  readOnly?: boolean;
  emptyText?: string;
  max?: number;
  /** Rows cannot be removed below this count. */
  min?: number;
  /** Collapsed row text. Rows with a summary start collapsed and expand on Enter or click. */
  summarize?: (item: T, index: number) => string;
  removeLabel?: (item: T, index: number) => string;
  compact?: boolean;
  className?: string;
  /** Tailwind classes for each row (e.g. `items-start` for tall rows) and for its content line. */
  rowClassName?: string;
  contentClassName?: string;
}

type Drag = { pointerId: number; from: number; to: number };
type Pending = { index: number; control: boolean } | null;

const isControl = (target: EventTarget | null): boolean => target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName);

export function ListField<T>({ label, hint, items, onChange, renderItem, renderAside, addLabel = "Add", onAdd, addControl, addOnEnter = false, ordered = false, keyOf, readOnly = false, emptyText = "None", max, min = 0, summarize, removeLabel, compact, className, rowClassName, contentClassName }: ListFieldProps<T>) {
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [expanded, setExpanded] = useState<Set<string | number>>(() => new Set());
  const pending = useRef<Pending>(null);
  const latest = useRef({ items, onChange });
  latest.current = { items, onChange };
  const key = (item: T, index: number): string | number => keyOf ? keyOf(item, index) : index;

  // Focus moves after the list re-renders: onto a moved row, a new row's first control, or the
  // row that took a removed row's place.
  useEffect(() => {
    const target = pending.current;
    if (!target) return;
    pending.current = null;
    const row = rows.current[Math.min(target.index, items.length - 1)];
    if (!row) return;
    const control = target.control ? row.querySelector<HTMLElement>("input, select, textarea, button.field-list-summary") : null;
    (control ?? row).focus();
  }, [items, expanded]);

  const canRemove = !readOnly && items.length > min;
  const canAdd = !readOnly && (max === undefined || items.length < max);

  const replace = (index: number, next: T) => onChange(items.map((item, at) => at === index ? next : item));
  const remove = (index: number) => {
    if (!canRemove) return;
    pending.current = { index, control: false };
    onChange(items.filter((_, at) => at !== index));
  };
  const shift = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    pending.current = { index: to, control: false };
    onChange(move(items, from, to));
  };
  const add = async () => {
    if (!onAdd || !canAdd) return;
    const result = await onAdd();
    if (result === undefined) return;
    const current = latest.current.items;
    pending.current = { index: current.length, control: true };
    latest.current.onChange([...current, result]);
  };
  const toggle = (item: T, index: number, open?: boolean) => {
    const id = key(item, index);
    setExpanded(current => {
      const next = new Set(current);
      const willOpen = open ?? !next.has(id);
      if (willOpen) next.add(id); else next.delete(id);
      return next;
    });
  };

  const rowKeyDown = (item: T, index: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    const onRow = event.target === event.currentTarget;
    const open = summarize ? expanded.has(key(item, index)) : true;
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && ordered && !readOnly && !isControl(event.target)) {
      event.preventDefault();
      shift(index, index + (event.key === "ArrowUp" ? -1 : 1));
    } else if (onRow && (event.key === "Backspace" || event.key === "Delete")) {
      event.preventDefault();
      remove(index);
    } else if (onRow && summarize && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      if (open) toggle(item, index, false);
      else { pending.current = { index, control: true }; toggle(item, index, true); }
    } else if (event.key === "Escape" && summarize && open && !event.defaultPrevented) {
      event.preventDefault();
      toggle(item, index, false);
      rows.current[index]?.focus();
    } else if (event.key === "Enter" && addOnEnter && !summarize && index === items.length - 1 && event.target instanceof HTMLInputElement && !event.shiftKey) {
      // The input's own Enter has already committed; add once that commit has rendered.
      setTimeout(() => { void add(); }, 0);
    }
  };

  // Drag with pointer capture on the handle: the handle keeps receiving moves while the pointer
  // roams, and the drop index comes from the row rectangles under the pointer.
  const handleDown = (index: number) => (event: ReactPointerEvent<HTMLElement>) => {
    if (readOnly || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ pointerId: event.pointerId, from: index, to: index });
  };
  const handleMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    let to = items.length - 1;
    for (let at = 0; at < items.length; at++) {
      const rect = rows.current[at]?.getBoundingClientRect();
      if (rect && event.clientY < rect.top + rect.height / 2) { to = at; break; }
    }
    if (to !== drag.to) setDrag({ ...drag, to });
  };
  const handleUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const { from, to } = drag;
    setDrag(null);
    shift(from, to);
  };
  const handleCancel = () => setDrag(null);

  const list = <div className={cn("field-list flex w-full min-w-0 flex-1 flex-col gap-px", className)} role="list" data-ordered={ordered || undefined} data-readonly={readOnly || undefined}>
    {items.map((item, index) => {
      const id = key(item, index);
      const open = summarize ? expanded.has(id) : true;
      const api: ListItemApi<T> = { index, update: next => replace(index, next), remove: () => remove(index), focus: () => rows.current[index]?.focus(), expanded: open };
      const dropSide = drag && drag.to === index && drag.to !== drag.from ? (drag.to < drag.from ? "before" : "after") : undefined;
      const summary = summarize?.(item, index);
      return <div key={id} ref={element => { rows.current[index] = element; }} className={cn(
          "field-list-row group/row relative -mx-0.5 grid min-h-7 items-center gap-x-1.5 rounded-sm px-0.5 outline-none hover:bg-accent data-[expanded=true]:hover:bg-transparent focus-visible:ring-1 focus-visible:ring-ring",
          "data-[dragging]:opacity-45 data-[drop=before]:shadow-[inset_0_2px_0_var(--accent)] data-[drop=after]:shadow-[inset_0_-2px_0_var(--accent)] data-[expanded=true]:pb-1",
          // The row hugs its content: the aside (a weight, a chance) and the remove button sit beside it and the
          // spare width is left in a last track. Rows whose content has a fixed width line their asides up.
          renderAside
            ? (ordered ? "grid-cols-[0.875rem_minmax(0,max-content)_auto_auto_minmax(0,1fr)]" : "grid-cols-[minmax(0,max-content)_auto_auto_minmax(0,1fr)]")
            : (ordered ? "grid-cols-[0.875rem_minmax(0,max-content)_auto_minmax(0,1fr)]" : "grid-cols-[minmax(0,max-content)_auto_minmax(0,1fr)]"),
          rowClassName,
        )} role="listitem" tabIndex={0}
        data-dragging={drag?.from === index || undefined} data-drop={dropSide} data-expanded={summarize ? open : undefined}
        aria-label={summary} onKeyDown={rowKeyDown(item, index)}>
        {ordered && <span className={cn("field-list-handle grid h-6 w-3.5 cursor-grab touch-none place-items-center text-faint select-none hover:text-muted-foreground", readOnly && "invisible", drag?.from === index && "cursor-grabbing")} title={readOnly ? undefined : "Drag, or Alt+Up/Down"} aria-hidden onPointerDown={handleDown(index)} onPointerMove={handleMove} onPointerUp={handleUp} onPointerCancel={handleCancel}><GripVertical size={12} /></span>}
        <SheetLevel.Provider value={false}><div className={cn("field-list-content flex min-w-0 flex-nowrap items-center gap-x-1.5 text-xs has-[>[data-slot=sheet]]:flex-wrap [&>*]:min-w-0", contentClassName)}>
          {summarize
            ? <button type="button" className="field-list-summary inline-flex min-h-6 cursor-pointer items-center gap-1 text-left text-xs text-foreground hover:text-primary [&_svg]:text-faint" tabIndex={-1} aria-expanded={open} onClick={() => toggle(item, index)}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<span>{summary}</span></button>
            : renderItem(item, api)}
        </div></SheetLevel.Provider>
        {renderAside && <div className="field-list-aside flex items-center gap-1.5">{renderAside(item, api)}</div>}
        {canRemove && <Button variant="ghost" size="icon-xs" className="field-list-remove opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:text-destructive" tabIndex={-1} title={removeLabel?.(item, index) ?? "Remove"} aria-label={removeLabel?.(item, index) ?? `Remove row ${index + 1}`} onClick={() => remove(index)}><X /></Button>}
        {summarize && open && <SheetLevel.Provider value><div className={cn("field-list-expanded @container col-span-full my-0.5 content-start gap-y-px border-l-2 border-border pl-3 [&>*]:col-span-full [&>*]:min-w-0", ROW_COLUMNS, ordered ? "ml-6" : "ml-1.5")}>{renderItem(item, api)}</div></SheetLevel.Provider>}
      </div>;
    })}
    {/* Empty, the list is one line: what it holds (nothing) and the way to add the first entry. */}
    {(!items.length || canAdd) && <div className="field-list-foot flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
      {!items.length && <span className="field-list-empty text-xs text-faint">{emptyText}</span>}
      {canAdd && (addControl ?? (onAdd && <Button variant="ghost" size="sm" className="field-list-add -ml-1.5" onClick={() => { void add(); }}><Plus />{addLabel}</Button>))}
    </div>}
  </div>;

  if (label === undefined) return list;
  return <Field label={label} hint={hint} compact={compact} className="[&>.field-body>.field-control]:items-start">{list}</Field>;
}
