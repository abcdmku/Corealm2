import { useFieldContext } from "./context.js";
import type { TextWidth } from "./TextField.js";

/*
  An enum as one native `<select>`: type-ahead, arrow keys and Space are the browser's. Commits on
  change. A value that is not in the option list is shown as a flagged option instead of being
  silently accepted or silently replaced.
*/

export type ChoiceOption<T extends string = string> = { value: T; label?: string };

export interface ChoiceFieldProps<T extends string = string> {
  value: T | undefined;
  /** `undefined` arrives only when `allowEmpty` is set and the empty row is chosen. */
  onChange: (value: T | undefined) => void;
  options: readonly ChoiceOption<T>[] | readonly T[];
  /** Label of an empty first row that clears the value. */
  allowEmpty?: string;
  width?: TextWidth;
  disabled?: boolean;
  readOnly?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function normalizeOptions<T extends string>(options: readonly ChoiceOption<T>[] | readonly T[]): { value: T; label: string }[] {
  return options.map(option => typeof option === "string" ? { value: option, label: option } : { value: option.value, label: option.label ?? option.value });
}

export function ChoiceField<T extends string = string>({ value, onChange, options, allowEmpty, width = "short", disabled, readOnly, ariaLabel, className = "" }: ChoiceFieldProps<T>) {
  const field = useFieldContext();
  const listed = normalizeOptions(options);
  const offList = value !== undefined && value !== "" && !listed.some(option => option.value === value);
  const inert = disabled || readOnly || field.disabled;
  // A choice of one is not a choice: show the value instead of a dropdown that offers only itself.
  if (listed.length === 1 && value === listed[0]!.value && allowEmpty === undefined) {
    return <span className={`field-static ${className}`.trim()} aria-labelledby={ariaLabel ? undefined : field.labelId} aria-label={ariaLabel}>{listed[0]!.label}</span>;
  }
  return <select className={`field-select ${className}`.trim()} data-width={width} data-invalid={offList || undefined} aria-invalid={offList || undefined} value={value ?? ""} disabled={inert}
    aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : field.labelId}
    onChange={event => { const next = event.target.value; onChange(next === "" && allowEmpty !== undefined ? undefined : next as T); }}>
    {(allowEmpty !== undefined || value === undefined || value === "") && <option value="" disabled={allowEmpty === undefined}>{allowEmpty ?? "—"}</option>}
    {offList && <option value={value}>{`${value} (not an option)`}</option>}
    {listed.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>;
}
