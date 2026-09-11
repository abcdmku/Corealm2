import type { RegionId } from "../contracts.js";
import { tierSilhouetteScale } from "../core/math.js";
import { hashId } from "../world/habitatMovement.js";
import { ENEMY_BLOCKS } from "./enemies.js";
import { enemyCombatLevel, type EnemyDef } from "./index.js";
import type { EnemyGroupDef } from "./regions.js";
import type { HabitatDef } from "./worldHabitats.js";

export type RegionalPackRank = "ordinary" | "seasoned" | "mature";
export type RegionalPackRegionId = Exclude<RegionId, "gravelmaw" | "wilderness">;

export interface RegionalPackVariant {
  readonly id: string;
  readonly baseEnemyDefId: string;
  readonly rank: RegionalPackRank;
  readonly stats: EnemyDef;
  readonly scaleMultiplier: number;
}

export interface RegionalPackDef {
  readonly id: string;
  readonly regionId: RegionalPackRegionId;
  readonly speciesId: string;
  readonly baseGroupId: string;
  readonly baseEnemyDefId: string;
  readonly assetId: string;
  /** Source model scale, before the tier silhouette and individual variant multipliers. */
  readonly scale: number;
  readonly activity: HabitatDef["activity"];
  readonly centre: HabitatDef["centre"];
  /** Full body and idle-motion reservation. The actor origins use a smaller inset circuit. */
  readonly radius: number;
  readonly anchors: HabitatDef["anchors"];
  readonly members: readonly {
    readonly id: string;
    readonly anchorIndex: number;
    readonly variantId: string;
  }[];
  readonly settingId: string;
  readonly rationale: string;
  readonly placementRisks: readonly string[];
  readonly levelRange: readonly [number, number];
}

interface PackSource {
  readonly id: string;
  readonly assetId: string;
  readonly scale: number;
  readonly baseEnemyDefId: string;
  readonly activity: HabitatDef["activity"];
  /** Measured production manifest bounds. Tests reject drift before coordinates are accepted. */
  readonly nativeBodyRadius: number;
  readonly nativeVisualRadius: number;
}

/** Canonical models only. Display names and combat properties come from ENEMY_BLOCKS. */
export const REGIONAL_PACK_SOURCES: readonly PackSource[] = [
  {
    "id": "march_road_reavers",
    "assetId": "outfit_male_peasant",
    "scale": 1.12,
    "baseEnemyDefId": "reaver_t1",
    "activity": "patrol",
    "nativeBodyRadius": 0.8995,
    "nativeVisualRadius": 0.9186163508233456
  },
  {
    "id": "open_march_goats",
    "assetId": "animal_goat",
    "scale": 0.85,
    "baseEnemyDefId": "goat_t1",
    "activity": "graze",
    "nativeBodyRadius": 0.757,
    "nativeVisualRadius": 0.9384338016077639
  },
  {
    "id": "palewood_adders",
    "assetId": "animal_viper",
    "scale": 1.1,
    "baseEnemyDefId": "viper_t1",
    "activity": "prowl",
    "nativeBodyRadius": 0.754,
    "nativeVisualRadius": 0.7768815868586408
  },
  {
    "id": "deepwood_coyotes",
    "assetId": "animal_coyote",
    "scale": 0.9,
    "baseEnemyDefId": "coyote_t5",
    "activity": "prowl",
    "nativeBodyRadius": 0.784,
    "nativeVisualRadius": 0.9839781501639151
  },
  {
    "id": "bramble_hogs",
    "assetId": "animal_hog",
    "scale": 1,
    "baseEnemyDefId": "hog_t5",
    "activity": "forage",
    "nativeBodyRadius": 0.9055,
    "nativeVisualRadius": 1.0772780513869205
  },
  {
    "id": "gorge_reavers",
    "assetId": "outfit_female_ranger",
    "scale": 0.95,
    "baseEnemyDefId": "reaver_t5",
    "activity": "patrol",
    "nativeBodyRadius": 0.832,
    "nativeVisualRadius": 0.8580932350275231
  },
  {
    "id": "thornline_adders",
    "assetId": "animal_viper",
    "scale": 1.2,
    "baseEnemyDefId": "viper_t5",
    "activity": "prowl",
    "nativeBodyRadius": 0.754,
    "nativeVisualRadius": 0.7768815868586408
  },
  {
    "id": "karrow_reavers",
    "assetId": "outfit_male_ranger",
    "scale": 0.9,
    "baseEnemyDefId": "reaver_t10",
    "activity": "patrol",
    "nativeBodyRadius": 0.8995,
    "nativeVisualRadius": 0.9232746070373645
  },
  {
    "id": "tarn_coyotes",
    "assetId": "animal_coyote",
    "scale": 0.95,
    "baseEnemyDefId": "coyote_t10",
    "activity": "prowl",
    "nativeBodyRadius": 0.784,
    "nativeVisualRadius": 0.9839781501639151
  },
  {
    "id": "gravelmaw_ch2_scorpions",
    "assetId": "animal_scorpion",
    "scale": 2.2,
    "baseEnemyDefId": "scorpion_t10",
    "activity": "prowl",
    "nativeBodyRadius": 0.214,
    "nativeVisualRadius": 0.2668126683649035
  },
  {
    "id": "redbrush_fox_residents",
    "assetId": "creature_redbrush_fox",
    "scale": 1,
    "baseEnemyDefId": "redbrush_fox_t1",
    "activity": "forage",
    "nativeBodyRadius": 0.7671434755255592,
    "nativeVisualRadius": 0.8766702550812312
  },
  {
    "id": "rootdelve_badger_residents",
    "assetId": "creature_rootdelve_badger",
    "scale": 1,
    "baseEnemyDefId": "rootdelve_badger_t5",
    "activity": "forage",
    "nativeBodyRadius": 0.8969810831546783,
    "nativeVisualRadius": 0.9480502382399154
  },
  {
    "id": "quillback_porcupine_residents",
    "assetId": "creature_quillback_porcupine",
    "scale": 1,
    "baseEnemyDefId": "quillback_porcupine_t10",
    "activity": "forage",
    "nativeBodyRadius": 0.8032790833711625,
    "nativeVisualRadius": 0.9516092637493768
  },
  {
    "id": "marchwild_horse_residents",
    "assetId": "creature_marchwild_horse",
    "scale": 1,
    "baseEnemyDefId": "marchwild_horse_t5",
    "activity": "graze",
    "nativeBodyRadius": 1.550673290217461,
    "nativeVisualRadius": 1.7794178954964508
  },
  {
    "id": "cairn_bighorn_residents",
    "assetId": "creature_cairn_bighorn",
    "scale": 1,
    "baseEnemyDefId": "cairn_bighorn_t10",
    "activity": "graze",
    "nativeBodyRadius": 1.1665486181705864,
    "nativeVisualRadius": 1.3731898101282751
  },
  {
    "id": "ashscale_monitor_residents",
    "assetId": "creature_ashscale_monitor",
    "scale": 1,
    "baseEnemyDefId": "ashscale_monitor_t20",
    "activity": "prowl",
    "nativeBodyRadius": 2.3840643191337585,
    "nativeVisualRadius": 3.1445374043543763
  },
  {
    "id": "scree_bustard_residents",
    "assetId": "creature_scree_bustard",
    "scale": 1,
    "baseEnemyDefId": "scree_bustard_t10",
    "activity": "prowl",
    "nativeBodyRadius": 0.5778399973750117,
    "nativeVisualRadius": 0.710137992894533
  },
  {
    "id": "antler_beetle_residents",
    "assetId": "creature_antler_beetle",
    "scale": 1,
    "baseEnemyDefId": "antler_beetle_t10",
    "activity": "forage",
    "nativeBodyRadius": 1.2878252632915974,
    "nativeVisualRadius": 1.9250381696382821
  },
  {
    "id": "slag_centipede_residents",
    "assetId": "creature_slag_centipede",
    "scale": 1,
    "baseEnemyDefId": "slag_centipede_t20",
    "activity": "prowl",
    "nativeBodyRadius": 2.0205623245239255,
    "nativeVisualRadius": 2.1259484295833517
  },
  {
    "id": "hollowroot_spider_residents",
    "assetId": "creature_hollowroot_spider",
    "scale": 1,
    "baseEnemyDefId": "hollowroot_spider_t5",
    "activity": "prowl",
    "nativeBodyRadius": 1.240081889629364,
    "nativeVisualRadius": 1.7506315645603658
  },
  {
    "id": "cinder_ravager_residents",
    "assetId": "creature_cinder_ravager",
    "scale": 1,
    "baseEnemyDefId": "cinder_ravager_t20",
    "activity": "patrol",
    "nativeBodyRadius": 0.8247650617417225,
    "nativeVisualRadius": 1.0934442293845774
  },
  {
    "id": "basalt_drake_residents",
    "assetId": "creature_basalt_drake",
    "scale": 1,
    "baseEnemyDefId": "basalt_drake_t20",
    "activity": "prowl",
    "nativeBodyRadius": 2.3678813472710196,
    "nativeVisualRadius": 2.9292466740132443
  },
  {
    "id": "gorge_mantis_residents",
    "assetId": "creature_gorge_mantis",
    "scale": 1,
    "baseEnemyDefId": "gorge_mantis_t20",
    "activity": "prowl",
    "nativeBodyRadius": 0.6994888707930447,
    "nativeVisualRadius": 1.134267202140573
  },
  {
    "id": "quarry_nightmare_residents",
    "assetId": "creature_quarry_nightmare",
    "scale": 1,
    "baseEnemyDefId": "quarry_nightmare_t10",
    "activity": "patrol",
    "nativeBodyRadius": 2.4705198314708756,
    "nativeVisualRadius": 3.3066887568297276
  }
];

type AuthoredPack = readonly [
  settingId: string, sourceGroupId: string, x: number, z: number,
  reservationRadius: number, count: number, rationale: string,
];

/**
 * Source-staged population. Do not import the runtime REGIONS or WORLD_HABITATS values here:
 * those registries will consume the accepted data together in a later root integration.
 * Each centre is an authored free-ground pocket beside the setting named in its notes.
 * No dressing is added until actual terrain, forest trunks and approaches are inspected.
 */
const FALLOWMARCH: readonly AuthoredPack[] = [
  ["palewood_northwest_watch","march_road_reavers",-333,181,9,7,"A bandit watch west of Galeskin and outside the northern travel lane."],
  ["galeskin_east_wolf_ground","deepwood_coyotes",-266,181,10,6,"A tougher wolf territory northeast of Galeskin, separated from the existing horse pasture."],
  ["northern_horse_outer_grass","marchwild_horse_residents",-218,183,11,6,"Outer northern grazing beyond the existing horse patch, leaving Kiln Road clear."],
  ["kiln_track_west_patrol","march_road_reavers",-188,174,9,6,"A bandit patrol west of Kiln Road and beyond Bracken workings."],
  ["kiln_track_east_watch","march_road_reavers",-111,175,12,8,"An open bandit watch east of Kiln Road, with room around both sides of the encounter."],
  ["northgate_outer_raiders","march_road_reavers",-53,176,13,8,"Raiders occupy the open ground northwest of North Gate without holding its approach."],
  ["northgate_west_scrub","palewood_adders",-65,146,9,7,"A dry snake pocket northwest of the gate approach; low cover still needs a world view."],
  ["bracken_northeast_spiders","hollowroot_spider_residents",-104,133,9,7,"A tougher spider pocket between the Bracken road and northern route, outside both travel reserves."],
  ["bracken_southeast_patrol","march_road_reavers",-92,51,11,6,"A bandit patrol southeast of Bracken, clear of the Broken Milestone route."],
  ["marchfield_east_wolf_ground","deepwood_coyotes",-47,45,11,6,"A tougher wolf territory east of Marchfield, clear of the farm and Redsill outer bank."],
  ["coldbrace_northwest_raiders","march_road_reavers",-176,-18,10,6,"Raiders shelter north of Coldbrace, beyond the town and south of the retained fox habitat."],
  ["lone_palewood_west_scrub","redbrush_fox_residents",-207,1,10,6,"Foxes browse west of Lone Palewood, separate from the retained northeast hedge population."],
  ["open_march_west_pack","open_march_goats",-299,26,11,8,"A wild-goat herd occupies the western Open March beyond its original grazing territory."],
  ["palewood_north_outer_pack","deepwood_coyotes",-331,66,12,5,"A tougher wolf pocket north of Palewood; final woodland shelter needs world proof."],
  ["bracken_west_outer_watch","march_road_reavers",-248,94,10,6,"A bandit watch northwest of Bracken apron roads and east of Galeskin's approach."],
  ["palewood_north_scrub","redbrush_fox_residents",-326,-9,12,6,"Foxes forage north of the Palewood landing, clear of its road and working ground."],
  ["palewood_east_brush","hollowroot_spider_residents",-285,-26,10,5,"A tougher spider pocket east of the Palewood approach, beside proposed undergrowth."],
  ["palewood_south_warm_ground","palewood_adders",-281,-91,8,7,"Snakes use dry ground southeast of the Palewood landing and east of the existing adder habitat."],
  ["coldbrace_southwest_pack","march_road_reavers",-209,-130,10,6,"A bandit patrol beyond Coldbrace's southwest pad, away from the starting lane."],
  ["south_march_horse_grass","marchwild_horse_residents",-163,-176,13,6,"Open horse grazing south of the starting road keeps this newcomer approach quiet."],
  ["corven_ford_southwest_pack","march_road_reavers",-112,-181,11,7,"A bandit watch southwest of Corven Ford and beyond the town-to-ford road reserve."],
  ["corven_ford_southeast_pack","palewood_adders",-40,-170,10,7,"Snakes occupy dry ground southeast of Corven Ford, with the ford approach left open."],
  ["palewood_far_south_scrub","palewood_adders",-335,-132,8,6,"A separate snake pocket south of Palewood and west of the Roc encounter reserve."],
  ["air_cache_southeast_spiders","hollowroot_spider_residents",-220,-178,10,7,"A tougher spider pocket southeast of the Air Cache, clear of its court and the Roc approach."],
];

const VELLENWOOD: readonly AuthoredPack[] = [
  ["marchgate_south_rootshade","hollowroot_spider_residents",-4,32,9,6,"Spiders occupy a root-edge candidate south of Marchgate, outside the gate route."],
  ["marchgate_south_bramble","bramble_hogs",23,29,10,6,"Wild boars root through open bramble ground south of Marchgate."],
  ["rootfall_south_open_glade","gorge_reavers",53,33,12,6,"Bandits hold an open glade south of Rootfall, beyond the settlement approach."],
  ["rootfall_southwest_brush","thornline_adders",30,60,9,7,"A snake aggregation uses brush southwest of Rootfall, off the working routes."],
  ["marchgate_south_damp_roots","hollowroot_spider_residents",-5,57,8,6,"Spiders use the western root margin south of Marchgate; damp cover remains a visual requirement."],
  ["rootfall_south_stump_hollow","rootdelve_badger_residents",53,56,9,6,"Territorial badgers occupy a proposed stump-side feeding pocket south of Rootfall."],
  ["blackwater_southwest_fern_bed","bramble_hogs",83,23,9,6,"Wild boars root southwest of Blackwater, with a narrow reserved gap to the existing tapir territory."],
  ["blackwater_southeast_bramble","bramble_hogs",183,26,10,6,"Wild boars use bramble ground southeast of Blackwater, beyond the full outer bank."],
  ["gorge_ford_south_hunting_ground","deepwood_coyotes",207,24,8,6,"Wolves range south of the gorge crossing without occupying its travel corridor."],
  ["cairn_gate_east_brush","gorge_reavers",279,30,10,6,"Bandits occupy open brush east of Cairn Gate, leaving the gate approach clear."],
  ["cairn_gate_far_east_roots","hollowroot_spider_residents",313,27,9,6,"Spiders occupy an eastern root pocket beyond Cairn Gate's approaches."],
  ["cairn_gate_east_boundary_thicket","thornline_adders",338,28,8,6,"Snakes use the far eastern thicket margin while bodies remain inside the region."],
  ["gorge_ford_east_glade","gorge_reavers",272,62,10,6,"Bandits hold an eastern glade away from the gorge ford and Mossbound's reserve."],
  ["mossbound_west_bramble","bramble_hogs",279,91,8,6,"Wild boars root west of Mossbound, outside the miniboss encounter reserve."],
  ["east_clearing_hunting_ground","deepwood_coyotes",275,120,9,6,"Wolves range the eastern clearing margin, separated from the retained lynx territory."],
  ["mossbound_northeast_roots","hollowroot_spider_residents",335,116,8,6,"Spiders occupy roots northeast of Mossbound, below the Rootheart approach."],
  ["mossbound_north_bramble","bramble_hogs",310,116,8,6,"Wild boars use the gap north of Mossbound and south of Rootheart's reserved encounter."],
  ["ember_edge_far_east_roots","hollowroot_spider_residents",339,183,8,6,"Spiders occupy the far eastern Ember edge, leaving the northern transition open."],
  ["thornline_north_bramble","bramble_hogs",198,189,8,6,"Wild boars forage north of Thornline and beyond the standing-stones reserve."],
  ["earth_cache_northwest_brush","thornline_adders",224,189,8,6,"Snakes bask in brush northwest of the Earth Cache, clear of its court."],
  ["root_tunnel_south_brush","thornline_adders",172,134,8,6,"Snakes occupy brush south of Root Tunnel, leaving the entire shortcut corridor clear."],
  ["rootfall_west_rootpocket","hollowroot_spider_residents",24,100,6,5,"A compact spider pocket occupies the western root edge beyond Rootfall's padded town footprint."],
  ["rootfall_south_wall_thicket","thornline_adders",40,79,7,6,"A compact snake pocket occupies the outer south thicket beyond Rootfall's padded town footprint."],
  ["gorge_watch_northeast_roots","hollowroot_spider_residents",252,98,8,6,"Spiders hold a root pocket northeast of the gorge watch, beyond the crossing route."],
];

const KARROWMOOR: readonly AuthoredPack[] = [
  ["moor_east_gate_watch","karrow_reavers",295,-14,7,6,"Bandits occupy the moor east of Moorgate, beyond the quarry road and retained bustard ground."],
  ["north_east_moor_nightmares","quarry_nightmare_residents",324,-12,13,5,"A large territorial pack occupies open northeastern moor ground, separated from Moorgate and the eastern watch."],
  ["outer_tarn_track_nightmares","quarry_nightmare_residents",333,-44,13,5,"A large pack ranges the outer moor east of Tarn Track without crossing its approach."],
  ["tarn_track_east_mandibles","antler_beetle_residents",305,-43,9,6,"Beetles occupy dry ground northeast of Tarn Track and east of the retained bustard territory."],
  ["far_tarn_north_east_watch","karrow_reavers",335,-71,7,6,"A bandit watch east of the Tarn Track bend leaves the road approach to Far Tarn open."],
  ["far_tarn_east_moor_stalkers","karrow_reavers",338,-91,6,5,"Bandits occupy the outer eastern moor beyond the crocodile territory and full Far Tarn bank."],
  ["far_tarn_south_east_mandibles","antler_beetle_residents",338,-120,8,5,"Beetles occupy dry ground southeast of the retained crocodile habitat, outside the whole lake carve."],
  ["water_road_east_watch","karrow_reavers",337,-145,6,5,"A compact bandit threat sits east of the Water Essence road, clear of the road and altar approach."],
  ["moor_road_inner_watch","karrow_reavers",196,-29,6,5,"A small bandit watch occupies open ground between the main quarry road and the Highcairn route."],
  ["moor_road_far_west_watch","karrow_reavers",7,-14,8,7,"Bandits occupy western moor ground beyond the Gravelmaw approach and original quarry-road arrival."],
  ["gravelmaw_north_west_quills","quillback_porcupine_residents",5,-35,6,5,"Porcupines browse northwest of the dungeon footprint and beyond the neighbouring Redsill bank."],
  ["second_ramp_west_watch","karrow_reavers",68,-80,8,6,"Bandits occupy ground west of Second Ramp, outside the aurochs habitat and retained bear reservation."],
  ["highcairn_south_wall_mandibles","antler_beetle_residents",145,-96,9,6,"Beetles occupy the gap between Highcairn's southern wall and the retained Third Ramp watch."],
  ["west_moor_outer_mandibles","antler_beetle_residents",-7,-126,8,5,"An outer western beetle pocket sits north of Tideworn, outside every Gravelmaw chamber and the retained nightmare territory."],
  ["scree_slide_west_nightmares","quarry_nightmare_residents",68,-142,13,5,"A large pack occupies ground west of Scree Slide, separate from the bear refuge, tortoise ground and Tideworn approach."],
  ["western_cairn_bighorns","cairn_bighorn_residents",67,-170,9,6,"An ecological herd browses the western upper moor east of Tideworn, away from Scree Slide's entrance."],
  ["tideworn_east_watch","karrow_reavers",75,-191,6,5,"A small southern bandit watch sits east of Tideworn, separate from the neighbouring bighorn reservation."],
  ["great_cairn_south_west_quills","quillback_porcupine_residents",113,-186,6,5,"Porcupines browse southwest of the Great Cairn, outside its stone composition and arrival road."],
  ["upper_seam_south_watch","karrow_reavers",206,-183,7,6,"Bandits watch south of Upper Karrow Seam, east of the retained boar territory and away from the haul floor."],
  ["upper_moor_east_bustards","scree_bustard_residents",240,-188,6,7,"Ground birds range the southern moor beyond the original porcupine patch, with room before the next predator territory."],
  ["ridge_south_nightmares","quarry_nightmare_residents",269,-184,13,5,"A large pack occupies ground south of the Ridge Ibex shelves, west of the water road and outside both retained ridge habitats."],
  ["water_cache_west_stalkers","tarn_coyotes",297,-183,7,6,"Wolves hunt west of the Water Essence court while leaving its approach and the nearby nightmare territory separate."],
  ["scree_slide_far_west_scorpions","gravelmaw_ch2_scorpions",44,-132,6,5,"Quarry Scorpions occupy dry moor ground between the tortoise territory and Tideworn reserve, outside the entire dungeon footprint."],
  ["lower_terrace_west_watch","karrow_reavers",48,-83,6,5,"A small surface watch sits east of the Cairn Hall footprint and west of Second Ramp, clear of the dungeon door partition."],
];

const KILNHALT: readonly AuthoredPack[] = [
  ["clinker_southwest_outer","basalt_drake_residents",-307,239,16,5,"Drakes range the southwest outer Clinker foothills, beyond the quarry road."],
  ["clinker_southern_approach_west","ashscale_monitor_residents",-258,238,16,5,"Monitors range dry ground west of Clinker's southern approach."],
  ["clinker_southern_approach_east","cinder_ravager_residents",-204,264,10,6,"Ravagers patrol open ground east of Clinker's southern approach."],
  ["clinker_southwest_inner","basalt_drake_residents",-304,285,16,5,"Drakes occupy a broad southwest Clinker pocket separated from the outer pack."],
  ["clinker_south_scrub","slag_centipede_residents",-245,281,14,6,"Centipedes range the dry scrub south of Clinker, clear of the haul route."],
  ["kilnroad_northwest_gap","cinder_ravager_residents",-157,280,10,6,"Ravagers patrol the northwest Kiln Road gap without holding its travelled line."],
  ["kilnroad_north_inner","gorge_mantis_residents",-109,281,10,5,"Mantises hunt in an open shelter candidate north of Kiln Road."],
  ["kilnroad_toll_northwest","cinder_ravager_residents",-71,293,9,5,"Ravagers occupy open ground northwest of the Kiln Road toll approach."],
  ["clinker_west_boundary","basalt_drake_residents",-325,331,16,5,"Drakes occupy Clinker's western outer ground with a clear region-edge margin."],
  ["clinker_north_inner","slag_centipede_residents",-221,379,14,6,"Centipedes range dry ground north of Clinker, beyond the current mine and habitat reserves."],
  ["emberhorn_east_range","ashscale_monitor_residents",-204,430,16,5,"Monitors range east of Emberhorn's retained territory in the northern foothills."],
  ["emberhorn_west_range","basalt_drake_residents",-318,429,16,5,"Drakes occupy the western Emberhorn range, separate from the retained ridge habitat."],
  ["ashback_east_outer","cinder_ravager_residents",-69,407,10,6,"Ravagers patrol the open eastern side of the Ashback refuge."],
  ["ashback_northeast_range","gorge_mantis_residents",-62,438,10,5,"Mantises hunt northeast of the Ashback refuge, clear of the northern border."],
  ["emberfast_northwest_outer","cinder_ravager_residents",-24,398,10,6,"Ravagers patrol beyond Emberfast's northwest town reserve."],
  ["emberfast_north_outer","basalt_drake_residents",24,429,16,5,"Drakes occupy the broad northern ground beyond Emberfast."],
  ["ashfin_outer_east","ashscale_monitor_residents",298,286,16,5,"Monitors range dry foothills east of the full Ashfin outer bank."],
  ["cinderpine_outer_east","ashscale_monitor_residents",317,344,16,5,"Monitors occupy dry ground east of Cinderpine's timber working envelope."],
  ["cinderpine_northwest_outer","slag_centipede_residents",214,427,14,6,"Centipedes range northwest of Cinderpine, clear of the fire-cache approach."],
  ["cinderpine_west_gap","gorge_mantis_residents",134,370,10,5,"Mantises hunt in the western Cinderpine gap, away from the timber route."],
  ["kilnroad_southwestern_edge","gorge_mantis_residents",-208,220,10,5,"Mantises occupy the southwestern Kiln Road edge beyond the inter-region travel lane."],
  ["ashfin_southeast_open","cinder_ravager_residents",331,231,9,5,"Ravagers patrol open ground southeast of Ashfin, within the eastern boundary."],
  ["ashback_far_north","cinder_ravager_residents",-144,441,9,5,"Ravagers occupy the far northern Ashback margin with the boundary kept clear."],
  ["clinker_northern_edge","cinder_ravager_residents",-259,378,9,5,"Ravagers patrol Clinker's northern edge outside the worked quarry and retained habitats."],
];

const BASE_STATS = new Map(ENEMY_BLOCKS.map((block) => [block.id, block]));
const SOURCES = new Map(REGIONAL_PACK_SOURCES.map((source) => [source.id, source]));
const RANKS: readonly RegionalPackRank[] = ["ordinary", "seasoned", "mature"];
const MAX_IDLE_OFFSET = 0.45;
const EDGE_RESERVE = 0.15;

function requireBase(id: string): EnemyDef {
  const stats = BASE_STATS.get(id);
  if (!stats) throw new Error(`Regional pack has no canonical stat block: ${id}`);
  return stats;
}

function variantId(baseId: string, rank: RegionalPackRank): string {
  return `${baseId}_pack_${rank}`;
}

/** Slight stat and size differences within the same species, never a separate boss rank.
 * Offence/defence gain one point per step. Health gains 6% per step, at least one point.
 * Cadence, max hit, gait, armour, behaviour and loot remain the source species' properties.
 */
export const REGIONAL_PACK_VARIANTS: readonly RegionalPackVariant[] = [
  ...new Set(REGIONAL_PACK_SOURCES.map((source) => source.baseEnemyDefId)),
].flatMap((baseEnemyDefId) => {
  const base = requireBase(baseEnemyDefId);
  return RANKS.map((rank, index) => {
    const id = variantId(baseEnemyDefId, rank);
    return {
      id, baseEnemyDefId, rank, scaleMultiplier: 1 + index * 0.02,
      stats: {
        ...base, id,
        maxHealth: Math.max(base.maxHealth + index, Math.round(base.maxHealth * (1 + index * 0.06))),
        attackLevel: base.attackLevel + index,
        defenceLevel: base.defenceLevel + index,
      },
    };
  });
});
const VARIANTS = new Map(REGIONAL_PACK_VARIANTS.map((variant) => [variant.id, variant]));

/** Stable local formation inside an authored reservation; it never chooses world locations.
 * Uneven sectors and shallow radial variation leave room around each actor without moving
 * a saved member when a different pack is added. The full largest variant fits at any yaw.
 */
function packAnchors(id: string, source: PackSource, row: AuthoredPack): HabitatDef["anchors"] {
  const [, , x, z, radius, count] = row;
  const visualRadius = source.nativeVisualRadius * source.scale
    * tierSilhouetteScale(requireBase(source.baseEnemyDefId).tier) * 1.04;
  const ring = radius - visualRadius - MAX_IDLE_OFFSET - EDGE_RESERVE;
  if (ring <= 0) throw new Error(`Regional pack cannot contain its model: ${id}`);
  const phase = (hashId(id) % 360) * Math.PI / 180;
  return Array.from({ length: count }, (_, index) => {
    const angle = phase + index * Math.PI * 2 / count + 0.04 * Math.sin(index * 2.39 + phase);
    const distance = ring * (0.94 + 0.06 * Math.sin(index * 1.77 + phase) ** 2);
    return [x + Math.cos(angle) * distance, z + Math.sin(angle) * distance] as const;
  });
}

function createPack(regionId: RegionalPackRegionId, row: AuthoredPack): RegionalPackDef {
  const [settingId, sourceGroupId, x, z, radius, count, rationale] = row;
  const source = SOURCES.get(sourceGroupId);
  if (!source) throw new Error(`Regional pack source is missing: ${sourceGroupId}`);
  const base = requireBase(source.baseEnemyDefId);
  const id = `pack_${regionId}_${settingId}`;
  const anchors = packAnchors(id, source, row);
  const members = anchors.map((_, index) => ({
    id: `${id}_${index + 1}`,
    anchorIndex: index,
    // Ordinary members remain the majority. Every pack has a seasoned and a mature member.
    variantId: variantId(base.id, index === count - 1 ? "mature" : index === 1 ? "seasoned" : "ordinary"),
  }));
  const levels = members.map((member) => enemyCombatLevel(VARIANTS.get(member.variantId)!.stats));
  const regionalRisk = regionId === "kilnhalt"
    ? "Prove ravine crossings, basalt slopes and open retreat routes on the generated surface."
    : regionId === "karrowmoor"
      ? "Prove broad terrace footing and keep the whole Gravelmaw structure, gates and both quarry approaches clear."
      : regionId === "vellenwood"
        ? "Prove dry forest floor, trunk clearance and room between the town walls, marsh and hunting circuits."
        : "Prove dry open footing and keep the starting routes and farm approach outside pursuit space.";
  return {
    id, regionId, speciesId: base.family, baseGroupId: source.id, baseEnemyDefId: base.id,
    assetId: source.assetId, scale: source.scale, activity: source.activity,
    centre: [x, z], radius, anchors, members, settingId, rationale,
    placementRisks: [
      regionalRisk,
      "Source reservations do not prove solved water, navigation, forest collision or simultaneous moving-body clearance.",
      "Accept same-species stat variants and a representative 5–10 member encounter in the production lab before world registration.",
    ],
    levelRange: [Math.min(...levels), Math.max(...levels)],
  };
}

export const REGIONAL_PACKS: readonly RegionalPackDef[] = [
  ...FALLOWMARCH.map((row) => createPack("fallowmarch", row)),
  ...VELLENWOOD.map((row) => createPack("vellenwood", row)),
  ...KARROWMOOR.map((row) => createPack("karrowmoor", row)),
  ...KILNHALT.map((row) => createPack("kilnhalt", row)),
];

/** Source projections for the root-owned registration step. These exports do not register.
 * Bind every member's variantId to meta.enemyDefId and multiply its source scale by that
 * variant's scaleMultiplier before the normal entity, health and view setup.
 */
export const REGIONAL_PACK_GROUPS: readonly EnemyGroupDef[] = REGIONAL_PACKS.map((pack) => {
  const base = requireBase(pack.baseEnemyDefId);
  return {
    id: pack.id, family: base.family, name: base.name, tier: base.tier,
    count: pack.members.length, centre: pack.centre, radius: pack.radius,
    assetId: pack.assetId, scale: pack.scale,
  };
});

export const REGIONAL_PACK_HABITATS: readonly HabitatDef[] = REGIONAL_PACKS.map((pack) => ({
  id: `${pack.id}_habitat`, groupId: pack.id, regionId: pack.regionId,
  centre: pack.centre, radius: pack.radius, anchors: pack.anchors, activity: pack.activity,
  dressing: [],
}));

function regionalLevelRange(regionId: RegionalPackRegionId): readonly [number, number] {
  const packs = REGIONAL_PACKS.filter((pack) => pack.regionId === regionId);
  return [
    Math.min(...packs.map((pack) => pack.levelRange[0])),
    Math.max(...packs.map((pack) => pack.levelRange[1])),
  ];
}

export const REGIONAL_PACK_LEVEL_RANGES: Readonly<Record<RegionalPackRegionId, readonly [number, number]>> = {
  fallowmarch: regionalLevelRange("fallowmarch"),
  vellenwood: regionalLevelRange("vellenwood"),
  karrowmoor: regionalLevelRange("karrowmoor"),
  kilnhalt: regionalLevelRange("kilnhalt"),
};
