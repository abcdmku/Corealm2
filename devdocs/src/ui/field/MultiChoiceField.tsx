import type { ReactNode } from "react";
import { ChoiceChips } from "../../components/ui/index.js";
import { optionsFor, useReferenceIndex } from "../../model/refs.js";
import { gameArt } from "../gameArt.js";
import { choiceLabel } from "./choiceIcons.js";
import { Field } from "./Field.js";

/*
  A list drawn from a small fixed set (the stations a template accepts, the skills a quest touches)
  as toggle chips: every member visible, a click adds or removes it. The set is an enum's choices or
  an option kind's options; when it is larger than a row of chips, or a value is not in it, the
  caller's list editor renders instead.
*/

export const MULTI_CHOICE_LIMIT = 12;

export function MultiChoiceField({ label, hint, value, onChange, choices, kind, readOnly = false, dirty, fallback }: {
  label?: ReactNode;
  hint?: string;
  value: readonly string[];
  onChange: (next: string[]) => void;
  choices?: readonly string[];
  /** An option kind (`station`, `skill`) whose options come from the reference index. */
  kind?: string;
  readOnly?: boolean;
  dirty?: boolean;
  /** The list editor for a set too large for chips. */
  fallback: ReactNode;
}) {
  const { index } = useReferenceIndex();
  const options = choices?.map(choice => ({ value: choice, label: choiceLabel(choice, choice) })) ?? (kind ? optionsFor(kind, index) : undefined);
  if (!options || options.length > MULTI_CHOICE_LIMIT || value.some(entry => !options.some(option => option.value === entry))) return <>{fallback}</>;
  const items = options.map(option => ({ value: option.value, label: option.label, art: gameArt(option.value) }));
  const control = readOnly
    ? <span className="inline-flex h-7 items-center text-xs">{value.length ? items.filter(item => value.includes(item.value)).map(item => item.label).join(", ") : <span className="text-faint">None</span>}</span>
    : <ChoiceChips items={items} value={value} onValueChange={onChange} aria-label={typeof label === "string" ? label : undefined} />;
  return label === undefined ? control : <Field label={label} hint={hint} dirty={dirty} disabled={readOnly}>{control}</Field>;
}
