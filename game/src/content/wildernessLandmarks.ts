import type { LandmarkDef, LocationDef } from './regions.js';
import { WILDERNESS_RUINS, type WildernessRuinId } from '../render/compositions/wildernessRuins.js';

/** Authored clearings; reusable recipes are accepted in the lab before this layout is activated. */
export const WILDERNESS_RUIN_SITES: readonly {
  id: string; name: string; position: readonly [number, number]; composition: WildernessRuinId; rotationY: number;
}[] = [
  { id: 'broken_watch_tower', name: 'Broken Watchtower', position: [-250, 520], composition: 'wilderness_broken_watchtower', rotationY: .2 },
  { id: 'nameless_abbey', name: 'The Nameless Abbey', position: [-130, 610], composition: 'wilderness_roofless_abbey', rotationY: .12 },
  { id: 'dead_smithy', name: 'Cinderwatch Smithy', position: [130, 565], composition: 'wilderness_ruined_smithy', rotationY: -.45 },
  { id: 'fallen_aqueduct', name: 'The Broken Waterway', position: [-205, 665], composition: 'wilderness_shattered_aqueduct', rotationY: .17 },
  { id: 'outer_watch', name: 'Widow Watch', position: [-310, 575], composition: 'wilderness_broken_watchtower', rotationY: 1.9 },
  { id: 'forgotten_forge', name: 'The Cold Forge', position: [-55, 675], composition: 'wilderness_ruined_smithy', rotationY: 2.4 },
  { id: 'eastern_cloister', name: 'Hollow Choir Cloister', position: [305, 670], composition: 'wilderness_roofless_abbey', rotationY: -.4 },
  { id: 'eastern_aqueduct', name: 'The Empty Sluice', position: [230, 555], composition: 'wilderness_shattered_aqueduct', rotationY: Math.PI / 2 },
];

export const WILDERNESS_RUIN_LANDMARKS: LandmarkDef[] = WILDERNESS_RUIN_SITES.map(site => ({
  ...site, assetId: 'kerb_straight', compositionOnly: true,
  blurb: `${WILDERNESS_RUINS[site.composition].name}. Broken masonry and the last burning torches mark an open way through.`,
}));

export const WILDERNESS_RUIN_LOCATIONS: LocationDef[] = WILDERNESS_RUIN_SITES
  .filter(site => site.id !== 'broken_watch_tower')
  .map(site => ({ id: `${site.id}_site`, name: site.name, position: site.position, kind: 'landmark', routeNode: true }));

/** Sparse lamps lead between occupied clearings. Most of the waste stays unlit. */
export const WILDERNESS_ROAD_BRAZIERS: readonly (readonly [number, number])[] = [
  [-5, 479], [12, 497], [22, 516], [30, 538], [34, 558], [46, 558],
  [-67, 490], [-128, 499], [-190, 510], [-240, 521],
  [92, 574], [178, 619], [180, 638], [246, 638],
];
