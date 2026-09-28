import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Button, Kbd } from "../../../components/ui/index.js";
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

/** A kit button that opens the file picker for one image; the native input stays hidden. */
export function FilePick({ label, title, disabled, onFile, name }: { label: ReactNode; title?: string; disabled?: boolean; onFile: (file: File) => void; /** The input's accessible name. */ name: string }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <input type="file" ref={input} className="hidden" accept="image/png,image/jpeg,image/webp" aria-label={name}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onFile(file); }} />
    <Button variant="secondary" size="xs" title={title} disabled={disabled} onClick={() => input.current?.click()}>{label}</Button>
  </>;
}

/** Drop handlers for image files, and whether one is being dragged over the target. */
export function useFileDrop(onFile: (file: File) => void, disabled = false): { over: boolean; handlers: { onDragOver: (event: DragEvent) => void; onDragLeave: () => void; onDrop: (event: DragEvent) => void } } {
  const [over, setOver] = useState(false);
  return {
    over: over && !disabled,
    handlers: {
      onDragOver: event => { if (disabled || ![...event.dataTransfer.types].includes("Files")) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setOver(true); },
      onDragLeave: () => setOver(false),
      onDrop: event => { setOver(false); if (disabled) return; const file = event.dataTransfer.files[0]; if (!file) return; event.preventDefault(); onFile(file); },
    },
  };
}

/** Why the controls beside it are disabled, in one line. Nothing when they are not. */
export function Blocked({ reason, className }: { reason: string | undefined; className?: string }) {
  return reason ? <p className={cn("text-[11px] leading-snug text-faint", className)} data-blocked="">{reason}</p> : null;
}
