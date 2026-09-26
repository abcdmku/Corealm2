import { resourceById, RESOURCE_DATA } from "./resourceData.js";
import { ITEM_DATA } from "./itemData.js";
import type { ItemDef } from '../contracts.js';
import type { ResourceDef, RecipeDef } from './index.js';
import { RECIPE_DATA } from "./recipeData.js";
import type { ResourceClusterDef, Spot } from './regions.js';
import type { WorldSite } from './worldSites.js';
import { riverSections, type RiverChannel } from '../world/riverChannels.js';

/** Fish identity is stable; its name/value and resource presentation are editable JSON. */
export function projectCrownwardFish<const Id extends string>(id: Id, resource: ResourceDef, items: readonly ItemDef[]) {
  if (resource.archetype !== 'fishing_spot' || resource.itemId !== id) {
    throw new Error(`Invalid fish resource for ${id}: ${resource.id}`);
  }
  const item = items.find(row => row.id === resource.itemId);
  if (!item) throw new Error(`Missing fish yield item ${resource.itemId}`);
  const asset = resource.presentation.availableAssetIds[0];
  if (!asset) throw new Error(`Missing fish presentation asset for ${id}`);
  return { id, name: item.name, tier: resource.tier, asset,
    size: resource.presentation.targetWorldSize, value: item.value } as const;
}

export const CROWNWARD_FISH = [
  projectCrownwardFish('crown_trout', resourceById('fish_crown_trout'), ITEM_DATA),
  projectCrownwardFish('crown_tuna', resourceById('fish_crown_tuna'), ITEM_DATA),
  projectCrownwardFish('pearlwater_salmon', resourceById('fish_pearlwater_salmon'), ITEM_DATA),
] as const;

export const CROWNWARD_FISH_RESOURCES: readonly ResourceDef[] = RESOURCE_DATA.filter(resource => resource.skill === "fishing" && resource.tier >= 30);

export const CROWNWARD_FISH_ITEMS: readonly ItemDef[] = ITEM_DATA.filter(item => item.tier >= 30 && (item.category === "food" || item.id.includes("fish") || item.id.includes("trout") || item.id.includes("tuna") || item.id.includes("salmon")));

export const CROWNWARD_FISH_RECIPES: readonly RecipeDef[] = RECIPE_DATA.filter(recipe => recipe.kind === "cook" && recipe.tier >= 30);

/** Same authored fishery construction in the compact river fixture and final channels. */
export function crownwardFisheries(channels: readonly RiverChannel[], salmonCentres?: readonly Spot[]): { sites: WorldSite[]; clusters: ResourceClusterDef[] } {
  const lake = channels.find(channel => channel.lake)!;
  const river = channels.find(channel => !channel.lake)!;
  const stations = riverSections(river);
  const intents = [
    { id: 'crownmere_trout', fish: CROWNWARD_FISH[0], centre: lake.lake!.centre, rotation: Math.PI, body: `lake:${lake.id}`, spread: 22 },
    { id: 'crownmere_tuna', fish: CROWNWARD_FISH[1], centre: lake.lake!.centre, rotation: 0, body: `lake:${lake.id}`, spread: 22 },
    ...[.23, .32, .43].map((progress, index) => {
      const centre = salmonCentres?.[index];
      const row = centre ? stations.reduce((best, row) => Math.hypot(row.x - centre[0], row.z - centre[1])
        < Math.hypot(best.x - centre[0], best.z - centre[1]) ? row : best)
        : stations.find(row => row.progress >= progress)!;
      return { id: `pearlwater_salmon_${index + 1}`, fish: CROWNWARD_FISH[2], centre: centre ?? [row.x, row.z] as const,
        rotation: Math.atan2(-row.tz, row.tx), body: `river:${river.id}:`, spread: 4 };
    }),
  ];
  const sites: WorldSite[] = intents.map(intent => ({
    id: intent.id, locationId: intent.id, regionId: 'crownward', kind: 'fishery', centre: intent.centre,
    rotationY: intent.rotation, waterBodyId: intent.body, workRadius: 5, extent: [Math.max(10, intent.spread), 10],
    terrain: { floorRadius: 0, backRise: 0, backDistance: 0, bermWidth: 0, approachAngle: 0 },
    resourceSlots: [-1, 0, 1].map((side, i) => ({ clusterId: `${intent.id}_spots`, index: i + 1,
      x: side * intent.spread, z: 0, yaw: i * .6, scale: 1 })), dressing: [],
  }));
  return { sites, clusters: intents.map(intent => ({ id: `${intent.id}_spots`, locationId: intent.id,
    resourceId: `fish_${intent.fish.id}`, centre: intent.centre, radius: Math.max(5, intent.spread), count: 3, waterBodyId: intent.body })) };
}

