import rawSets from "../../content/data/equipmentSets.json";
import type { EquipmentSetDefinition } from "./equipmentSets.js";
import { parseCollection } from "./schema/core.js";
import { EquipmentSetRecordSchema, type EquipmentSetRecord, type SetCatalog } from "./schema/equipmentSets.js";

/** Authored thresholds load as written. Balance edits never rewrite them during import. */
export const SET_RECORDS: readonly EquipmentSetRecord[] = parseCollection(EquipmentSetRecordSchema, rawSets, { name: "equipmentSets" });
export const SET_DATA: readonly EquipmentSetDefinition[] = SET_RECORDS.map(({ catalog: _catalog, derivation: _derivation, ...set }) => set);

/** Filters exclusive primary catalogs in file order and shares runtime set objects. */
export function setRows(catalog: SetCatalog | readonly SetCatalog[]): readonly EquipmentSetDefinition[] {
  const selected = new Set<SetCatalog>(typeof catalog === "string" ? [catalog] : catalog);
  return SET_DATA.filter((_set, index) => selected.has(SET_RECORDS[index]!.catalog));
}
