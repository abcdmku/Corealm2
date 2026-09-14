import type { ItemDef } from '../contracts.js';
import { COMPILED_PROGRESSION } from './compiler/runtime.js';
export const ITEM_RECORDS = COMPILED_PROGRESSION.items;
export const ITEM_DATA: readonly ItemDef[] = ITEM_RECORDS;

