import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";
import { ON_SHEET, ROW_COLUMNS, SheetLevel, useOnSheet } from "./Sheet.js";


/*
  Related numbers as a small table that sits on the sheet's own columns: each row's name is in the
  label column (so "Accuracy" lines up with "Buy value" above it), and the values are fixed-width
  cells under optional column heads ("Melee", "Magic"). Every cell is the same width and every
  control fills its cell, so a column of values reads straight down.

  Rows are `kv-row`s, which the sheet turns into subgrids; the fragment adds no wrapper box.
*/

export interface StatMatrixRow { key: string; label: ReactNode; cells: readonly ReactNode[]; hint?: string }

const track = "grid grid-cols-[repeat(var(--cols),6.75rem)] items-center gap-x-2";

export function StatMatrix({ columns, rows, width }: { columns?: readonly ReactNode[]; rows: readonly StatMatrixRow[]; width?: number }) {
  const onSheet = useOnSheet();
  const cols = width ?? Math.max(columns?.length ?? 1, ...rows.map(row => row.cells.length));
  const style = { "--cols": cols } as React.CSSProperties;
  const line = cn(onSheet ? ON_SHEET : ROW_COLUMNS, "items-center");
  return <>
    {columns && <div className={cn(line, "min-h-5")}>
      <span aria-hidden />
      <div className={track} style={style}>{columns.map((column, index) => <span key={index} className="pl-0.5 text-[11px] text-faint">{column}</span>)}</div>
    </div>}
    {rows.map(row => <div key={row.key} className={cn(line, "min-h-7 py-px")}>
      <span className="kv-label truncate text-right text-xs text-muted-foreground" title={row.hint}>{row.label}</span>
      <SheetLevel.Provider value={false}>
        <div className={track} style={style}>{row.cells.map((cell, index) => <div key={index} className="min-w-0 [&_[data-slot=input-group]]:w-full">{cell}</div>)}</div>
      </SheetLevel.Provider>
    </div>)}
  </>;
}
