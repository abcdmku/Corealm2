import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useFieldContext, type LabelHandlers } from "./context.js";
import { applyMixedOp, clampNumber, evaluateNumber, formatNumber, parseMixedEdit, scrubDelta, stepValue, type MixedOp, type NumberRules } from "./model.js";

/*
  A number with its own edit buffer. Nothing reaches `onChange` per keystroke: commits happen on
  Enter (focus stays), Tab and blur (native move), an arrow step, and a scrub release. Escape puts
  the pre-edit value back. `=3*4` evaluates on commit. Alt+drag on the enclosing `Field`'s label
  scrubs, previewing through `onPreview` and committing once on release.
*/

export type NumberWidth = "num" | "short" | "full";

export interface NumberFieldProps {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  /** Live value during a scrub. The commit still arrives once through `onChange` on release. */
  onPreview?: (value: number) => void;
  /** With `mixed`, receives the raw relative edit (`+10`) and its parsed op instead of a single value. */
  onMixedEdit?: (text: string, op: MixedOp) => void;
  unit?: string;
  integer?: boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  /** `num` 76px (default), `short` 160px, `full` fills the row. */
  width?: NumberWidth;
  ariaLabel?: string;
  /** An empty commit clears the value. Otherwise an empty buffer restores the previous value. */
  optional?: boolean;
  /** Several records disagree: the buffer shows "Mixed" and accepts `+10`, `*1.1`. */
  mixed?: boolean;
  autoFocus?: boolean;
  className?: string;
}

export function NumberField({ value, onChange, onPreview, onMixedEdit, unit, integer, min, max, step, placeholder, disabled, readOnly, width = "num", ariaLabel, optional = false, mixed = false, autoFocus, className = "" }: NumberFieldProps) {
  const field = useFieldContext();
  const [text, setText] = useState(mixed ? "" : formatNumber(value));
  const [editing, setEditingState] = useState(false);
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rules: NumberRules = { integer, min, max, step };
  const stepSize = step ?? (integer ? 1 : undefined);
  const inert = disabled || readOnly || field.disabled;

  const setEditing = (next: boolean) => { setEditingState(next); field.setEditing(next); };
  const clearError = () => { setInvalid(false); field.reportError(undefined); };
  const fail = (message: string) => { setInvalid(true); field.reportError(message); };

  // A value that changes from outside while the field is focused but not editing (a revert, an
  // undo) is selected once it reaches the DOM, so typing keeps replacing rather than appending.
  const selectNext = useRef(false);
  useEffect(() => {
    if (editing) return;
    setText(mixed ? "" : formatNumber(value));
    if (focused) selectNext.current = true;
  }, [value, editing, mixed, focused]);
  useLayoutEffect(() => {
    if (!selectNext.current) return;
    selectNext.current = false;
    if (!editing && document.activeElement === inputRef.current) inputRef.current?.select();
  }, [text, editing]);

  const restore = () => { setText(mixed ? "" : formatNumber(value)); setEditing(false); clearError(); };

  const settle = (next: number | undefined) => { setText(mixed ? "" : formatNumber(next)); setEditing(false); clearError(); };

  /** Returns false when the buffer does not parse; the caller decides whether to keep or restore it. */
  const commit = (raw: string): boolean => {
    const trimmed = raw.trim();
    if (!trimmed) {
      if (optional) { onChange(undefined); settle(undefined); return true; }
      restore();
      return true;
    }
    if (mixed) {
      const parsed = parseMixedEdit(trimmed);
      if (!parsed.ok) { fail(parsed.message); return false; }
      if (onMixedEdit) onMixedEdit(trimmed, parsed.op);
      else onChange(clampNumber(applyMixedOp(parsed.op, value ?? 0), rules));
      settle(undefined);
      return true;
    }
    const result = evaluateNumber(trimmed);
    if (!result.ok) { fail(result.message); return false; }
    const next = clampNumber(result.value, rules);
    onChange(next);
    settle(next);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (inert) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (editing) { if (commit(text)) requestAnimationFrame(() => inputRef.current?.select()); }
      else inputRef.current?.select();
    } else if (event.key === "Escape") {
      if (editing) { event.preventDefault(); restore(); requestAnimationFrame(() => inputRef.current?.select()); }
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      if (mixed) return;
      const parsed = editing ? evaluateNumber(text) : undefined;
      const base = parsed?.ok ? parsed.value : value ?? 0;
      const next = stepValue(base, event.key, { shift: event.shiftKey, alt: event.altKey }, rules);
      onChange(next);
      settle(next);
    }
  };

  // Alt+drag on the label. Pointer capture keeps the events on the label while the pointer roams.
  const latest = useRef({ value, rules, stepSize, onChange, onPreview, inert, mixed });
  latest.current = { value, rules, stepSize, onChange, onPreview, inert, mixed };
  const scrub = useRef<{ pointerId: number; x: number; y: number; base: number; last: number } | null>(null);
  useEffect(() => {
    const handlers: LabelHandlers = {
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        const now = latest.current;
        if (!event.altKey || now.inert || now.mixed || event.button !== 0) return;
        event.preventDefault();
        const base = now.value ?? 0;
        scrub.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, base, last: base };
        event.currentTarget.setPointerCapture(event.pointerId);
        field.setScrubbing(true);
        document.body.style.cursor = "ew-resize";
      },
      onPointerMove(event: ReactPointerEvent<HTMLElement>) {
        const active = scrub.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const now = latest.current;
        const next = clampNumber(active.base + scrubDelta(event.clientX - active.x, event.clientY - active.y, now.stepSize ?? 1), now.rules);
        if (next === active.last) return;
        active.last = next;
        setText(formatNumber(next));
        now.onPreview?.(next);
      },
      onPointerUp(event: ReactPointerEvent<HTMLElement>) {
        const active = scrub.current;
        if (!active || active.pointerId !== event.pointerId) return;
        scrub.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        field.setScrubbing(false);
        document.body.style.cursor = "";
        const now = latest.current;
        if (active.last !== active.base) now.onChange(active.last);
        else setText(formatNumber(now.value));
      },
      onPointerCancel(event: ReactPointerEvent<HTMLElement>) {
        const active = scrub.current;
        if (!active) return;
        scrub.current = null;
        field.setScrubbing(false);
        document.body.style.cursor = "";
        setText(formatNumber(latest.current.value));
        void event;
      },
    };
    field.setLabelHandlers(handlers);
    return () => field.setLabelHandlers(null);
  }, [field]);

  // The box hugs the digits in the buffer, so `12` and `26000` each sit right beside their label
  // and their unit. Placeholders ("Mixed", "none") count too, or an empty field would collapse.
  const chars = Math.max(2, (text || placeholder || (mixed ? "Mixed" : "")).length);

  return <span className={`field-input ${className}`.trim()} style={{ "--chars": chars } as CSSProperties} data-kind="number" data-width={width} data-unit={unit || undefined} data-zero={value === 0 && !focused && !mixed ? "true" : undefined} data-invalid={invalid || undefined} data-disabled={inert || undefined} data-editing={editing || undefined}>
    <input ref={inputRef} type="text" inputMode="decimal" className="mono" value={text} placeholder={mixed ? "Mixed" : placeholder} disabled={disabled || field.disabled} readOnly={readOnly} autoFocus={autoFocus}
      aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : field.labelId} aria-invalid={invalid || undefined} autoComplete="off" spellCheck={false}
      onChange={event => { if (inert) return; selectNext.current = false; setText(event.target.value); if (!editing) setEditing(true); if (invalid) clearError(); }}
      onKeyDown={onKeyDown}
      onFocus={event => { setFocused(true); event.target.select(); }}
      onBlur={() => { setFocused(false); if (editing && !commit(text)) restore(); }} />
    {unit && <span className="field-unit">{unit}</span>}
  </span>;
}
