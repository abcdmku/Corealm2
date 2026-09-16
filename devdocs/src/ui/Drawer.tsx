import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "../components/ui/index.js";
import { cn } from "../lib/utils.js";

/** A right-hand drawer over the current page. `stacked` drawers sit above an open one. */
export function Drawer({ title, label, onClose, actions, children, stacked = false, wide = false, className }: { title: ReactNode; /** The accessible name when the title is not plain text. */ label?: string; onClose: () => void; actions?: ReactNode; children: ReactNode; stacked?: boolean; wide?: boolean; className?: string }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return <>
    <div className={cn("fixed inset-0 bg-transparent", stacked ? "z-[46]" : "z-[44]")} onClick={onClose} />
    <aside className={cn(
      "fixed inset-y-0 right-0 flex flex-col border-l border-border bg-card shadow-[-12px_0_40px_var(--shadow)]",
      stacked ? "z-[47]" : "z-[45]",
      wide ? "w-[min(38.75rem,92vw)]" : "w-[min(32.5rem,90vw)]",
      className,
    )} role="dialog" aria-label={label ?? (typeof title === "string" ? title : undefined)}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</h2>
        {actions}
        <Button variant="ghost" size="icon-sm" aria-label="Close drawer" onClick={onClose}><X /></Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </aside>
  </>;
}
