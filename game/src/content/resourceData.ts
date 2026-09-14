import type { ResourceDef } from './index.js';
import { COMPILED_PROGRESSION } from './compiler/runtime.js';
export const RESOURCE_RECORDS = COMPILED_PROGRESSION.resources;
export const RESOURCE_DATA: readonly ResourceDef[] = RESOURCE_RECORDS;
const RESOURCE_BY_ID = new Map(RESOURCE_DATA.map(row => [row.id, row]));

export function resourceById(id: string): ResourceDef {
  const resource = RESOURCE_BY_ID.get(id);
  if (!resource) throw new Error(`Unknown resource ${id}`);
  return resource;
}
