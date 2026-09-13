import rawResources from "../../content/data/resources.json";
import type { ResourceDef } from "./index.js";
import { parseCollection } from "./schema/core.js";
import { ResourceRecordSchema, type ResourceCatalog, type ResourceRecord } from "./schema/resources.js";

/** Parse and strip once so named views and production ladders share resource objects. */
export const RESOURCE_RECORDS: readonly ResourceRecord[] = parseCollection(ResourceRecordSchema, rawResources, { name: "resources" });
export const RESOURCE_DATA: readonly ResourceDef[] = RESOURCE_RECORDS.map(({ catalog: _catalog, ...resource }) => resource);
const RESOURCE_BY_ID = new Map(RESOURCE_DATA.map(resource => [resource.id, resource] as const));

/** Select catalogs in file order, regardless of the requested catalog order. */
export function resourceRows(catalog: ResourceCatalog | readonly ResourceCatalog[]): readonly ResourceDef[] {
  const selected = new Set<ResourceCatalog>(typeof catalog === "string" ? [catalog] : catalog);
  return RESOURCE_DATA.filter((_resource, index) => selected.has(RESOURCE_RECORDS[index]!.catalog));
}

/** Missing authored references fail during import rather than later in gameplay. */
export function resourceById(resourceId: string): ResourceDef {
  const resource = RESOURCE_BY_ID.get(resourceId);
  if (!resource) throw new Error(`Unknown resource id "${resourceId}".`);
  return resource;
}
