import type { ReactNode } from "react";
import { cn } from "../../lib/utils.js";
import { NumberField } from "./NumberField.js";

/*
  A number for each of a small fixed set, every member shown: the runes a spell spends, the skill
  levels an item requires, the XP a quest grants per skill.

    [🜲 Mind 2 ] [🜲 Chaos – ] [🜲 Death 1 ] …       ⛏ Mining 20   🪓 Woodcutting –

  A member with no number is drawn faint with an empty box; typing a number includes it, clearing the
  box leaves it out. No add row, no remove button, no dropdown: the set is the control.
*/

export interface CountOption { value: string; label: string; art?: ReactNode }

export interface CountGridProps {
  options: readonly CountOption[];
  value: Readonly<Record<string, number | undefined>>;
  onChange: (next: Record<string, number>) => void;
  /** Names each box for assistive tech: "Rune cost" reads "Rune cost, Mind Rune". */
  label: string;
  min?: number;
  max?: number;
  integer?: boolean;
  readOnly?: boolean;
  className?: string;
}

export function CountGrid({ options, value, onChange, label, min, max, integer = true, readOnly = false, className }: CountGridProps) {
  const set = (key: string, next: number | undefined) => {
    const out: Record<string, number> = {};
    // The set's order, not the order of edits; keys outside the set (legacy data) are kept at the end.
    for (const option of options) { const current = option.value === key ? next : value[option.value]; if (current !== undefined) out[option.value] = current; }
    for (const [other, current] of Object.entries(value)) if (!options.some(option => option.value === other) && current !== undefined) out[other] = current;
    onChange(out);
  };
  const shown = readOnly ? options.filter(option => value[option.value] !== undefined) : options;
  if (readOnly && !shown.length) return <span className="inline-flex h-7 items-center text-xs text-faint">None</span>;
  // Past six members a tile hugs its name and a member not set keeps a narrow box, so ten skills with
  // one XP value read as a line or two of names rather than rows of empty boxes.
  const tight = options.length > 6;
  return <div data-slot="count-grid" className={cn("flex w-full min-w-0 max-w-[44rem] flex-wrap gap-1", className)}>
    {shown.map(option => {
      const current = value[option.value];
      const on = current !== undefined;
      const narrow = tight && !on;
      return <label key={option.value} className={cn(
        "group/count flex h-7 min-w-0 items-stretch overflow-hidden rounded-md border text-xs transition-[border-color,box-shadow]",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25",
        on ? "border-input bg-background shadow-xs" : "border-dashed border-border text-muted-foreground hover:border-input hover:text-foreground",
      )} data-set={on || undefined}>
        <span className={cn("flex min-w-0 items-center gap-1.5 pl-1.5", tight ? "pr-1.5" : "w-28", "[&_.thumb]:size-5", !on && "[&>[aria-hidden]]:opacity-60")}>
          {option.art}
          <span className={cn("truncate", on && "text-foreground")}>{option.label}</span>
        </span>
        <NumberField className={cn("h-full shrink-0 rounded-none border-0 border-l border-border-subtle bg-transparent shadow-none has-[input:focus-visible]:ring-0", narrow ? "w-7! focus-within:w-12! [&_input]:px-1" : "w-[calc(var(--chars)*1ch+1.75rem)]! min-w-11 [&_input]:px-1.5")}
          value={current} optional integer={integer} min={min} max={max} placeholder="–" readOnly={readOnly}
          ariaLabel={`${label}, ${option.label}`} onChange={next => set(option.value, next)} />
      </label>;
    })}
  </div>;
}
