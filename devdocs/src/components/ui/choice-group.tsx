import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "../../lib/utils.js";

/*
  A small fixed set of choices, all visible at once: one click instead of open-scan-pick, and the
  current value reads at a glance. `segments` is one bordered strip (2–5 short options); `chips` is
  a wrapping row of pills (a longer set with icons, or a multi-select). Radix gives the radio or
  checkbox semantics and arrow-key movement.
*/

export interface ChoiceItem<T extends string = string> {
  value: T;
  label: React.ReactNode;
  /** The game's mark for the value (a skill colour, an element motif, a rune stone). */
  art?: React.ReactNode;
  /** Tooltip; also the accessible name when `iconOnly`. */
  title?: string;
  /** A count or short figure after the label ("Art 3"). */
  count?: React.ReactNode;
  disabled?: boolean;
}

type Look = "segments" | "chips";

const ROOT: Record<Look, string> = {
  // A strip that has no room wraps its segments instead of pushing out of its column.
  segments: "inline-flex min-h-7 max-w-full flex-wrap items-center gap-0.5 rounded-md border border-input bg-background p-0.5 shadow-xs",
  chips: "inline-flex max-w-full flex-wrap items-center gap-1",
};

const ITEM: Record<Look, string> = {
  segments: "h-[1.375rem] rounded-sm px-2 text-muted-foreground hover:bg-accent hover:text-foreground data-[state=on]:bg-selected data-[state=on]:font-medium data-[state=on]:text-foreground data-[state=on]:ring-1 data-[state=on]:ring-border",
  chips: "h-7 rounded-full border border-input bg-background px-2.5 text-muted-foreground hover:bg-accent hover:text-foreground data-[state=on]:border-primary data-[state=on]:bg-brass-soft data-[state=on]:text-foreground",
};

const itemClass = (look: Look, iconOnly: boolean, className?: string) => cn(
  "inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-xs whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50",
  "[&_small]:font-mono [&_small]:text-[11px] [&_small]:text-faint",
  ITEM[look], iconOnly && (look === "segments" ? "px-1.5" : "px-2"), className,
);

function Content({ item, iconOnly }: { item: ChoiceItem; iconOnly: boolean }) {
  return <>
    {item.art}
    {iconOnly && item.art ? <span className="sr-only">{item.label}</span> : <span>{item.label}</span>}
    {item.count !== undefined && <small>{item.count}</small>}
  </>;
}

export function ChoiceGroup<T extends string = string>({ items, value, onValueChange, look = "segments", iconOnly = false, allowDeselect = false, disabled, className, itemClassName, ...props }: {
  items: readonly ChoiceItem<T>[];
  value: T | undefined;
  onValueChange: (value: T | undefined) => void;
  look?: Look;
  /** Icons alone, the label in the tooltip and for assistive tech: for a narrow cell. */
  iconOnly?: boolean;
  /** Clicking the chosen item clears the value (an optional field). */
  allowDeselect?: boolean;
  disabled?: boolean;
  className?: string;
  itemClassName?: string;
} & Omit<React.ComponentProps<"div">, "defaultValue" | "dir" | "onChange">) {
  return <ToggleGroupPrimitive.Root type="single" data-slot="choice-group" data-look={look} value={value ?? ""} disabled={disabled}
    onValueChange={next => { if (next === "" && !allowDeselect) return; onValueChange(next === "" ? undefined : next as T); }}
    className={cn(ROOT[look], className)} {...props}>
    {items.map(item => <ToggleGroupPrimitive.Item key={item.value} value={item.value} disabled={item.disabled} title={item.title ?? (iconOnly && typeof item.label === "string" ? item.label : undefined)}
      className={itemClass(look, iconOnly && Boolean(item.art), itemClassName)}>
      <Content item={item} iconOnly={iconOnly} />
    </ToggleGroupPrimitive.Item>)}
  </ToggleGroupPrimitive.Root>;
}

/** Several of a small set: toggle chips. */
export function ChoiceChips<T extends string = string>({ items, value, onValueChange, disabled, className, iconOnly = false, ...props }: {
  items: readonly ChoiceItem<T>[];
  value: readonly T[];
  onValueChange: (value: T[]) => void;
  disabled?: boolean;
  iconOnly?: boolean;
  className?: string;
} & Omit<React.ComponentProps<"div">, "defaultValue" | "dir" | "onChange">) {
  // Keep the set's own order, not the order of clicks.
  const order = new Map(items.map((item, index) => [item.value, index]));
  return <ToggleGroupPrimitive.Root type="multiple" data-slot="choice-chips" value={[...value]} disabled={disabled}
    onValueChange={next => onValueChange((next as T[]).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)))}
    className={cn(ROOT.chips, className)} {...props}>
    {items.map(item => <ToggleGroupPrimitive.Item key={item.value} value={item.value} disabled={item.disabled} title={item.title}
      className={itemClass("chips", iconOnly && Boolean(item.art))}>
      <Content item={item} iconOnly={iconOnly} />
    </ToggleGroupPrimitive.Item>)}
  </ToggleGroupPrimitive.Root>;
}
