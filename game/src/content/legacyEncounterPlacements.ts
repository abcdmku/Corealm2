import type { RegionId } from '../contracts.js';
import type { EnemyGroupDef, Spot } from './regions.js';
import { createEncounterFormation, type EncounterFormation, type EncounterFormationOptions } from './encounterPopulation.js';

export interface LegacyEncounterPlacement {
  readonly id: string;
  readonly regionId: RegionId;
  /** Before this population expansion; do not replace these with projected counts or centers. */
  readonly originalCentre: Spot;
  readonly originalCount: number;
  readonly centre: Spot;
  readonly count: number;
  readonly radius: number;
  /** Explicit layout capacity at final rendered scale. Larger art requires another layout pass. */
  readonly bodyRadiusBudget: number;
  readonly anchors?: readonly Spot[];
  readonly anchorOnly?: boolean;
  readonly floorRect?: { readonly centre: Spot; readonly halfExtents: Spot };
  readonly rotationY?: number;
  readonly reason: string;
}

/** Receiving-floor proposal only. Root applies it after the production cave fixture accepts it. */
export const LEGACY_CAVE_FLOOR_INTENTS = [
  { id: 'gravelmaw_chamber1', originalRadius: 11, radius: 24, centre: [40, -40] as const },
] as const;

function ruin(id: string, originalCentre: Spot, yaw: number, localX: number, bodyRadiusBudget: number): LegacyEncounterPlacement {
  return { id: `${id}_haunt`, regionId: 'wilderness', originalCentre, originalCount: 2,
    centre: [originalCentre[0] + Math.cos(yaw) * localX, originalCentre[1] - Math.sin(yaw) * localX],
    count: 7, radius: 6, bodyRadiusBudget, rotationY: -yaw,
    reason: 'Seven residents occupy a side clearing beyond the complete ruin footprint; its through passage remains open.' };
}

export const LEGACY_ENCOUNTER_PLACEMENTS: readonly LegacyEncounterPlacement[] = [
  { id: 'redsill_frogs', regionId: 'fallowmarch', originalCentre: [-56, -72], originalCount: 6,
    centre: [-50, -52], count: 7, radius: 12, bodyRadiusBudget: .35,
    anchors: [[-45.78,-45.48],[-48.25,-47.38],[-49.94,-50.13],[-50.96,-53.1],[-52.09,-55.84],[-54.05,-58.57],[-56,-60]],
    reason: 'Keep the six original dry bank anchors and add the seventh frog farther along the northwest shore.' },
  { id: 'marchfield_hens', regionId: 'fallowmarch', originalCentre: [-93, -21], originalCount: 12,
    centre: [-93, -21], count: 12, radius: 4.4, bodyRadiusBudget: .45,
    floorRect: { centre: [-93, -21], halfExtents: [2.7, 3.7] },
    anchors: [[-94.9,-23.9],[-93.2,-23.9],[-91.4,-23.9],[-94.9,-22.15],[-93.2,-22.15],[-90.8,-22],
      [-94.9,-20.4],[-93.2,-20.4],[-91.4,-20.4],[-94.9,-18.65],[-93.2,-18.65],[-91.4,-18.65]],
    reason: 'Keep the twelve hens inside the existing eastern pen, retaining its trough and entrance.' },
  { id: 'bracken_hens', regionId: 'fallowmarch', originalCentre: [-152, 44], originalCount: 4,
    centre: [-101, -22], count: 7, radius: 2.7, bodyRadiusBudget: .45,
    floorRect: { centre: [-101, -22], halfExtents: [1.85, 2.2] },
    anchors: [[-102.4,-23.4],[-101,-23.4],[-99.6,-23.4],[-102.4,-22],[-101,-22],[-99.6,-22],[-102.4,-20.6]],
    rotationY: 0, reason: 'Seven small hens fit the existing western paddock without enlarging its fence.' },
  { id: 'redsill_cattle', regionId: 'fallowmarch', originalCentre: [-110, -34], originalCount: 4,
    centre: [-115, -40], count: 7, radius: 7, bodyRadiusBudget: 1.6,
    reason: 'Move the enlarged herd southwest of the barn into its open grazing field and away from the pen fences.' },
  { id: 'pack_fallowmarch_palewood_far_south_scrub', regionId: 'fallowmarch', originalCentre: [-338, -134], originalCount: 1,
    centre: [-330, -174], count: 7, radius: 8, bodyRadiusBudget: 1.8,
    reason: 'Separate the Thorn Maws from the three species that previously shared one tiny pocket.' },
  { id: 'pack_fallowmarch_palewood_heath_scrub', regionId: 'fallowmarch', originalCentre: [-332, -134], originalCount: 1,
    centre: [-307, -164], count: 9, radius: 7, bodyRadiusBudget: 1.05,
    reason: 'Heath Jacks occupy a separate clearing east of the Thorn Maws.' },
  { id: 'pack_fallowmarch_palewood_reed_scrub', regionId: 'fallowmarch', originalCentre: [-335, -129], originalCount: 1,
    centre: [-337, -147], count: 7, radius: 8, bodyRadiusBudget: 1.5,
    reason: 'Reed Striders occupy the northern side of the original shared pocket without reaching the grove work floor.' },
  { id: 'reedbank_goose_residents', regionId: 'fallowmarch', originalCentre: [-40, -27], originalCount: 4,
    centre: [-40, -21], count: 7, radius: 5, bodyRadiusBudget: .65,
    reason: 'Seven measured small birds move north of the fishing approach onto dry bank ground.' },
  { id: 'marchfield_turkey_residents', regionId: 'fallowmarch', originalCentre: [-83, 8], originalCount: 4,
    centre: [-83, 8], count: 7, radius: 6, bodyRadiusBudget: 1.15,
    reason: 'Reserve a six-meter field patch for seven turkeys north of the farm gate.' },
  { id: 'blackwater_heron_residents', regionId: 'vellenwood', originalCentre: [153, 109], originalCount: 2,
    centre: [162, 113], count: 7, radius: 8, bodyRadiusBudget: 1.7,
    reason: 'Move the larger Reed Striders northeast onto the dry bank above Blackwater.' },
  { id: 'blackwater_frogs', regionId: 'vellenwood', originalCentre: [112, 96], originalCount: 7,
    centre: [145, 84], count: 7, radius: 14, bodyRadiusBudget: 1,
    anchors: [[142.02,71.7],[144.94,75.18],[147.79,79.16],[148.05,84],[145.86,88.25],[142.64,91.36],[140.63,94.64]],
    reason: 'Preserve the eastern bank circuit and nudge its three northern anchors east so the complete Reed Strider bodies stay dry.' },
  { id: 'quarry_snail_residents', regionId: 'vellenwood', originalCentre: [122, 160], originalCount: 4,
    centre: [132, 179], count: 7, radius: 9, bodyRadiusBudget: 1.9,
    reason: 'Thorn Maws move beyond the rotated Hollowcut receiving face and its work aisle.' },
  { id: 'antler_beetle_residents', regionId: 'karrowmoor', originalCentre: [241, -129], originalCount: 3,
    centre: [241, -129], count: 7, radius: 11, bodyRadiusBudget: 2.7,
    anchors: [[239,-128],[244.9,-128],[241.95,-122.89],[236.05,-122.89],[233.1,-128],[236.05,-133.11],[241.95,-133.11]],
    reason: 'The seven large Flint Mandibles occupy the western shelf with a full body aisle beside the deadwood cover.' },
  { id: 'highcairn_bears', regionId: 'karrowmoor', originalCentre: [100, -110], originalCount: 4,
    centre: [92, -116], count: 7, radius: 12, bodyRadiusBudget: 1.6,
    reason: 'Seven Cairn Treaders fit their authored refuge; discard the unused 26-meter fallback disc that reached the Scree Slide pack.' },
  { id: 'kiln_salamander_residents', regionId: 'kilnhalt', originalCentre: [244, 269], originalCount: 2,
    centre: [247, 277], count: 7, radius: 8, bodyRadiusBudget: 1.7,
    reason: 'Shift the Slag Crawlers northeast away from Ashfin fishing access.' },
  { id: 'population_petrified_grove_south_shades', regionId: 'wilderness', originalCentre: [280, 574], originalCount: 3,
    centre: [326, 571], count: 9, radius: 9, bodyRadiusBudget: 1.25,
    reason: 'Clear the new Ember Shelter living grove while preserving the original shade group.' },
  { id: 'wilderness_petrified_grove', regionId: 'wilderness', originalCentre: [255, 612], originalCount: 3,
    centre: [255, 620], count: 9, radius: 12, bodyRadiusBudget: 1.45,
    reason: 'Move the Hollow Bough circuit north of the complete Ember Shelter tree floor and its gathering aisle.' },
  { id: 'population_broken_watch_lanterns', regionId: 'wilderness', originalCentre: [-272, 496], originalCount: 3,
    centre: [-249, 489], count: 8, radius: 9, bodyRadiusBudget: .7,
    reason: 'Move the lanterns east of the Lastroot tree floor while keeping them south of the Broken Watch structure.' },
  { id: 'population_aqueduct_west_lanterns', regionId: 'wilderness', originalCentre: [-260, 664], originalCount: 3,
    centre: [-250, 664], count: 8, radius: 9, bodyRadiusBudget: .7,
    reason: 'Place the lantern circuit east of Cindervein mine without occupying the aqueduct ruin or its resident clearing.' },
  { id: 'black_keep_gate_guard', regionId: 'wilderness', originalCentre: [29, 565], originalCount: 2,
    centre: [27, 566], count: 7, radius: 6, bodyRadiusBudget: 1.4,
    reason: 'The western seven-member guard remains south of the gate towers and clear of the approach axis.' },
  { id: 'black_keep_gate_archers', regionId: 'wilderness', originalCentre: [52, 566], originalCount: 2,
    centre: [54, 565], count: 7, radius: 6, bodyRadiusBudget: 1.4,
    reason: 'A separate eastern archer detachment leaves the gate lane and the western guard clear.' },
  { id: 'black_keep_court_guard', regionId: 'wilderness', originalCentre: [40, 594], originalCount: 2,
    centre: [31, 596], count: 7, radius: 6, bodyRadiusBudget: 1.4,
    reason: 'The inner guard occupies the west court, clear of the main gate axis and the sealed keep hall.' },
  ruin('broken_watch_tower', [-250,520], .2, -17, 1.4),
  ruin('nameless_abbey', [-130,610], .12, -20, 1.35),
  ruin('dead_smithy', [130,565], -.45, -21, 1.4),
  ruin('fallen_aqueduct', [-205,665], .17, -27, 1.35),
  ruin('outer_watch', [-310,575], 1.9, -17, 1.4),
  // Must track wildernessLandmarks.ts: wilderness.ts derives this haunt's centre from the site
  // position, so the pair moves together or the saved encounter identity breaks.
  ruin('forgotten_forge', [-55,670], 2.4, -21, 1.35),
  ruin('eastern_cloister', [305,670], -.4, 20, 1.4),
  ruin('eastern_aqueduct', [230,555], Math.PI / 2, -27, 1.35),
  { id: 'gravelmaw_ch1_rats', regionId: 'gravelmaw', originalCentre: [40,-40], originalCount: 4,
    centre: [35,-38], count: 7, radius: 10, bodyRadiusBudget: 1.8, anchorOnly: true,
    anchors: [[34,-39],[30.75,-36.5],[36.5,-35.75],[33.25,-33.25],[38.5,-42.75],[37,-31.5],[42.75,-38.75]],
    reason: 'Seven Weavers occupy the enlarged Lit Gallery floor west of the portal and arrival.' },
  { id: 'gravelmaw_ch1_reavers', regionId: 'gravelmaw', originalCentre: [44,-36], originalCount: 2,
    centre: [45,-36], count: 7, radius: 15, bodyRadiusBudget: 1.2, anchorOnly: true,
    anchors: [[46.75,-35.5],[47.25,-32.5],[49.5,-34.5],[40.75,-29],[37.5,-39.25],[47.5,-48.25],[37,-46.25]],
    reason: 'Seven bandits use the eastern gallery and open link, clear of the exit recess.' },
  { id: 'gravelmaw_ch2_scorpions', regionId: 'gravelmaw', originalCentre: [30,-58], originalCount: 6,
    centre: [29,-52], count: 7, radius: 16, bodyRadiusBudget: 1.8, anchorOnly: true,
    anchors: [[20.5,-56.25],[30.5,-44.75],[33.5,-48],[29.5,-40.75],[29,-65],[34.5,-43.75],[37.25,-49.75]],
    reason: 'Seven Weavers use dry ledges around the larger Mandibles and the continuous floor link before the door.' },
  { id: 'gravelmaw_ch2_crabs', regionId: 'gravelmaw', originalCentre: [27,-54], originalCount: 3,
    centre: [30,-58], count: 7, radius: 12, bodyRadiusBudget: 2.7, anchorOnly: true,
    anchors: [[30,-58],[25.25,-61.5],[25.25,-54.5],[33.5,-62.75],[33.5,-53.25],[37,-58],[28.75,-49.75]],
    reason: 'The measured Mandibles occupy a broad formation in The Collapse, north of the Three-Lever Door.' },
  { id: 'gravelmaw_amethyst_spiders', regionId: 'gravelmaw', originalCentre: [35,-42], originalCount: 3,
    centre: [45,-45], count: 7, radius: 10, bodyRadiusBudget: 1.7, anchorOnly: true,
    anchors: [[44,-48],[46.5,-45],[40.5,-46.25],[43,-43.25],[46.25,-41],[50,-43.25],[49.75,-39.25]],
    reason: 'The Amethyst group remains before the Three-Lever Door in the east gallery and its southern link.' },
  { id: 'gravelmaw_ch3_bears', regionId: 'gravelmaw', originalCentre: [22,-76], originalCount: 2,
    centre: [22,-77], count: 7, radius: 8, bodyRadiusBudget: 1.8,
    reason: 'Seven Vault Custodians occupy the Cairn Hall between the existing door partitions.' },
];

export const LEGACY_ENCOUNTER_PLACEMENT_OVERRIDES: Readonly<Record<string, LegacyEncounterPlacement>> =
  Object.fromEntries(LEGACY_ENCOUNTER_PLACEMENTS.map(row => [row.id, row]));

/** The supplied receiving-floor predicate remains authoritative for production terrain and solids. */
export function createLegacyEncounterFormation(group: EnemyGroupDef,
  options: Omit<EncounterFormationOptions, 'count' | 'maxRadius' | 'preferredAnchors'>): EncounterFormation | null {
  const layout = LEGACY_ENCOUNTER_PLACEMENT_OVERRIDES[group.id];
  if (!layout) return null;
  if (options.bodyRadius > layout.bodyRadiusBudget + 1e-6)
    throw new Error(`${group.id}: measured body radius ${options.bodyRadius} exceeds authored ${layout.bodyRadiusBudget} m capacity`);
  return createEncounterFormation({ ...group, centre: layout.centre, count: layout.originalCount, radius: layout.radius }, {
    ...options, count: layout.count, maxRadius: layout.radius, preferredAnchors: layout.anchors,
    rotationY: options.rotationY ?? layout.rotationY,
    accepts: (point, radius) => {
      if (layout.anchorOnly && !layout.anchors?.some(anchor => anchor[0] === point[0] && anchor[1] === point[1])) return false;
      if (layout.floorRect && (Math.abs(point[0] - layout.floorRect.centre[0]) + radius > layout.floorRect.halfExtents[0] + 1e-6
        || Math.abs(point[1] - layout.floorRect.centre[1]) + radius > layout.floorRect.halfExtents[1] + 1e-6)) return false;
      return options.accepts?.(point, radius) ?? true;
    },
  });
}
