import type { ReactNode } from "react";
import { fmtValue, type RecordRef, type Resolved } from "../../model/origin.js";
import { ChoiceField, type ChoiceOption } from "./ChoiceField.js";
import { Field } from "./Field.js";
import { NumberField, type NumberWidth } from "./NumberField.js";

/*
  The replacement for `Sheet`'s `Derived`. A number with a chain: the control shows the resolved
  value whatever its origin, so typing over a curve or inherited value creates an own value (the
  dot turns brass, the revert appears). Reverting hands `undefined` to `onChange`, which the page
  writes as "remove the own value".
*/

interface DerivedShared {
  label: ReactNode;
  hint?: string;
  onOpenRef?: (ref: RecordRef) => void;
  readOnly?: boolean;
  compact?: boolean;
  span?: 1 | 2 | 3 | 4;
  dirty?: boolean;
  stale?: boolean;
  mixed?: boolean;
  error?: string;
  className?: string;
}

export interface DerivedNumberProps extends DerivedShared {
  resolved: Resolved<number | undefined>;
  onChange: (value: number | undefined) => void;
  onPreview?: (value: number) => void;
  unit?: string;
  integer?: boolean;
  min?: number;
  max?: number;
  step?: number;
  width?: NumberWidth;
  /** An empty commit removes the own value rather than restoring it. */
  optional?: boolean;
}

const expressionOf = (resolved: Resolved<unknown>): string | undefined => {
  const head = resolved.chain[0]?.origin;
  return head?.kind === "curve" ? head.expression : undefined;
};

export function DerivedNumber({ resolved, onChange, onPreview, unit, integer = true, min, max, step, width, optional, label, hint, onOpenRef, readOnly = false, compact, span, dirty, stale, mixed, error, className }: DerivedNumberProps) {
  return <Field label={label} hint={hint} unit={unit} resolved={resolved} onRevert={readOnly ? undefined : () => onChange(undefined)} onOpenRef={onOpenRef} expression={expressionOf(resolved)} compact={compact} span={span} dirty={dirty} stale={stale} mixed={mixed} error={error} className={className}>
    {readOnly
      ? <span className="field-static mono">{fmtValue(resolved.value)}{unit && <span className="field-unit">{unit}</span>}</span>
      : <NumberField value={resolved.value} onChange={onChange} onPreview={onPreview} unit={unit} integer={integer} min={min} max={max} step={step} width={width} optional={optional} mixed={mixed} />}
  </Field>;
}

export interface DerivedChoiceProps<T extends string = string> extends DerivedShared {
  resolved: Resolved<T | undefined>;
  onChange: (value: T | undefined) => void;
  options: readonly ChoiceOption<T>[] | readonly T[];
  allowEmpty?: string;
}

export function DerivedChoice<T extends string = string>({ resolved, onChange, options, allowEmpty, label, hint, onOpenRef, readOnly = false, compact, span, dirty, stale, mixed, error, className }: DerivedChoiceProps<T>) {
  return <Field label={label} hint={hint} resolved={resolved} onRevert={readOnly ? undefined : () => onChange(undefined)} onOpenRef={onOpenRef} compact={compact} span={span} dirty={dirty} stale={stale} mixed={mixed} error={error} className={className}>
    {readOnly
      ? <span className="field-static">{resolved.value ?? "—"}</span>
      : <ChoiceField value={resolved.value} onChange={onChange} options={options} allowEmpty={allowEmpty} />}
  </Field>;
}
