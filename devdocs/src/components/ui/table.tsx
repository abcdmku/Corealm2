import * as React from "react";
import { cn } from "../../lib/utils.js";

/*
  shadcn's Table, dense. `TableFrame` is the bordered scroll box; its header row sticks to the top and
  `pin` on a head or cell sticks that column to the left. Cells default to one line; numeric cells
  (`numeric`) align right in mono so a column of numbers reads down.
*/

export function TableFrame({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="table-frame" className={cn("relative w-fit max-w-full overflow-auto rounded-md border border-border bg-card", className)} {...props} />;
}

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <table data-slot="table" className={cn("min-w-full border-separate border-spacing-0 text-xs", className)} {...props} />;
}

export function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_th]:sticky [&_th]:top-0 [&_th]:z-20", className)} {...props} />;
}

export function TableBody(props: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" {...props} />;
}

export function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr data-slot="table-row" className={cn("group/tr", className)} {...props} />;
}

const cellBase = "border-b border-border-subtle px-2 py-1 text-left align-middle whitespace-nowrap";

export function TableHead({ className, pin = false, numeric = false, ...props }: React.ComponentProps<"th"> & { pin?: boolean; numeric?: boolean }) {
  return <th data-slot="table-head" className={cn(
    cellBase, "h-7 bg-secondary text-[11px] font-semibold text-muted-foreground [&_button]:inline-flex [&_button]:cursor-pointer [&_button]:items-center [&_button]:gap-1 [&_button:hover]:text-foreground",
    pin && "sticky left-0 z-30!", numeric && "text-right",
    className,
  )} {...props} />;
}

export function TableCell({ className, pin = false, numeric = false, ...props }: React.ComponentProps<"td"> & { pin?: boolean; numeric?: boolean }) {
  return <td data-slot="table-cell" className={cn(
    cellBase, "group-hover/tr:bg-accent",
    pin && "sticky left-0 z-10 bg-secondary font-semibold",
    numeric && "text-right font-mono tabular-nums",
    className,
  )} {...props} />;
}

/** A clickable name or icon inside a cell. */
export function TableLink({ className, ...props }: React.ComponentProps<"button">) {
  return <button type="button" data-slot="table-link" className={cn("inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm py-0.5 text-left hover:text-link", className)} {...props} />;
}

export function EmptyCell() {
  return <span className="text-faint">—</span>;
}
