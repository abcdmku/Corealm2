import rawItems from "../../content/data/items.json";
import type { ItemDef } from "../contracts.js";
import { parseCollection } from "./schema/core.js";
import { ItemRecordSchema, type ItemCatalog, type ItemRecord } from "./schema/itemRecords.js";

/** Parse and strip once so every runtime view shares the same item objects. */
export const ITEM_RECORDS: readonly ItemRecord[] = parseCollection(ItemRecordSchema, rawItems, { name: "items" });
export const ITEM_DATA: readonly ItemDef[] = ITEM_RECORDS.map(({ catalog: _catalog, derivation: _derivation, ...item }) => item);

/** Filters primary catalogs in file order; supplying multiple catalogs never regroups rows. */
export function itemRows(catalog: ItemCatalog | readonly ItemCatalog[]): readonly ItemDef[] {
  const selected = new Set<ItemCatalog>(typeof catalog === "string" ? [catalog] : catalog);
  return ITEM_DATA.filter((_item, index) => selected.has(ITEM_RECORDS[index]!.catalog));
}
