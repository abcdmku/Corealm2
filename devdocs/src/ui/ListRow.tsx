import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/utils.js";

/*
  One row in a list of records: art, a title with its subtitle under it, and a right-hand meta slot
  in mono (counts, levels). RefRow draws a reference with it; list pages (loot tables, spawns,
  requests) draw their own records with it so every list in the app reads the same.
*/
export function ListRow({ art, title, tag, subtitle, meta, trailing, hint, className, ...props }: Omit<ComponentProps<"button">, "title"> & {
  art?: ReactNode;
  title: ReactNode;
  /** A short word beside the title. */
  tag?: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  /** The native tooltip (the id). */
  hint?: string;
}) {
  return <button type="button" title={hint} className={cn(
    "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border border-transparent px-1.5 py-[3px] text-left outline-none hover:border-border hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/40",
    className,
  )} {...props}>
    {art}
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-xs font-medium">{title}{tag !== undefined && <small className="ml-1.5 text-[11px] font-normal text-faint">{tag}</small>}</span>
      {subtitle !== undefined && <span className="truncate text-[11px] text-muted-foreground">{subtitle}</span>}
    </span>
    {meta !== undefined && <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">{meta}</span>}
    {trailing}
  </button>;
}
