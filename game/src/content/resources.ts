import { HIGH_TIER_TREE_RESOURCES } from "./treeSpecies.js";
import { WILDERNESS_ORE_RESOURCES, WILDERNESS_TREE_RESOURCES } from './wildernessResources.js';
/**
 * Gatherable resource catalog.
 *
 * Mining, woodcutting, and fishing rows are generated directly from the canonical tier catalog.
 */
import type { ResourceDef } from "./index.js";
import { GATHERING_PRODUCTION_TIERS } from "./gatheringProductionTiers.js";

const ESSENCE_RESOURCES: readonly ResourceDef[] = GATHERING_PRODUCTION_TIERS.map((definition) => {
  const label = definition.magic.element === "wind"
    ? "Air"
    : `${definition.magic.element[0]?.toUpperCase() ?? ""}${definition.magic.element.slice(1)}`;
  return {
    id: `essence_${definition.magic.element === "wind" ? "air" : definition.magic.element}`,
    name: `${label} Essence Cache`,
    archetype: "ore",
    skill: "mining",
    tier: definition.tier,
    reqLevel: definition.reqLevel,
    itemId: definition.magic.essence,
    yieldRange: [40, 90],
    respawnSeconds: 30,
    presentation: {
      availableAssetIds: ["rocks_free_essence_node"],
      targetWorldSize: 1.58,
      variantScale: [0.96, 1.04],
      materialTier: definition.tier,
    },
  };
});

/** Canonical archetypes only. Cluster aliases are deliberately unsupported. */
export const RESOURCES: readonly ResourceDef[] = [
  ...GATHERING_PRODUCTION_TIERS.flatMap((definition) => definition.resourceDefs),
  ...ESSENCE_RESOURCES,
  ...HIGH_TIER_TREE_RESOURCES,
  ...WILDERNESS_ORE_RESOURCES, ...WILDERNESS_TREE_RESOURCES,
];

const RESOURCE_BY_ID = new Map(RESOURCES.map((resource) => [resource.id, resource] as const));

/** Strict authoring lookup. A cluster with a missing resource reference is a boot-time error. */
export function resourceDef(resourceId: string): ResourceDef {
  const resource = RESOURCE_BY_ID.get(resourceId);
  if (!resource) throw new Error(`Unknown resource id "${resourceId}".`);
  return resource;
}

/** Canonical resource rows without cluster aliases. Useful for docs and guides. */
export const RESOURCE_ARCHETYPES: readonly ResourceDef[] = RESOURCES;
