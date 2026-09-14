import { RESOLVED_TABLES } from './resolvedCatalog.js';
const rawSets = RESOLVED_TABLES["equipmentSets"];
import type { EquipmentSetDefinition } from "./equipmentSets.js";
import { parseCollection } from "./schema/core.js";
import { EquipmentSetRecordSchema, type EquipmentSetRecord } from "./schema/equipmentSets.js";

/** Authored thresholds load as written. Balance edits never rewrite them during import. */
export const SET_RECORDS: readonly EquipmentSetRecord[] = parseCollection(EquipmentSetRecordSchema, rawSets, { name: "equipmentSets" });
export const SET_DATA: readonly EquipmentSetDefinition[] = SET_RECORDS;
