import type { RegionId } from "../contracts.js";
import { WILDERNESS_RESOURCE_SITES } from './wildernessResources.js';
import { CROWNWARD_RESOURCE_INTENTS, CROWNWARD_FISHERIES } from './crownward.js';
import { FAIRY_RESOURCE_INTENTS } from './fairyRegions.js';

export interface WorldSiteResourceSlot {
  readonly clusterId: string;
  /** One-based suffix of the existing semantic entity id. */
  readonly index: number;
  /**
   * Local across-site offset. On a fishery it is the ONLY placement authority: `x` picks the
   * outward ray, and `app/fishingAccess.ts` solves both the casting stance and the school it
   * faces along that ray from the built water body.
   */
  readonly x: number;
  /** Local depth into the site. Inert on a fishery, where solved depth decides how far out. */
  readonly z: number;
  readonly yaw: number;
  /** Multiplier on the resource's canonical presentation scale. */
  readonly scale: number;
}

export interface WorldSiteDressing {
  readonly id: string;
  readonly assetId: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number | readonly [number, number, number];
  readonly sink?: number;
}

/**
 * One authored setting shared by terrain, resources, rendering and access. Coordinates are
 * local metres: +Z is the approach, -Z is the back of the site, and +X is the right-hand side.
 * Rotating the site uses the same Y rotation as its production models.
 */
export interface WorldSite {
  /** Existing solved lake id, or a river mask prefix resolved near this site's centre. */
  readonly waterBodyId?: string;
  readonly id: string;
  readonly locationId: string;
  readonly regionId: RegionId;
  readonly centre: readonly [number, number];
  readonly rotationY: number;
  readonly kind: "mine" | "grove" | "fishery" | "habitat";
  readonly workRadius: number;
  /** Local half-extents. Includes setting pieces and the clear approach. */
  readonly extent: readonly [number, number];
  readonly terrain: {
    readonly floorRadius: number;
    readonly backRise: number;
    readonly backDistance: number;
    readonly bermWidth: number;
    /** Local radians from +Z. */
    readonly approachAngle: number;
  };
  readonly resourceSlots: readonly WorldSiteResourceSlot[];
  /** Connected cliff behind the ground ore, ordered along the working aisle. */
  readonly cutFace?: {
    readonly stations: readonly { clusterId: string; index: number; crestHeight: number }[];
    readonly backDepth: number;
    readonly buryDepth: number;
    /** Metres behind the ore centres along the site forward axis. Defaults to 0.40, embedding the rear of each deposit. */
    readonly frontSetback?: number;
  };
  readonly dressing: readonly WorldSiteDressing[];
}

/** Shared production fixtures, available in the lab before their regions enter the world. */
export const FAIRY_RESOURCE_SITES: readonly WorldSite[] = [...CROWNWARD_RESOURCE_INTENTS, ...FAIRY_RESOURCE_INTENTS].map(intent => {
  const mine = intent.kind === 'mine';
  const fairy = intent.regionId !== 'crownward';
  const deep = intent.regionId === 'faeholme';
  const clusterId = `${intent.id}_resources`;
  // Seams face inward toward the main road. Their cut faces sit on the outer shoulder.
  const rotationY = mine ? fairy && intent.position[0] < 2320 ? Math.PI / 2 : -Math.PI / 2 : .18;
  return {
    id: intent.id, locationId: intent.id, regionId: intent.regionId, centre: intent.position, rotationY,
    kind: intent.kind, workRadius: mine ? 8 : 10, extent: mine ? [23, 25] : [23, 23],
    terrain: {
      floorRadius: mine ? 10.5 : 16, backRise: mine ? deep ? 5.4 : 4.8 : .45,
      backDistance: mine ? 7.2 : 21, bermWidth: mine ? 10 : 8, approachAngle: 0,
    },
    resourceSlots: mine ? Array.from({ length: intent.count }, (_, i) => {
      const offset = i - (intent.count - 1) / 2;
      return {
        clusterId, index: i + 1, x: offset * 3.65, z: -4.5 + Math.abs(offset) * .46,
        yaw: -offset * .095, scale: [.94, 1.06, .98, 1.08, .95, 1.03, .97][i % 7]!,
      };
    }) : Array.from({ length: intent.count }, (_, i) => {
      // Two unequal rows leave the approach and the whole central work aisle open.
      const leftCount = Math.ceil(intent.count / 2), left = i < leftCount, rank = left ? i : i - leftCount;
      return {
        clusterId, index: i + 1, x: (left ? -1 : 1) * (8 + (rank % 2) * 6.6), z: -13 + rank * 6.1,
        yaw: i * 2.399963, scale: [.91, 1.02, .96, 1.06, .94, 1, .92, 1.04, .97][i % 9]!,
      };
    }),
    ...(mine ? {
      cutFace: {
        backDepth: 10.4, buryDepth: .65, frontSetback: .4,
        stations: Array.from({ length: intent.count }, (_, i) => ({
          clusterId, index: i + 1, crestHeight: [3.2, 3.7, 3.5, 3.9, 3.4, 3.6, 3.1][i % 7]!,
        })),
      },
    } : {}),
    dressing: mine ? [
      { id: 'west-shoulder', assetId: 'corealm_rock_strata_3', x: -13.8, z: -6.3, yaw: .62, scale: [1.25, 1.1, 1.1], sink: .48 },
      { id: 'east-shoulder', assetId: 'corealm_rock_strata_1', x: 13.7, z: -6, yaw: -.74, scale: [1.2, 1.05, 1.17], sink: .52 },
      { id: 'tailings', assetId: 'corealm_scree_2', x: -14.4, z: 2.5, yaw: .43, scale: [1.25, .85, 1.08], sink: .12 },
      { id: 'sorting-bench', assetId: 'workbench', x: 12.9, z: 1.5, yaw: -.28, scale: 1 },
      { id: 'ore-crate', assetId: fairy ? 'crate_wood' : 'crate_metal', x: 14.5, z: 2.3, yaw: .22, scale: .9 },
    ] : [
      { id: 'root-stone-west', assetId: 'corealm_rock_strata_1', x: -18.8, z: -8, yaw: .38, scale: [1.2, .84, .85], sink: .3 },
      { id: 'root-stone-east', assetId: 'corealm_rock_strata_3', x: 18.5, z: -6, yaw: -.45, scale: [1.12, .84, .9], sink: .3 },
      { id: 'fallen-trunk', assetId: 'nature_wood_log_moss', x: 0, z: -18, yaw: Math.PI / 2, scale: .75, sink: .08 },
      ...(!fairy ? [
        { id: 'timber-bench', assetId: 'workbench', x: 7, z: 16.5, yaw: .2, scale: 1 },
        { id: 'worked-timber', assetId: 'nature_wood_log', x: 10, z: 17, yaw: .06, scale: 1.05 },
      ] : []),
    ],
  } satisfies WorldSite;
});

export const WORLD_SITES: readonly WorldSite[] = [
  ...CROWNWARD_FISHERIES.sites,
  ...WILDERNESS_RESOURCE_SITES,
  ...FAIRY_RESOURCE_SITES,
  {
    id: "bracken_workings", locationId: "bracken_pit", regionId: "fallowmarch",
    centre: [-160, 80], rotationY: 2.608, kind: "mine", workRadius: 6.5, extent: [22, 26],
    terrain: { floorRadius: 9.5, backRise: 4.8, backDistance: 6.7, bermWidth: 11, approachAngle: 0 },
    cutFace: {
      stations: [
        { clusterId: "bracken_pit_grithe", index: 1, crestHeight: 3.2 },
        { clusterId: "bracken_pit_grithe", index: 2, crestHeight: 3.4 },
        { clusterId: "bracken_pit_grithe", index: 3, crestHeight: 2.8 },
        { clusterId: "bracken_pit_grithe", index: 4, crestHeight: 2.9 },
        { clusterId: "bracken_pit_grithe", index: 5, crestHeight: 3.1 },
        { clusterId: "bracken_pit_grithe", index: 6, crestHeight: 3.3 },
        { clusterId: "bracken_pit_stone", index: 1, crestHeight: 2.6 },
        { clusterId: "bracken_pit_stone", index: 2, crestHeight: 2.4 },
      ], backDepth: 9.8, buryDepth: 0.6,
    },
    // Ground ore follows a shallow arc in front of the cliff. The stone
    // return stays open on its inner side, with handling equipment beyond the mining stances.
    resourceSlots: [
      { clusterId: "bracken_pit_grithe", index: 1, x: -10.0, z: -2.4, yaw: 0.30, scale: 1.12 },
      { clusterId: "bracken_pit_grithe", index: 2, x: -6.5, z: -3.35, yaw: 0.20, scale: 0.82 },
      { clusterId: "bracken_pit_grithe", index: 3, x: -3.0, z: -3.9, yaw: 0.08, scale: 1.04 },
      { clusterId: "bracken_pit_grithe", index: 4, x: 0.5, z: -4.1, yaw: -0.03, scale: 1.16 },
      { clusterId: "bracken_pit_grithe", index: 5, x: 4.0, z: -3.65, yaw: -0.15, scale: 0.87 },
      { clusterId: "bracken_pit_grithe", index: 6, x: 7.5, z: -2.7, yaw: -0.30, scale: 1.01 },
      { clusterId: "bracken_pit_stone", index: 1, x: 11.2, z: 0.2, yaw: -0.65, scale: 1.08 },
      { clusterId: "bracken_pit_stone", index: 2, x: 12.8, z: 3.7, yaw: -0.85, scale: 0.86 },
    ],
    dressing: [
      { id: "east_face_step", assetId: "corealm_rock_strata_1", x: 7.0, z: -6.4, yaw: -0.47, scale: [1.25, 0.85, 1.15], sink: 0.35 },
      { id: "stone_shoulder", assetId: "corealm_rock_strata_1", x: 14.6, z: -2.5, yaw: -0.7, scale: [1.333, 1.2, 0.988], sink: 0.45 },
      { id: "west_foot", assetId: "corealm_rock_strata_2", x: -10.6, z: -5.5, yaw: 0.7, scale: [0.95, 0.7, 0.92], sink: 0.55 },
      { id: "spoil_outer", assetId: "corealm_scree_1", x: -10.1, z: 0.2, yaw: 0.6, scale: [1.35, 0.85, 1.15], sink: 0.12 },
      { id: "spoil_inner", assetId: "corealm_scree_2", x: -8.9, z: 1.7, yaw: 0.3, scale: [1.1, 0.8, 1.1], sink: 0.08 },
      { id: "sorting_bench", assetId: "workbench", x: 7.7, z: 7.0, yaw: -0.35, scale: 1 },
      { id: "sorted_stone", assetId: "crate_village", x: 9.6, z: 7.2, yaw: -0.28, scale: 0.8 },
    ],
  },
  {
    id: "hollowcut_workings", locationId: "hollowcut_seam", regionId: "vellenwood",
    centre: [94, 145], rotationY: -2.034, kind: "mine", workRadius: 5.8, extent: [16, 20],
    terrain: { floorRadius: 8.5, backRise: 4.3, backDistance: 6.2, bermWidth: 7.5, approachAngle: 0 },
    cutFace: {
      stations: [
        { clusterId: "hollowcut_corven", index: 1, crestHeight: 2.8 },
        { clusterId: "hollowcut_corven", index: 2, crestHeight: 3.2 },
        { clusterId: "hollowcut_corven", index: 3, crestHeight: 3.0 },
        { clusterId: "hollowcut_corven", index: 4, crestHeight: 2.6 },
        { clusterId: "hollowcut_corven", index: 5, crestHeight: 3.2 },
      ], backDepth: 9.2, buryDepth: 0.6,
    },
    // Five separate ground rocks share a broad aisle in front of the cliff. Tailings and
    // bracing stock sit beside the apron, clear of the bank-to-mine approach.
    resourceSlots: [
      { clusterId: "hollowcut_corven", index: 1, x: -7.5, z: -2.4, yaw: 0.22, scale: 0.82 },
      { clusterId: "hollowcut_corven", index: 2, x: -3.7, z: -3.4, yaw: 0.12, scale: 1.10 },
      { clusterId: "hollowcut_corven", index: 3, x: 0.1, z: -3.8, yaw: 0, scale: 0.80 },
      { clusterId: "hollowcut_corven", index: 4, x: 3.9, z: -3.4, yaw: -0.12, scale: 1.16 },
      { clusterId: "hollowcut_corven", index: 5, x: 7.7, z: -2.4, yaw: -0.22, scale: 0.96 },
    ],
    dressing: [
      { id: "root_ridge_face", assetId: "corealm_cliff_strata_1", x: -3.4, z: -8.7, yaw: 0.26, scale: [0.96, 0.75, 1.12], sink: 0.7 },
      { id: "eastern_exposure", assetId: "corealm_rock_strata_3", x: 6.1, z: -7.5, yaw: -0.42, scale: [1.15, 1.15, 1.2], sink: 0.6 },
      { id: "rear_fracture", assetId: "corealm_rock_strata_1", x: 3.1, z: -11.2, yaw: -0.17, scale: [1.1, 0.8, 1.1], sink: 0.9 },
      { id: "tailings", assetId: "corealm_scree_2", x: -9.0, z: 1.4, yaw: 0.45, scale: [1.2, 0.9, 1.2], sink: 0.1 },
      { id: "tailings_toe", assetId: "corealm_scree_1", x: -8.0, z: 2.8, yaw: 0.6, scale: [0.8, 0.65, 0.8], sink: 0.08 },
      { id: "sorting_bench", assetId: "workbench", x: 8.0, z: 4.0, yaw: -0.35, scale: 1 },
      { id: "ore_box", assetId: "crate_wood", x: 10.1, z: 4.2, yaw: 0.12, scale: 0.9 },
      { id: "timber_brace_stock", assetId: "nature_wood_log_moss", x: 9.2, z: 6.3, yaw: -0.3, scale: 0.8 },
    ],
  },
  {
    id: "lower_quarry_bench", locationId: "karrowmoor_terraces", regionId: "karrowmoor",
    centre: [140, -16], rotationY: 1.2490457724, kind: "mine", workRadius: 6, extent: [14, 22],
    terrain: { floorRadius: 10, backRise: 5.5, backDistance: 6.8, bermWidth: 10, approachAngle: 0 },
    cutFace: {
      stations: [
        { clusterId: "lower_quarry_kaldite", index: 1, crestHeight: 3.4 },
        { clusterId: "lower_quarry_kaldite", index: 2, crestHeight: 3.6 },
        { clusterId: "lower_quarry_kaldite", index: 3, crestHeight: 2.6 },
        { clusterId: "lower_quarry_kaldite", index: 4, crestHeight: 2.8 },
        { clusterId: "lower_quarry_kaldite", index: 5, crestHeight: 3.4 },
      ], backDepth: 10.0, buryDepth: 0.65,
    },
    // The working bench sits east of the Gravelmaw with its own approach from Moor Road Bend.
    // Separate ore rocks stand on the floor in front of the cliff; spoil stays beside the exit.
    resourceSlots: [
      { clusterId: "lower_quarry_kaldite", index: 1, x: -8.3, z: -2.3, yaw: 0.32, scale: 0.90 },
      { clusterId: "lower_quarry_kaldite", index: 2, x: -4.5, z: -3.6, yaw: 0.18, scale: 1.12 },
      { clusterId: "lower_quarry_kaldite", index: 3, x: 0, z: -4.2, yaw: 0, scale: 0.84 },
      { clusterId: "lower_quarry_kaldite", index: 4, x: 4.5, z: -3.6, yaw: -0.18, scale: 1.17 },
      { clusterId: "lower_quarry_kaldite", index: 5, x: 8.3, z: -2.3, yaw: -0.32, scale: 0.96 },
    ],
    dressing: [
      { id: "bench_end", assetId: "corealm_rock_strata_3", x: 8.6, z: -6.0, yaw: -0.62, scale: [1.1, 1.4, 1.16], sink: 0.40 },
      { id: "west_root", assetId: "corealm_rock_strata_3", x: -10.0, z: -5.8, yaw: 0.82, scale: [1.0, 0.9, 1.1], sink: 0.65 },
      { id: "graded_spoil", assetId: "corealm_scree_1", x: -8.7, z: 1.9, yaw: 0.50, scale: [1.2, 0.85, 1.2], sink: 0.12 },
      { id: "spoil_toe", assetId: "corealm_scree_2", x: -7.7, z: 3.1, yaw: 0.2, scale: [0.9, 0.7, 0.9], sink: 0.08 },
      { id: "sorting_table", assetId: "workbench", x: 8.5, z: 4.5, yaw: -0.2, scale: 1 },
      { id: "cut_stone_box", assetId: "crate_village", x: 10.4, z: 4.8, yaw: 0.15, scale: 0.95 },
    ],
  },
  {
    id: "upper_seam_shelf", locationId: "upper_karrow_seam", regionId: "karrowmoor",
    centre: [194, -132], rotationY: -0.648, kind: "mine", workRadius: 5, extent: [12.5, 20],
    terrain: { floorRadius: 7.5, backRise: 5, backDistance: 6, bermWidth: 6.4, approachAngle: -1 },
    cutFace: {
      stations: [
        { clusterId: "upper_karrow_kaldite", index: 1, crestHeight: 3.2 },
        { clusterId: "upper_karrow_kaldite", index: 2, crestHeight: 3.4 },
        { clusterId: "upper_karrow_kaldite", index: 3, crestHeight: 2.6 },
      ], backDepth: 8.8, buryDepth: 0.6,
    },
    // The diagonal approach opens onto a shallow shelf across all three ground rocks. The small
    // sorting position sits forward of the eastern abutment and the working aisle.
    resourceSlots: [
      { clusterId: "upper_karrow_kaldite", index: 1, x: -5.6, z: -2.0, yaw: 0.22, scale: 1.13 },
      { clusterId: "upper_karrow_kaldite", index: 2, x: -1.0, z: -3.0, yaw: 0.05, scale: 0.84 },
      { clusterId: "upper_karrow_kaldite", index: 3, x: 3.8, z: -2.5, yaw: -0.18, scale: 1.04 },
    ],
    dressing: [
      { id: "upper_bedding", assetId: "corealm_cliff_strata_1", x: -1.2, z: -8.8, yaw: 0.22, scale: [0.8, 0.7, 1.02], sink: 0.8 },
      { id: "pocket_face", assetId: "corealm_rock_strata_1", x: 4.2, z: -9.1, yaw: -0.28, scale: [1.0, 0.8, 1.12], sink: 0.8 },
      { id: "eastern_abutment", assetId: "corealm_rock_strata_3", x: 6.7, z: -7.9, yaw: -0.7, scale: [0.85, 0.65, 1.0], sink: 0.75 },
      { id: "scree_run", assetId: "corealm_scree_2", x: -7.1, z: 0.3, yaw: 0.40, scale: [1.15, 0.85, 1.05], sink: 0.10 },
      { id: "scree_toe", assetId: "corealm_scree_1", x: -8.25, z: 1.05, yaw: 0.6, scale: [0.7, 0.55, 0.65], sink: 0.08 },
      { id: "sorting_bench", assetId: "workbench", x: 6.0, z: 2.8, yaw: -0.3, scale: 1 },
      { id: "tool_store", assetId: "crate_wood", x: 7.9, z: 3.1, yaw: 0.25, scale: 0.85 },
    ],
  },
  {
    id: "clinker_cut", locationId: "clinker_quarry", regionId: "kilnhalt",
    centre: [-250, 330], rotationY: 1.558, kind: "mine", workRadius: 7, extent: [22, 29],
    terrain: { floorRadius: 10, backRise: 6.4, backDistance: 7.2, bermWidth: 12, approachAngle: 0 },
    cutFace: {
      stations: [
        { clusterId: "clinker_kilnstone", index: 2, crestHeight: 2.7 },
        { clusterId: "clinker_kilnstone", index: 1, crestHeight: 3.5 },
        { clusterId: "clinker_emberite", index: 1, crestHeight: 4.5 },
        { clusterId: "clinker_emberite", index: 2, crestHeight: 4.6 },
        { clusterId: "clinker_emberite", index: 3, crestHeight: 4.2 },
        { clusterId: "clinker_emberite", index: 4, crestHeight: 2.8 },
        { clusterId: "clinker_emberite", index: 5, crestHeight: 4.0 },
        { clusterId: "clinker_emberite", index: 6, crestHeight: 4.1 },
      ], backDepth: 10.5, buryDepth: 0.7,
    },
    // Emberite rocks sit on the ground in front of one broad cliff. Its pale flux return opens toward the
    // same aisle; the assay bench sits farther down the apron, opposite the spoil run.
    resourceSlots: [
      { clusterId: "clinker_emberite", index: 1, x: -8.1, z: -3.0, yaw: 0.45, scale: 1.11 },
      { clusterId: "clinker_emberite", index: 2, x: -4.8, z: -3.7, yaw: 0.17, scale: 0.79 },
      { clusterId: "clinker_emberite", index: 3, x: -1.4, z: -4.25, yaw: 0.03, scale: 1.03 },
      { clusterId: "clinker_emberite", index: 4, x: 2.2, z: -4.45, yaw: -0.08, scale: 1.18 },
      { clusterId: "clinker_emberite", index: 5, x: 5.8, z: -3.7, yaw: -0.20, scale: 0.85 },
      { clusterId: "clinker_emberite", index: 6, x: 9.2, z: -2.6, yaw: -0.40, scale: 1.02 },
      { clusterId: "clinker_kilnstone", index: 1, x: -11.4, z: -0.2, yaw: 0.95, scale: 1.02 },
      { clusterId: "clinker_kilnstone", index: 2, x: -14.4, z: 3.5, yaw: 0.85, scale: 0.90 },
    ],
    dressing: [
      { id: "flux_face", assetId: "corealm_cliff_strata_2", x: -11.6, z: -2.1, yaw: 1.08, scale: [0.915, 0.63, 0.657], sink: 0.45 },
      { id: "east_fracture", assetId: "corealm_rock_strata_1", x: 12.0, z: -6.9, yaw: -0.82, scale: [1.15, 0.88, 0.95], sink: 0.65 },
      { id: "clinker_spoil", assetId: "corealm_scree_1", x: 11.2, z: -0.35, yaw: -0.45, scale: [1.45, 0.95, 1.2], sink: 0.12 },
      { id: "clinker_tail", assetId: "corealm_scree_2", x: 10.3, z: 1.25, yaw: -0.2, scale: [1.0, 0.75, 1.0], sink: 0.08 },
      { id: "assay_bench", assetId: "workbench", x: -7.0, z: 6.0, yaw: 0.25, scale: 1 },
      { id: "ore_hod", assetId: "crate_metal", x: -8.9, z: 6.4, yaw: 0.17, scale: 0.95 },
    ],
  },
  {
    id: "palewood_landing", locationId: "palewood_copse", regionId: "fallowmarch",
    centre: [-334, -64], rotationY: 1.532, kind: "grove", workRadius: 4.1, extent: [17, 18],
    terrain: { floorRadius: 4.5, backRise: 0, backDistance: 11, bermWidth: 6, approachAngle: 0 },
    resourceSlots: [
      { clusterId: "palewood_copse_trees", index: 1, x: -5.3, z: 5.7, yaw: 0.4, scale: 0.96 },
      { clusterId: "palewood_copse_trees", index: 2, x: -10.5, z: 1.5, yaw: 1.6, scale: 1.08 },
      { clusterId: "palewood_copse_trees", index: 3, x: -8.2, z: -5.9, yaw: 2.5, scale: 1.03 },
      { clusterId: "palewood_copse_trees", index: 4, x: -2.4, z: -8.3, yaw: 0.9, scale: 1.11 },
      { clusterId: "palewood_copse_trees", index: 5, x: 4.1, z: -8.2, yaw: 2.0, scale: 1.02 },
      { clusterId: "palewood_copse_trees", index: 6, x: 10.2, z: -4.8, yaw: -0.7, scale: 0.98 },
      { clusterId: "palewood_copse_trees", index: 7, x: 11.4, z: 2.6, yaw: 1.1, scale: 1.06 },
      { clusterId: "palewood_copse_trees", index: 8, x: 5.1, z: 5.8, yaw: -1.1, scale: 0.92 },
    ],
    dressing: [
      { id: "old_coppice", assetId: "corealm_stump_oak", x: -6.8, z: 11.1, yaw: 0.6, scale: 0.75 },
      { id: "stack_first", assetId: "nature_wood_log", x: 6.0, z: 13.3, yaw: 0.06, scale: 1.1 },
      { id: "stack_second", assetId: "nature_wood_log", x: 6.8, z: 13.1, yaw: 0.06, scale: 1 },
      { id: "stack_third", assetId: "nature_wood_log", x: 7.55, z: 13.3, yaw: 0.06, scale: 1.07 },
      { id: "timber_bench", assetId: "workbench", x: 9.5, z: 10.9, yaw: -0.15, scale: 1 },
      { id: "hauling_rope", assetId: "rope_coil", x: 8.9, z: 12.3, yaw: 0.3, scale: 1.2 },
    ],
  },
  {
    id: "duskoak_hollow", locationId: "vellenwood_canopy", regionId: "vellenwood",
    centre: [14, 166], rotationY: -2.731, kind: "grove", workRadius: 4.3, extent: [20, 21],
    terrain: { floorRadius: 4.5, backRise: 0, backDistance: 14, bermWidth: 7, approachAngle: 0 },
    resourceSlots: [
      { clusterId: "duskoak_stand_trees", index: 1, x: -5.6, z: 6.5, yaw: 0.2, scale: 0.96 },
      { clusterId: "duskoak_stand_trees", index: 2, x: -12.5, z: 3, yaw: 1.8, scale: 1.07 },
      { clusterId: "duskoak_stand_trees", index: 3, x: -13.8, z: -5.7, yaw: -0.6, scale: 1.03 },
      { clusterId: "duskoak_stand_trees", index: 4, x: -7.2, z: -11.1, yaw: 2.4, scale: 1.1 },
      { clusterId: "duskoak_stand_trees", index: 5, x: 0.6, z: -13.4, yaw: 1.1, scale: 1.12 },
      { clusterId: "duskoak_stand_trees", index: 6, x: 8.6, z: -10.5, yaw: -1.4, scale: 1.06 },
      { clusterId: "duskoak_stand_trees", index: 7, x: 14.1, z: -4.6, yaw: 0.7, scale: 1.03 },
      { clusterId: "duskoak_stand_trees", index: 8, x: 12.5, z: 3.6, yaw: -0.8, scale: 0.99 },
      { clusterId: "duskoak_stand_trees", index: 9, x: 6.0, z: 7.2, yaw: 2.2, scale: 0.94 },
      { clusterId: "duskoak_stand_trees", index: 10, x: -2.0, z: -5.2, yaw: 0.5, scale: 1.02 },
    ],
    dressing: [
      { id: "old_stool", assetId: "corealm_stump_oak", x: -7.8, z: 12.7, yaw: -0.5, scale: 1.05 },
      { id: "windfall", assetId: "nature_wood_log_moss", x: -12.8, z: 10.5, yaw: 0.65, scale: 1.35 },
      { id: "worked_timber", assetId: "nature_wood_log", x: 8.6, z: 13.7, yaw: 0.1, scale: 1.25 },
      { id: "worked_timber_short", assetId: "nature_wood_log", x: 9.55, z: 13.5, yaw: 0.1, scale: 1.1 },
      { id: "tools", assetId: "crate_wood", x: 10.8, z: 12.1, yaw: -0.2, scale: 0.75 },
    ],
  },
  {
    id: "ridge_pine_shelter", locationId: "ridge_pines", regionId: "karrowmoor",
    centre: [250, -96], rotationY: -1.391, kind: "grove", workRadius: 4, extent: [18, 19],
    terrain: { floorRadius: 4.4, backRise: 0, backDistance: 12, bermWidth: 6, approachAngle: 0 },
    resourceSlots: [
      { clusterId: "ridge_pines_trees", index: 1, x: -5.1, z: 5.9, yaw: 0.6, scale: 0.93 },
      { clusterId: "ridge_pines_trees", index: 2, x: -10.9, z: 0.7, yaw: 2.1, scale: 1.04 },
      { clusterId: "ridge_pines_trees", index: 3, x: -8.2, z: -6.8, yaw: -0.9, scale: 1.08 },
      { clusterId: "ridge_pines_trees", index: 4, x: -1.7, z: -10.1, yaw: 1.4, scale: 0.97 },
      { clusterId: "ridge_pines_trees", index: 5, x: 5.4, z: -8.9, yaw: 2.8, scale: 1.05 },
      { clusterId: "ridge_pines_trees", index: 6, x: 11.5, z: -4.3, yaw: 0.2, scale: 0.96 },
      { clusterId: "ridge_pines_trees", index: 7, x: 11.1, z: 3.1, yaw: -1.8, scale: 1.02 },
      { clusterId: "ridge_pines_trees", index: 8, x: 5.0, z: 7.1, yaw: -0.6, scale: 0.91 },
    ],
    dressing: [
      { id: "shelter_rock", assetId: "corealm_rock_strata_3", x: 13.0, z: -10.5, yaw: -0.45, scale: 0.9, sink: 0.12 },
      { id: "old_pine_stump", assetId: "corealm_stump_pine", x: -6.0, z: 12.7, yaw: 0.3, scale: 1 },
      { id: "cut_poles", assetId: "nature_wood_log", x: 7.4, z: 13.1, yaw: 0.12, scale: [0.8, 0.8, 1.15] },
      { id: "cut_poles_second", assetId: "nature_wood_log", x: 8.1, z: 13.3, yaw: 0.12, scale: [0.7, 0.7, 1.2] },
      { id: "binding", assetId: "rope_coil", x: 6.0, z: 13.8, yaw: 0, scale: 1.15 },
    ],
  },
  {
    id: "cinderpine_survivors", locationId: "cinderpine_stand", regionId: "kilnhalt",
    centre: [240, 340], rotationY: -1.603, kind: "grove", workRadius: 4.2, extent: [18, 19],
    terrain: { floorRadius: 4.5, backRise: 0, backDistance: 12, bermWidth: 7, approachAngle: 0 },
    resourceSlots: [
      { clusterId: "cinderpine_stand_trees", index: 1, x: -5.3, z: 5.8, yaw: -0.2, scale: 0.91 },
      { clusterId: "cinderpine_stand_trees", index: 2, x: -11.2, z: 1.0, yaw: 1.5, scale: 1.01 },
      { clusterId: "cinderpine_stand_trees", index: 3, x: -8.0, z: -6.5, yaw: 2.2, scale: 1.07 },
      { clusterId: "cinderpine_stand_trees", index: 4, x: -1.0, z: -10.0, yaw: -0.7, scale: 0.98 },
      { clusterId: "cinderpine_stand_trees", index: 5, x: 6.1, z: -8.0, yaw: 0.8, scale: 1.05 },
      { clusterId: "cinderpine_stand_trees", index: 6, x: 12.0, z: -2.8, yaw: 2.7, scale: 0.94 },
      { clusterId: "cinderpine_stand_trees", index: 7, x: 10.2, z: 4.2, yaw: -1.3, scale: 1.02 },
      { clusterId: "cinderpine_stand_trees", index: 8, x: 4.8, z: 8.2, yaw: 1.2, scale: 0.93 },
    ],
    dressing: [
      { id: "burned_stump", assetId: "corealm_stump_pine", x: -6.7, z: 11.6, yaw: -0.3, scale: 1.1 },
      { id: "kilnwood_first", assetId: "nature_wood_log", x: 8.0, z: 13.0, yaw: -0.12, scale: 1.1 },
      { id: "kilnwood_second", assetId: "nature_wood_log", x: 8.8, z: 13.1, yaw: -0.12, scale: 0.96 },
      { id: "binding", assetId: "rope_coil", x: 6.5, z: 13.9, yaw: 0.4, scale: 1.1 },
      { id: "charred_ledge", assetId: "corealm_rock_strata_2", x: -12.9, z: 8.6, yaw: 0.25, scale: 0.68, sink: 0.14 },
    ],
  },
  {
    id: "redsill_bank", locationId: "redsill_shallows", regionId: "fallowmarch",
    centre: [-40, -60], rotationY: -2.785, kind: "fishery", workRadius: 3, extent: [17, 29],
    // Existing water basins own all relief. The dry handling area is beyond the basin crest.
    terrain: { floorRadius: 0, backRise: 0, backDistance: 0, bermWidth: 0, approachAngle: 0 },
    resourceSlots: [
      { clusterId: "redsill_spots", index: 1, x: -6.3, z: 4.5, yaw: -0.2, scale: 0.97 },
      { clusterId: "redsill_spots", index: 2, x: -2.2, z: 7.5, yaw: 0.1, scale: 1.02 },
      { clusterId: "redsill_spots", index: 3, x: 2.6, z: 7.1, yaw: 0.25, scale: 0.95 },
      { clusterId: "redsill_spots", index: 4, x: 6.7, z: 4.4, yaw: -0.15, scale: 1.04 },
    ],
    dressing: [
      { id: "bank_seat", assetId: "bench", x: -4.8, z: 24.6, yaw: -0.1, scale: 0.9 },
      { id: "catch_box", assetId: "farm_crate_empty", x: -6.6, z: 24.1, yaw: 0.2, scale: 1.4 },
      { id: "line_coil", assetId: "rope_coil", x: -5.1, z: 26.0, yaw: 0.5, scale: 1 },
      { id: "reed_bank_stone", assetId: "corealm_rock_strata_2", x: 8.9, z: 23.0, yaw: -0.6, scale: 0.5, sink: 0.13 },
    ],
  },
  {
    id: "blackwater_landing", locationId: "blackwater_pools", regionId: "vellenwood",
    centre: [128, 84], rotationY: -1.084, kind: "fishery", workRadius: 3, extent: [19, 33],
    terrain: { floorRadius: 0, backRise: 0, backDistance: 0, bermWidth: 0, approachAngle: 0 },
    resourceSlots: [
      { clusterId: "blackwater_spots", index: 1, x: -9.2, z: 5.2, yaw: -0.25, scale: 0.95 },
      { clusterId: "blackwater_spots", index: 2, x: -5.4, z: 8.8, yaw: 0.2, scale: 1.02 },
      { clusterId: "blackwater_spots", index: 3, x: -0.3, z: 10.5, yaw: 0, scale: 1.05 },
      { clusterId: "blackwater_spots", index: 4, x: 5.0, z: 9.1, yaw: -0.1, scale: 0.96 },
      { clusterId: "blackwater_spots", index: 5, x: 9.0, z: 5.4, yaw: 0.25, scale: 1.01 },
    ],
    dressing: [
      { id: "bank_log", assetId: "nature_wood_log_moss", x: -5.2, z: 28.5, yaw: Math.PI / 2, scale: 1.1 },
      { id: "fish_barrel", assetId: "barrel", x: -7.4, z: 29.2, yaw: 0.2, scale: 0.85 },
      { id: "line_coil", assetId: "rope_coil", x: -5.7, z: 30.0, yaw: -0.2, scale: 1.2 },
      { id: "wet_bank_outcrop", assetId: "corealm_rock_strata_3", x: 10.8, z: 27.0, yaw: 0.7, scale: 0.5, sink: 0.15 },
    ],
  },
  {
    id: "cairn_tarn_ledge", locationId: "cairn_tarns", regionId: "karrowmoor",
    centre: [206, -88], rotationY: -1.23, kind: "fishery", workRadius: 2.8, extent: [15, 28],
    terrain: { floorRadius: 0, backRise: 0, backDistance: 0, bermWidth: 0, approachAngle: 0 },
    resourceSlots: [
      { clusterId: "cairn_tarn_spots", index: 1, x: -3.3, z: 5.6, yaw: -0.1, scale: 1.04 },
      { clusterId: "cairn_tarn_spots", index: 2, x: 3.4, z: 5.7, yaw: 0.15, scale: 0.96 },
    ],
    dressing: [
      { id: "ledge_left", assetId: "corealm_rock_strata_3", x: -7.2, z: 23.4, yaw: -0.05, scale: [0.85, 0.34, 0.8], sink: 0.12 },
      { id: "ledge_right", assetId: "corealm_rock_strata_2", x: 7.5, z: 23.4, yaw: 0.4, scale: [0.68, 0.4, 0.72], sink: 0.12 },
      { id: "catch_box", assetId: "farm_crate_empty", x: -4.3, z: 25.5, yaw: 0.1, scale: 1.2 },
    ],
  },
  {
    id: "far_tarn_cove", locationId: "far_tarn", regionId: "karrowmoor",
    centre: [284, -110], rotationY: -1.143, kind: "fishery", workRadius: 2.8, extent: [14, 27],
    terrain: { floorRadius: 0, backRise: 0, backDistance: 0, bermWidth: 0, approachAngle: 0 },
    resourceSlots: [
      { clusterId: "far_tarn_spots", index: 1, x: -2.8, z: 5.1, yaw: 0.1, scale: 0.98 },
      { clusterId: "far_tarn_spots", index: 2, x: 3.0, z: 5.0, yaw: -0.15, scale: 1.03 },
    ],
    dressing: [
      { id: "cove_shoulder", assetId: "corealm_rock_strata_1", x: 7.2, z: 22.5, yaw: 0.6, scale: 0.58, sink: 0.16 },
      { id: "bank_seat", assetId: "nature_wood_log", x: -5.8, z: 23.7, yaw: Math.PI / 2, scale: 0.9 },
      { id: "line_coil", assetId: "rope_coil", x: -4.0, z: 25.0, yaw: 0.7, scale: 0.95 },
    ],
  },
  {
    id: "ashfin_warm_bank", locationId: "ashfin_springs", regionId: "kilnhalt",
    centre: [210, 250], rotationY: -0.985, kind: "fishery", workRadius: 3, extent: [17, 29],
    terrain: { floorRadius: 0, backRise: 0, backDistance: 0, bermWidth: 0, approachAngle: 0 },
    resourceSlots: [
      { clusterId: "ashfin_spring_spots", index: 1, x: -6.4, z: 4.6, yaw: 0.1, scale: 0.96 },
      { clusterId: "ashfin_spring_spots", index: 2, x: -2.2, z: 7.5, yaw: -0.15, scale: 1.02 },
      { clusterId: "ashfin_spring_spots", index: 3, x: 2.5, z: 7.2, yaw: 0.2, scale: 1.05 },
      { clusterId: "ashfin_spring_spots", index: 4, x: 6.5, z: 4.6, yaw: -0.2, scale: 0.98 },
    ],
    dressing: [
      { id: "warm_ledge", assetId: "corealm_rock_strata_3", x: 8.5, z: 23.5, yaw: 0.3, scale: [0.7, 0.45, 0.8], sink: 0.12 },
      { id: "catch_barrel", assetId: "barrel", x: -5.3, z: 24.4, yaw: -0.3, scale: 0.9 },
      { id: "sorting_box", assetId: "farm_crate_empty", x: -6.5, z: 25.1, yaw: -0.2, scale: 1.35 },
      { id: "rest_log", assetId: "nature_wood_log", x: -4.8, z: 26.9, yaw: Math.PI / 2, scale: 0.95 },
    ],
  },
];

const SITE_BY_CLUSTER = new Map<string, WorldSite>();
for (const site of WORLD_SITES) {
  for (const slot of site.resourceSlots) SITE_BY_CLUSTER.set(slot.clusterId, site);
}

export function authoredSiteForCluster(clusterId: string): WorldSite | null {
  return SITE_BY_CLUSTER.get(clusterId) ?? null;
}

export function worldSiteResourceSlot(
  clusterId: string,
  index: number,
): { site: WorldSite; slot: WorldSiteResourceSlot } | null {
  const site = SITE_BY_CLUSTER.get(clusterId);
  const slot = site?.resourceSlots.find((candidate) => candidate.clusterId === clusterId && candidate.index === index);
  return site && slot ? { site, slot } : null;
}

export function worldSitePoint(site: WorldSite, x: number, z: number): readonly [number, number] {
  const cos = Math.cos(site.rotationY);
  const sin = Math.sin(site.rotationY);
  return [site.centre[0] + x * cos + z * sin, site.centre[1] - x * sin + z * cos];
}
