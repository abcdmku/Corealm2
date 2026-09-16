import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, Pencil } from "lucide-react";
import type { RefKind } from "../../../../game/src/content/schema/core.js";
import { revertTarget, type RecordRef, type Resolved } from "../../model/origin.js";
import type { ContentRow } from "../../model/contracts.js";
import { REF_COLLECTIONS, findRecord, optionsFor, refTargetCollection, resolveReference, summaryContext, useReferenceIndex, type RefOption } from "../../model/refs.js";
import { summarize, titleCase, type SummaryContext } from "../../model/summaries.js";
import { usePeek } from "../Peek.js";
import { RecordPicker } from "../RecordPicker.js";
import { RefChip } from "../RefChip.js";
import { Thumb } from "../Thumb.js";
import { labelFor } from "../library.js";
import { useFieldContext } from "./context.js";
import { Field } from "./Field.js";
import { Button } from "../../components/ui/index.js";
import { chipVariants } from "../../components/ui/chip.js";
import { cn } from "../../lib/utils.js";


/*
  The one way a reference is edited (docs/devdocs-inputs.md §3.4). Inside the shared `Field`
  anatomy the control is a chip and a pencil:

    Loot table     [🜲 Marsh gland · raw venison] ✎  ●  ⟲   from Heath Jack

  The chip is the tab stop. Click or Space peeks the target record; Enter or the pencil opens the
  `RecordPicker`; Backspace unlinks an optional reference (an inherited one reverts through the
  Field). A missing target draws a dashed red chip and an error line; an empty one is a select-shaped
  "Choose <kind>…" button, or a dash when read-only. Kinds with no collection (skill, station, element, ...) pick from `optionsFor`.
*/

export interface RefFieldProps {
  /** Schema ref kind. Resolves the collection, the option list and the alias tables. */
  kind?: RefKind | string;
  /** A served collection, when the kind is not known or should be pinned (`compiled-items`). */
  collection?: string;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  label: ReactNode;
  hint?: string;
  /** The value's chain; draws the dot, the revert glyph and the provenance line. */
  resolved?: Resolved<string | undefined>;
  /** Defaults to `onChange(undefined)`, which pages write as "remove the own value". */
  onRevert?: () => void;
  /** Backspace clears; the picker shows a "None" row. */
  optional?: boolean;
  exclude?: ReadonlySet<string>;
  readOnly?: boolean;
  compact?: boolean;
  /** A chip inside a row or a cell: see `Field`'s `bare`. */
  bare?: boolean;
  span?: 1 | 2 | 3 | 4;
  dirty?: boolean;
  error?: string;
  /** Defaults to opening a peek of the target. */
  onOpenRef?: (ref: RecordRef) => void;
  /** Runs the page's create dialog; the returned id is linked. Adds a "Create new…" row (Ctrl+Enter). */
  createNew?: () => Promise<string | undefined>;
  className?: string;
}

export function RefField({ kind, collection, value, onChange, label, hint, resolved, onRevert, optional = false, exclude, readOnly = false, compact, bare, span, dirty, error, onOpenRef, createNew, className }: RefFieldProps) {
  const { index } = useReferenceIndex();
  const ctx = useMemo(() => summaryContext(index), [index]);
  const peek = usePeek();
  const shown = value ?? resolved?.value;
  const target = collection ?? (kind ? refTargetCollection(kind, index.available) ?? REF_COLLECTIONS[kind]?.[0] : undefined) ?? kind ?? "";
  const options = useMemo(() => !collection && kind ? optionsFor(kind, index) : undefined, [collection, kind, index]);
  const found = shown !== undefined && kind && !collection && !options ? resolveReference(index, kind, shown) : undefined;
  const record = found?.record ?? (shown !== undefined && !options ? findRecord(index, target, shown) : undefined);
  const recordCollection = found?.collection ?? target;
  const option = options && shown !== undefined ? options.find(candidate => candidate.value === shown) : undefined;
  const missing = shown !== undefined && shown !== "" && (options ? !option : !record);
  const kindLabel = kind ? titleCase(kind).toLowerCase() : labelFor(target).toLowerCase().replace(/s$/, "");
  const openRef = onOpenRef ?? peek.open;

  return <Field<string | undefined> label={label} hint={hint} resolved={resolved} onRevert={readOnly || !resolved ? undefined : (onRevert ?? (() => onChange(undefined)))} onOpenRef={openRef}
    error={error ?? (missing ? `${shown} is not in ${options ? `${kindLabel} options` : labelFor(recordCollection).toLowerCase()}` : undefined)} compact={compact} bare={bare} span={span} dirty={dirty} disabled={readOnly} className={className}>
    <RefControl kind={kind} kindLabel={kindLabel} collection={recordCollection} value={shown} record={record} option={option} options={options} missing={missing} ctx={ctx} exclude={exclude} readOnly={readOnly} optional={optional}
      canRevert={Boolean(resolved && revertTarget(resolved))} onChange={onChange} openRef={openRef} createNew={createNew} bare={bare}
      title={record ? summarize(recordCollection, record, ctx).title : option?.label ?? shown ?? ""} />
  </Field>;
}

interface ControlProps {
  kind?: string; kindLabel: string; collection: string; value: string | undefined; title: string;
  record: ContentRow | undefined; option: RefOption | undefined; options: RefOption[] | undefined;
  missing: boolean; ctx: SummaryContext; exclude?: ReadonlySet<string>; readOnly: boolean; optional: boolean; canRevert: boolean;
  onChange: (id: string | undefined) => void; openRef: (ref: RecordRef) => void; createNew?: () => Promise<string | undefined>; bare?: boolean;
}

function RefControl({ kind, kindLabel, collection, value, title, record, option, options, missing, ctx, exclude, readOnly, optional, canRevert, onChange, openRef, createNew, bare = false }: ControlProps) {
  const field = useFieldContext();
  const [pickerOpen, setPickerOpen] = useState(false);
  const chip = useRef<HTMLSpanElement>(null);
  const inert = readOnly || field.disabled;
  const empty = value === undefined || value === "";

  const setOpen = useCallback((open: boolean) => {
    if (open && inert) return;
    setPickerOpen(open);
    field.setEditing(open);
    // Radix hands focus back to the pencil; the chip is the field's tab stop, so take it there.
    if (!open) requestAnimationFrame(() => chip.current?.querySelector<HTMLElement>(".ref-chip")?.focus({ preventScroll: true }));
  }, [inert, field]);

  const peekTarget = () => { if (!empty && record && !options) openRef({ collection, id: value!, label: title }); else setOpen(true); };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (pickerOpen || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Enter") { event.preventDefault(); setOpen(true); }
    else if (event.key === " ") { event.preventDefault(); peekTarget(); }
    else if ((event.key === "Backspace" || event.key === "Delete") && !inert && optional && !empty && !canRevert) { event.preventDefault(); onChange(undefined); }
  };

  // An empty reference is a control that says what it will pick, never a pale "None" that reads as
  // a value. A read-only empty reference is just a dash: there is nothing to do with it.
  const chipNode = empty
    ? inert
      ? <span className="ref-empty-static inline-flex h-7 items-center text-xs text-faint" aria-labelledby={field.labelId}>—</span>
      : <button type="button" className={chipVariants({ state: "empty" })} aria-labelledby={field.labelId} title="Enter or click to choose" onClick={() => setOpen(true)}>
        <span>Choose {kindLabel}…</span><ChevronDown size={12} aria-hidden />
      </button>
    : options
      ? <button type="button" className={cn(chipVariants({ state: missing ? "missing" : "option" }), "is-option")} aria-labelledby={field.labelId} title={missing ? `${value} is not an option` : `${kindLabel} · ${value}`} onClick={() => setOpen(true)}>
        <Thumb spec={option?.thumb ?? { kind: "glyph", icon: Pencil, letter: value!.slice(0, 2).toUpperCase() }} size="s" />
        <span>{option?.label ?? value}</span>
      </button>
      : <RefChip collection={collection} id={value!} record={record} ctx={ctx} missing={missing} onOpen={() => (missing ? setOpen(true) : openRef({ collection, id: value!, label: title }))} />;

  // Focus lands on the chip only once the click completes, so a blur elsewhere cannot move it
  // mid-click. The picker's popover is a React child of this span but a DOM child of a portal, so
  // its events bubble through here too: leave those alone or picking a row with the mouse dies.
  const focusChip = () => chip.current?.querySelector<HTMLElement>(".ref-chip")?.focus({ preventScroll: true });
  const inPicker = (event: { target: unknown }) => event.target instanceof Element && event.target.closest(".popover") !== null;
  return <span ref={chip} className={cn("min-w-0 ref-control relative inline-flex max-w-full items-center gap-0.5", bare && !empty && !inert && "group-hover/row:[&_.ref-chip]:pr-8 group-focus-within/row:[&_.ref-chip]:pr-8")} data-kind={kind} data-missing={missing || undefined} onKeyDown={onKeyDown}
    onMouseDown={event => { if (!inPicker(event)) event.preventDefault(); }} onClickCapture={event => { if (!inPicker(event)) focusChip(); }}>
    {chipNode}
    {!inert && <RecordPicker collection={collection} value={value} ctx={ctx} exclude={exclude} options={options} open={pickerOpen} onOpenChange={setOpen}
      placeholder={`Search ${kindLabel}s…`}
      allowNone={optional} onClear={optional ? () => onChange(undefined) : undefined}
      onCreate={createNew ? async () => { const id = await createNew(); if (id) onChange(id); } : undefined} createLabel={`New ${kindLabel}…`}
      onPick={id => onChange(id)}
      trigger={<Button variant="ghost" size="icon-sm" className={cn("ref-edit", empty ? "pointer-events-none absolute right-0 size-0 overflow-hidden p-0 opacity-0" : bare && "absolute top-0.5 right-0.5 size-6 bg-background opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100")} tabIndex={-1} aria-label={`Choose ${kindLabel}`} title="Choose (Enter)"><Pencil size={12} /></Button>} />}
  </span>;
}
