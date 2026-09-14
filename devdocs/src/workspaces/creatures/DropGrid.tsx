import type { CSSProperties } from "react";
import { rowName } from "../../model/rows.js";
import { percent, rangeText, type SummaryContext } from "../../model/summaries.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ViewProps } from "../types.js";

export interface Drop { itemId: string; quantity: [number, number]; chance: number; exclusiveGroup?: string }

const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const dropList = (value: unknown): Drop[] => list(value).map(entry => entry as Drop);

/** The read-only drop grid: icon, name, quantity and chance per drop. Clicking opens the item. */
export function DropGrid({ drops, ctx, navigate }: { drops: Drop[]; ctx: SummaryContext; navigate: ViewProps["navigate"] }) {
  if (!drops.length) return <p className="empty-inline">No drops.</p>;
  return <div className="drop-grid">{drops.map((drop, index) => {
    const item = ctx.lookup("item", drop.itemId);
    return <button type="button" key={`${drop.itemId}:${index}`} className={`drop-tile${item ? "" : " is-missing"}`} onClick={() => navigate("items", drop.itemId)} title={drop.itemId}>
      <Thumb spec={{ kind: "item", id: drop.itemId }} size="l" />
      <span className="drop-tile-name">{item ? rowName(item) : drop.itemId}</span>
      <span className="drop-tile-meta"><span>×{rangeText(drop.quantity) || "1"}</span><span className="drop-chance" style={{ "--chance": drop.chance } as CSSProperties}>{percent(drop.chance)}</span></span>
    </button>;
  })}</div>;
}
