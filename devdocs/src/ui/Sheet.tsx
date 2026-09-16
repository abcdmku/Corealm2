import { type ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";

/*
  The layout pieces the property sheet is built from: one column of `label | value` rows at 28px,
  sections separated by a rule and an 11px label, plus the grid, columns and fact-line helpers
  purpose-built pages compose them with. The controls that go inside these rows (numbers, text,
  choices, toggles, derived values) live in `ui/field/`, which re-exports these layout pieces so a
  page imports one module.
*/

export function Sheet({ children, className = "", compact = false }: { children: ReactNode; className?: string; compact?: boolean }) {
  return <div className={`kv${compact ? " kv-compact" : ""} ${className}`.trim()}>{children}</div>;
}

export function Section({ title, aside, children, open: initialOpen = true, collapsible = false, className = "" }: { title: ReactNode; aside?: ReactNode; children: ReactNode; open?: boolean; collapsible?: boolean; className?: string }) {
  const [open, setOpen] = useState(initialOpen);
  return <section className={`kv-section${open ? "" : " is-closed"} ${className}`.trim()}>
    <header className="kv-section-head">
      {collapsible ? <button type="button" className="kv-section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}><ChevronDown size={12} />{title}</button> : <h3>{title}</h3>}
      {aside && <span className="kv-section-aside">{aside}</span>}
    </header>
    {open && <div className="kv-section-body">{children}</div>}
  </section>;
}

/** Two sheets beside each other for records with two natural halves (identity + numbers). */
export function Columns({ children }: { children: ReactNode }) { return <div className="kv-columns">{children}</div>; }

/**
 * A grid of small labelled fields for a group of like values (a creature's combat numbers, an
 * item's bonuses). Label above, control below, cells packed left to right: eight numbers take two
 * lines instead of eight rows, and the eye reads them as one set.
 */
export function Fields({ children, columns, className = "" }: { children: ReactNode; columns?: number; className?: string }) {
  // `columns` caps how many cells sit on a line; it does not stretch them. A number control keeps
  // its own width, so the value stays beside its label instead of drifting to a far edge.
  return <div className={`kv-fields ${className}`.trim()} style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(88px, 1fr))` } : undefined}>{children}</div>;
}

export function Field({ label, hint, children, span, error, className = "" }: { label: ReactNode; hint?: string; children: ReactNode; span?: 1 | 2 | 3 | 4; error?: string; className?: string }) {
  return <div className={`kv-field${error ? " has-error" : ""} ${className}`.trim()} data-span={span} title={hint}>
    <span className="kv-field-label">{label}</span>
    <div className="kv-field-value">{children}</div>
    {error && <span className="kv-error">{error}</span>}
  </div>;
}

export function Row({ label, hint, children, error, wide = false, align = "center" }: { label: ReactNode; hint?: string; children: ReactNode; error?: string; wide?: boolean; align?: "center" | "start" }) {
  return <div className={`kv-row${wide ? " is-wide" : ""}${error ? " has-error" : ""}`} data-align={align}>
    <span className="kv-label" title={hint}>{label}</span>
    <div className="kv-value">{children}{error && <span className="kv-error">{error}</span>}</div>
  </div>;
}

/** A line of facts: `Tier 1 · Head · Melee 1`. Replaces badge rows for non-state information. */
export function Facts({ items, className = "" }: { items: readonly (ReactNode | undefined | false | null)[]; className?: string }) {
  const shown = items.filter((item): item is ReactNode => item !== undefined && item !== false && item !== null && item !== "");
  if (!shown.length) return null;
  return <span className={`facts ${className}`.trim()}>{shown.map((item, index) => <span key={index}>{item}</span>)}</span>;
}

/** A read-only value in the sheet. */
export function Static({ children, mono = false, muted = false }: { children: ReactNode; mono?: boolean; muted?: boolean }) {
  return <span className={`kv-static${mono ? " mono" : ""}${muted ? " muted" : ""}`}>{children}</span>;
}
