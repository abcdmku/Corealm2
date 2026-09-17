import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import type { ListItemApi } from "./ListField.js";

/*
  Rows of several values each, under column heads that say what every box is:

    Item                 Quantity       Chance     Exclusive group
    [🜲 Coarse Hide ▾] ↗  [1] to [2]     [60] %     [ none    ]      ×
    [🜲 Ox Horn     ▾] ↗  [1] to [1]     [20] %     [ horn    ]      ×
    + Add drop

  One grid for the table and a subgrid per row, so every column lines up whatever its contents.
  The remove button is always there, faint until hovered. `template` is the grid's Tailwind column
  class and ends with the remove column (`…_auto`).
*/

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  /** What the column means, on the head's hover. */
  hint?: string;
  align?: "start" | "end";
  render: (item: T, api: ListItemApi<T>) => ReactNode;
}

export interface EditTableProps<T> {
  items: readonly T[];
  onChange: (items: T[]) => void;
  columns: readonly TableColumn<T>[];
  template: string;
  /** Names the table for assistive tech. */
  label: string;
  keyOf?: (item: T, index: number) => string | number;
  removeLabel?: (item: T, index: number) => string;
  readOnly?: boolean;
  emptyText?: string;
  /** The add control under the rows. */
  addControl?: ReactNode;
  /** Rows cannot be removed below this count. */
  min?: number;
  className?: string;
}

export function EditTable<T>({ items, onChange, columns, template, label, keyOf, removeLabel, readOnly = false, emptyText = "None", addControl, min = 0, className }: EditTableProps<T>) {
  const canRemove = !readOnly && items.length > min;
  const remove = (index: number) => { if (canRemove) onChange(items.filter((_, at) => at !== index)); };
  const replace = (index: number, next: T) => onChange(items.map((item, at) => at === index ? next : item));

  return <div className={cn("edit-table flex w-full min-w-0 flex-col", className)}>
    {items.length > 0 && <div className="min-w-0 overflow-x-auto">
      <div role="table" aria-label={label} className={cn("grid w-full min-w-max items-center gap-x-2.5 text-xs", template)}>
        <div role="row" className="col-span-full grid h-6 grid-cols-subgrid items-center border-b border-border-subtle text-[11px] text-muted-foreground">
          {columns.map(column => <span key={column.key} role="columnheader" title={column.hint}
            className={cn("truncate", column.hint && "cursor-help underline decoration-border decoration-dotted underline-offset-[3px]", column.align === "end" && "text-right")}>{column.header}</span>)}
          <span role="columnheader" className="sr-only">Remove</span>
        </div>
        {items.map((item, index) => {
          const api: ListItemApi<T> = { index, update: next => replace(index, next), remove: () => remove(index), focus: () => undefined, expanded: true };
          return <div key={keyOf ? keyOf(item, index) : index} role="row" className="group/row col-span-full grid min-h-8 grid-cols-subgrid items-center border-b border-border-subtle/60 py-0.5 hover:bg-accent/40">
            {columns.map(column => <div key={column.key} role="cell" className={cn("flex min-w-0 items-center gap-1", column.align === "end" && "justify-end")}>{column.render(item, api)}</div>)}
            <div role="cell" className="flex justify-end">
              {canRemove && <Button variant="ghost" size="icon-xs" className="edit-table-remove text-faint hover:text-destructive" title={removeLabel?.(item, index) ?? "Remove"} aria-label={removeLabel?.(item, index) ?? `Remove row ${index + 1}`} onClick={() => remove(index)}><X /></Button>}
            </div>
          </div>;
        })}
      </div>
    </div>}
    {(!items.length || addControl) && <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
      {!items.length && <span className="text-xs text-faint">{emptyText}</span>}
      {addControl}
    </div>}
  </div>;
}
