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
  // Moved 5 m north off [-55, 675]. The Cinder Crossing road junction at [-65, 690] takes a
  // generic 7 m location pad that grades 0.87 m higher, and its core used to reach 2.2 m inside
  // this ruin's pad. applyFlats averages overlapping cores by depth, so the shared lattice
  // vertices built high and tilted the rotated footprint's south-west corner 0.099 m out of
  // level. Separating the two pads levels all eight ruins exactly and moves the ruin further off
  // the Grave Road centreline. legacyEncounterPlacements.ts carries the matching haunt centre.
  { id: 'forgotten_forge', name: 'The Cold Forge', position: [-55, 670], composition: 'wilderness_ruined_smithy', rotationY: 2.4 },
  { id: 'eastern_cloister', name: 'Hollow Choir Cloister', position: [305, 670], composition: 'wilderness_roofless_abbey', rotationY: -.4 },
  { id: 'eastern_aqueduct', name: 'The Empty Sluice', position: [230, 555], composition: 'wilderness_shattered_aqueduct', rotationY: Math.PI / 2 },
  { id: 'east_kingspan', name: 'The Lost Kingspan', position: [390, 500], composition: 'wilderness_shattered_aqueduct', rotationY: 1.34 },
  { id: 'ashwind_cloister', name: 'Ashwind Cloister', position: [505, 585], composition: 'wilderness_roofless_abbey', rotationY: 2.53 },
  { id: 'far_cinder_smithy', name: 'Far Cinder Smithy', position: [665, 660], composition: 'wilderness_ruined_smithy', rotationY: -2.23 },
  { id: 'rift_watch', name: 'Rift Watch', position: [385, 775], composition: 'wilderness_broken_watchtower', rotationY: 1.51 },
  { id: 'nightglass_waterway', name: 'The Nightglass Waterway', position: [535, 815], composition: 'wilderness_shattered_aqueduct', rotationY: 2.68 },
  { id: 'starless_abbey', name: 'The Starless Abbey', position: [675, 915], composition: 'wilderness_roofless_abbey', rotationY: 2.78 },
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
  [548, 525], [604, 610], [630, 700], [550, 785], [572, 860],
];
