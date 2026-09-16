import { useCallback, useId, useMemo, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { Undo2 } from "lucide-react";
import { describeChain, originState, revertTarget, type RecordRef, type Resolved } from "../../model/origin.js";
import { FieldContext, type FieldContextValue, type LabelHandlers } from "./context.js";
import { DOT_LEGEND, describeRevert, type DotState, type FieldPhase } from "./model.js";

/*
  One field anatomy for every page (docs/devdocs-inputs.md §3.2):

    label          [ 1800 ] ms  ●  ⟲   from Heath Jack · was 2400 ms from Grazer
                   control      dot revert  provenance line

  The wrapper owns the dot, the revert glyph, the provenance line, the hint shown while focused and
  the field-level keys (Backspace/Delete revert while focused but not editing). The control is
  `children`; it reports editing through `FieldContext`.
*/

export interface FieldProps<T = unknown> {
  label: ReactNode;
  /** Schema help. Shown under the control while the field is focused or editing, never as a tooltip. */
  hint?: string;
  unit?: string;
  /** The value's chain. Draws the dot, the revert glyph and the provenance line. */
  resolved?: Resolved<T>;
  /** Called with the value the field returns to. The glyph is hidden when there is nothing to return to. */
  onRevert?: (value: T | undefined) => void;
  onOpenRef?: (ref: RecordRef) => void;
  /** The curve's terms, shown in the focus state only. */
  expression?: string;
  error?: string;
  dirty?: boolean;
  mixed?: boolean;
  stale?: boolean;
  /** In a `Fields` grid: label above, dot only, the sentence moves to the focus state and the dot's title. */
  compact?: boolean;
  span?: 1 | 2 | 3 | 4;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

const legendLabel = (state: DotState): string => DOT_LEGEND.find(entry => entry.state === state)?.label ?? (state === "balance" ? "Balance target" : state === "default" ? "Default" : state === "absent" ? "Not set" : state);

/*
  The dot marks a value that deviates: it came from somewhere else, several records disagree, or it
  is wrong or stale. A value that is simply authored here, or simply computed by the curve the
  section already names, gets nothing. A mark on every field is a mark on none.
*/
// "balance" means the value still equals its balance target, which is the norm; drift shows up as
// "overridden" instead, so only that earns a mark.
const DEVIATIONS = new Set<DotState>(["overridden", "inherited", "mixed", "invalid", "stale"]);
const showDot = (state: DotState): boolean => DEVIATIONS.has(state);

export function Field<T>({ label, hint, unit, resolved, onRevert, onOpenRef, expression, error, dirty, mixed, stale, compact = false, span, disabled = false, className = "", children }: FieldProps<T>) {
  const labelId = useId();
  const [focused, setFocused] = useState(false);
  const [editing, setEditing] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [controlError, setControlError] = useState<string>();
  const [labelHandlers, setLabelHandlers] = useState<LabelHandlers | null>(null);

  const origin = resolved ? originState(resolved) : undefined;
  const target = resolved ? revertTarget(resolved) : undefined;
  const shownError = error ?? controlError;
  const state: DotState = shownError ? "invalid" : stale ? "stale" : mixed ? "mixed" : origin ?? "own";
  const phase: FieldPhase = editing ? "editing" : focused ? "focused" : "idle";
  const phrases = useMemo(() => resolved ? describeChain(resolved, unit) : [], [resolved, unit]);
  const sentence = phrases.map(phrase => phrase.text).join("");
  const canRevert = Boolean(onRevert && target && !disabled);

  const context = useMemo<FieldContextValue>(() => ({
    labelId, compact, disabled, setEditing, reportError: setControlError, setLabelHandlers, setScrubbing,
  }), [labelId, compact, disabled]);

  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setFocused(false); setEditing(false); setControlError(undefined); }
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing || !canRevert || !target) return;
    if (event.key === "Backspace" || event.key === "Delete") { event.preventDefault(); onRevert?.(target.value); }
  };

  const dotTitle = compact && sentence ? `${legendLabel(state)} · ${sentence}` : legendLabel(state);
  const origins = phrases.map((phrase, index) => phrase.ref
    ? (onOpenRef
      ? <button key={index} type="button" className="field-origin-ref" onClick={() => onOpenRef(phrase.ref!)}>{phrase.text}</button>
      : <span key={index} className="field-origin-ref">{phrase.text}</span>)
    : <span key={index}>{phrase.text}</span>);

  return <FieldContext.Provider value={context}>
    <div className={`field ${className}`.trim()} data-state={state} data-origin={origin} data-phase={phase} data-compact={compact || undefined} data-dirty={dirty || undefined} data-span={span} data-disabled={disabled || undefined} data-scrubbing={scrubbing || undefined}
      onFocus={onFocus} onBlur={onBlur} onKeyDown={onKeyDown}>
      <span className="field-label" id={labelId} data-scrub={labelHandlers ? "true" : undefined} title={[typeof label === "string" ? label : undefined, hint, labelHandlers ? "Alt+drag to scrub" : undefined].filter(Boolean).join(" · ") || undefined} {...labelHandlers}>{label}</span>
      <div className="field-body">
        <div className="field-control">
          {children}
          {showDot(state) && <span className="field-dot" data-state={state} title={dotTitle} aria-label={dotTitle} role="img" />}
          {canRevert && target && <button type="button" className="field-revert" tabIndex={-1} title={describeRevert(target, unit)} aria-label={describeRevert(target, unit)} onClick={() => onRevert?.(target.value)}><Undo2 size={12} /></button>}
          {!compact && origins.length > 0 && <span className="field-origin">{origins}</span>}
        </div>
        {compact && phase !== "idle" && origins.length > 0 && <span className="field-origin is-floating">{origins}</span>}
        {shownError && <span className="field-error" role="alert">{shownError}</span>}
        {(hint || expression) && <span className="field-below">
          {phase !== "idle" && expression && <span className="field-expression mono">= {expression}</span>}
          {hint && <span className="field-hint">{hint}</span>}
        </span>}
      </div>
    </div>
  </FieldContext.Provider>;
}

/** The dot states, inline, for the app shell. */
export function FieldLegend({ className = "" }: { className?: string }) {
  return <span className={`field-legend ${className}`.trim()} aria-label="Field dot legend">
    {DOT_LEGEND.map(entry => <span key={entry.state} className="field-legend-item" title={entry.meaning}><span className="field-dot" data-state={entry.state} aria-hidden /> {entry.label}</span>)}
  </span>;
}
