import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { fmtValue } from "../../model/origin.js";
import { sameValue, tally, type Tally } from "./consequence.js";
import "./formulas.css";

/*
  What a curve edit does to the records that use it (docs/devdocs-inputs.md 3.10). The role, family
  and template drawers recompute their consumers from the draft; these are the three pieces that
  turn that recomputation into a consequence: the before/after cell, the same cell for a consumer
  whose own override pins it in place, and the tally in the section aside.

  Tufte's small multiples, not a chart: one row per consumer, one number per column.
*/

const show = (value: unknown, digits: number, unit: string): string =>
  value === undefined || value === null ? "—" : `${fmtValue(value, digits)}${unit}`;

/** A number that moved: the old value struck, the new one in accent. Unchanged values print plain. */
export function Change({ before, after, digits = 0, unit = "" }: { before: unknown; after: unknown; digits?: number; unit?: string }) {
  if (sameValue(before, after)) return <span className="mono">{show(after, digits, unit)}</span>;
  return <span className="mono change"><s>{show(before, digits, unit)}</s><ArrowRight size={10} /><strong>{show(after, digits, unit)}</strong></span>;
}

export interface ConsequenceCellProps {
  /** The curve's value before the edit, and after it. */
  before: unknown;
  after: unknown;
  /** The consumer's own value when it overrides the curve. The curve moves; this record does not. */
  own?: unknown;
  digits?: number;
  unit?: string;
  /** Names the number in the pinned cell's title, e.g. "Health". */
  label?: string;
}

/**
 * One consumer's number under the edit. With no override it is the curve's before and after. With
 * one, the record keeps its own value and the cell says so: the value, a brass dot, and the curve
 * it is ignoring in the title.
 */
export function ConsequenceCell({ before, after, own, digits = 0, unit = "", label }: ConsequenceCellProps) {
  if (own === undefined) return <Change before={before} after={after} digits={digits} unit={unit} />;
  const name = label ? `${label}: ` : "";
  const title = sameValue(before, after)
    ? `${name}own ${show(own, digits, unit)}, curve ${show(after, digits, unit)}`
    : `${name}own ${show(own, digits, unit)} does not move · curve ${show(before, digits, unit)} → ${show(after, digits, unit)}`;
  return <span className="mono unmoved" title={title}>
    {show(own, digits, unit)}
    <span className="field-dot" data-state="overridden" role="img" aria-label="Own override: does not move" />
  </span>;
}

export { movesWith, rowMovement, sameValue, tally, type Movement, type Tally } from "./consequence.js";

/**
 * The section aside. While nothing has changed it prints `idle` (how many consumers there are);
 * once the draft moves something it says what the edit does, including the consumers it cannot
 * reach because they override the value themselves.
 */
export function ConsequenceNote({ tally: counts, noun, idle }: { tally: Tally; noun: string; idle: ReactNode }) {
  if (!counts.moved && !counts.pinned) return <>{idle}</>;
  return <span>
    {counts.moved} of {counts.total} {noun} move
    {counts.pinned > 0 && <> · <span className="unmoved">{counts.pinned} pinned by an own override<span className="field-dot" data-state="overridden" role="img" aria-label="" /></span></>}
  </span>;
}
