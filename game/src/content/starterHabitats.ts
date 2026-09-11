import { STARTER_CREATURES } from "./starterCreatures.js";
import type { EnemyGroupDef } from "./regions.js";
import type { HabitatDef } from "./worldHabitats.js";

/** Small encounters in existing screened pack pockets. No camp props for wild creatures. */
const pockets = [
  ["marchfield_east_wolf_ground", "grass_viper", -47, 45, 3],
  // One of each wasp replaces the original three identical residents in this pocket.
  ["palewood_far_south_scrub", "field_wasp", -338, -134, 1],
  ["palewood_heath_scrub", "heath_wasp", -332, -134, 1],
  ["palewood_reed_scrub", "reed_wasp", -335, -129, 1],
  ["corven_ford_southeast_pack", "creek_crab", -40, -170, 3],
  ["bracken_northeast_spiders", "briar_spider", -104, 133, 3],
  ["coldbrace_northwest_raiders", "granary_rat", -176, -18, 3],
] as const;

export const STARTER_HABITATS: readonly HabitatDef[] = pockets.map(([pocket, speciesId, x, z, count]) => ({
  id: `pack_fallowmarch_${pocket}_habitat`, groupId: `pack_fallowmarch_${pocket}`,
  regionId: "fallowmarch", centre: [x, z], radius: count === 1 ? 4 : 7,
  anchors: count === 1 ? [[x, z]] : [[x - 3, z - 2], [x + 3, z - 2], [x, z + 3]],
  activity: STARTER_CREATURES.find(row => row.id === speciesId)!.activity, dressing: [],
}));

export const STARTER_GROUPS: readonly EnemyGroupDef[] = pockets.map(([, speciesId, , , count], index) => {
  const species = STARTER_CREATURES.find(row => row.id === speciesId)!;
  const habitat = STARTER_HABITATS[index]!;
  return { id: habitat.groupId, family: species.stats.family, name: species.stats.name, tier: 1,
    count, centre: habitat.centre, radius: habitat.radius, assetId: species.assetId, scale: species.scale };
});

/** These three stable group IDs replace the residents of one reserved pack pocket. */
export const STARTER_SHARED_PACK_RESERVATIONS: Readonly<Record<string, string>> = {
  pack_fallowmarch_palewood_far_south_scrub: "pack_fallowmarch_palewood_far_south_scrub",
  pack_fallowmarch_palewood_heath_scrub: "pack_fallowmarch_palewood_far_south_scrub",
  pack_fallowmarch_palewood_reed_scrub: "pack_fallowmarch_palewood_far_south_scrub",
};
