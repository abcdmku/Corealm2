import { type ReactNode, useEffect, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { Derivation } from "../model/derive.js";
import { fmt } from "../model/derive.js";

/*
  The property sheet every purpose-built page is made of. One column of `label | value` rows at
  28px, sections separated by a rule and an 11px label, inputs sized to what they hold. A derived
  row shows the value, the terms that produced it, the curve it came from and an override control.
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
  return <div className={`kv-fields ${className}`.trim()} style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>{children}</div>;
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

export type InputWidth = "num" | "short" | "id" | "text" | "full";

export function NumberInput({ value, onChange, unit, width = "num", min, max, step, disabled, placeholder, ariaLabel, integer, title }: {
  value: number | undefined; onChange: (value: number | undefined) => void; unit?: string; width?: InputWidth; min?: number; max?: number; step?: number; disabled?: boolean; placeholder?: string; ariaLabel?: string; integer?: boolean; title?: string;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => { setText(value === undefined ? "" : String(value)); }, [value]);
  return <span className="kv-input-wrap">
    <input className="kv-input kv-input-number" data-width={width} data-zero={value === 0 ? "true" : undefined} type="number" inputMode="decimal" value={text} min={min} max={max} step={step ?? (integer ? 1 : "any")} disabled={disabled} placeholder={placeholder} aria-label={ariaLabel} title={title}
      onChange={event => { setText(event.target.value); const parsed = event.target.value === "" ? undefined : Number(event.target.value); if (parsed === undefined || Number.isFinite(parsed)) onChange(parsed); }} />
    {unit && <span className="kv-unit">{unit}</span>}
  </span>;
}

export function TextInput({ value, onChange, width = "text", mono = false, disabled, placeholder, ariaLabel, multiline = false }: {
  value: string; onChange: (value: string) => void; width?: InputWidth; mono?: boolean; disabled?: boolean; placeholder?: string; ariaLabel?: string; multiline?: boolean;
}) {
  if (multiline) return <textarea className="kv-input kv-textarea" value={value} disabled={disabled} placeholder={placeholder} aria-label={ariaLabel} rows={Math.min(8, Math.max(2, value.split("\n").length))} onChange={event => onChange(event.target.value)} />;
  return <input className={`kv-input${mono ? " mono" : ""}`} data-width={width} type="text" value={value} disabled={disabled} placeholder={placeholder} aria-label={ariaLabel} onChange={event => onChange(event.target.value)} />;
}

export function Select<T extends string>({ value, onChange, options, width = "short", disabled, ariaLabel, allowEmpty }: {
  value: T | undefined; onChange: (value: T) => void; options: readonly { value: T; label?: string }[] | readonly T[]; width?: InputWidth; disabled?: boolean; ariaLabel?: string; allowEmpty?: string;
}) {
  const normalized = options.map(option => typeof option === "string" ? { value: option, label: option } : { value: option.value, label: option.label ?? option.value });
  return <select className="kv-input kv-select" data-width={width} value={value ?? ""} disabled={disabled} aria-label={ariaLabel} onChange={event => onChange(event.target.value as T)}>
    {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
    {value !== undefined && !normalized.some(option => option.value === value) && <option value={value}>{value}</option>}
    {normalized.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>;
}

export function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (value: boolean) => void; label?: string; disabled?: boolean }) {
  return <label className="kv-toggle"><input type="checkbox" checked={value} disabled={disabled} onChange={event => onChange(event.target.checked)} /><span>{label ?? (value ? "Yes" : "No")}</span></label>;
}

/** A read-only value in the sheet. */
export function Static({ children, mono = false, muted = false }: { children: ReactNode; mono?: boolean; muted?: boolean }) {
  return <span className={`kv-static${mono ? " mono" : ""}${muted ? " muted" : ""}`}>{children}</span>;
}

function showValue(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "number") return fmt(value);
  if (Array.isArray(value)) return value.map(showValue).join(" – ");
  return String(value);
}

/**
 * A computed value with its derivation inline. When `onOverride` is given the row is editable: the
 * input holds the override, the computed value is struck out beside it, and the × clears it.
 */
export function Derived({ derivation, unit, onOverride, onOpenSource, integer = true, readOnly = false }: {
  derivation: Derivation<unknown>; unit?: string; onOverride?: (value: number | undefined) => void; onOpenSource?: (source: Derivation["source"]) => void; integer?: boolean; readOnly?: boolean;
}) {
  const { value, computed, expression, overridden, source } = derivation;
  const numeric = typeof computed === "number" || typeof value === "number";
  const canEdit = Boolean(onOverride) && numeric && !readOnly;
  return <span className={`derived${overridden ? " is-overridden" : ""}`}>
    {canEdit
      ? <NumberInput value={typeof value === "number" ? value : undefined} integer={integer} onChange={next => onOverride?.(next === computed ? undefined : next)} ariaLabel="Override" title={overridden ? `Computed ${showValue(computed)}${expression ? ` = ${expression}` : ""}` : expression ? `= ${expression}` : undefined} />
      : <strong className="derived-value mono">{showValue(value)}{unit && <small> {unit}</small>}</strong>}
    {overridden && <s className="derived-computed mono" title="Computed value">{showValue(computed)}</s>}
    {overridden && onOverride && !readOnly && <button type="button" className="derived-clear" aria-label="Clear override" title="Use the computed value" onClick={() => onOverride(undefined)}><X size={11} /></button>}
    {expression && <span className="derived-expression mono">= {expression}</span>}
    {source.label && (onOpenSource
      ? <button type="button" className="derived-source" onClick={() => onOpenSource(source)}>{source.label}</button>
      : <span className="derived-source">{source.label}</span>)}
  </span>;
}

/** The dirty/save/reset strip pages put at the top of an editable sheet. */
