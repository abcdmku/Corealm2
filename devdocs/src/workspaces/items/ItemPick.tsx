import { useMemo, type ReactElement } from "react";
import { ChevronDown } from "lucide-react";
import type { ContentRow } from "../../model/contracts.js";
import { RecordPicker } from "../../ui/RecordPicker.js";
import { Thumb } from "../../ui/Thumb.js";
import type { ItemsData } from "./data.js";

/** A chip showing an item that opens the item picker when clicked. `slot` limits the list to gear for that slot. */
export function ItemPick({ value, onPick, data, ariaLabel, disabled, slot, placeholder = "Pick an item", trigger }: {
  value?: string; onPick: (id: string, record: ContentRow) => void; data: Pick<ItemsData, "item" | "compiled">; ariaLabel: string; disabled?: boolean; slot?: string; placeholder?: string;
  /** Replace the default chip with a custom trigger element. */
  trigger?: ReactElement;
}) {
  const record = value ? data.item(value) : undefined;
  const exclude = useMemo(() => {
    if (!slot) return undefined;
    const out = new Set<string>();
    for (const row of data.compiled.values()) if (row.equip?.slot !== slot) out.add(row.id);
    return out;
  }, [slot, data.compiled]);
  const chip = trigger ?? <button type="button" className={`ref-chip item-pick${value && !record ? " is-missing" : ""}${value ? "" : " is-empty"}`} aria-label={ariaLabel} disabled={disabled} title={value}>
    {value ? <Thumb spec={{ kind: "item", id: value }} size="s" /> : null}
    <span>{record?.name ?? value ?? placeholder}</span>
    {!disabled && <ChevronDown size={11} className="muted" />}
  </button>;
  if (disabled) return chip;
  return <RecordPicker collection="compiled-items" value={value} onPick={onPick} exclude={exclude} trigger={chip} placeholder={slot ? `Search ${slot} gear…` : undefined} />;
}
