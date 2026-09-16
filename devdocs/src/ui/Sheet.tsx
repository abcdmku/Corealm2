import { createContext, Fragment, useContext, useState, type ReactNode } from "react";
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
export const ROW_COLUMNS = "grid grid-cols-[fit-content(10.5rem)_minmax(0,1fr)] gap-x-2.5";
/** A row on a sheet: span both columns and use the sheet's. */
export const ON_SHEET = "col-span-full grid grid-cols-subgrid";

export function Sheet({ children, className, compact = false }: { children: ReactNode; className?: string; compact?: boolean }) {
  return <SheetLevel.Provider value>
    <div data-slot="sheet" data-compact={compact || undefined} className={cn(
      "kv grid min-w-0 content-start gap-x-2.5 [&>*]:col-span-full [&>*]:min-w-0",
      compact ? "grid-cols-[fit-content(8.25rem)_minmax(0,1fr)] gap-x-2" : "grid-cols-[fit-content(10.5rem)_minmax(0,1fr)]",
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
  return <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-2">{children}</div>;
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
    columns ? "grid-cols-[repeat(var(--columns),8rem)]" : "grid-cols-[repeat(auto-fill,8rem)]",
    onSheet && "col-start-2! col-end-auto!",
    // Controls fill the cell and give way to the origin dot and revert glyph beside them.
    "[&_[data-slot=input-group]]:w-auto! [&_[data-slot=input-group]]:min-w-0 [&_[data-slot=input-group]]:flex-1 [&_[data-slot=native-select]]:w-auto! [&_[data-slot=native-select]]:min-w-0 [&_[data-slot=native-select]]:flex-1",
    className,
  )} style={columns ? { "--columns": columns } as React.CSSProperties : undefined}>{children}</div>;
}

/** A label/value row for read-only or composite values. */
export function Row({ label, hint, children, error, wide = false, align = "center" }: { label: ReactNode; hint?: string; children: ReactNode; error?: string; wide?: boolean; align?: "center" | "start" }) {
  const onSheet = useOnSheet();
  return <div data-slot="row" className={cn(
    "kv-row min-h-7 py-px",
    wide ? "col-span-full flex flex-col gap-1" : onSheet ? ON_SHEET : ROW_COLUMNS,
    align === "start" ? "items-start" : "items-center",
  )}>
    <span className={cn("kv-label truncate text-xs text-muted-foreground", wide ? "text-left" : "text-right", align === "start" && !wide && "pt-1.5", error && "text-destructive")} title={hint}>{label}</span>
    <SheetLevel.Provider value={false}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">{children}{error && <span className="basis-full text-[11px] text-destructive">{error}</span>}</div>
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
export function Static({ children, mono = false, muted = false }: { children: ReactNode; mono?: boolean; muted?: boolean }) {
  return <span className={cn("inline-flex min-h-7 items-center text-xs [overflow-wrap:anywhere]", mono && "font-mono", muted ? "text-faint" : "text-foreground")}>{children}</span>;
}
