import { type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import "../../styles/gamecard.css";

/*
  The pieces a play view is built from. See styles/gamecard.css for why the page leads with one.

  These are layout only, like `ui/Sheet.tsx`: the controls inside them are the ordinary field
  controls, so a number on a card steps with the arrow keys, scrubs from its label, takes `=2*3`,
  reverts with Backspace and shows its origin chain exactly as it does in a sheet.
*/

export function Card({ caption, note, wide = false, children }: { caption: string; note?: ReactNode; wide?: boolean; children: ReactNode }) {
  return <div className="gamecard-frame">
    <div className="gamecard-caption"><b>{caption}</b>{note}</div>
    <div className="gamecard" data-wide={wide || undefined}>{children}</div>
  </div>;
}

/**
 * Art, name, and the small line under the name.
 *
 * `title` is the record's name as text. The visible name is an input, which is a textbox and not a
 * heading, so the page would otherwise have none: the hidden heading is what a screen reader, an
 * outline and the smoke test all land on.
 */
export function CardHead({ art, title, name, sub }: { art?: ReactNode; title: string; name: ReactNode; sub?: ReactNode }) {
  return <header className="gamecard-head">
    {art && <span className="gamecard-art">{art}</span>}
    <div className="gamecard-headings">
      <h2 className="sr-only">{title}</h2>
      <div className="gamecard-name">{name}</div>
      {sub && <div className="gamecard-sub">{sub}</div>}
    </div>
  </header>;
}

/** A `·`-separated line under the name, skipping the parts this record has nothing to say about. */
export function CardMeta({ parts }: { parts: readonly (ReactNode | undefined | false | "")[] }) {
  const shown = parts.filter((part): part is ReactNode => part !== undefined && part !== false && part !== "");
  return <>{shown.map((part, at) => <span key={at} className="gamecard-meta-part">{at > 0 && <i className="gamecard-sep">·</i>}{part}</span>)}</>;
}

/** The tooltip's stat table: name left, number hard right. */
export function CardStats({ children }: { children: ReactNode }) {
  return <div className="gamecard-stats">{children}</div>;
}

/** A sentence with live values in it: "Attack speed 2.4 s", "Heals 12 health". */
export function CardLine({ tone, children }: { tone?: "requirement" | "unmet" | "value" | "warn"; children: ReactNode }) {
  return <div className="gamecard-line" data-tone={tone}>{children}</div>;
}

export function CardLines({ children }: { children: ReactNode }) {
  return <div className="gamecard-lines">{children}</div>;
}

export function CardRule() { return <hr className="gamecard-rule" />; }

/**
 * A block the record only sometimes has (a food effect, a charge, a loot table). Present blocks
 * draw their own lines and offer one quiet way out; absent ones are a chip in `CardAdd` instead of
 * a section of empty boxes.
 */
export function CardBlock({ title, onRemove, removeLabel, children }: { title?: string; onRemove?: () => void; removeLabel?: string; children: ReactNode }) {
  return <section className="gamecard-block">
    {(title || onRemove) && <header className="gamecard-block-head">
      {title}
      {onRemove && <button type="button" className="gamecard-drop" title={removeLabel} onClick={onRemove}><X size={11} /> Remove</button>}
    </header>}
    {children}
  </section>;
}

export interface AddOption { key: string; label: string; onAdd: () => void }

/** What this record could also be, as one line of chips rather than four empty sections. */
export function CardAdd({ lead = "Also", options }: { lead?: string; options: readonly AddOption[] }) {
  if (!options.length) return null;
  return <div className="gamecard-add">
    <span>{lead}</span>
    {options.map(option => <button key={option.key} type="button" onClick={option.onAdd}><Plus size={10} /> {option.label}</button>)}
  </div>;
}
