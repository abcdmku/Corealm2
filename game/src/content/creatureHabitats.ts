import type { RegionId } from "../contracts.js";
import { CREATURE_EXPANSION } from "./creatureExpansion.js";
import type { EnemyGroupDef } from "./regions.js";
import type { HabitatDef } from "./worldHabitats.js";

/** Placement notes from runs/corealm-rebuild/creature-habitat-plan.json, kept out of game contracts. */
export interface CreatureHabitatNotes {
  readonly speciesId: string;
  readonly enemyDefId: string;
  readonly groupId: string;
  readonly habitatId: string;
  readonly settingId: string;
  readonly rationale: string;
  readonly riskNotes: readonly string[];
  readonly movementDomain: "ground";
  readonly enabled: false;
  readonly status: "proposed_pending_lab_and_world_acceptance";
  readonly nearestScreenedExclusion: { readonly id: string; readonly kind: string; readonly gapMetres: number };
  readonly dressingNotes: readonly string[];
  /** Source-screened body envelope, including sampled motion reserve; final nav paths need proof. */
  readonly dressingBodyRadius?: number;
}

interface StagedCreatureHabitat extends CreatureHabitatNotes {
  readonly assetId: string;
  readonly regionId: RegionId;
  readonly tier: number;
  readonly activity: HabitatDef["activity"];
  readonly count: number;
  readonly centre: HabitatDef["centre"];
  readonly radius: number;
  readonly anchors: HabitatDef["anchors"];
  readonly dressing: HabitatDef["dressing"];
}

/**
 * Production data: 24 groups, 53 residents and 124 ordered spawn/activity anchors.
 * Regions and habitats register together after the production creature and loot lab acceptance.
 * Final terrain, solved water, navigation and setting composition still need world acceptance.
 * The first count anchors retain the proposal's actor order; singleton IDs must remain stable.
 */
const STAGED_CREATURE_HABITATS: readonly StagedCreatureHabitat[] = [
  {
    speciesId: "redbrush_fox", assetId: "creature_redbrush_fox", enemyDefId: "redbrush_fox_t1",
    groupId: "redbrush_fox_residents", habitatId: "hedge_northwest_of_marchfield_habitat",
    regionId: "fallowmarch", tier: 1, activity: "forage", count: 2,
    centre: [-177,24], radius: 10,
    anchors: [[-182,27], [-173,20], [-170,27], [-178,32], [-184,21]],
    settingId: "hedge_northwest_of_marchfield",
    rationale: "A small hedge patch northwest of Marchfield connects open foraging ground to proposed shrub cover, clear of the current coney hedge.",
    riskNotes: ["Keep the eastern half open for a short retreat. Any den or shrub dressing needs lab acceptance; a den-shaped prop does not add a burrowing interaction."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"lone_dead_palewood","kind":"landmark","gapMetres":3},
    dressing: [
      { id: "hedge_cover", assetId: "corealm_shrub_1", x: -183, z: 34, yaw: 0.4, scale: 1.1 },
    ],
    dressingBodyRadius: 2,
    dressingNotes: ["Shrub cover frames the northern hedge edge while the eastern retreat remains open. Source screening reserves a 2 m body radius plus each measured prop radius, 0.25 m plant sway and at least 1 m beyond every straight anchor connection. Actual terrain, collision and navigation remain unaccepted."],
  },
  {
    speciesId: "duskoak_lynx", assetId: "creature_duskoak_lynx", enemyDefId: "duskoak_lynx_t5",
    groupId: "duskoak_lynx_residents", habitatId: "east_clearing_margin_habitat",
    regionId: "vellenwood", tier: 5, activity: "prowl", count: 1,
    centre: [243,128], radius: 9,
    anchors: [[243,128], [237,124], [249,124], [247,134], [238,133]],
    settingId: "east_clearing_margin",
    rationale: "One hunter occupies an eastern clearing margin between the Thornline routes and the Rootheart area, with open floor around the strike.",
    riskNotes: ["Confirm sightlines and canopy at normal play distance. Keep the animal and pursuit clear of the Rootheart approach and nearby adders."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"source_road_29_leg_0","kind":"road","gapMetres":10.98},
    dressing: [
      { id: "clearing_cover", assetId: "corealm_shrub_1", x: 252, z: 136, yaw: -0.3, scale: 1.2 },
    ],
    dressingBodyRadius: 2,
    dressingNotes: ["Low cover frames the clearing edge outside the hunting floor. Source screening reserves a 2 m body radius plus each measured prop radius, 0.25 m plant sway and at least 1 m beyond every straight anchor connection. Actual terrain, collision and navigation remain unaccepted."],
  },
  {
    speciesId: "rootdelve_badger", assetId: "creature_rootdelve_badger", enemyDefId: "rootdelve_badger_t5",
    groupId: "rootdelve_badger_residents", habitatId: "rootfall_south_stump_belt_habitat",
    regionId: "vellenwood", tier: 5, activity: "forage", count: 2,
    centre: [64,77], radius: 7,
    anchors: [[60,76], [68,78], [64,82], [61,72], [68,73]],
    settingId: "rootfall_south_stump_belt",
    rationale: "A proposed stump belt south of Rootfall offers a separate low forager patch beyond the palisade and bank routes.",
    riskNotes: ["The settlement pad is the nearest exclusion. Keep any hollow stump south of the existing yard and recheck the building envelope before integration."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"rootfall","kind":"settlement","gapMetres":4},
    dressing: [
      { id: "stump_edge", assetId: "corealm_stump_oak", x: 58, z: 83, yaw: 0.75, scale: 0.85 },
      { id: "stump_fern", assetId: "corealm_fern_2", x: 56.7, z: 81, yaw: -0.4, scale: 0.75 },
    ],
    dressingBodyRadius: 1.75,
    dressingNotes: ["A stump and fern frame the foraging patch; neither adds a hollow or burrowing interaction. Source screening reserves a 1.75 m body radius plus each measured prop radius, 0.25 m plant sway and at least 1 m beyond every straight anchor connection. Actual terrain, collision and navigation remain unaccepted."],
  },
  {
    speciesId: "quillback_porcupine", assetId: "creature_quillback_porcupine", enemyDefId: "quillback_porcupine_t10",
    groupId: "quillback_porcupine_residents", habitatId: "upper_moor_root_pocket_habitat",
    regionId: "karrowmoor", tier: 10, activity: "forage", count: 2,
    centre: [237,-166], radius: 8,
    anchors: [[232,-164], [242,-168], [237,-172], [243,-161], [231,-170]],
    settingId: "upper_moor_root_pocket",
    rationale: "Exposed-root dressing in the gap south of the pine shelf separates these browsers from ridge ibex and upper-moor boars.",
    riskNotes: ["Ground sampling must prove a usable shelf rather than a terrace riser. Keep modeled quills clear of rocks during turns."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"ridge_ibex_shelves","kind":"existing_habitat","gapMetres":19.19},
    dressing: [
      { id: "root_stub", assetId: "corealm_stump_pine", x: 245, z: -174, yaw: 0.25, scale: 1.2 },
    ],
    dressingBodyRadius: 2,
    dressingNotes: ["An exposed root flare sits beside the browsing floor and outside quill-turning space. Source screening reserves a 2 m body radius plus each measured prop radius, 0.25 m plant sway and at least 1 m beyond every straight anchor connection. Actual terrain, collision and navigation remain unaccepted."],
  },
  {
    speciesId: "marchwild_horse", assetId: "creature_marchwild_horse", enemyDefId: "marchwild_horse_t5",
    groupId: "marchwild_horse_residents", habitatId: "northern_march_grass_habitat",
    regionId: "fallowmarch", tier: 5, activity: "graze", count: 4,
    centre: [-224,142], radius: 18,
    anchors: [[-234,139], [-224,132], [-214,140], [-224,152], [-235,150], [-212,152]],
    settingId: "northern_march_grass",
    rationale: "Four individually anchored grazers occupy northern open ground west of the kiln road and east of Galeskin.",
    riskNotes: ["Reserve the full open patch for body clearance and short retreat routes. The current graze activity does not imply coordinated herd or flee behavior."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"source_road_16_leg_0","kind":"road","gapMetres":17.06},
    dressing: [],
    dressingNotes: [],
  },
  {
    speciesId: "cairn_bighorn", assetId: "creature_cairn_bighorn", enemyDefId: "cairn_bighorn_t10",
    groupId: "cairn_bighorn_residents", habitatId: "northern_tarn_shelf_habitat",
    regionId: "karrowmoor", tier: 10, activity: "graze", count: 3,
    centre: [231,-42], radius: 12,
    anchors: [[223,-42], [231,-49], [239,-40], [230,-33], [239,-47]],
    settingId: "northern_tarn_shelf",
    rationale: "A broad shelf candidate north of Cairn Tarn gives three sheep room to turn while retaining separation from the existing ibex shelf.",
    riskNotes: ["Terrace slope and hoof contact remain unproved. Accept a broad reachable shelf before adding rocks along its edge."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"scree_bustard","kind":"new_habitat","gapMetres":14.12},
    dressing: [
      { id: "shelf_edge", assetId: "corealm_rock_strata_3", x: 242, z: -32, yaw: -0.4, scale: 0.6, sink: 0.12 },
    ],
    dressingBodyRadius: 2.75,
    dressingNotes: ["A low rock marks the shelf edge while leaving the whole turning floor open. Source screening reserves a 2.75 m body radius plus each measured prop radius, 0.25 m plant sway and at least 1 m beyond every straight anchor connection. Actual terrain, collision and navigation remain unaccepted."],
  },
  {
    speciesId: "marsh_moose", assetId: "creature_marsh_moose", enemyDefId: "marsh_moose_t10",
    groupId: "marsh_moose_residents", habitatId: "blackwater_south_dry_margin_habitat",
    regionId: "vellenwood", tier: 10, activity: "graze", count: 2,
    centre: [150,34], radius: 12,
    anchors: [[142,32], [158,36], [150,43], [155,26], [141,41]],
    settingId: "blackwater_south_dry_margin",
    rationale: "Two moose occupy a broad dry approach to the southern Blackwater marsh margin, outside the basin and casting route.",
    riskNotes: ["This is a dry-ground reservation, not a water spawn. Verify antler and body width, turning room, marsh vegetation and dry navigation at every anchor."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"vellenwood_south_boundary","kind":"semantic_boundary","gapMetres":12},
    dressing: [],
    dressingNotes: [],
  },
  {
    speciesId: "bracken_tapir", assetId: "creature_bracken_tapir", enemyDefId: "bracken_tapir_t5",
    groupId: "bracken_tapir_residents", habitatId: "blackwater_southwest_cover_habitat",
    regionId: "vellenwood", tier: 5, activity: "forage", count: 2,
    centre: [96,44], radius: 10,
    anchors: [[90,44], [102,43], [98,51], [91,37], [103,50]],
    settingId: "blackwater_southwest_cover",
    rationale: "A sheltered patch southwest of Blackwater offers low-risk browsing away from the water, Rootfall routes and moose.",
    riskNotes: ["Visual woodland coverage is not guaranteed by semantic region ownership. Root must confirm shelter and dry continuous routes without moving the lake."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"blackwater_spots","kind":"water_crest","gapMetres":15.22},
    dressing: [
      { id: "browse_cover", assetId: "corealm_shrub_1", x: 105, z: 35, yaw: 0.6, scale: 1.2 },
    ],
    dressingBodyRadius: 2.75,
    dressingNotes: ["Low cover sits beside the browsing patch rather than across its activity routes. Source screening reserves a 2.75 m body radius plus each measured prop radius, 0.25 m plant sway and at least 1 m beyond every straight anchor connection. Actual terrain, collision and navigation remain unaccepted."],
  },
  {
    speciesId: "reedjaw_crocodile", assetId: "creature_reedjaw_crocodile", enemyDefId: "reedjaw_crocodile_t10",
    groupId: "reedjaw_crocodile_residents", habitatId: "far_tarn_east_dry_bank_habitat",
    regionId: "karrowmoor", tier: 10, activity: "prowl", count: 1,
    centre: [316,-106], radius: 7,
    anchors: [[316,-106], [312,-110], [321,-108], [320,-101], [312,-102]],
    settingId: "far_tarn_east_dry_bank",
    rationale: "One crocodile uses the dry eastern shoulder of Far Tarn, opposite the western fishing landing and clear of the water-cache road.",
    riskNotes: ["The nominal crest exclusion leaves a small margin. Check solved shoreline, tail sweep and both Far Tarn road endpoints. No swimming or shore-crossing snap is allowed."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"far_tarn_spots","kind":"water_crest","gapMetres":4.25},
    dressing: [],
    dressingNotes: [],
  },
  {
    speciesId: "kiln_salamander", assetId: "creature_kiln_salamander", enemyDefId: "kiln_salamander_t20",
    groupId: "kiln_salamander_residents", habitatId: "ashfin_east_warm_rocks_habitat",
    regionId: "kilnhalt", tier: 20, activity: "forage", count: 2,
    centre: [244,269], radius: 6,
    anchors: [[240,269], [247,267], [245,273], [241,265], [249,270]],
    settingId: "ashfin_east_warm_rocks",
    rationale: "A warm-rock shelter east of Ashfin sits outside the basin, northeast of the handling landing, and beyond the current adder patch.",
    riskNotes: ["Confirm dry ground under every splayed foot and the route to Cinderpine. Use ordinary production melee; damp shelter does not require a new water volume."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"source_road_59_leg_0","kind":"road","gapMetres":6.25},
    dressing: [
      { id: "warm_rock_edge", assetId: "corealm_rock_strata_2", x: 253, z: 276, yaw: 0.3, scale: 0.55, sink: 0.12 },
    ],
    dressingBodyRadius: 1.5,
    dressingNotes: ["One stone frames a warm-rock shelter edge without requiring under-rock traversal. Source screening reserves a 1.5 m body radius plus each measured prop radius, 0.25 m plant sway and at least 1 m beyond every straight anchor connection. Actual terrain, collision and navigation remain unaccepted."],
  },
  {
    speciesId: "slateback_tortoise", assetId: "creature_slateback_tortoise", enemyDefId: "slateback_tortoise_t10",
    groupId: "slateback_tortoise_residents", habitatId: "west_moor_ledge_basin_habitat",
    regionId: "karrowmoor", tier: 10, activity: "forage", count: 2,
    centre: [55,-111], radius: 8,
    anchors: [[50,-110], [59,-114], [55,-105], [49,-115], [61,-107]],
    settingId: "west_moor_ledge_basin",
    rationale: "Low forage and a proposed warm rock edge on the western moor give two tortoises a quiet patch between larger encounters.",
    riskNotes: ["Check the whole route on the terrace rather than accepting dry anchor points alone. Keep the rigid shell clear of rocks; no invulnerability state is implied."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"quarry_nightmare","kind":"new_habitat","gapMetres":14.22},
    dressing: [
      { id: "warm_ledge_edge", assetId: "corealm_rock_strata_3", x: 49, z: -122, yaw: 0.65, scale: 0.55, sink: 0.15 },
    ],
    dressingBodyRadius: 3,
    dressingNotes: ["Low stone frames the southern edge and leaves shell-sized turning room. Source screening reserves a 3 m body radius plus each measured prop radius, 0.25 m plant sway and at least 1 m beyond every straight anchor connection. Actual terrain, collision and navigation remain unaccepted."],
  },
  {
    speciesId: "ashscale_monitor", assetId: "creature_ashscale_monitor", enemyDefId: "ashscale_monitor_t20",
    groupId: "ashscale_monitor_residents", habitatId: "cinderpine_west_scree_habitat",
    regionId: "kilnhalt", tier: 20, activity: "prowl", count: 2,
    centre: [175,378], radius: 11,
    anchors: [[168,375], [181,381], [176,370], [183,374], [169,385]],
    settingId: "cinderpine_west_scree",
    rationale: "Dry scree west of Cinderpine supports a separate hunting patch south of the ravager court and away from the main timber road.",
    riskNotes: ["The long tail and nine-metre aggro range need full-route clearance. Do not let pursuit enter the grove working area or the new ravager patch."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"source_road_57_leg_0","kind":"road","gapMetres":15.09},
    dressing: [
      { id: "scree_edge", assetId: "corealm_scree_1", x: 185, z: 389, yaw: -0.2, scale: 0.8, sink: 0.05 },
    ],
    dressingBodyRadius: 5,
    dressingNotes: ["Loose scree marks the outer hunting margin beyond the long tail envelope. Source screening reserves a 5 m body radius plus each measured prop radius, 0.25 m plant sway and at least 1 m beyond every straight anchor connection. Actual terrain, collision and navigation remain unaccepted."],
  },
  {
    speciesId: "reedbank_goose", assetId: "creature_reedbank_goose", enemyDefId: "reedbank_goose_t1",
    groupId: "reedbank_goose_residents", habitatId: "redsill_north_dry_reeds_habitat",
    regionId: "fallowmarch", tier: 1, activity: "forage", count: 4,
    centre: [-40,-27], radius: 5,
    anchors: [[-43,-28], [-39,-30], [-37,-26], [-42,-24], [-39,-23]],
    settingId: "redsill_north_dry_reeds",
    rationale: "A small grounded flock forages north of Redsill, beyond the existing frog margin and opposite the southwest fishing approach.",
    riskNotes: ["Verify actual dry reeds and the resolved landing route. Leave Brookvault's exit and the semantic eastern boundary clear; wings remain grounded body animation."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"redsill_spots","kind":"water_crest","gapMetres":5},
    dressing: [],
    dressingNotes: [],
  },
  {
    speciesId: "blackwater_heron", assetId: "creature_blackwater_heron", enemyDefId: "blackwater_heron_t5",
    groupId: "blackwater_heron_residents", habitatId: "blackwater_northeast_reed_shelf_habitat",
    regionId: "vellenwood", tier: 5, activity: "forage", count: 2,
    centre: [153,109], radius: 5,
    anchors: [[150,110], [155,107], [156,112], [151,105], [153,113]],
    settingId: "blackwater_northeast_reed_shelf",
    rationale: "Two birds occupy a separate dry reed shelf northeast of Blackwater, beyond the frogs and below the hog rooting patch.",
    riskNotes: ["This is the tightest gap to existing wildlife. Verify the solved bank, planted long-legged stance, activity paths and a readable separation from frogs and hogs."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"blackwater_reed_margin","kind":"existing_habitat","gapMetres":4.25},
    dressing: [],
    dressingNotes: [],
  },
  {
    speciesId: "scree_bustard", assetId: "creature_scree_bustard", enemyDefId: "scree_bustard_t10",
    groupId: "scree_bustard_residents", habitatId: "tarn_track_west_grass_habitat",
    regionId: "karrowmoor", tier: 10, activity: "prowl", count: 3,
    centre: [270,-45], radius: 10,
    anchors: [[263,-44], [270,-52], [277,-42], [272,-37], [263,-50]],
    settingId: "tarn_track_west_grass",
    rationale: "Open ground west of Tarn Track provides a ground-bird patch between shelves, distinct from the bighorn and existing pine wildlife.",
    riskNotes: ["The eight-metre aggro reach must stay clear of the curved Tarn Track road. Confirm the display silhouette and running contact on actual terrain."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"cairn_bighorn","kind":"new_habitat","gapMetres":14.12},
    dressing: [],
    dressingNotes: [],
  },
  {
    speciesId: "marchfield_turkey", assetId: "creature_marchfield_turkey", enemyDefId: "marchfield_turkey_t1",
    groupId: "marchfield_turkey_residents", habitatId: "marchfield_outer_orchard_margin_habitat",
    regionId: "fallowmarch", tier: 1, activity: "forage", count: 4,
    centre: [-83,8], radius: 5,
    anchors: [[-86,7], [-82,5], [-80,9], [-85,11], [-82,12]],
    settingId: "marchfield_outer_orchard_margin",
    rationale: "An outer feeding patch northeast of the existing farm keeps the new fan-tailed birds visible near Marchfield without occupying either hen pen.",
    riskNotes: ["No orchard or new paddock is claimed to exist here. Lab-accepted low cover can frame the patch; keep the farm paths and current rails unchanged."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"marchfield_farmstead","kind":"farm_yard","gapMetres":7.7},
    dressing: [
      { id: "field_cover", assetId: "corealm_shrub_2", x: -77, z: 14, yaw: 0.35, scale: 1.1 },
    ],
    dressingBodyRadius: 1.5,
    dressingNotes: ["A low field-edge shrub frames the flock without claiming a new orchard or pen. Source screening reserves a 1.5 m body radius plus each measured prop radius, 0.25 m plant sway and at least 1 m beyond every straight anchor connection. Actual terrain, collision and navigation remain unaccepted."],
  },
  {
    speciesId: "quarry_snail", assetId: "creature_quarry_snail", enemyDefId: "quarry_snail_t5",
    groupId: "quarry_snail_residents", habitatId: "hollowcut_outer_damp_toe_habitat",
    regionId: "vellenwood", tier: 5, activity: "forage", count: 4,
    centre: [122,160], radius: 4,
    anchors: [[120,159], [123,158], [124,161], [121,162], [123,163]],
    settingId: "hollowcut_outer_damp_toe",
    rationale: "A small damp-rock patch northeast of Hollowcut uses the outer toe of the worked landscape without entering the mine extent.",
    riskNotes: ["The worksite and gorge-head road are the nearest exclusions. Inspect the mine cut face, root tunnel and real ground slope before promoting this compact patch."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"hollowcut_workings","kind":"worksite","gapMetres":3.75},
    dressing: [],
    dressingNotes: [],
  },
  {
    speciesId: "antler_beetle", assetId: "creature_antler_beetle", enemyDefId: "antler_beetle_t10",
    groupId: "antler_beetle_residents", habitatId: "ridge_pine_south_deadwood_habitat",
    regionId: "karrowmoor", tier: 10, activity: "forage", count: 3,
    centre: [241,-129], radius: 5,
    anchors: [[238,-129], [242,-132], [244,-127], [239,-125], [242,-125]],
    settingId: "ridge_pine_south_deadwood",
    rationale: "A deadwood pocket south of the authored pine site places beetles between the grove footprint and the ibex shelf.",
    riskNotes: ["Keep Cairn Leap endpoints clear and place any log outside all activity routes. Recheck six-foot contact and the pine site's rotated working envelope."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"ridge_pine_shelter","kind":"worksite","gapMetres":7.08},
    dressing: [
      { id: "deadwood_edge", assetId: "corealm_deadwood_2", x: 248, z: -133, yaw: -0.4, scale: 0.7 },
    ],
    dressingBodyRadius: 3,
    dressingNotes: ["Standing dead pine provides the proposed deadwood setting outside all activity connections. Source screening reserves a 3 m body radius plus each measured prop radius, 0.25 m plant sway and at least 1 m beyond every straight anchor connection. Actual terrain, collision and navigation remain unaccepted."],
  },
  {
    speciesId: "slag_centipede", assetId: "creature_slag_centipede", enemyDefId: "slag_centipede_t20",
    groupId: "slag_centipede_residents", habitatId: "west_kiln_fissure_mouth_habitat",
    regionId: "kilnhalt", tier: 20, activity: "prowl", count: 2,
    centre: [-169,382], radius: 9,
    anchors: [[-175,380], [-165,385], [-170,376], [-163,379], [-174,387]],
    settingId: "west_kiln_fissure_mouth",
    rationale: "A broad dry fissure-mouth candidate north of the quarry road separates centipedes from ashback bears and keeps the main path readable.",
    riskNotes: ["The fissure setting is proposed, not measured existing terrain. Accept its local dressing first and verify the full segmented body stays inside an honest footprint on turns."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"ashback_rock_refuge","kind":"existing_habitat","gapMetres":24.37},
    dressing: [
      { id: "scree_margin", assetId: "corealm_scree_2", x: -181, z: 391, yaw: 0.3, scale: 0.9, sink: 0.05 },
    ],
    dressingBodyRadius: 3.75,
    dressingNotes: ["Scree sits beside open ground; it does not imply an authored fissure entrance. Source screening reserves a 3.75 m body radius plus each measured prop radius, 0.25 m plant sway and at least 1 m beyond every straight anchor connection. Actual terrain, collision and navigation remain unaccepted."],
  },
  {
    speciesId: "hollowroot_spider", assetId: "creature_hollowroot_spider", enemyDefId: "hollowroot_spider_t5",
    groupId: "hollowroot_spider_residents", habitatId: "rootfall_southwest_hollow_roots_habitat",
    regionId: "vellenwood", tier: 5, activity: "prowl", count: 2,
    centre: [14,83], radius: 7,
    anchors: [[10,82], [18,85], [14,78], [9,87], [19,80]],
    settingId: "rootfall_southwest_hollow_roots",
    rationale: "Dry hollow-root cover southwest of Rootfall gives short-range spiders a distinct pocket away from the canopy route and tapir ground.",
    riskNotes: ["Roots must frame the encounter without hiding targets or blocking legs. There is no web trap, poison or burrow traversal in the initial behavior."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"rootfall","kind":"settlement","gapMetres":13.4},
    dressing: [
      { id: "root_edge", assetId: "corealm_stump_oak", x: 6, z: 77, yaw: -0.6, scale: 0.85 },
    ],
    dressingBodyRadius: 3,
    dressingNotes: ["A root flare frames the patch without a hollow, trap or obstacle across the legs. Source screening reserves a 3 m body radius plus each measured prop radius, 0.25 m plant sway and at least 1 m beyond every straight anchor connection. Actual terrain, collision and navigation remain unaccepted."],
  },
  {
    speciesId: "cinder_ravager", assetId: "creature_cinder_ravager", enemyDefId: "cinder_ravager_t20",
    groupId: "cinder_ravager_residents", habitatId: "north_kiln_abandoned_court_habitat",
    regionId: "kilnhalt", tier: 20, activity: "patrol", count: 1,
    centre: [130,414], radius: 17,
    anchors: [[130,414], [119,409], [137,404], [141,420], [128,427], [117,418]],
    settingId: "north_kiln_abandoned_court",
    rationale: "One dangerous resident patrols a proposed abandoned kiln court in the northern interior, well away from Emberfast, Cinderwake and ordinary boars.",
    riskNotes: ["The court is new local dressing and must pass the lab before placement. Keep the inner patrol open for a large body and ordinary melee escape space."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"cinder_regrowth_patch","kind":"existing_habitat","gapMetres":22.64},
    dressing: [],
    dressingNotes: [],
  },
  {
    speciesId: "basalt_drake", assetId: "creature_basalt_drake", enemyDefId: "basalt_drake_t20",
    groupId: "basalt_drake_residents", habitatId: "clinker_outer_northwest_bench_habitat",
    regionId: "kilnhalt", tier: 20, activity: "prowl", count: 1,
    centre: [-303,370], radius: 16,
    anchors: [[-303,370], [-313,369], [-309,379], [-293,376], [-292,365], [-302,359]],
    settingId: "clinker_outer_northwest_bench",
    rationale: "A single drake occupies an outer bench northwest of Clinker, beyond the mine's rotated extent and the main road.",
    riskNotes: ["Actual bench relief and broad turns need browser proof. Dressing must not expand the live work floor or create an approach through the mine face."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"clinker_cut","kind":"worksite","gapMetres":10},
    dressing: [
      { id: "bench_edge", assetId: "corealm_rock_strata_1", x: -318, z: 381, yaw: 0.2, scale: 0.65, sink: 0.15 },
    ],
    dressingBodyRadius: 5,
    dressingNotes: ["One outcrop marks the outer bench while preserving broad turns and the mine approach. Source screening reserves a 5 m body radius plus each measured prop radius, 0.25 m plant sway and at least 1 m beyond every straight anchor connection. Actual terrain, collision and navigation remain unaccepted."],
  },
  {
    speciesId: "gorge_mantis", assetId: "creature_gorge_mantis", enemyDefId: "gorge_mantis_t20",
    groupId: "gorge_mantis_residents", habitatId: "inner_ashfin_ravine_shelter_habitat",
    regionId: "kilnhalt", tier: 20, activity: "prowl", count: 1,
    centre: [129,306], radius: 8,
    anchors: [[129,306], [124,302], [135,305], [131,312], [124,310]],
    settingId: "inner_ashfin_ravine_shelter",
    rationale: "A sheltered ravine candidate between the Ashfin and Cinderpine roads gives a tall solitary hunter a compact ground territory.",
    riskNotes: ["The source only supports a location candidate, not a verified ravine. Check terrain and room for all long legs; converted ground clips must pass the lab first."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"source_road_57_leg_0","kind":"road","gapMetres":8.39},
    dressing: [
      { id: "stone_edge", assetId: "corealm_rock_strata_2", x: 139, z: 314, yaw: -0.35, scale: 0.6, sink: 0.12 },
    ],
    dressingBodyRadius: 2.75,
    dressingNotes: ["A stone edge frames the hunter without claiming that a ravine already exists. Source screening reserves a 2.75 m body radius plus each measured prop radius, 0.25 m plant sway and at least 1 m beyond every straight anchor connection. Actual terrain, collision and navigation remain unaccepted."],
  },
  {
    speciesId: "quarry_nightmare", assetId: "creature_quarry_nightmare", enemyDefId: "quarry_nightmare_t10",
    groupId: "quarry_nightmare_residents", habitatId: "west_moor_abandoned_cut_habitat",
    regionId: "karrowmoor", tier: 10, activity: "patrol", count: 1,
    centre: [18,-98], radius: 14,
    anchors: [[18,-98], [10,-102], [25,-105], [27,-92], [16,-88], [8,-94]],
    settingId: "west_moor_abandoned_cut",
    rationale: "One territorial ground dragon patrols a broad abandoned-cut candidate west of the quarry route and north of Tideworn.",
    riskNotes: ["This cut needs lab-accepted rock dressing and final terrain proof. Preserve the Gravelmaw entrance, Tideworn approach and tortoise patch; do not substitute a dungeon spawn."],
    movementDomain: "ground", enabled: false, status: "proposed_pending_lab_and_world_acceptance",
    nearestScreenedExclusion: {"id":"tideworn","kind":"boss_centre","gapMetres":20},
    dressing: [
      { id: "cut_edge", assetId: "corealm_rock_strata_1", x: -1, z: -110, yaw: 0.55, scale: 0.75, sink: 0.15 },
    ],
    dressingBodyRadius: 5,
    dressingNotes: ["A western outcrop leaves the entire patrol floor open; it does not create a new mine. Source screening reserves a 5 m body radius plus each measured prop radius, 0.25 m plant sway and at least 1 m beyond every straight anchor connection. Actual terrain, collision and navigation remain unaccepted."],
  },
];

const speciesById = new Map(CREATURE_EXPANSION.map((species) => [species.id, species]));

/** Append each group only to the region named by its matching CREATURE_HABITATS row. */
export const CREATURE_ENEMY_GROUPS: readonly EnemyGroupDef[] = STAGED_CREATURE_HABITATS.map((row) => {
  const species = speciesById.get(row.speciesId);
  if (!species || species.assetId !== row.assetId || species.stats.id !== row.enemyDefId
    || species.regionId !== row.regionId || species.stats.tier !== row.tier || species.activity !== row.activity) {
    throw new Error(`Staged habitat ${row.habitatId} no longer matches its production species`);
  }
  return {
    id: row.groupId, family: species.stats.family, name: species.stats.name, tier: species.stats.tier,
    count: row.count, centre: row.centre, radius: row.radius, assetId: species.assetId, scale: species.scale,
  };
});

/** Register these in the same round as their groups so regionBuilder uses the ordered anchors. */
export const CREATURE_HABITATS: readonly HabitatDef[] = STAGED_CREATURE_HABITATS.map((row) => ({
  id: row.habitatId, groupId: row.groupId, regionId: row.regionId,
  centre: row.centre, radius: row.radius, anchors: row.anchors, activity: row.activity, dressing: row.dressing,
}));

/** Original proposal notes remain evidence of pending checks, not gameplay flags or new abilities. */
export const CREATURE_HABITAT_NOTES: readonly CreatureHabitatNotes[] = STAGED_CREATURE_HABITATS.map((row) => ({
  speciesId: row.speciesId, enemyDefId: row.enemyDefId, groupId: row.groupId, habitatId: row.habitatId,
  settingId: row.settingId, rationale: row.rationale, riskNotes: row.riskNotes,
  movementDomain: row.movementDomain, enabled: row.enabled, status: row.status,
  nearestScreenedExclusion: row.nearestScreenedExclusion, dressingNotes: row.dressingNotes,
  ...(row.dressingBodyRadius === undefined ? {} : { dressingBodyRadius: row.dressingBodyRadius }),
}));
