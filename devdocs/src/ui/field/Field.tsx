import { useCallback, useId, useMemo, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { Undo2 } from "lucide-react";
import { describeChain, originState, revertTarget, type RecordRef, type Resolved } from "../../model/origin.js";
import { Button } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { ON_SHEET, ROW_COLUMNS, SheetLevel, useOnSheet } from "../Sheet.js";
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
  /** Keep the label for assistive tech only: a table's row and column heads already say it. */
  labelHidden?: boolean;
  /** Inside a list row or a table cell: no columns of its own, the label for assistive tech only. */
  bare?: boolean;
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

export function Field<T>({ label, hint, unit, resolved, onRevert, onOpenRef, expression, error, dirty, mixed, stale, compact = false, labelHidden = false, bare = false, span, disabled = false, className, children }: FieldProps<T>) {
  const onSheet = useOnSheet();
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
      ? <button key={index} type="button" className="cursor-pointer text-link hover:underline" onClick={() => onOpenRef(phrase.ref!)}>{phrase.text}</button>
      : <span key={index} className="text-link">{phrase.text}</span>)
    : <span key={index}>{phrase.text}</span>);

  return <FieldContext.Provider value={context}>
    <div className={cn(
      "field group/field relative min-w-0",
      bare ? "inline-flex min-w-0 items-center" : compact ? "flex flex-col gap-1" : cn("min-h-7 items-start py-px", onSheet ? ON_SHEET : ROW_COLUMNS),
      span === 2 && "col-span-2", span === 3 && "col-span-3", span === 4 && "col-span-4",
      scrubbing && "cursor-ew-resize",
      // Unsaved: a bar in the gutter, outside the box, so it never moves the row.
      dirty && "before:absolute before:top-1 before:bottom-1 before:-left-2 before:w-0.5 before:rounded-full before:bg-primary before:content-['']",
      className,
    )} data-state={state} data-origin={origin} data-phase={phase} data-compact={compact || undefined} data-dirty={dirty || undefined} data-span={span} data-disabled={disabled || undefined} data-scrubbing={scrubbing || undefined}
      onFocus={onFocus} onBlur={onBlur} onKeyDown={onKeyDown}>
      <span className={cn(
        "field-label truncate select-none",
        labelHidden || bare ? "sr-only" : compact ? "text-[11px] leading-snug text-muted-foreground" : "block h-7 text-right text-xs leading-7 text-muted-foreground",
        disabled && "text-faint", state === "invalid" && "text-destructive",
      )} id={labelId} data-scrub={labelHandlers ? "true" : undefined}
        title={[typeof label === "string" ? label : undefined, hint, labelHandlers ? "Alt+drag to scrub" : undefined].filter(Boolean).join(" · ") || undefined} {...labelHandlers}>{label}</span>
      <SheetLevel.Provider value={false}>
        <div className={cn("field-body relative flex min-w-0 flex-col gap-0.5", bare && "flex-1")}>
          <div className={cn("field-control flex min-h-7 min-w-0 items-center text-xs", compact ? "flex-nowrap gap-1" : "gap-1.5")}>
            {children}
            {showDot(state) && <span className={cn("field-dot size-2 shrink-0 rounded-full", DOT[state])} data-state={state} title={dotTitle} aria-label={dotTitle} role="img" />}
            {canRevert && target && <Button variant="ghost" size="icon-xs" className="field-revert" tabIndex={-1} title={describeRevert(target, unit)} aria-label={describeRevert(target, unit)} onClick={() => onRevert?.(target.value)}><Undo2 /></Button>}
            {!compact && !bare && origins.length > 0 && <span className="field-origin min-w-0 flex-1 truncate text-[11px] leading-tight text-faint">{origins}</span>}
          </div>
          {(compact || bare) && phase !== "idle" && origins.length > 0 && <span className={FLOAT}>{origins}</span>}
          {shownError && <span className="field-error text-[11px] leading-snug text-destructive [overflow-wrap:anywhere]" role="alert">{shownError}</span>}
          {/* Help and the curve's terms float under the control while it has focus; hovering the label shows the help too. */}
          {!compact && !bare && phase !== "idle" && (hint || expression) && <span className={cn(FLOAT, "flex flex-wrap gap-x-2")}>
            {expression && <span className="font-mono">= {expression}</span>}
            {hint && <span>{hint}</span>}
          </span>}
        </div>
      </SheetLevel.Provider>
    </div>
  </FieldContext.Provider>;
}

const FLOAT = "pointer-events-none absolute top-full left-0 z-20 mt-px max-w-md rounded-md border border-border bg-popover px-2 py-1 text-[11px] leading-snug whitespace-normal text-muted-foreground shadow-md";

const DOT: Readonly<Record<DotState, string>> = {
  own: "border border-dashed border-border", default: "", absent: "",
  curve: "border-[1.5px] border-muted-foreground", balance: "border-[1.5px] border-muted-foreground",
  inherited: "bg-muted-foreground", overridden: "bg-primary",
  mixed: "h-0.5 rounded-[1px] bg-muted-foreground",
  invalid: "border-[1.5px] border-destructive", stale: "border-[1.5px] border-warn",
};

/** The dot states, inline, for the app shell. */
export function FieldLegend({ className }: { className?: string }) {
  return <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground", className)} aria-label="Field dot legend">
    {DOT_LEGEND.map(entry => <span key={entry.state} className="inline-flex items-center gap-1.5" title={entry.meaning}><span className={cn("size-2 shrink-0 rounded-full", DOT[entry.state])} aria-hidden /> {entry.label}</span>)}
  </span>;
}
