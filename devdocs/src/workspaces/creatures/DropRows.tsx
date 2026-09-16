import { DropSchema } from "../../../../game/src/content/schema/loot.js";
import { NumberField, RefField, TextField, WeightedList, fieldFromSchema } from "../../ui/field/index.js";

/*
  The drop list a creature's own loot and a shared loot table both edit: one 28px row per drop,

    [item chip ✎]  [min] to [max]  [group]        [chance %] ▬▬▬  ⟲

  `WeightedList` with `probabilityKey` draws the chance and its fill; each drop rolls on its own so
  there is no redistribution. The item is a `RefField` with its label hidden by `.drop-item`
  (Space peeks the item, Enter picks another); the add row is an empty `RefField` whose pick
  appends a drop. Editing an inherited list makes it the record's own through `onChange`.
*/

export interface Drop extends Record<string, unknown> { itemId: string; quantity: [number, number]; chance: number; exclusiveGroup?: string }

const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const dropList = (value: unknown): Drop[] => list(value).map(entry => entry as Drop);

const ITEM = fieldFromSchema(DropSchema, "itemId");
const QUANTITY = fieldFromSchema(DropSchema, "quantity");
const GROUP = fieldFromSchema(DropSchema, "exclusiveGroup");

export function DropRows({ drops, onChange, readOnly = false, emptyText = "No drops." }: { drops: Drop[]; onChange: (drops: Drop[]) => void; readOnly?: boolean; emptyText?: string }) {
  const add = (itemId: string | undefined) => { if (itemId) onChange([...drops, { itemId, quantity: [1, 1], chance: 0.5 }]); };
  return <WeightedList<Drop> items={drops} probabilityKey="chance" onChange={onChange} readOnly={readOnly} emptyText={emptyText} className="max-w-[55rem]" contentClassName="flex-nowrap"
    keyOf={(drop, index) => `${drop.itemId}:${index}`}
    removeLabel={drop => `Remove ${drop.itemId}`}
    addControl={readOnly ? undefined : <RefField kind={ITEM.ref} label="Add drop" bare value={undefined} onChange={add} />}
    renderItem={(drop, api) => <>
      <RefField kind={ITEM.ref} label={`${ITEM.label} ${api.index + 1}`} value={drop.itemId} readOnly={readOnly} onChange={next => { if (next) api.update({ ...drop, itemId: next }); }} bare className="min-w-44 flex-1 [&_.ref-control]:flex-1 [&_.ref-chip]:flex-1" />
      <NumberField value={drop.quantity[0]} integer min={1} readOnly={readOnly} ariaLabel={`${QUANTITY.label} minimum ${api.index + 1}`} onChange={next => { const low = next ?? 1; api.update({ ...drop, quantity: [low, Math.max(low, drop.quantity[1])] }); }} />
      <span className="text-[11px] text-faint">to</span>
      <NumberField value={drop.quantity[1]} integer min={drop.quantity[0]} readOnly={readOnly} ariaLabel={`${QUANTITY.label} maximum ${api.index + 1}`} onChange={next => api.update({ ...drop, quantity: [drop.quantity[0], Math.max(drop.quantity[0], next ?? drop.quantity[0])] })} />
      <TextField value={drop.exclusiveGroup ?? ""} width="short" className={drop.exclusiveGroup ? "w-32" : "w-32 opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100"} placeholder={GROUP.label.toLowerCase()} readOnly={readOnly} ariaLabel={`${GROUP.label} ${api.index + 1}`} onChange={next => { const { exclusiveGroup, ...bare } = drop; void exclusiveGroup; api.update(next.trim() ? { ...bare, exclusiveGroup: next.trim() } : bare); }} />
    </>} />;
}
