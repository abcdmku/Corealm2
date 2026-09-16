import { Checkbox } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
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
  return <label className={cn("field-toggle inline-flex h-7 cursor-pointer items-center gap-2 text-xs text-foreground", inert && "cursor-default opacity-60", className)} data-disabled={inert || undefined}>
    <Checkbox checked={value} disabled={inert} aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : field.labelId} onCheckedChange={checked => onChange(checked === true)} />
    <span>{value ? labels[0] : labels[1]}</span>
  </label>;
}
