import { useFieldContext } from "./context.js";

/** A checkbox reading Yes/No. Space flips it (native); the flip is the commit. */
export interface ToggleFieldProps {
  value: boolean;
  onChange: (value: boolean) => void;
  /** Replace Yes/No, e.g. `["Shown", "Hidden"]`. */
  labels?: readonly [on: string, off: string];
  disabled?: boolean;
  readOnly?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function ToggleField({ value, onChange, labels = ["Yes", "No"], disabled, readOnly, ariaLabel, className = "" }: ToggleFieldProps) {
  const field = useFieldContext();
  const inert = disabled || readOnly || field.disabled;
  return <label className={`field-toggle ${className}`.trim()} data-disabled={inert || undefined}>
    <input type="checkbox" checked={value} disabled={inert} aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : field.labelId} onChange={event => onChange(event.target.checked)} />
    <span>{value ? labels[0] : labels[1]}</span>
  </label>;
}
