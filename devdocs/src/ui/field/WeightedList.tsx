import { useState, type ReactNode } from "react";
import { Lock, LockOpen } from "lucide-react";
import { ListField, type ListFieldProps, type ListItemApi } from "./ListField.js";
import { NumberField } from "./NumberField.js";
import { clampProbability, redistribute, shares } from "./reorder.js";

/*
  A `ListField` whose rows carry a number that reads as a share (docs/devdocs-inputs.md §3.6).

  `weightKey`: members compete for one roll. Each row shows its weight, a bar of its share of the
  total (3/1/1 reads 60/20/20) and a lock. With `keepTotal`, editing an unlocked weight scales the
  other unlocked weights so the total stays put; locked rows never move. This is the one pattern
  the research found no primary source for, so it is a prototype to test.

  `probabilityKey`: each row rolls on its own, 0..1 shown as a percentage with its own fill. The
  rows do not sum to anything, so there is no redistribution and no lock.
*/

export interface WeightedListProps<T extends Record<string, unknown>> extends Omit<ListFieldProps<T>, "renderAside"> {
  weightKey?: keyof T & string;
  probabilityKey?: keyof T & string;
  /** Weights only: an edit to one unlocked row is paid for by the other unlocked rows. */
  keepTotal?: boolean;
  /** Step of the weight control. Probabilities step by one percent. */
  step?: number;
}

const numberAt = (item: Record<string, unknown>, key: string): number => { const value = item[key]; return typeof value === "number" && Number.isFinite(value) ? value : 0; };
const percent = (share: number): string => `${Math.round(share * 100)}%`;

export function WeightedList<T extends Record<string, unknown>>({ weightKey, probabilityKey, keepTotal = false, step = 0.5, items, onChange, keyOf, readOnly, ...rest }: WeightedListProps<T>) {
  const [locked, setLocked] = useState<Set<string | number>>(() => new Set());
  // A rejected edit (every other row locked) leaves the number control showing the typed value;
  // remounting it puts the unchanged weight back.
  const [rejected, setRejected] = useState(0);
  const key = (item: T, index: number): string | number => keyOf ? keyOf(item, index) : index;
  const weights = weightKey ? items.map(item => numberAt(item, weightKey)) : [];
  const shareOf = shares(weights);
  const lockedFlags = items.map((item, index) => locked.has(key(item, index)));

  const setWeight = (index: number, next: number | undefined) => {
    if (!weightKey || next === undefined) return;
    const target = Math.max(0, next);
    if (!keepTotal) { onChange(items.map((item, at) => at === index ? { ...item, [weightKey]: target } : item)); return; }
    const spread = redistribute(weights, index, target, lockedFlags);
    if (spread.every((weight, at) => weight === weights[at])) { setRejected(count => count + 1); return; }
    onChange(items.map((item, at) => spread[at] === weights[at] ? item : { ...item, [weightKey]: spread[at] }));
  };
  const setProbability = (index: number, next: number | undefined) => {
    if (!probabilityKey || next === undefined) return;
    onChange(items.map((item, at) => at === index ? { ...item, [probabilityKey]: clampProbability(next / 100) } : item));
  };
  const toggleLock = (item: T, index: number) => {
    const id = key(item, index);
    setLocked(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const renderAside = (item: T, api: ListItemApi<T>): ReactNode => {
    if (weightKey) {
      const isLocked = lockedFlags[api.index] ?? false;
      const share = shareOf[api.index] ?? 0;
      return <span className="field-weight" data-locked={isLocked || undefined}>
        <NumberField key={rejected} value={numberAt(item, weightKey)} min={0} step={step} readOnly={readOnly || isLocked} ariaLabel={`Weight ${api.index + 1}`} onChange={next => setWeight(api.index, next)} />
        <span className="field-weight-bar" role="img" aria-label={`${percent(share)} of the group`} title={`${percent(share)} of the group`}><span className="field-weight-fill" style={{ width: `${share * 100}%` }} /></span>
        <span className="field-weight-share mono">{percent(share)}</span>
        {!readOnly && <button type="button" className="field-weight-lock" aria-pressed={isLocked} aria-label={`${isLocked ? "Unlock" : "Lock"} weight ${api.index + 1}`} title={isLocked ? "Unlock: let this weight move" : "Lock: keep this weight while others change"} onClick={() => toggleLock(item, api.index)}>{isLocked ? <Lock size={11} /> : <LockOpen size={11} />}</button>}
      </span>;
    }
    if (probabilityKey) {
      const chance = clampProbability(numberAt(item, probabilityKey));
      return <span className="field-weight" data-probability>
        <NumberField value={Math.round(chance * 1000) / 10} min={0} max={100} step={1} unit="%" readOnly={readOnly} ariaLabel={`Chance ${api.index + 1}`} onChange={next => setProbability(api.index, next)} />
        <span className="field-weight-bar" role="img" aria-label={`${percent(chance)} chance`} title={`${percent(chance)} chance`}><span className="field-weight-fill" style={{ width: `${chance * 100}%` }} /></span>
      </span>;
    }
    return null;
  };

  return <ListField<T> {...rest} items={items} onChange={onChange} keyOf={keyOf} readOnly={readOnly} renderAside={renderAside} className={`field-weighted ${rest.className ?? ""}`.trim()} />;
}
