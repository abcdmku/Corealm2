import type { ReactNode } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";
import { Button } from "../components/ui/index.js";
import { cn } from "../lib/utils.js";

/*
  The small states every dev panel repeats: a spinner, a heading row, a failed load with a retry,
  a save problem with its one action, a form error and a skeleton bar. One definition each, so the
  notes, set-piece, asset, request and review panels read the same.
*/

/** A spinning loader icon that stays still for reduced motion. */
export const SPIN = "animate-spin motion-reduce:animate-none";

/** A panel's own heading row: title, count, spinner, then actions pushed right. */
export const PANEL_HEAD = "flex min-h-7 items-center gap-2 [&_h2]:text-xs [&_h2]:font-semibold [&_h3]:text-xs [&_h3]:font-semibold";

/** A load that failed: what failed, why, and a retry. */
export function LoadError({ label, message, retry, className }: { label: string; message: string; retry: () => void; className?: string }) {
  return <div className={cn("flex items-start gap-2 py-2 text-xs text-muted-foreground", className)} role="alert">
    <CircleAlert size={16} className="mt-px shrink-0 text-destructive" />
    <div className="grid justify-items-start gap-1.5">
      <strong className="font-medium text-foreground">{label}</strong>
      <p className="[overflow-wrap:anywhere]">{message}</p>
      <Button variant="secondary" size="sm" onClick={retry}><RefreshCw size={13} />Try again</Button>
    </div>
  </div>;
}

/** A save that did not land. A conflict reads as a warning and carries its reload action. */
export function Notice({ conflict = false, children, action, className }: { conflict?: boolean; children: ReactNode; action?: ReactNode; className?: string }) {
  return <div className={cn(
    "flex items-center gap-2 rounded-md border py-1 pr-1 pl-2.5 text-xs text-foreground [&>svg]:shrink-0",
    conflict ? "border-warn bg-warn-soft [&>svg]:text-warn" : "border-destructive bg-destructive-soft [&>svg]:text-destructive",
    className,
  )} role="alert">
    <CircleAlert size={14} />
    <span className="min-h-6 flex-1 py-1 leading-snug">{children}</span>
    {action}
  </div>;
}

/** A validation message under a form. */
export function FormError({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return <p className={cn("flex basis-full items-center gap-1 text-xs text-destructive", className)} id={id} role="alert"><CircleAlert size={12} className="shrink-0" />{children}</p>;
}

/** A placeholder bar while content loads. */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("block h-7 animate-pulse rounded-sm bg-secondary motion-reduce:animate-none", className)} />;
}
