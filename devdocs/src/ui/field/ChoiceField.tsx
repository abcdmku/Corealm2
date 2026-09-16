import type { ReactNode } from "react";
import { ChoiceGroup, NativeSelect } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";
import { gameArt } from "../gameArt.js";
import { choiceLabel } from "./choiceIcons.js";
import { useFieldContext } from "./context.js";
import type { TextWidth } from "./TextField.js";

/*
  An enum. A small set shows every choice at once: two to five short options are a segmented strip,
  up to eight are a row of chips, and in a narrow grid cell a few options the game has a mark for
  (an element's motif, a skill's colour) are the marks alone. Anything longer is one native `<select>` (type-ahead, arrow keys
  and Space are the browser's). A value that is not in the option list always falls back to the
  select, where it shows as a flagged option instead of being silently accepted or replaced.
*/

export type ChoiceOption<T extends string = string> = { value: T; label?: string; art?: ReactNode };
export type ChoiceDisplay = "auto" | "select" | "segments" | "chips" | "icons";

export interface ChoiceFieldProps<T extends string = string> {
  value: T | undefined;
  /** `undefined` arrives only when `allowEmpty` is set and the empty row is chosen (or the chosen segment is clicked again). */
  onChange: (value: T | undefined) => void;
  options: readonly ChoiceOption<T>[] | readonly T[];
  /** Label of an empty first row that clears the value. */
  allowEmpty?: string;
  width?: TextWidth;
  /** `auto` picks segments, chips or a select from the size of the set; pickers of an action ("Add skill…") pass `select`. */
  display?: ChoiceDisplay;
  disabled?: boolean;
  readOnly?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function normalizeOptions<T extends string>(options: readonly ChoiceOption<T>[] | readonly T[]): { value: T; label: string; art?: ReactNode }[] {
  return options.map(option => {
    const value = typeof option === "string" ? option : option.value;
    const raw = typeof option === "string" ? option : option.label ?? option.value;
    return { value, label: choiceLabel(value, raw), art: (typeof option === "string" ? undefined : option.art) ?? gameArt(value) };
  });
}

type Resolved = "select" | "segments" | "chips" | "icons";

function pick(listed: { label: string; art?: ReactNode }[], display: ChoiceDisplay, compact: boolean, offList: boolean): Resolved {
  if (offList || display === "select") return "select";
  if (display === "segments") return compact && listed.every(option => option.art) ? "icons" : "segments";
  if (display === "chips") return "chips";
  if (display === "icons") return listed.every(option => option.art) ? "icons" : "select";
  const marked = listed.every(option => option.art);
  const letters = listed.reduce((sum, option) => sum + option.label.length, 0);
  if (compact) return marked && listed.length <= 4 ? "icons" : "select";
  if (listed.length <= 5 && letters <= 44) return "segments";
  if (listed.length <= 8 && letters <= 80) return "chips";
  if (listed.length <= 10 && marked && letters <= 90) return "chips";
  return "select";
}

export function ChoiceField<T extends string = string>({ value, onChange, options, allowEmpty, width = "short", display = "auto", disabled, readOnly, ariaLabel, className = "" }: ChoiceFieldProps<T>) {
  const field = useFieldContext();
  const listed = normalizeOptions(options);
  const offList = value !== undefined && value !== "" && !listed.some(option => option.value === value);
  const inert = disabled || readOnly || field.disabled;
  const chosen = listed.find(option => option.value === value);
  const labelled = { "aria-label": ariaLabel, "aria-labelledby": ariaLabel ? undefined : field.labelId };

  // A choice of one is not a choice: show the value instead of a control that offers only itself.
  if (listed.length === 1 && value === listed[0]!.value && allowEmpty === undefined) return <Static option={listed[0]!} className={className} {...labelled} />;

  const mode = listed.length === 0 ? "select" : pick(listed, display, field.compact, offList);
  if (mode !== "select") {
    // Read-only, a set of buttons is noise: the value is enough.
    if (readOnly || field.disabled) return chosen ? <Static option={chosen} className={className} {...labelled} /> : <span className={cn("inline-flex h-7 items-center text-xs text-faint", className)} {...labelled}>{allowEmpty ?? "—"}</span>;
    return <ChoiceGroup<T> look={mode === "chips" ? "chips" : "segments"} iconOnly={mode === "icons"} className={cn("field-choice", className)} value={value || undefined} disabled={disabled}
      allowDeselect={allowEmpty !== undefined} onValueChange={onChange} items={listed.map(option => ({ value: option.value, label: option.label, art: option.art }))} {...labelled} />;
  }

  return <NativeSelect wrapperClassName={cn(WIDTH[width], className)} className="field-select" data-width={width} data-invalid={offList || undefined} aria-invalid={offList || undefined} value={value ?? ""} disabled={inert}
    {...labelled}
    onChange={event => { const next = event.target.value; onChange(next === "" && allowEmpty !== undefined ? undefined : next as T); }}>
    {(allowEmpty !== undefined || value === undefined || value === "") && <option value="" disabled={allowEmpty === undefined}>{allowEmpty ?? "—"}</option>}
    {offList && <option value={value}>{`${value} (not an option)`}</option>}
    {listed.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </NativeSelect>;
}

function Static({ option, className, ...labelled }: { option: { label: string; art?: ReactNode }; className?: string; "aria-label"?: string; "aria-labelledby"?: string }) {
  return <span className={cn("field-static inline-flex h-7 items-center gap-1.5 text-xs", className)} {...labelled}>{option.art}{option.label}</span>;
}

const WIDTH: Readonly<Record<TextWidth, string>> = { short: "w-40", id: "w-56", text: "w-full max-w-[22.5rem]", full: "w-full" };
