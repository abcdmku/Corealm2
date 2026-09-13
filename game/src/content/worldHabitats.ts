import { BIOME_POPULATION_HABITATS } from './biomePopulation.js';
import { REGIONAL_VARIANT_HABITATS, AMETHYST_CAVE_HABITAT } from "./regionalVariantHabitats.js";
import type { RegionId, Vec3 } from "../contracts.js";
import { WILDERNESS_HABITATS } from "./wilderness.js";
import { DEEP_WILDERNESS_PACK_HABITATS } from './deepWildernessEncounters.js';
import { FANTASY_ENCOUNTER_SPECIES } from "./fantasyEncounters.js";
import { CREATURE_HABITATS } from "./creatureHabitats.js";
import { STARTER_HABITATS } from "./starterHabitats.js";
import { RED_WORM_HABITAT } from './redWormHabitat.js';
import { REGIONS, WORLD_BOUNDS } from './regions.js';
import { encounterBodyRadius } from './encounterPlacement.js';
import { createEncounterFormation } from './encounterPopulation.js';
import { createLegacyEncounterFormation, LEGACY_ENCOUNTER_PLACEMENT_OVERRIDES } from './legacyEncounterPlacements.js';
import { FAIRY_TERRACE_HABITATS } from './fairyTerraceEncounters.js';
import { isFairyRegion } from '../contracts.js';

export interface HabitatDef {
  /** Spaced residents idle near their own spawn instead of sharing the pack's patrol sockets. */
  readonly roamRadius?: number;
  readonly id: string;
  readonly groupId: string;
  readonly regionId: RegionId;
  readonly centre: readonly [number, number];
  readonly radius: number;
  /** Generated coast has already passed the playable receiving-floor sampler outside the core map. */
  readonly boundary?: 'playable-coast';
  /** World-space spawn and activity points. The first group.count points preserve actor order. */
  readonly anchors: readonly (readonly [number, number])[];
  readonly activity: "graze" | "forage" | "prowl" | "patrol";
  /** World-space setting pieces. Existing yards already have their own dressing. */
  readonly dressing: readonly {
    readonly id: string;
    readonly assetId: string;
    readonly x: number;
    readonly z: number;
    readonly yaw: number;
    readonly scale: number | [number, number, number];
    readonly sink?: number;
  }[];
}

/** One containment rule for AI destinations, pursuit and the corresponding tree-clearance paths. */
export function habitatContains(habitat: HabitatDef, position: Vec3): boolean {
  const [x, , z] = position;
  if (!Number.isFinite(x) || !Number.isFinite(z)
    || Math.hypot(x - habitat.centre[0], z - habitat.centre[1]) > habitat.radius) return false;
  if (habitat.boundary === 'playable-coast') return true;
  // Underground residents use their bounded pack circle and the dungeon navmesh.
  if (REGIONS.some(region => region.dungeon?.id === habitat.regionId)) return true;
  const bounds = REGIONS.find(region => region.id === habitat.regionId)?.bounds;
  return bounds !== undefined
    && (isFairyRegion(habitat.regionId) || (x >= WORLD_BOUNDS.min[0] && x <= WORLD_BOUNDS.max[0]
    && z >= WORLD_BOUNDS.min[1] && z <= WORLD_BOUNDS.max[1]))
    && x >= bounds.min[0] && x <= bounds.max[0] && z >= bounds.min[1] && z <= bounds.max[1];
}

/** Ordinary surface wildlife and patrols. Bosses and dungeon rooms keep their encounter authorship. */
const AUTHORED_WORLD_HABITATS: readonly HabitatDef[] = [
  ...REGIONAL_VARIANT_HABITATS,
  {
    id: "redsill_wet_margin", groupId: "redsill_frogs", regionId: "fallowmarch",
    centre: [-50, -52], radius: 9, activity: "forage",
    // The northwest bank leaves the southwest fishing approach open. Each point follows the
    // production basin's organic shore, with 1.5 m of effective radial clearance above water.
    anchors: [[-45.78, -45.48], [-48.25, -47.38], [-49.94, -50.13], [-50.96, -53.1], [-52.09, -55.84], [-54.05, -58.57]],
    dressing: [
      { id: "bank_refuge", assetId: "corealm_rock_strata_2", x: -55.6, z: -48.5, yaw: 0.6, scale: 0.38, sink: 0.1 },
      { id: "damp_fern", assetId: "corealm_fern_1", x: -53.0, z: -50.4, yaw: -0.3, scale: 0.75 },
    ],
  },
  {
    id: "marchfield_hen_pen", groupId: "marchfield_hens", regionId: "fallowmarch",
    centre: [-93, -21], radius: 4, activity: "forage",
    // Existing rails are x [-96,-90], z [-25,-17]. Leave the trough at [-92.1,-22.8] clear.
    anchors: [
      [-94.8, -23.7], [-93.5, -23.8], [-91.9, -24], [-94.8, -22.2],
      [-93.6, -21.7], [-91.0, -21.4], [-94.7, -20.6], [-93.0, -20.2],
      [-91.4, -19.8], [-94.7, -18.6], [-93.1, -18.3], [-91.2, -18.4],
    ],
    dressing: [],
  },
  {
    id: "marchfield_outer_yard", groupId: "bracken_hens", regionId: "fallowmarch",
    centre: [-101, -22.2], radius: 2.7, activity: "forage",
    // The smaller flock now belongs to the homestead's western paddock. Its old quarry-field
    // identity survives in group/actor IDs; the barn, scarecrow and fencing already frame it.
    anchors: [[-101.8, -23.0], [-100.3, -23.0], [-101.8, -21.3], [-100.3, -21.3]],
    dressing: [],
  },
  {
    id: "open_march_grazing", groupId: "open_march_goats", regionId: "fallowmarch",
    centre: [-250, 30], radius: 14, activity: "graze",
    anchors: [[-259, 24], [-250, 21], [-240, 30], [-250, 40], [-259, 33]],
    dressing: [
      { id: "wind_shelter", assetId: "corealm_rock_strata_3", x: -264, z: 38, yaw: 0.3, scale: 0.75, sink: 0.16 },
      { id: "sheltered_scrub", assetId: "corealm_shrub_1", x: -262, z: 33, yaw: -0.4, scale: 0.8 },
    ],
  },
  {
    id: "marchfield_cattle_grazing", groupId: "redsill_cattle", regionId: "fallowmarch",
    centre: [-110, -34], radius: 5, activity: "graze",
    // These cattle retain the existing farm-side grazing area; no imaginary second pen.
    anchors: [[-113, -36], [-108.7, -37], [-107.5, -32], [-112, -31]],
    dressing: [
      { id: "feed_trough", assetId: "corealm_feed_trough", x: -113.6, z: -29.1, yaw: 0.2, scale: 1.15 },
    ],
  },
  {
    id: "marchfield_hedge", groupId: "marchfield_coneys", regionId: "fallowmarch",
    centre: [-137, 10], radius: 8, activity: "forage",
    anchors: [[-142, 7], [-132, 12], [-137, 15]],
    dressing: [
      { id: "hedge_refuge", assetId: "corealm_shrub_1", x: -140, z: 14, yaw: 0.4, scale: 0.95 },
    ],
  },
  {
    id: "palewood_sunny_edge", groupId: "palewood_adders", regionId: "fallowmarch",
    centre: [-318, -94], radius: 11, activity: "prowl",
    anchors: [[-326, -91], [-320, -87], [-310, -92], [-316, -101]],
    dressing: [
      { id: "basking_stone", assetId: "corealm_rock_strata_2", x: -325, z: -98, yaw: 0.8, scale: 0.5, sink: 0.1 },
      { id: "fallen_cover", assetId: "nature_wood_log", x: -311, z: -99, yaw: 0.5, scale: 0.85 },
    ],
  },
  {
    id: "west_track_ambush", groupId: "march_road_reavers", regionId: "fallowmarch",
    centre: [-245, -21], radius: 15, activity: "patrol",
    anchors: [[-250, -24], [-242, -18], [-235, -25], [-239, -31], [-246, -12]],
    dressing: [
      { id: "camp_seat", assetId: "nature_wood_log", x: -254, z: -16, yaw: 1.2, scale: 1 },
      { id: "stolen_supplies", assetId: "crate_wood", x: -255, z: -19, yaw: 0.2, scale: 0.9 },
    ],
  },
  {
    id: "duskoak_clearing_edge", groupId: "duskoak_stags", regionId: "vellenwood",
    centre: [12, 182], radius: 11.5, activity: "graze",
    anchors: [[6, 184], [15, 185], [22, 177], [2, 178], [12, 174]],
    dressing: [
      { id: "browse_edge", assetId: "corealm_shrub_2", x: 3, z: 189, yaw: -0.3, scale: 0.85 },
    ],
  },
  {
    id: "bramble_rooting_ground", groupId: "bramble_hogs", regionId: "vellenwood",
    centre: [141, 132], radius: 10, activity: "forage",
    // West of the gorge's authored axis, south of the route to the head. The former 20 m disc
    // spread animals across both the open track and the gorge instead of into bramble cover.
    anchors: [[135, 126], [143, 125], [149, 132], [144, 140], [136, 138]],
    dressing: [
      { id: "rotting_log", assetId: "nature_wood_log_moss", x: 134, z: 133, yaw: 0.9, scale: 1.05 },
      { id: "bramble_cover", assetId: "corealm_shrub_2", x: 148, z: 140, yaw: -0.5, scale: 1.05 },
    ],
  },
  {
    id: "deepwood_den", groupId: "deepwood_coyotes", regionId: "vellenwood",
    centre: [54, 181], radius: 10, activity: "prowl",
    // Clear of Rootfall's north wall, logging gate and Hollowcut work floor.
    anchors: [[48, 178], [54, 174], [62, 181], [53, 188], [60, 188]],
    dressing: [
      { id: "den_shoulder", assetId: "corealm_rock_strata_1", x: 61, z: 192, yaw: 0.5, scale: 0.65, sink: 0.15 },
      { id: "den_screen", assetId: "corealm_shrub_2", x: 58, z: 192, yaw: 0.3, scale: 1.1 },
    ],
  },
  {
    id: "blackwater_reed_margin", groupId: "blackwater_frogs", regionId: "vellenwood",
    centre: [145, 84], radius: 14, activity: "forage",
    // Eastern shore activity stays opposite the western landing and its route from Rootfall.
    anchors: [[142.02, 71.7], [144.94, 75.18], [147.79, 79.16], [148.05, 84], [145.36, 88.25], [142.14, 91.36], [140.13, 94.64]],
    dressing: [
      { id: "bank_root_cover", assetId: "nature_wood_log_moss", x: 151.5, z: 82, yaw: 0.2, scale: 0.8 },
      { id: "reed_fern", assetId: "corealm_fern_2", x: 149.5, z: 86.5, yaw: -0.2, scale: 0.8 },
    ],
  },
  {
    id: "rootfall_north_undergrowth", groupId: "rootfall_coneys", regionId: "vellenwood",
    centre: [83, 173], radius: 9, activity: "forage",
    anchors: [[77, 170], [83, 166], [89, 170], [89, 176], [82, 179], [76, 175]],
    dressing: [
      { id: "burrow_screen", assetId: "corealm_shrub_1", x: 79, z: 181, yaw: 0.2, scale: 0.95 },
      { id: "fallen_root", assetId: "corealm_stump_oak", x: 91, z: 175, yaw: 0.8, scale: 0.8 },
    ],
  },
  {
    id: "thornline_brush_margin", groupId: "thornline_adders", regionId: "vellenwood",
    centre: [201, 153], radius: 11, activity: "prowl",
    anchors: [[195, 147], [205, 148], [210, 157], [199, 159]],
    dressing: [
      { id: "warm_slate", assetId: "corealm_rock_strata_3", x: 212, z: 151, yaw: 0.3, scale: [0.65, 0.35, 0.65], sink: 0.12 },
      { id: "brush_refuge", assetId: "corealm_shrub_2", x: 194, z: 143, yaw: 0.5, scale: 0.95 },
    ],
  },
  {
    id: "gorge_east_watch", groupId: "gorge_reavers", regionId: "vellenwood",
    centre: [233, 67], radius: 14, activity: "patrol",
    // A camp above the ford, on the east bank. Patrol points approach the ford from dry ground.
    anchors: [[230, 75], [239, 69], [231, 60], [241, 62], [233, 55]],
    dressing: [
      { id: "watch_seat", assetId: "nature_wood_log", x: 244, z: 76, yaw: 0.6, scale: 1 },
      { id: "provisions", assetId: "crate_wood", x: 246, z: 73, yaw: -0.1, scale: 0.85 },
    ],
  },
  {
    id: "highcairn_bear_refuge", groupId: "highcairn_bears", regionId: "karrowmoor",
    centre: [92, -116], radius: 12, activity: "prowl",
    anchors: [[85, -119], [94, -124], [100, -115], [91, -108]],
    dressing: [
      { id: "sheltered_face", assetId: "corealm_rock_strata_1", x: 86, z: -126, yaw: 0.6, scale: 0.95, sink: 0.18 },
      { id: "den_scrub", assetId: "corealm_shrub_1", x: 82, z: -123, yaw: 0.2, scale: 1.05 },
    ],
  },
  {
    id: "upper_moor_rooting", groupId: "scree_boars", regionId: "karrowmoor",
    centre: [176, -167], radius: 12, activity: "forage",
    anchors: [[168, -171], [175, -177], [183, -173], [185, -164], [176, -158], [168, -162]],
    dressing: [
      { id: "rooting_cover", assetId: "corealm_shrub_1", x: 170, z: -179, yaw: 0.3, scale: 1 },
      { id: "fractured_toe", assetId: "corealm_scree_1", x: 187, z: -171, yaw: -0.2, scale: 0.8, sink: 0.05 },
    ],
  },
  {
    id: "ridge_ibex_shelves", groupId: "ridge_ibex", regionId: "karrowmoor",
    centre: [273, -144], radius: 12, activity: "graze",
    anchors: [[263, -142], [276, -149], [278, -136], [269, -152]],
    dressing: [
      { id: "shelf_exposure", assetId: "corealm_rock_strata_3", x: 283, z: -146, yaw: -0.4, scale: 0.85, sink: 0.17 },
    ],
  },
  {
    id: "lower_terrace_grazing", groupId: "terrace_aurochs", regionId: "karrowmoor",
    centre: [77, -50], radius: 11, activity: "graze",
    anchors: [[70, -51], [80, -57], [84, -46], [77, -43]],
    dressing: [
      { id: "weather_shelter", assetId: "corealm_rock_strata_2", x: 69, z: -58, yaw: 0.2, scale: 0.95, sink: 0.15 },
    ],
  },
  {
    id: "tarn_east_hunting_edge", groupId: "tarn_coyotes", regionId: "karrowmoor",
    centre: [230, -84], radius: 9, activity: "prowl",
    anchors: [[227, -78], [235, -82], [234, -88], [227, -91]],
    dressing: [
      { id: "scrub_cover", assetId: "corealm_shrub_1", x: 236, z: -76, yaw: -0.3, scale: 0.95 },
      { id: "shelf_foot", assetId: "corealm_rock_strata_2", x: 239, z: -87, yaw: 0.5, scale: 0.65, sink: 0.14 },
    ],
  },
  {
    id: "third_ramp_watch", groupId: "karrow_reavers", regionId: "karrowmoor",
    centre: [147, -127], radius: 15, activity: "patrol",
    anchors: [[139, -125], [145, -133], [154, -130], [153, -121], [160, -131], [136, -133]],
    dressing: [
      { id: "watch_supplies", assetId: "crate_wood", x: 137, z: -120, yaw: 0.2, scale: 0.95 },
      { id: "watch_seat", assetId: "nature_wood_log", x: 136, z: -123, yaw: 1.3, scale: 0.95 },
    ],
  },
  {
    id: "ashback_rock_refuge", groupId: "ashback_bears", regionId: "kilnhalt",
    centre: [-127, 406], radius: 12, activity: "prowl",
    anchors: [[-134, 409], [-126, 416], [-118, 407], [-126, 398]],
    dressing: [
      { id: "refuge_face", assetId: "corealm_rock_strata_1", x: -136, z: 416, yaw: 0.3, scale: 1.05, sink: 0.18 },
      { id: "burned_cover", assetId: "corealm_shrub_2", x: -140, z: 411, yaw: 0.5, scale: 0.85 },
    ],
  },
  {
    id: "cinder_regrowth_patch", groupId: "cinder_boars", regionId: "kilnhalt",
    centre: [85, 383], radius: 12, activity: "forage",
    anchors: [[78, 379], [85, 374], [94, 381], [90, 389], [81, 392]],
    dressing: [
      { id: "fire_killed_stool", assetId: "corealm_stump_pine", x: 95, z: 390, yaw: -0.2, scale: 1.1 },
      { id: "fresh_browse", assetId: "corealm_shrub_1", x: 76, z: 387, yaw: 0.3, scale: 0.95 },
    ],
  },
  {
    id: "emberhorn_west_ridge", groupId: "emberhorn_ibex", regionId: "kilnhalt",
    centre: [-262, 420], radius: 12, activity: "graze",
    anchors: [[-270, 424], [-258, 430], [-255, 413], [-267, 414]],
    dressing: [
      { id: "exposed_bedding", assetId: "corealm_rock_strata_3", x: -274, z: 418, yaw: 0.6, scale: 0.9, sink: 0.18 },
    ],
  },
  {
    id: "ashfin_basking_bank", groupId: "cinder_adders", regionId: "kilnhalt",
    centre: [190, 267], radius: 8, activity: "prowl",
    // Near the springs' northwest bank, clear of both water and the western fishing landing.
    anchors: [[186, 265], [191, 272], [196, 266], [188, 271]],
    dressing: [
      { id: "warm_basking_rock", assetId: "corealm_rock_strata_2", x: 184, z: 273, yaw: 0.3, scale: [0.75, 0.45, 0.8], sink: 0.12 },
    ],
  },
  {
    id: "kilnroad_toll_camp", groupId: "kilnroad_reavers", regionId: "kilnhalt",
    centre: [-42, 258], radius: 15, activity: "patrol",
    anchors: [[-49, 265], [-45, 256], [-37, 253], [-32, 263], [-35, 249], [-48, 249]],
    dressing: [
      { id: "camp_supplies", assetId: "crate_wood", x: -53, z: 262, yaw: -0.1, scale: 0.9 },
      { id: "camp_seat", assetId: "nature_wood_log", x: -54, z: 258, yaw: 0.7, scale: 1 },
    ],
  },
  ...CREATURE_HABITATS,
  ...STARTER_HABITATS,
  RED_WORM_HABITAT,
  ...WILDERNESS_HABITATS,
];
const sourceHabitats = [...AUTHORED_WORLD_HABITATS, ...BIOME_POPULATION_HABITATS, AMETHYST_CAVE_HABITAT];
const encounterRegions = [...REGIONS, ...REGIONS.flatMap(region => region.dungeon ? [region.dungeon] : [])];
const allEncounterHabitats: readonly HabitatDef[] = encounterRegions.flatMap(region => region.enemyGroups
  .filter(group => !group.boss && !group.miniBoss)
  .map(group => {
    const accepted = [...DEEP_WILDERNESS_PACK_HABITATS, ...FAIRY_TERRACE_HABITATS].find(habitat => habitat.groupId === group.id);
    if (accepted) return accepted;
    const source = sourceHabitats.find(habitat => habitat.groupId === group.id);
    // Authored shore and clearing centres already account for local water and paths.
    // Only a measured replacement layout is allowed to relocate that habitat.
    const placedGroup = source && !LEGACY_ENCOUNTER_PLACEMENT_OVERRIDES[group.id]
      ? { ...group, centre: source.centre } : group;
    const bodyRadius = encounterBodyRadius(group);
    const formation = createLegacyEncounterFormation(placedGroup, { bodyRadius })
      ?? createEncounterFormation(placedGroup, { bodyRadius, count: group.count,
        preferredAnchors: source?.anchors, maxRadius: Math.max(group.radius, source?.radius ?? 0) });
    const dx = placedGroup.centre[0] - (source?.centre[0] ?? placedGroup.centre[0]);
    const dz = placedGroup.centre[1] - (source?.centre[1] ?? placedGroup.centre[1]);
    return { id: source?.id ?? `${group.id}_habitat`, groupId: group.id, regionId: region.id,
      centre: formation.group.centre, radius: formation.group.radius, anchors: formation.anchors,
      ...(source?.roamRadius !== undefined ? { roamRadius: source.roamRadius } : {}),
      activity: FANTASY_ENCOUNTER_SPECIES[group.id] ? 'patrol' as const : source?.activity ?? 'patrol' as const,
      dressing: (source?.dressing ?? []).map(piece => ({ ...piece, x: piece.x + dx, z: piece.z + dz })),
    };
  }));

/** Surface dressing and tree clearance must not project underground packs onto the terrain. */
export const WORLD_HABITATS = allEncounterHabitats.filter(habitat => REGIONS.some(region => region.id === habitat.regionId));
const HABITAT_BY_GROUP = new Map(allEncounterHabitats.map((habitat) => [habitat.groupId, habitat]));

export function habitatForGroup(groupId: string): HabitatDef | null {
  return HABITAT_BY_GROUP.get(groupId) ?? null;
}
