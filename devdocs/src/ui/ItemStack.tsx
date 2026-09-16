import type { ReactNode } from "react";
import { chipVariants } from "../components/ui/chip.js";
import { cn } from "../lib/utils.js";
import { Thumb } from "./Thumb.js";

/*
  An item and a count as one control-height chip: icon, name, "×2". Used wherever a recipe, a drop
  or a reward is listed, so a line of them sits on one baseline with the inputs around it.
*/
export function ItemStack({ id, name, quantity, onOpen, className }: { id: string; name: string; quantity?: ReactNode; onOpen?: () => void; className?: string }) {
  const body = <>
    <Thumb spec={{ kind: "item", id }} size="s" alt="" />
    <span>{name}</span>
    {quantity !== undefined && <small className="tabular-nums">×{quantity}</small>}
  </>;
  return onOpen
    ? <button type="button" className={cn(chipVariants({ state: "link" }), className)} title={id} onClick={onOpen}>{body}</button>
    : <span className={cn(chipVariants({ state: "option" }), "cursor-default", className)} title={id}>{body}</span>;
}

/** Label/value pairs on one line: "Time 1.8 s · XP 55 · Level 5". */
export function InlineStats({ items }: { items: readonly { label: string; value: ReactNode }[] }) {
  return <dl className="m-0 flex min-h-7 flex-wrap items-center gap-x-5 gap-y-1 text-xs">
    {items.map(item => <div key={item.label} className="flex items-baseline gap-1.5">
      <dt className="text-faint">{item.label}</dt>
      <dd className="m-0 font-medium tabular-nums text-foreground">{item.value}</dd>
    </div>)}
  </dl>;
}
