import { RESOLVED_TABLES } from './resolvedCatalog.js';
import type { EquipmentSetDefinition } from "./equipmentSets.js";
import { parseCollection } from "./schema/core.js";
import { EquipmentSetRecordSchema, type EquipmentSetRecord } from "./schema/equipmentSets.js";

/** Authored thresholds load as written. Balance edits never rewrite them during import. */
const setRows = (): EquipmentSetRecord[] => parseCollection(EquipmentSetRecordSchema, RESOLVED_TABLES["equipmentSets"], { name: "equipmentSets" });
const sets = setRows();
export const SET_RECORDS: readonly EquipmentSetRecord[] = sets;
export const SET_DATA: readonly EquipmentSetDefinition[] = SET_RECORDS;

/** After the catalog moved: the same array, refilled. `EQUIPMENT_SETS` is this array too. */
export function reindexEquipmentSets(): void {
  sets.splice(0, sets.length, ...setRows());
}
