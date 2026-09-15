import { type ReactNode } from "react";
import { ChoiceField, normalizeOptions, type ChoiceOption } from "./ChoiceField.js";
import { ListField } from "./ListField.js";
import { TextField } from "./TextField.js";

/*
  A keyed map (skill → level, slot → item) as rows of `key | value`. With `keys` the key cell is a
  choice of the keys not yet used and the add row is "Add skill…" over the same set; without them
  the key is typed. Rows remove like any `ListField` row: the glyph, or Backspace on the row.
*/

export interface MapFieldProps<V> {
  label?: ReactNode;
  hint?: string;
  value: Readonly<Record<string, V>>;
  onChange: (value: Record<string, V>) => void;
  /** The allowed keys. Omit to let keys be typed. */
  keys?: readonly ChoiceOption[] | readonly string[];
  /** Noun for the add row: "skill" reads "Add skill…". */
  keyLabel?: string;
  renderValue: (key: string, value: V, update: (next: V) => void) => ReactNode;
  defaultValue: (key: string) => V;
  readOnly?: boolean;
  emptyText?: string;
  compact?: boolean;
  className?: string;
}

type Entry<V> = readonly [key: string, value: V];

export function MapField<V>({ label, hint, value, onChange, keys, keyLabel = "key", renderValue, defaultValue, readOnly = false, emptyText = "None", compact, className = "" }: MapFieldProps<V>) {
  const entries: Entry<V>[] = Object.entries(value);
  const listed = keys ? normalizeOptions(keys) : undefined;
  const remaining = listed?.filter(option => !Object.hasOwn(value, option.value)) ?? [];
  const labelOf = (key: string): string => listed?.find(option => option.value === key)?.label ?? key;

  const commit = (next: Entry<V>[]) => onChange(Object.fromEntries(next));
  const rename = (index: number, next: string) => {
    const trimmed = next.trim();
    if (!trimmed || (trimmed !== entries[index]?.[0] && Object.hasOwn(value, trimmed))) return;
    commit(entries.map((entry, at) => at === index ? [trimmed, entry[1]] as const : entry));
  };
  const add = (key: string) => {
    const trimmed = key.trim();
    if (!trimmed || Object.hasOwn(value, trimmed)) return;
    commit([...entries, [trimmed, defaultValue(trimmed)]]);
  };

  const addControl = readOnly ? undefined : listed
    ? (remaining.length > 0 ? <ChoiceField value={undefined} allowEmpty={`Add ${keyLabel}…`} options={remaining} ariaLabel={`Add ${keyLabel}`} onChange={next => { if (next) add(next); }} className="field-list-add-choice" /> : undefined)
    : <TextField value="" placeholder={`Add ${keyLabel}…`} width="short" ariaLabel={`Add ${keyLabel}`} onChange={add} className="field-list-add-text" />;

  return <ListField<Entry<V>> label={label} hint={hint} items={entries} onChange={commit} keyOf={entry => entry[0]} readOnly={readOnly} emptyText={emptyText} compact={compact} className={`field-map ${className}`.trim()}
    addControl={addControl}
    removeLabel={entry => `Remove ${labelOf(entry[0])}`}
    renderItem={([key, current], api) => <>
      <span className="field-map-key">
        {listed
          ? <ChoiceField value={key} options={[...listed.filter(option => option.value === key), ...remaining]} readOnly={readOnly} ariaLabel={`${keyLabel} ${api.index + 1}`} onChange={next => { if (next) rename(api.index, next); }} />
          : <TextField value={key} width="short" readOnly={readOnly} ariaLabel={`${keyLabel} ${api.index + 1}`} onChange={next => rename(api.index, next)} />}
      </span>
      <span className="field-map-value">{renderValue(key, current, next => api.update([key, next]))}</span>
    </>} />;
}
