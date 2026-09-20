import { X } from "lucide-react";
import { DropSchema } from "../../../../game/src/content/schema/loot.js";
import { dropPerKill, formatChance } from "../../model/loot.js";
import { rowName } from "../../model/rows.js";
import { REF_COLLECTIONS, refTargetCollection, summaryContext, useReferenceIndex } from "../../model/refs.js";
import { NumberField, RefAddButton, RefField, clampProbability, fieldFromSchema, usePeek } from "../../ui/field/index.js";
import { Thumb } from "../../ui/Thumb.js";
import { Button } from "../../components/ui/index.js";
import { cn } from "../../lib/utils.js";

/*
  A pool's drops as loot cards, one line each: the item, how many and how often. A card you can
  edit is one segmented field; a read-only card says the same thing in the same places and opens
  the item.
*/

export interface Drop { itemId: string; quantity: [number, number]; chance: number }

const ITEM = fieldFromSchema(DropSchema, "itemId");
const CHANCE = fieldFromSchema(DropSchema, "chance");

const CARD = "loot-card flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-card p-1";
const GRID = "grid w-full gap-1";
/*
  An editable drop is one control, not boxes in a box: item, quantity and chance are segments of a
  single outlined field, split by hairlines. The segment being edited is the one that lights up.
*/
export const DROP = cn(
  "loot-card flex h-8 min-w-0 items-stretch overflow-hidden rounded-md border border-input bg-background text-xs shadow-xs transition-[border-color,box-shadow]",
  "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25",
  "[&_.ref-chip]:h-full [&_.ref-chip]:w-full [&_.ref-chip]:rounded-none [&_.ref-chip]:border-0 [&_.ref-chip]:bg-transparent [&_.ref-chip]:shadow-none [&_.ref-chip]:focus-visible:bg-accent [&_.ref-chip]:focus-visible:ring-0 [&_.ref-chip>svg]:hidden [&_.ref-open]:hidden",
);
export const SEGMENT = "flex shrink-0 items-center border-l border-border-subtle font-mono has-[input:focus]:bg-accent";
/** A number inside a segment: no box of its own, as wide as its digits. */
export const PART = "h-full w-[calc(var(--chars)*1ch+0.75rem)]! min-w-5 rounded-none border-0 bg-transparent shadow-none has-[input:focus-visible]:ring-0 [&_input]:px-1 [&_input]:text-center";
const range = ([low, high]: readonly [number, number]): string => low === high ? String(low) : `${low} to ${high}`;

/** Drops you can edit: the pool's own, or a shared table's when it is edited in place. */
export function LootCardGrid({ drops, count, onChange, readOnly = false, label = "Drop" }: { drops: Drop[]; count: number; onChange: (drops: Drop[]) => void; readOnly?: boolean; label?: string }) {
  const name = (index: number) => `${label} ${index + 1}`;
  const update = (index: number, drop: Drop) => onChange(drops.map((old, at) => at === index ? drop : old));
  if (readOnly) return <StaticLootCards drops={drops} count={count} />;
  if (!drops.length) return null;
  return <div className={cn(GRID, "grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]")}>
    {drops.map((drop, index) => {
      const fixed = drop.quantity[0] === drop.quantity[1];
      return <div key={`${drop.itemId}:${index}`} data-slot="stack-field" className={DROP}>
        <RefField kind={ITEM.ref} label={`${name(index)} item`} bare className="min-w-0 flex-1 [&_.ref-control]:w-full" value={drop.itemId}
          onChange={next => { if (next) update(index, { ...drop, itemId: next }); }} />
        <span className={cn(SEGMENT, "min-w-[4.25rem] justify-center")} title="How many drop, rolled between the two numbers.">
          <span aria-hidden className="pl-1.5 text-faint">×</span>
          <NumberField className={PART} value={drop.quantity[0]} integer min={1} ariaLabel={`${name(index)} minimum quantity`}
            onChange={next => { const low = next ?? 1; update(index, { ...drop, quantity: [low, Math.max(low, drop.quantity[1])] }); }} />
          <span aria-hidden className="text-faint">–</span>
          <NumberField className={cn(PART, fixed && "[&_input:not(:focus)]:text-faint")} value={drop.quantity[1]} integer min={drop.quantity[0]} ariaLabel={`${name(index)} maximum quantity`}
            onChange={next => update(index, { ...drop, quantity: [drop.quantity[0], Math.max(drop.quantity[0], next ?? drop.quantity[0])] })} />
        </span>
        <span className={cn(SEGMENT, "min-w-[3.5rem] justify-end pr-1.5")} title={count > 1 ? `${CHANCE.hint ?? ""} ${formatChance(dropPerKill(drop.chance, count))} per kill over ${count} rolls.`.trim() : CHANCE.hint}>
          <NumberField className={cn(PART, "[&_input]:pr-0.5 [&_input]:text-right")} value={Number((clampProbability(drop.chance) * 100).toPrecision(12))} min={0} max={100} step={1} ariaLabel={`${name(index)} chance`}
            onChange={next => { if (next !== undefined) update(index, { ...drop, chance: clampProbability(next / 100) }); }} />
          <span aria-hidden className="text-faint">%</span>
        </span>
        <button type="button" className="flex w-6 shrink-0 cursor-pointer items-center justify-center border-l border-border-subtle text-faint outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground" aria-label={`Remove ${drop.itemId}`} title="Remove drop" onClick={() => onChange(drops.filter((_, at) => at !== index))}><X className="size-3" /></button>
      </div>;
    })}
  </div>;
}

/** Adds a drop with whatever chance the roll has left: `used` counts its attached tables too. */
export function AddDrop({ drops, used, onChange, label = "Add drop" }: { drops: Drop[]; used?: number; onChange: (drops: Drop[]) => void; label?: string }) {
  const spare = Math.max(0, Math.round((1 - (used ?? drops.reduce((sum, row) => sum + row.chance, 0))) * 10000) / 10000);
  return <RefAddButton kind={ITEM.ref ?? "item"} label={label} onPick={itemId => onChange([...drops, { itemId, quantity: [1, 1], chance: spare }])} />;
}

/** Drops shown but not edited here: every one of them, as cards. */
export function StaticLootCards({ drops, count, emptyText = "No drops." }: { drops: readonly Drop[]; count: number; emptyText?: string }) {
  const { index } = useReferenceIndex();
  const ctx = summaryContext(index);
  const peek = usePeek();
  const collection = refTargetCollection("item", index.available) ?? REF_COLLECTIONS.item?.[0] ?? "items";
  if (!drops.length) return <p className="text-xs text-faint">{emptyText}</p>;
  return <div className={cn(GRID, "grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]")}>
    {drops.map((drop, at) => {
      const item = ctx.lookup("item", drop.itemId);
      const title = item ? rowName(item) : drop.itemId;
      return <button key={`${drop.itemId}:${at}`} type="button" data-slot="loot-card" title={`Open ${title}${count > 1 ? ` · ${formatChance(dropPerKill(drop.chance, count))} per kill over ${count} rolls` : ""}`}
        className={cn(CARD, "cursor-pointer pr-2 pl-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25")}
        onClick={() => peek.open({ collection, id: drop.itemId, label: title })}>
        <Thumb spec={{ kind: "item", id: drop.itemId }} size="s" className="size-7" alt="" />
        <span className={cn("min-w-0 flex-1 truncate", item ? "text-foreground" : "text-destructive")}>{title}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">× {range(drop.quantity)}</span>
        <span className="w-10 shrink-0 text-right font-mono text-[11px] text-foreground">{formatChance(drop.chance)}</span>
      </button>;
    })}
  </div>;
}
