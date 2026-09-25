/** Static production-site layouts shared by the site builder and world authoring. */
export const CROWNWARD_RESOURCE_INTENTS = [
  { id: 'crown_silver_quarry', regionId: 'crownward', kind: 'mine', position: [625, -135], resourceId: 'crown_silver_ore', count: 7 },
  { id: 'argent_high_cut', regionId: 'crownward', kind: 'mine', position: [640, 220], resourceId: 'crown_silver_ore', count: 7 },
  { id: 'royal_maple_grove', regionId: 'crownward', kind: 'grove', position: [445, -115], resourceId: 'tree_maple', count: 9 },
  { id: 'silverthorn_park', regionId: 'crownward', kind: 'grove', position: [630, 105], resourceId: 'tree_maple', count: 9 },
  { id: 'whitebough_copse', regionId: 'crownward', kind: 'grove', position: [445, 310], resourceId: 'tree_maple', count: 9 },
] as const;

export const FAIRY_RESOURCE_INTENTS = [
  { id: 'dewglass_workings', regionId: 'gloamgarden', kind: 'mine', position: [2175, -135], resourceId: 'dewglass_ore', count: 7 },
  { id: 'lantern_seam', regionId: 'gloamgarden', kind: 'mine', position: [2505, 60], resourceId: 'dewglass_ore', count: 7 },
  { id: 'moonpetal_grove', regionId: 'gloamgarden', kind: 'grove', position: [2250, -55], resourceId: 'tree_gloam_willow', count: 9 },
  { id: 'lantern_willows', regionId: 'gloamgarden', kind: 'grove', position: [2470, -110], resourceId: 'tree_gloam_willow', count: 9 },
  { id: 'dewsong_copse', regionId: 'gloamgarden', kind: 'grove', position: [2115, 40], resourceId: 'tree_gloam_willow', count: 9 },
  { id: 'star_amethyst_cut', regionId: 'faeholme', kind: 'mine', position: [2170, 240], resourceId: 'star_amethyst_ore', count: 7 },
  { id: 'sovereign_lode', regionId: 'faeholme', kind: 'mine', position: [2500, 370], resourceId: 'star_amethyst_ore', count: 7 },
  { id: 'orchid_yew_grove', regionId: 'faeholme', kind: 'grove', position: [2420, 210], resourceId: 'tree_fae_yew', count: 9 },
  { id: 'starroot_garden', regionId: 'faeholme', kind: 'grove', position: [2300, 365], resourceId: 'tree_fae_yew', count: 9 },
  { id: 'twilight_copse', regionId: 'faeholme', kind: 'grove', position: [2075, 350], resourceId: 'tree_fae_yew', count: 9 },
] as const;
