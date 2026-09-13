import type { ResourceDef } from "./index.js";
import { RESOURCE_DATA, resourceById } from "./resourceData.js";

/** Canonical archetypes in authored file order. Cluster aliases are unsupported. */
export const RESOURCES: readonly ResourceDef[] = RESOURCE_DATA;

/** Strict authoring lookup. A cluster with a missing resource reference is a boot-time error. */
export function resourceDef(resourceId: string): ResourceDef {
  return resourceById(resourceId);
}

/** Canonical resource rows without cluster aliases. Useful for docs and guides. */
export const RESOURCE_ARCHETYPES: readonly ResourceDef[] = RESOURCES;
