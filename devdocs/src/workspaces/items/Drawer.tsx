import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "../../components/ui/index.js";

/** A right-hand drawer over the current page. `stacked` drawers sit above an open one. */
export function Drawer({ title, onClose, actions, children, stacked = false, wide = false }: { title: ReactNode; onClose: () => void; actions?: ReactNode; children: ReactNode; stacked?: boolean; wide?: boolean }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return <>
    <div className={`drawer-scrim${stacked ? " is-stacked" : ""}`} onClick={onClose} />
    <aside className={`drawer${stacked ? " is-stacked" : ""}${wide ? " is-wide" : ""}`} role="dialog" aria-label={typeof title === "string" ? title : undefined}>
      <header className="drawer-head">
        <h2>{title}</h2>
        {actions}
        <Button variant="ghost" size="icon-sm" aria-label="Close drawer" onClick={onClose}><X size={15} /></Button>
      </header>
      <div className="drawer-body">{children}</div>
    </aside>
  </>;
}
