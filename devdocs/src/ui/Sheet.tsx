import { Children, createContext, Fragment, isValidElement, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/utils.js";


/*
  The layout a record sheet is built from, in Tailwind.

  A sheet is one two-column grid: labels, as wide as the longest one (capped at 10.5rem), set flush
  right against their values. Sections, their bodies and every label/value row are subgrids of that
  grid, so all values in a record start on one edge. Anything that is not a row spans both columns.

  Whether a row is on the sheet's grid is known from `SheetLevel`, not from CSS selectors: a sheet
  and a section body say "rows here sit on the grid"; a field's own control area says "not here", so
  a field nested in a list row or a union lays itself out on its own columns.
*/

export const SheetLevel = createContext(false);
export const useOnSheet = (): boolean => useContext(SheetLevel);

/** A standalone row's columns, for rows that are not on a sheet's grid. */
/** Narrower than 26rem (a nested editor in a peek), labels stack over their controls. */
export const ROW_COLUMNS = "grid grid-cols-[fit-content(10.5rem)_minmax(0,1fr)] gap-x-2.5 @max-[26rem]:grid-cols-1";
/** A row on a sheet: span both columns and use the sheet's. */
export const ON_SHEET = "col-span-full grid grid-cols-subgrid";

export function Sheet({ children, className, compact = false }: { children: ReactNode; className?: string; compact?: boolean }) {
  const nested = useOnSheet();
  return <SheetLevel.Provider value>
    <div data-slot="sheet" data-compact={compact || undefined} className={cn(
      "kv min-w-0 content-start [&>*]:col-span-full [&>*]:min-w-0",
      nested ? ON_SHEET : cn("grid gap-x-2.5", compact ? "grid-cols-[fit-content(8.25rem)_minmax(0,1fr)] gap-x-2" : "grid-cols-[fit-content(10.5rem)_minmax(0,1fr)]", "@max-[26rem]:grid-cols-1"),
      className,
    )}>{children}</div>
  </SheetLevel.Provider>;
}

export function Section({ title, aside, children, open: initialOpen = true, collapsible = false, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; open?: boolean; collapsible?: boolean; className?: string }) {
  const [open, setOpen] = useState(initialOpen);
  const onSheet = useOnSheet();
  return <section data-slot="section" data-open={open} className={cn(
    "kv-section min-w-0 border-t border-border-subtle pt-3 pb-1.5 first:border-t-0 first:pt-0 [&>*]:col-span-full",
    onSheet ? ON_SHEET : "grid grid-cols-[fit-content(10.5rem)_minmax(0,1fr)] gap-x-2.5",
    className,
  )}>
    <header className="mb-1 flex min-h-6 items-center gap-2">
      {collapsible
        ? <button type="button" className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-semibold text-foreground" aria-expanded={open} onClick={() => setOpen(!open)}>
          <ChevronDown className={cn("size-3.5 text-faint transition-transform", !open && "-rotate-90")} />{title}
        </button>
        : <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>}
      {aside && <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">{aside}</span>}
    </header>
    {open && <SheetLevel.Provider value>
      <div data-slot="section-body" className={cn(ON_SHEET, "min-w-0 [&>*]:col-span-full [&>*]:min-w-0")}>{children}</div>
    </SheetLevel.Provider>}
  </section>;
}

/** Two sheets side by side for records with two natural halves. */
export function Columns({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-6 @min-[64rem]:grid-cols-2">{children}</div>;
}

/**
 * A grid of small labelled fields for like values (a creature's combat numbers). Label above, the
 * control filling a fixed-width cell, so a column of values reads straight down. On a sheet it sits
 * in the value column.
 */
export function Fields({ children, columns, className }: { children: ReactNode; columns?: number; className?: string }) {
  const onSheet = useOnSheet();
  return <div data-slot="fields" className={cn(
    "grid w-fit max-w-full gap-x-3 gap-y-2 pt-1 pb-2",
    columns ? "grid-cols-[repeat(var(--columns),minmax(6.5rem,8rem))]" : "grid-cols-[repeat(auto-fill,8rem)]",
    onSheet && "col-start-2! col-end-auto!",
    // Controls fill the cell and give way to the origin dot and revert glyph beside them.
    "[&_[data-slot=input-group]]:w-auto! [&_[data-slot=input-group]]:min-w-0 [&_[data-slot=input-group]]:flex-1 [&_[data-slot=native-select]]:w-auto! [&_[data-slot=native-select]]:min-w-0 [&_[data-slot=native-select]]:flex-1",
    className,
  )} style={columns ? { "--columns": columns } as React.CSSProperties : undefined}>{children}</div>;
}

/** Where a field sits in a `FieldRows` line: the first keeps the sheet's label column, the rest follow it. */
export type PairSlot = "lead" | "rest";
export const PairLevel = createContext<PairSlot | undefined>(undefined);

/**
 * Short like fields (a creature's combat numbers) set several to a line, each one the sheet's usual
 * label and control. It is one grid, so every column is as wide as its widest label and control and
 * no wider; its first track is measured off the sheet's label column, so values still start on the
 * sheet's edge. A dot and a revert glyph stand in for the provenance sentence. Columns that do not
 * fit are dropped, and at one to a line the fields are plain sheet rows again.
 */
export function FieldRows({ children, columns = 3 }: { children: ReactNode; columns?: number }) {
  const onSheet = useOnSheet();
  const wrapper = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const seen = useRef(0);
  const [fit, setFit] = useState(columns);
  const [labelWidth, setLabelWidth] = useState<number>();
  useLayoutEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const measure = () => {
      setLabelWidth(probe.current?.offsetWidth);
      // Dropping a column changes the height, never the width: only a new width gets a fresh try.
      if (element.clientWidth === seen.current) return;
      seen.current = element.clientWidth;
      setFit(columns);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [columns]);
  useLayoutEffect(() => {
    const element = grid.current;
    if (element && fit > 1 && element.scrollWidth > element.clientWidth + 1) setFit(fit - 1);
  });
  const fields = Children.toArray(children);
  const tracks = `${labelWidth === undefined ? "max-content" : `${labelWidth}px`} max-content${" max-content max-content".repeat(Math.max(0, fit - 1))}`;
  return <div ref={wrapper} data-slot="field-rows" data-columns={fit} className={cn(onSheet ? ON_SHEET : ROW_COLUMNS, "[&_[data-slot=native-select]]:w-28!")}>
    {/* Holds the sheet's label column open for these labels, and says how wide it came out. */}
    <span ref={probe} aria-hidden className="invisible col-start-1 row-start-1 flex h-0 flex-col overflow-hidden text-xs whitespace-nowrap">
      {fields.map((field, index) => <span key={index}>{isValidElement<{ label?: ReactNode }>(field) ? field.props.label : null}</span>)}
    </span>
    {fit === 1
      ? fields
      : <div ref={grid} className="col-span-full row-start-1 grid min-w-0 gap-x-2.5 overflow-x-clip" style={{ gridTemplateColumns: tracks }}>
        {fields.map((field, index) => <PairLevel.Provider key={index} value={index % fit === 0 ? "lead" : "rest"}>{field}</PairLevel.Provider>)}
      </div>}
  </div>;
}

/** A label/value row for read-only or composite values. */
export function Row({ label, hint, children, error, wide = false, align = "center" }: { label: ReactNode; hint?: string; children: ReactNode; error?: string; wide?: boolean; align?: "center" | "start" }) {
  const onSheet = useOnSheet();
  return <div data-slot="row" className={cn(
    "kv-row min-h-7 py-px",
    wide ? "col-span-full flex flex-col items-stretch gap-1" : onSheet ? ON_SHEET : ROW_COLUMNS,
    !wide && (align === "start" ? "items-start" : "items-center"),
  )}>
    <span className={cn("kv-label truncate text-xs text-muted-foreground", wide ? "text-left" : "text-right", align === "start" && !wide && "pt-1.5", error && "text-destructive")} title={hint}>{label}</span>
    <SheetLevel.Provider value={false}>
      <div className="min-w-0 flex flex-wrap items-center gap-1.5 text-xs">{children}{error && <span className="basis-full text-[11px] text-destructive">{error}</span>}</div>
    </SheetLevel.Provider>
  </div>;
}

/** A line of facts: `Tier 1 · Head · Melee 1`. */
export function Facts({ items, className }: { items: readonly (ReactNode | undefined | false | null)[]; className?: string }) {
  const shown = items.filter((item): item is ReactNode => item !== undefined && item !== false && item !== null && item !== "");
  if (!shown.length) return null;
  return <span className={cn("inline-flex flex-wrap items-center gap-x-1 text-muted-foreground", className)}>
    {shown.map((item, index) => <Fragment key={index}>{index > 0 && <span aria-hidden className="text-faint">·</span>}<span>{item}</span></Fragment>)}
  </span>;
}

/** A read-only value in the sheet. */
export function Static({ children, mono = false, muted = false, title, className }: { children: ReactNode; mono?: boolean; muted?: boolean; title?: string; className?: string }) {
  return <span title={title} className={cn("field-static inline-flex min-h-7 items-center gap-1 text-xs [overflow-wrap:anywhere] [&_small]:text-[11px] [&_small]:text-faint", mono && "font-mono", muted ? "text-faint" : "text-foreground", className)}>{children}</span>;
}
