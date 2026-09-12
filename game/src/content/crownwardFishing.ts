import type { ItemDef } from '../contracts.js';
import { healAmount, recipeXp, type ResourceDef, type RecipeDef } from './index.js';
import type { ResourceClusterDef } from './regions.js';
import type { WorldSite } from './worldSites.js';
import { riverSections, type RiverChannel } from '../world/riverChannels.js';

export const CROWNWARD_FISH = [
  { id: 'crown_trout', name: 'Trout', tier: 30, asset: 'fish_trout', size: .72, value: 310 },
  { id: 'crown_tuna', name: 'Tuna', tier: 40, asset: 'fish_cragfin', size: .9, value: 420 },
  { id: 'pearlwater_salmon', name: 'Salmon', tier: 60, asset: 'animal_salmon', size: .8, value: 650 },
] as const;

export const CROWNWARD_FISH_RESOURCES: readonly ResourceDef[] = CROWNWARD_FISH.map(fish => ({
  id: `fish_${fish.id}`, name: `${fish.name} Fishing Spot`, archetype: 'fishing_spot', skill: 'fishing',
  tier: fish.tier, reqLevel: fish.tier, itemId: fish.id, yieldRange: [30, 45], respawnSeconds: 35,
  presentation: { availableAssetIds: [fish.asset], targetWorldSize: fish.size,
    waterOffset: -.3, materialTier: fish.tier },
}));

export const CROWNWARD_FISH_ITEMS: readonly ItemDef[] = CROWNWARD_FISH.flatMap(fish => [
  { id: fish.id, name: fish.name, tier: fish.tier, description: `Fresh ${fish.name.toLowerCase()} from ${fish.tier === 60 ? 'Pearlwater' : 'Crownmere'}. Cook it over a range or campfire.`,
    stackable: false, value: fish.value, category: 'resource' as const },
  { id: `cooked_${fish.id}`, name: `Cooked ${fish.name}`, tier: fish.tier,
    description: `${fish.name} cooked through over the fire.`, stackable: false,
    value: Math.round(fish.value * 1.4), category: 'food' as const, food: { healAmount: healAmount(fish.tier) } },
  { id: `burnt_${fish.id}`, name: `Burnt ${fish.name}`, tier: fish.tier,
    description: 'Charred through and inedible.', stackable: false, value: 1, category: 'food' as const },
]);

export const CROWNWARD_FISH_RECIPES: readonly RecipeDef[] = CROWNWARD_FISH.map(fish => ({
  id: `cook_${fish.id}`, name: `Cooked ${fish.name}`, kind: 'cook', skill: 'cooking',
  tier: fish.tier, reqLevel: fish.tier, stations: ['range', 'campfire'],
  inputs: [{ itemId: fish.id, quantity: 1 }], output: { itemId: `cooked_${fish.id}`, quantity: 1 },
  burntItemId: `burnt_${fish.id}`, xp: recipeXp(fish.tier, 1.5), durationMs: 2400,
}));

/** Same authored fishery construction in the compact river fixture and final channels. */
export function crownwardFisheries(channels: readonly RiverChannel[]): { sites: WorldSite[]; clusters: ResourceClusterDef[] } {
  const lake = channels.find(channel => channel.lake)!;
  const river = channels.find(channel => !channel.lake)!;
  const stations = riverSections(river);
  const intents = [
    { id: 'crownmere_trout', fish: CROWNWARD_FISH[0], centre: lake.lake!.centre, rotation: Math.PI, body: `lake:${lake.id}`, spread: 22 },
    { id: 'crownmere_tuna', fish: CROWNWARD_FISH[1], centre: lake.lake!.centre, rotation: 0, body: `lake:${lake.id}`, spread: 22 },
    ...[.23, .32, .43].map((progress, index) => {
      const row = stations.find(row => row.progress >= progress)!;
      return { id: `pearlwater_salmon_${index + 1}`, fish: CROWNWARD_FISH[2], centre: [row.x, row.z] as const,
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


