import type { RefKind } from "../../../../game/src/content/schema/core.js";
import { cn } from "../../lib/utils.js";
import { NumberField } from "./NumberField.js";
import { RefField } from "./RefField.js";

/*
  An item and how many, as one control: the item is the unit of the count.

    [🜲 Copper Bar   × 2 ]      [🜲 Raw Game Meat   × 1 – 2 ]

  The chip keeps RefField's keys (Space peeks, Enter picks) and the count is a NumberField with its
  steps; they share one border so a list of stacks reads as a list of things, not of boxes.
  `quantity` as a pair edits a range (a drop's min and max).
*/

export interface StackFieldProps {
  kind?: RefKind;
  collection?: string;
  /** The accessible name of the item ("Ingredient 1"). */
  label: string;
  value: string | undefined;
  onChange: (itemId: string | undefined) => void;
  quantity: number | readonly [number, number];
  onQuantityChange: (quantity: number | [number, number]) => void;
  min?: number;
  readOnly?: boolean;
  exclude?: ReadonlySet<string>;
  className?: string;
}

// A floor of three digits keeps the × of every row in a list on one line.
const COUNT = "h-full w-[calc(var(--chars)*1ch+1rem)]! min-w-10 border-0 bg-transparent shadow-none has-[input:focus-visible]:ring-0 [&_input]:px-1 [&_input]:text-right";

export function StackField({ kind = "item", collection, label, value, onChange, quantity, onQuantityChange, min = 1, readOnly = false, exclude, className }: StackFieldProps) {
  const range = Array.isArray(quantity) ? quantity as readonly [number, number] : undefined;
  const single = typeof quantity === "number" ? quantity : undefined;
  return <span data-slot="stack-field" className={cn(
    "group/stack inline-flex h-7 min-w-44 max-w-full items-stretch overflow-hidden rounded-md border border-input bg-background shadow-xs transition-[border-color,box-shadow]",
    "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25",
    "[&_.ref-chip]:h-full [&_.ref-chip]:rounded-none [&_.ref-chip]:border-0 [&_.ref-chip]:bg-transparent [&_.ref-chip]:shadow-none [&_.ref-chip]:focus-visible:ring-0",
    className,
  )}>
    <RefField kind={kind} collection={collection} label={label} bare value={value} readOnly={readOnly} exclude={exclude} onChange={onChange}
      className="min-w-0 flex-1 [&_.ref-chip]:w-full [&_.ref-control]:w-full" />
    <span className="flex shrink-0 items-center border-l border-border-subtle pl-1.5 font-mono text-[11px] text-faint">
      <span aria-hidden>×</span>
      {range
        ? <>
          <NumberField className={COUNT} value={range[0]} integer min={min} readOnly={readOnly} ariaLabel={`${label} minimum quantity`} onChange={next => { const low = next ?? min; onQuantityChange([low, Math.max(low, range[1])]); }} />
          <span aria-hidden>–</span>
          <NumberField className={COUNT} value={range[1]} integer min={range[0]} readOnly={readOnly} ariaLabel={`${label} maximum quantity`} onChange={next => onQuantityChange([range[0], Math.max(range[0], next ?? range[0])])} />
        </>
        : <NumberField className={COUNT} value={single} integer min={min} readOnly={readOnly} ariaLabel={`${label} quantity`} onChange={next => onQuantityChange(next ?? min)} />}
    </span>
  </span>;
}
