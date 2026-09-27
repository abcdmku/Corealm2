import type { ReactNode } from "react";
import { Kbd } from "../../../components/ui/index.js";
import { cn } from "../../../lib/utils.js";

/* Small layout pieces the body page's inspector panels share. */

export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={cn("flex flex-col gap-1.5 border-b border-border-subtle px-3 py-2", className)}>
    <div className="flex min-h-5 items-center gap-2">
      <h2 className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-[.04em] text-faint uppercase">{title}</h2>
      {aside}
    </div>
    {children}
  </section>;
}

/** Label and control rows: one right-aligned label column, tight gap. */
export function Rows({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1", className)}>{children}</div>;
}

export function Row({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return <>
    <span className="truncate text-right text-[11px] text-faint">{label}</span>
    <div className={cn("flex min-h-7 min-w-0 items-center gap-1.5", className)}>{children}</div>
  </>;
}

export function Pairs({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return <dl className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11px]">
    {rows.map(([label, value]) => <div key={label} className="contents"><dt className="text-right text-faint">{label}</dt><dd className="truncate text-muted-foreground" title={typeof value === "string" ? value : undefined}>{value}</dd></div>)}
  </dl>;
}

/** A one-line message inside a panel: a hint, a missing server route, an error. */
export function Note({ tone = "muted", children, className }: { tone?: "muted" | "warn" | "error"; children: ReactNode; className?: string }) {
  return <p className={cn("text-[11px] leading-snug", tone === "error" ? "text-destructive" : tone === "warn" ? "text-warn" : "text-faint", className)} role={tone === "error" ? "alert" : undefined}>{children}</p>;
}

export function Legend({ keys, label }: { keys: readonly string[]; label: string }) {
  return <span className="inline-flex items-center gap-0.5">{keys.map(key => <Kbd key={key}>{key}</Kbd>)}<span className="ml-0.5">{label}</span></span>;
}

export const formatScale = (scale: number): string => Number(scale.toFixed(2)).toString();
export const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
