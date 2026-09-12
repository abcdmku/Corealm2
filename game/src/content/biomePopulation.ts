import type { RegionId } from '../contracts.js';
import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { EnemyGroupDef, Spot } from './regions.js';
import type { HabitatDef } from './worldHabitats.js';
import { tierSilhouetteScale } from '../core/math.js';

export interface BiomePopulationDef {
  readonly id: string;
  readonly speciesId: string;
  readonly regionId: Exclude<RegionId, 'gravelmaw'>;
  readonly centre: Spot;
  readonly count: number;
  /** Covers the activity circuit and a 3.5 m moving body radius. */
  readonly radius: number;
}

/** Art coverage proposal for the root's later projection step. Stable group IDs stay intact. */
export const BIOME_POPULATION_LEGACY_REPLACEMENTS: Readonly<Record<string,string>> = {
  palewood_adders:'thorn_maw',regional_gloam_fox:'heath_jack',regional_redbrush_fox:'heath_jack',
  pack_fallowmarch_palewood_far_south_scrub:'thorn_maw',pack_fallowmarch_palewood_heath_scrub:'heath_jack',
  pack_fallowmarch_palewood_reed_scrub:'reed_strider',pack_fallowmarch_bracken_northeast_spiders:'thorn_maw',
  marchwild_horse_residents:'briar_harrow',
  duskoak_stags:'briar_harrow',bramble_hogs:'fen_crawler',deepwood_coyotes:'heath_jack',
  blackwater_frogs:'reed_strider',rootfall_coneys:'thorn_maw',thornline_adders:'thorn_maw',
  pack_vellenwood_marchgate_south_bramble:'thorn_maw',pack_vellenwood_mossbound_west_bramble:'fen_crawler',
  duskoak_lynx_residents:'heath_jack',rootdelve_badger_residents:'briar_harrow',marsh_moose_residents:'briar_harrow',
  bracken_tapir_residents:'fen_crawler',blackwater_heron_residents:'reed_strider',quarry_snail_residents:'thorn_maw',
  hollowroot_spider_residents:'thorn_maw',
  highcairn_bears:'cairn_treader',scree_boars:'vault_custodian',ridge_ibex:'scree_watcher',
  terrace_aurochs:'vault_custodian',tarn_coyotes:'cairn_treader',
  pack_karrowmoor_tarn_track_east_mandibles:'flint_mandible',pack_karrowmoor_moor_road_far_west_watch:'vault_custodian',
  quillback_porcupine_residents:'scree_watcher',cairn_bighorn_residents:'cairn_treader',
  reedjaw_crocodile_residents:'flint_mandible',slateback_tortoise_residents:'vault_custodian',
  scree_bustard_residents:'scree_watcher',antler_beetle_residents:'flint_mandible',quarry_nightmare_residents:'cairn_treader',
  gravelmaw_ch1_rats:'blind_cave_weaver',gravelmaw_ch2_scorpions:'blind_cave_weaver',
  gravelmaw_ch2_crabs:'flint_mandible',gravelmaw_ch3_bears:'vault_custodian',gravelmaw_amethyst_spiders:'blind_cave_weaver',
  ashback_bears:'kiln_marrow',cinder_boars:'slag_crawler',emberhorn_ibex:'cinder_penitent',cinder_adders:'grave_lantern',
  pack_kilnhalt_clinker_southern_approach_west:'kiln_marrow',pack_kilnhalt_cinderpine_northwest_outer:'slag_crawler',
  kiln_salamander_residents:'slag_crawler',ashscale_monitor_residents:'cinder_penitent',slag_centipede_residents:'slag_crawler',
  cinder_ravager_residents:'kiln_marrow',basalt_drake_residents:'slag_crawler',gorge_mantis_residents:'veil_reaper',
};

/** Fixed encounter positions. The root registers these only after the bodies pass the lab. */
export const BIOME_POPULATION: readonly BiomePopulationDef[] = [
  { id:'population_palewood_south_harrow',speciesId:'briar_harrow',regionId:'fallowmarch',centre:[-314,-122],count:2,radius:9 },
  { id:'population_palewood_west_jacks',speciesId:'heath_jack',regionId:'fallowmarch',centre:[-296,-50],count:3,radius:9 },
  { id:'population_palewood_root_maws',speciesId:'thorn_maw',regionId:'fallowmarch',centre:[-290,-2],count:3,radius:9 },
  { id:'population_northgate_fen_crawlers',speciesId:'fen_crawler',regionId:'fallowmarch',centre:[-62,70],count:3,radius:9 },
  { id:'population_galeskin_south_jacks',speciesId:'heath_jack',regionId:'fallowmarch',centre:[-308,100],count:3,radius:9 },
  { id:'population_northern_march_harrows',speciesId:'briar_harrow',regionId:'fallowmarch',centre:[-224,106],count:2,radius:9 },
  { id:'population_bracken_north_striders',speciesId:'reed_strider',regionId:'fallowmarch',centre:[-116,112],count:3,radius:9 },
  { id:'population_northgate_outer_jacks',speciesId:'heath_jack',regionId:'fallowmarch',centre:[-62,118],count:3,radius:9 },

  { id:'population_marchgate_root_maws',speciesId:'thorn_maw',regionId:'vellenwood',centre:[28,52],count:3,radius:9 },
  { id:'population_blackwater_south_crawlers',speciesId:'fen_crawler',regionId:'vellenwood',centre:[124,40],count:3,radius:9 },
  { id:'population_gorge_south_striders',speciesId:'reed_strider',regionId:'vellenwood',centre:[208,34],count:3,radius:9 },
  { id:'population_mossbound_south_harrows',speciesId:'briar_harrow',regionId:'vellenwood',centre:[298,40],count:2,radius:9 },
  { id:'population_rootfall_west_jacks',speciesId:'heath_jack',regionId:'vellenwood',centre:[34,76],count:3,radius:9 },
  { id:'population_rootfall_south_crawlers',speciesId:'fen_crawler',regionId:'vellenwood',centre:[82,64],count:3,radius:9 },
  { id:'population_thornline_south_maws',speciesId:'thorn_maw',regionId:'vellenwood',centre:[226,112],count:3,radius:9 },
  { id:'population_rootheart_south_harrows',speciesId:'briar_harrow',regionId:'vellenwood',centre:[304,112],count:2,radius:9 },
  { id:'population_mire_skirt_striders',speciesId:'reed_strider',regionId:'vellenwood',centre:[-8,94],count:3,radius:9 },
  { id:'population_hollowcut_east_harrows',speciesId:'briar_harrow',regionId:'vellenwood',centre:[154,154],count:2,radius:9 },
  { id:'population_thornline_north_jacks',speciesId:'heath_jack',regionId:'vellenwood',centre:[232,184],count:3,radius:9 },
  { id:'population_rootheart_east_maws',speciesId:'thorn_maw',regionId:'vellenwood',centre:[334,184],count:3,radius:9 },

  { id:'population_cairn_south_weavers',speciesId:'blind_cave_weaver',regionId:'karrowmoor',centre:[34,-128],count:3,radius:9 },
  { id:'population_low_moor_custodians',speciesId:'vault_custodian',regionId:'karrowmoor',centre:[100,-176],count:2,radius:9 },
  { id:'population_upper_seam_mandibles',speciesId:'flint_mandible',regionId:'karrowmoor',centre:[214,-164],count:3,radius:9 },
  { id:'population_south_ridge_watchers',speciesId:'scree_watcher',regionId:'karrowmoor',centre:[268,-170],count:3,radius:9 },
  { id:'population_cairn_hall_outer_weavers',speciesId:'blind_cave_weaver',regionId:'karrowmoor',centre:[40,-80],count:3,radius:9 },
  { id:'population_second_ramp_treaders',speciesId:'cairn_treader',regionId:'karrowmoor',centre:[76,-86],count:2,radius:9 },
  { id:'population_cairn_tarn_west_watchers',speciesId:'scree_watcher',regionId:'karrowmoor',centre:[202,-50],count:3,radius:9 },
  { id:'population_far_tarn_mandibles',speciesId:'flint_mandible',regionId:'karrowmoor',centre:[322,-74],count:3,radius:9 },
  { id:'population_gravelmaw_west_weavers',speciesId:'blind_cave_weaver',regionId:'karrowmoor',centre:[22,-38],count:3,radius:9 },
  { id:'population_low_terrace_custodians',speciesId:'vault_custodian',regionId:'karrowmoor',centre:[52,-44],count:2,radius:9 },
  { id:'population_northern_tarn_treaders',speciesId:'cairn_treader',regionId:'karrowmoor',centre:[208,-26],count:2,radius:9 },
  { id:'population_east_tarn_watchers',speciesId:'scree_watcher',regionId:'karrowmoor',centre:[304,-20],count:3,radius:9 },

  { id:'population_clinker_south_crawlers',speciesId:'slag_crawler',regionId:'kilnhalt',centre:[-266,260],count:3,radius:9 },
  { id:'population_kilnroad_west_marrow',speciesId:'kiln_marrow',regionId:'kilnhalt',centre:[-92,248],count:2,radius:9 },
  { id:'population_emberfast_south_penitents',speciesId:'cinder_penitent',regionId:'kilnhalt',centre:[88,248],count:3,radius:9 },
  { id:'population_ashfin_east_crawlers',speciesId:'slag_crawler',regionId:'kilnhalt',centre:[262,248],count:3,radius:9 },
  { id:'population_clinker_west_marrow',speciesId:'kiln_marrow',regionId:'kilnhalt',centre:[-296,332],count:2,radius:9 },
  { id:'population_emberfast_west_lanterns',speciesId:'grave_lantern',regionId:'kilnhalt',centre:[-92,314],count:3,radius:9 },
  { id:'population_emberfast_east_penitents',speciesId:'cinder_penitent',regionId:'kilnhalt',centre:[88,320],count:3,radius:9 },
  { id:'population_cinderpine_east_crawlers',speciesId:'slag_crawler',regionId:'kilnhalt',centre:[280,332],count:3,radius:9 },
  { id:'population_west_cinder_reapers',speciesId:'veil_reaper',regionId:'kilnhalt',centre:[-248,398],count:3,radius:9 },
  { id:'population_ashback_north_lanterns',speciesId:'grave_lantern',regionId:'kilnhalt',centre:[-86,416],count:3,radius:9 },
  { id:'population_north_track_penitents',speciesId:'cinder_penitent',regionId:'kilnhalt',centre:[88,410],count:3,radius:9 },
  { id:'population_cinderwake_west_marrow',speciesId:'kiln_marrow',regionId:'kilnhalt',centre:[244,416],count:2,radius:9 },

  { id:'population_broken_watch_lanterns',speciesId:'grave_lantern',regionId:'wilderness',centre:[-272,496],count:3,radius:9 },
  { id:'population_last_light_west_penitents',speciesId:'cinder_penitent',regionId:'wilderness',centre:[-92,484],count:3,radius:9 },
  { id:'population_last_light_east_shades',speciesId:'pallid_shade',regionId:'wilderness',centre:[88,502],count:3,radius:9 },
  { id:'population_east_march_reapers',speciesId:'veil_reaper',regionId:'wilderness',centre:[262,502],count:3,radius:9 },
  { id:'population_deadwood_west_boughs',speciesId:'hollow_bough',regionId:'wilderness',centre:[-260,580],count:2,radius:9 },
  { id:'population_abbey_east_lanterns',speciesId:'grave_lantern',regionId:'wilderness',centre:[-86,580],count:3,radius:9 },
  { id:'population_black_keep_east_reapers',speciesId:'veil_reaper',regionId:'wilderness',centre:[88,586],count:3,radius:9 },
  { id:'population_petrified_grove_south_shades',speciesId:'pallid_shade',regionId:'wilderness',centre:[280,574],count:3,radius:9 },
  { id:'population_aqueduct_west_lanterns',speciesId:'grave_lantern',regionId:'wilderness',centre:[-260,664],count:3,radius:9 },
  { id:'population_silent_stones_reapers',speciesId:'veil_reaper',regionId:'wilderness',centre:[-50,635],count:3,radius:9 },
  { id:'population_black_keep_north_penitents',speciesId:'cinder_penitent',regionId:'wilderness',centre:[88,658],count:3,radius:9 },
  { id:'population_lava_east_marrow',speciesId:'kiln_marrow',regionId:'wilderness',centre:[262,658],count:2,radius:9 },
];

/** Clear floors keep every return and patrol connection outside ruin and tree collisions. */
export const BIOME_POPULATION_HABITATS: readonly HabitatDef[] = BIOME_POPULATION.map(pack => ({
  id: `${pack.id}_habitat`, groupId: pack.id, regionId: pack.regionId,
  centre: pack.centre, radius: pack.radius, activity: 'patrol', dressing: [],
  anchors: Array.from({ length: Math.max(pack.count, 4) }, (_, index) => {
    const angle = index / Math.max(pack.count, 4) * Math.PI * 2 + .3;
    return [Number((pack.centre[0] + Math.cos(angle) * 5.25).toFixed(3)),
      Number((pack.centre[1] + Math.sin(angle) * 5.25).toFixed(3))] as const;
  }),
}));

/** Species ownership remains in the art catalogues; this module never supplies fallback bodies. */
export function resolveBiomePopulation(species: readonly CreatureSpeciesDef[]): EnemyGroupDef[] {
  const byId = new Map(species.map(row => [row.id, row]));
  const tierByRegion = {
    fallowmarch: 1, vellenwood: 5, karrowmoor: 10, kilnhalt: 20, wilderness: 20,
    crownward: 40, gloamgarden: 30, faeholme: 60,
  } as const satisfies Readonly<Record<Exclude<RegionId, 'gravelmaw'>, number>>;
  return BIOME_POPULATION.map(pack => {
    const creature = byId.get(pack.speciesId);
    if (!creature) throw new Error(`Missing accepted population species ${pack.speciesId} for ${pack.id}`);
    const previousTier = Object.values(BIOME_POPULATION_LEGACY_REPLACEMENTS).includes(creature.id)
      ? tierByRegion[pack.regionId] : creature.stats.tier;
    const tier = pack.regionId === 'wilderness' ? 50 : previousTier;
    return { id: pack.id, family: creature.stats.family, name: creature.stats.name,
      tier, assetId: creature.assetId,
      scale: creature.scale * tierSilhouetteScale(previousTier) / tierSilhouetteScale(tier),
      centre: pack.centre, count: pack.count, radius: pack.radius };
  });
}
