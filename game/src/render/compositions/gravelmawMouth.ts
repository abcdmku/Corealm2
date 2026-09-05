import type { BuildingKit, PartPlacement } from "../buildings.js";

/**
 * Set dressing for the Gravelmaw's surface portal.
 *
 * The portal entity owns the `wall_brick_door` hero. `dungeonMouth.ts` supplies its dressed stone
 * crown and recessed passage; the authored landform buries its back. This module beds the side
 * masonry and quarry shoulders into that bank, leaving the inner 3.4 m open from local +Z.
 * All coordinates are authored in that frame, in metres, before the caller's entrance yaw.
 *
 * The surface drops away toward +Z. Lower rock courses are therefore deliberately sunk rather
 * than lifted to the mouth's origin height. The front lip is centred near z 4 and its rotated
 * bounds stop below z 6, with a buried foot on the downhill ground. The native strata use uniform
 * scales fitted to the previous rotated XZ bounds. Their measured centre and base corrections
 * preserve that footprint and burial despite the imported rocks' off-centre source pivots.
 */

interface RockSpec {
  readonly tag: string;
  readonly assetId: "rock_medium_1" | "rock_medium_2" | "rock_medium_3"
    | "corealm_rock_strata_1" | "corealm_rock_strata_2";
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly rotationY: number;
  readonly scale: number;
}

interface MouthVariant {
  readonly rocks: readonly RockSpec[];
  readonly torchScale: number;
  readonly torchY: number;
  readonly thresholdScale: number;
  readonly thresholdZ: number;
  readonly pathZ: number;
}

const MOUTH_VARIANTS: readonly MouthVariant[] = [
  {
    // Broad, even jaws support paired shoulders behind the brick piers. The fitted masonry
    // coping remains the uninterrupted upper silhouette of the entrance.
    rocks: [
      { tag: "jaw_l", assetId: "corealm_rock_strata_1", dx: -4.460772, dy: -0.864077, dz: -1.088388, rotationY: 0.45, scale: 0.651672 },
      { tag: "jaw_r", assetId: "corealm_rock_strata_1", dx: 4.421189, dy: -0.823966, dz: -1.649244, rotationY: -0.7, scale: 0.625466 },
      // The broader native jaws overlap the lower shoulder faces, keeping both courses seated.
      { tag: "shoulder_l", assetId: "corealm_rock_strata_2", dx: -4.540775, dy: 1.097720, dz: -1.687964, rotationY: 1.1, scale: 0.595517 },
      { tag: "shoulder_r", assetId: "corealm_rock_strata_2", dx: 5.388238, dy: 1.153800, dz: -2.094101, rotationY: 2, scale: 0.617403 },
      { tag: "rear_l", assetId: "corealm_rock_strata_2", dx: -5.866926, dy: -0.756622, dz: -2.867933, rotationY: 0.7, scale: 0.466448 },
      { tag: "rear_r", assetId: "corealm_rock_strata_2", dx: 6.028536, dy: -0.935173, dz: -3.127213, rotationY: 2.4, scale: 0.525921 },
      { tag: "lip_l", assetId: "corealm_rock_strata_2", dx: -4.452966, dy: -1.116622, dz: 4.006391, rotationY: 0.4, scale: 0.459618 },
      { tag: "lip_r", assetId: "corealm_rock_strata_2", dx: 4.543187, dy: -1.269751, dz: 3.734645, rotationY: 2.6, scale: 0.509160 },
    ],
    torchScale: 2.16,
    torchY: 0.4,
    thresholdScale: 2.2,
    thresholdZ: 0.58,
    pathZ: 2.55,
  },
  {
    // A lower right shoulder and unequal rear stones bed into the bank beside the opening.
    rocks: [
      { tag: "jaw_l", assetId: "corealm_rock_strata_1", dx: -4.940306, dy: -0.863966, dz: -1.584149, rotationY: -0.3, scale: 0.578893 },
      { tag: "jaw_r", assetId: "corealm_rock_strata_1", dx: 5.480363, dy: -0.825138, dz: -1.617085, rotationY: 1.3, scale: 0.580637 },
      { tag: "shoulder_l", assetId: "corealm_rock_strata_2", dx: -4.069452, dy: 1.020113, dz: -2.137807, rotationY: 1.95, scale: 0.599285 },
      { tag: "shoulder_r", assetId: "corealm_rock_strata_2", dx: 4.784941, dy: 0.996257, dz: -1.805835, rotationY: 0.3, scale: 0.545801 },
      { tag: "rear_l", assetId: "corealm_rock_strata_2", dx: -5.488674, dy: -0.914636, dz: -2.560445, rotationY: 0.6, scale: 0.544845 },
      { tag: "rear_r", assetId: "corealm_rock_strata_2", dx: 6.039547, dy: -0.698148, dz: -3.014332, rotationY: 2.3, scale: 0.486522 },
      { tag: "lip_l", assetId: "corealm_rock_strata_2", dx: -3.730575, dy: -1.294636, dz: 3.968257, rotationY: 1.5, scale: 0.521210 },
      { tag: "lip_r", assetId: "corealm_rock_strata_2", dx: 4.451248, dy: -1.137640, dz: 3.833270, rotationY: 2.85, scale: 0.469398 },
    ],
    torchScale: 2.24,
    torchY: 0.43,
    thresholdScale: 2.24,
    thresholdZ: 0.62,
    pathZ: 2.48,
  },
  {
    // A wider left jaw and lower right shoulder frame the dressed portal. Every stone stays
    // behind the piers or outside the 3.4 m walk channel.
    rocks: [
      { tag: "jaw_l", assetId: "corealm_rock_strata_1", dx: -4.578822, dy: -0.596795, dz: -1.799447, rotationY: 2.3, scale: 0.573912 },
      { tag: "jaw_r", assetId: "corealm_rock_strata_1", dx: 4.403180, dy: -0.863966, dz: -1.779264, rotationY: -1, scale: 0.610582 },
      { tag: "shoulder_l", assetId: "corealm_rock_strata_2", dx: -4.582781, dy: 1.077720, dz: -1.695604, rotationY: 0.8, scale: 0.599331 },
      { tag: "shoulder_r", assetId: "corealm_rock_strata_2", dx: 5.434427, dy: 0.933800, dz: -2.049414, rotationY: 1.9, scale: 0.612622 },
      { tag: "rear_l", assetId: "corealm_rock_strata_2", dx: -5.205377, dy: -0.894636, dz: -2.960350, rotationY: 1.55, scale: 0.518160 },
      { tag: "rear_r", assetId: "corealm_rock_strata_2", dx: 5.686130, dy: -0.900594, dz: -2.816882, rotationY: -0.2, scale: 0.533818 },
      { tag: "lip_l", assetId: "corealm_rock_strata_2", dx: -4.127813, dy: -1.249751, dz: 3.776321, rotationY: 2.4, scale: 0.511313 },
      { tag: "lip_r", assetId: "corealm_rock_strata_2", dx: 4.530750, dy: -1.294636, dz: 4.452773, rotationY: 0.45, scale: 0.539081 },
    ],
    torchScale: 2.2,
    torchY: 0.42,
    thresholdScale: 2.18,
    thresholdZ: 0.56,
    pathZ: 2.62,
  },
  {
    // A low left shoulder and heavier right shoulder give the bank an uneven toe while the
    // brick piers retain their alignment with the masonry hero.
    rocks: [
      { tag: "jaw_l", assetId: "corealm_rock_strata_1", dx: -5.371349, dy: -0.891451, dz: -1.462625, rotationY: -0.8, scale: 0.671638 },
      { tag: "jaw_r", assetId: "corealm_rock_strata_1", dx: 4.893713, dy: -0.625778, dz: -1.720409, rotationY: 1.7, scale: 0.519324 },
      { tag: "shoulder_l", assetId: "corealm_rock_strata_2", dx: -4.621023, dy: 1.078291, dz: -1.903793, rotationY: 2.4, scale: 0.532225 },
      { tag: "shoulder_r", assetId: "corealm_rock_strata_2", dx: 5.294345, dy: 1.107487, dz: -1.446914, rotationY: 0.9, scale: 0.644087 },
      { tag: "rear_l", assetId: "corealm_rock_strata_2", dx: -5.640356, dy: -0.889751, dz: -2.882067, rotationY: 1, scale: 0.509481 },
      { tag: "rear_r", assetId: "corealm_rock_strata_2", dx: 5.985369, dy: -0.698657, dz: -2.986689, rotationY: 2.1, scale: 0.488424 },
      { tag: "lip_l", assetId: "corealm_rock_strata_2", dx: -4.469932, dy: -1.135605, dz: 3.992925, rotationY: 0.3, scale: 0.444257 },
      { tag: "lip_r", assetId: "corealm_rock_strata_2", dx: 4.621548, dy: -1.255173, dz: 3.897926, rotationY: 1.9, scale: 0.521161 },
    ],
    torchScale: 2.12,
    torchY: 0.38,
    thresholdScale: 2.26,
    thresholdZ: 0.6,
    pathZ: 2.52,
  },
] as const;

/**
 * Beds a `floor_brick` paving tile into the ground with its face just proud of it.
 *
 * `floor_brick` is a 0.020 m slab about a base at -0.010, so at 2.2 it is 44 mm thick. Both of
 * these tiles were authored at a flat `dy -0.035`, which put their TOP at -0.013 and -0.018: they
 * were submitted to the renderer, batched, and drew nothing at all because the whole tile was
 * under the ground plane.
 */
const PAVING_PROUD_METRES = 0.012;
const FLOOR_BRICK_TOP = 0.01;

function pavingY(scale: number): number {
  return PAVING_PROUD_METRES - FLOOR_BRICK_TOP * scale;
}

function placement(
  tag: string,
  assetId: string,
  dx: number,
  dy: number,
  dz: number,
  rotationY: number,
  scale: number,
): PartPlacement {
  return { tag, assetId, dx, dy, dz, rotationY, scale };
}

/**
 * Build one deterministic mouth dressing. Each of the four recipes has fourteen parts: two brick
 * piers, a low kerb threshold, one brick approach tile, two upright torches, and eight bedded rocks.
 * The hero's fitted crown needs no suspended rock dressing.
 */
export function buildGravelmawMouthComposition(seed: number, kit: BuildingKit): PartPlacement[] {
  const variant = MOUTH_VARIANTS[(seed >>> 0) % MOUTH_VARIANTS.length]!;
  const out: PartPlacement[] = [];

  // `gatePier` is the kit's stone gate masonry (wall_brick_straight in all current kits). These
  // two short piers frame the hero's thin panel, with a measured front face at z +0.093. Their
  // inner edges remain more than 2 m from centre, leaving the required 3.4 m walk channel between
  // them; the quarry rocks sit farther back so the transition reads as layered construction.
  out.push(placement("masonry_l", kit.gatePier, -3.12, -0.04, 0.14, 0, 1.04));
  out.push(placement("masonry_r", kit.gatePier, 3.12, -0.04, 0.14, 0, 1.04));

  // The kerb is a readable stone threshold rather than a wall across the opening. The floor tile
  // sits farther down the approach and is low enough to remain walkable, keeping the black centre
  // visible between the two piers.
  out.push(placement("threshold", "kerb_straight", 0, -0.035, variant.thresholdZ, 0, variant.thresholdScale));
  out.push(placement("approach_stone", "floor_brick", 0, pavingY(2.2), variant.pathZ, 0, 2.2));

  // A bracket torch mounts ON the pier, not in front of it. `torch`'s measured base.y is -0.278,
  // so a raw `variant.torchY` of 0.38-0.43 buried the foot 0.2 m at these scales, and dz 0.96 left
  // the mounting plate 0.82 m out in the open air in front of the pier's brick plane at z 0.140.
  // The pivot correction is the same one `rootTunnel.ts:torch` and `regionGate.ts:torchY` use.
  const brazierY = 0.278 * variant.torchScale + 0.38;
  out.push(placement("brazier_l", "torch", -3.35, brazierY, 0.1, 0, variant.torchScale));
  out.push(placement("brazier_r", "torch", 3.35, brazierY, 0.1, 0, variant.torchScale));

  for (const rock of variant.rocks) {
    out.push(placement(
      rock.tag,
      rock.assetId,
      rock.dx,
      rock.dy,
      rock.dz,
      rock.rotationY,
      rock.scale,
    ));
  }
  return out;
}

interface ExitVariant {
  readonly rocks: readonly RockSpec[];
  readonly torchScale: number;
  readonly torchY: number;
  readonly torchX: number;
  readonly torchZ: number;
  readonly thresholdScale: number;
  readonly thresholdZ: number;
}

/**
 * Small interior-side recipes for the reciprocal portal in chamber one.
 *
 * `gravelmaw_exit_portal` is another `wall_brick_door` hero, facing local +Z back toward the surface
 * mouth. The chamber floor is level at this point, so these rocks use only a shallow burial and
 * the torch pivots use the same measured `base.y = -0.278` correction as the surface mouth. Four
 * rocks, two brick piers, a floor-brick threshold and two torches are enough to make the exit read
 * as a cut stone opening without narrowing the three-metre approach from the chamber centre.
 */
const EXIT_VARIANTS: readonly ExitVariant[] = [
  {
    rocks: [
      { tag: "exit_jaw_l", assetId: "rock_medium_1", dx: -3.1, dy: -0.46, dz: -0.12, rotationY: 0.25, scale: 0.68 },
      { tag: "exit_jaw_r", assetId: "rock_medium_2", dx: 3.1, dy: -0.5, dz: -0.08, rotationY: -0.35, scale: 0.7 },
      { tag: "exit_cap_l", assetId: "rock_medium_3", dx: -3.1, dy: 2.02, dz: -0.82, rotationY: 0.2, scale: 0.65 },
      { tag: "exit_cap_r", assetId: "rock_medium_1", dx: 3.1, dy: 2.14, dz: -0.94, rotationY: -0.25, scale: 0.68 },
    ],
    torchScale: 1.62,
    torchY: 0.4,
    torchX: 2.55,
    torchZ: 0.76,
    thresholdScale: 1.7,
    thresholdZ: 0.52,
  },
  {
    rocks: [
      { tag: "exit_jaw_l", assetId: "rock_medium_2", dx: -3.1, dy: -0.5, dz: -0.18, rotationY: -0.2, scale: 0.7 },
      { tag: "exit_jaw_r", assetId: "rock_medium_3", dx: 3.1, dy: -0.48, dz: -0.02, rotationY: 0.4, scale: 0.62 },
      { tag: "exit_cap_l", assetId: "rock_medium_1", dx: -3.1, dy: 2.12, dz: -0.72, rotationY: -0.35, scale: 0.68 },
      { tag: "exit_cap_r", assetId: "rock_medium_2", dx: 3.1, dy: 1.98, dz: -1.02, rotationY: 0.25, scale: 0.66 },
    ],
    torchScale: 1.68,
    torchY: 0.42,
    torchX: 2.58,
    torchZ: 0.7,
    thresholdScale: 1.74,
    thresholdZ: 0.56,
  },
  {
    rocks: [
      { tag: "exit_jaw_l", assetId: "rock_medium_3", dx: -3.1, dy: -0.44, dz: -0.08, rotationY: 0.45, scale: 0.6 },
      { tag: "exit_jaw_r", assetId: "rock_medium_1", dx: 3.1, dy: -0.52, dz: -0.14, rotationY: -0.3, scale: 0.68 },
      { tag: "exit_cap_l", assetId: "rock_medium_2", dx: -3.1, dy: 2.06, dz: -0.9, rotationY: 0.35, scale: 0.7 },
      { tag: "exit_cap_r", assetId: "rock_medium_3", dx: 3.1, dy: 2.0, dz: -0.98, rotationY: -0.3, scale: 0.64 },
    ],
    torchScale: 1.64,
    torchY: 0.39,
    torchX: 2.52,
    torchZ: 0.82,
    thresholdScale: 1.72,
    thresholdZ: 0.5,
  },
] as const;

/** Build the compact chamber-side dressing for the Gravelmaw's exit portal. */
export function buildGravelmawExitComposition(seed: number, kit: BuildingKit): PartPlacement[] {
  const variant = EXIT_VARIANTS[(seed >>> 0) % EXIT_VARIANTS.length]!;
  const out: PartPlacement[] = [
    // The brick gate piers frame the separate `wall_brick_door` hero and leave its clear opening
    // untouched. At dx +-3.35 and scale 1.05 their inner edges landed at 2.30 m against a hero
    // whose panel reaches 2.20 m, so each pier stood off the portal behind a full-height 0.10 m
    // slot of daylight. +-3.15 laps them 0.10 m into the hero instead.
    placement("exit_pier_l", kit.gatePier, -3.15, -0.04, -0.18, 0, 1.05),
    placement("exit_pier_r", kit.gatePier, 3.15, -0.04, -0.18, 0, 1.05),

    // A single floor-brick tile reads as the threshold and remains floor, not a blocker across the
    // portal. The tile is centred on the +Z approach so the arch is still visible over it.
    placement("exit_floor_threshold", "floor_brick", 0, pavingY(variant.thresholdScale), variant.thresholdZ, 0, variant.thresholdScale),

    // `torch` is vertical at rotationY 0; its feet sit slightly below the chamber floor while the
    // flames flank the arch. No wall lamps or cage stand-ins are needed for this interior view.
    placement("exit_brazier_l", "torch", -variant.torchX, variant.torchY, variant.torchZ, 0, variant.torchScale),
    placement("exit_brazier_r", "torch", variant.torchX, variant.torchY, variant.torchZ, 0, variant.torchScale),
  ];

  for (const rock of variant.rocks) {
    out.push(placement(
      rock.tag,
      rock.assetId,
      rock.dx,
      rock.dy,
      rock.dz,
      rock.rotationY,
      rock.scale,
    ));
  }
  return out;
}
