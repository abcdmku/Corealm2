import { DropSchema } from "../../../../game/src/content/schema/loot.js";
import { EditTable, NumberField, RefAddButton, RefField, TextField, clampProbability, fieldFromSchema } from "../../ui/field/index.js";

/*
  The drop list a creature's own loot and a shared loot table both edit, as a table whose heads say
  what each box is:

    Item                   Quantity      Chance per kill   Exclusive group
    [🜲 Coarse Hide ▾] ↗    [1] to [2]    [60] %            [ none ]          ×
    + Add drop

  Each drop rolls on its own, so chances do not sum to anything. The add button picks an item and
  appends it at 50%. Editing an inherited list makes it the record's own through `onChange`.
*/

export interface Drop extends Record<string, unknown> { itemId: string; quantity: [number, number]; chance: number; exclusiveGroup?: string }

const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const dropList = (value: unknown): Drop[] => list(value).map(entry => entry as Drop);

const ITEM = fieldFromSchema(DropSchema, "itemId");
const CHANCE = fieldFromSchema(DropSchema, "chance");
const GROUP = fieldFromSchema(DropSchema, "exclusiveGroup");

export function DropRows({ drops, onChange, readOnly = false, emptyText = "No drops." }: { drops: Drop[]; onChange: (drops: Drop[]) => void; readOnly?: boolean; emptyText?: string }) {
  const name = (index: number) => `Drop ${index + 1}`;
  return <EditTable<Drop> label="Drops" items={drops} onChange={onChange} readOnly={readOnly} emptyText={emptyText} className="max-w-[44rem]"
    template="grid-cols-[minmax(9rem,1fr)_auto_auto_minmax(5rem,7rem)_1.5rem]"
    keyOf={(drop, index) => `${drop.itemId}:${index}`}
    removeLabel={drop => `Remove ${drop.itemId}`}
    addControl={readOnly ? undefined : <RefAddButton kind={ITEM.ref ?? "item"} label="Add drop" onPick={itemId => onChange([...drops, { itemId, quantity: [1, 1], chance: 0.5 }])} />}
    columns={[
      { key: "item", header: "Item", render: (drop, api) => <RefField kind={ITEM.ref} label={`${name(api.index)} item`} bare className="w-full [&_.ref-control]:w-full [&_.ref-chip]:min-w-0 [&_.ref-chip]:flex-1" value={drop.itemId} readOnly={readOnly} onChange={next => { if (next) api.update({ ...drop, itemId: next }); }} /> },
      { key: "quantity", header: "Quantity", hint: "How many drop, rolled between the two numbers.", render: (drop, api) => <>
        <NumberField value={drop.quantity[0]} integer min={1} readOnly={readOnly} ariaLabel={`${name(api.index)} minimum quantity`} className="w-14!"
          onChange={next => { const low = next ?? 1; api.update({ ...drop, quantity: [low, Math.max(low, drop.quantity[1])] }); }} />
        <span className="text-faint">to</span>
        <NumberField value={drop.quantity[1]} integer min={drop.quantity[0]} readOnly={readOnly} ariaLabel={`${name(api.index)} maximum quantity`} className="w-14!"
          onChange={next => api.update({ ...drop, quantity: [drop.quantity[0], Math.max(drop.quantity[0], next ?? drop.quantity[0])] })} />
      </> },
      { key: "chance", header: "Chance per kill", hint: CHANCE.hint, render: (drop, api) =>
        <NumberField value={Math.round(clampProbability(drop.chance) * 1000) / 10} min={0} max={100} step={1} unit="%" readOnly={readOnly} ariaLabel={`${name(api.index)} chance`}
          onChange={next => { if (next !== undefined) api.update({ ...drop, chance: clampProbability(next / 100) }); }} /> },
      { key: "group", header: "Exclusive group", hint: `${GROUP.hint ?? ""} Leave empty for a drop that rolls independently.`, render: (drop, api) =>
        <TextField value={drop.exclusiveGroup ?? ""} width="full" placeholder="none" readOnly={readOnly} ariaLabel={`${name(api.index)} exclusive group`}
          onChange={next => { const { exclusiveGroup, ...rest } = drop; void exclusiveGroup; api.update(next.trim() ? { ...rest, exclusiveGroup: next.trim() } : rest); }} /> },
    ]} />;
}
