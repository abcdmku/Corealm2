import type { BuildingKit, PartPlacement } from "../buildings.js";

/**
 * Dressing around the `wall_arch` obstacle used by Rootfall's Root Tunnel.
 *
 * The obstacle owns the opening and its navigation contract. These are deliberately only
 * surrounding details: the two posts and braces flank the hero's 1.728 m clear opening, the low
 * threshold is a non-blocking visual floor, and the lintel is high enough to read as a frame
 * without becoming a second invisible gate. The origin is the arch pivot, whose +Z side is the
 * Rootfall approach.
 */

const ROOF_LOG_BASE_Y = 3.8489;
const SUPPORT_BEAM_BASE_Y = 1.211;
const VINE_BASE_Y = -2.1205;
const VINE_TOP_Y = 3.47;
const TORCH_BASE_Y = -0.278;
const TORCH_MOUNT_Y = 1.62;
const LINTEL_BOTTOM_Y = 3.52;
const LINTEL_SCALE = 0.34;
/**
 * Post height is derived from where the beam actually is over the post, not from its lowest point.
 *
 * `roof_log` is not a prism. Decoded off the GLB its underside is 3.849 at the middle of the span
 * but sags away to 3.948 at |z| 3.0, 4.081 at |z| 4.5 and 4.100 at the tip. The posts stand at
 * |x| 1.42, which after the quarter turn is local |z| 4.18 at `LINTEL_SCALE` 0.34, where the
 * underside is 4.05 - so the beam's soffit over a post is 3.59, not the 3.52 the constant above
 * describes.
 *
 * The authored post scales - 1.16, 1.14 and 1.18 across the three variants - gave 3.48, 3.42 and
 * 3.54 m posts, so every variant left a slot of daylight between the post head and the beam it is
 * supposed to carry. `POST_BURY_METRES` takes the head far enough into the timber that the joint
 * reads as a joint and survives `r3` rounding, while staying under the log's 3.94 m upper surface.
 */
const CORNER_WOOD_HEIGHT = 3;
const LINTEL_SOFFIT_OVER_POST_Y = 3.59;
const POST_BURY_METRES = 0.13;
const FRAME_POST_SCALE = (LINTEL_SOFFIT_OVER_POST_Y + POST_BURY_METRES) / CORNER_WOOD_HEIGHT;
type RockAsset = "rock_medium_1" | "rock_medium_2" | "rock_medium_3";
const ROCK_BASE_Y: Record<RockAsset, number> = {
  rock_medium_1: -0.271,
  rock_medium_2: -0.051,
  rock_medium_3: -0.316,
};

function r3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function r4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function placement(
  tag: string,
  assetId: string,
  dx: number,
  dy: number,
  dz: number,
  rotationY = 0,
  scale = 1,
): PartPlacement {
  return {
    tag,
    assetId,
    dx: r3(dx),
    dy: r3(dy),
    dz: r3(dz),
    rotationY: r4(rotationY),
    scale: r4(scale),
  };
}

/** The arch is timber-trimmed even in the stone kit, so its posts remain dark wood. */
function timberPostAsset(kit: BuildingKit): string {
  return kit.corner === "corner_brick" ? "corner_wood" : kit.corner;
}

function post(
  tag: string,
  kit: BuildingKit,
  dx: number,
  dz: number,
  scale = FRAME_POST_SCALE,
): PartPlacement {
  return placement(tag, timberPostAsset(kit), dx, 0, dz, 0, scale);
}

/** `roof_log` runs along local Z. A quarter turn makes a continuous timber lintel across the arch. */
function lintel(tag: string, scale = LINTEL_SCALE, dz = -0.08): PartPlacement {
  // The wall_arch hero is 3.6 m high at its authored 1.2 scale. Keeping the log's measured lower
  // edge at 3.52 lets it overlap that crown by 8 cm, while its 3.99 m upper edge remains a clean
  // cap instead of leaving a daylight seam between the posts and the arch.
  return placement(tag, "roof_log", 0, LINTEL_BOTTOM_Y - ROOF_LOG_BASE_Y * scale, dz, Math.PI / 2, scale);
}

/**
 * `support_beam` is a diagonal knee bracket, not a vertical post: its local +Z end is the high
 * end. Rotating it half a turn puts that high end behind the arch and the authored stub foot on
 * the approach, so the two braces visibly support the lintel without projecting into the opening.
 */
function brace(tag: string, dx: number, dz: number, scale: number): PartPlacement {
  return placement(tag, "support_beam", dx, -SUPPORT_BEAM_BASE_Y * scale, dz, Math.PI, scale);
}

function rock(
  tag: string,
  assetId: RockAsset,
  dx: number,
  dz: number,
  scale: number,
): PartPlacement {
  // The composition origin is raw ground, so compensate each rock's measured bbox minimum.
  return placement(tag, assetId, dx, -ROCK_BASE_Y[assetId] * scale, dz, 0, scale);
}

function hangingVine(tag: string, dx: number, dz: number, scale: number): PartPlacement {
  // vine_1's local top is +0.482 m and its leaves fall to -2.1205 m. Anchor that top just below
  // the lintel; a vine is then clearly attached to the frame instead of looking like a floating
  // shrub beside the entrance.
  const topY = 0.482;
  return placement(tag, "vine_1", dx, VINE_TOP_Y - topY * scale, dz, 0, scale);
}

function groundVine(tag: string, dx: number, dz: number, scale: number): PartPlacement {
  // One low vine at the foot of the frame softens the hard rock-to-dirt transition. Its measured
  // low leaf is left just above the ground, so it does not disappear into the terrain.
  return placement(tag, "vine_1", dx, -VINE_BASE_Y * scale + 0.04, dz, 0, scale);
}

function torch(tag: string, dx: number, dz: number, scale: number): PartPlacement {
  // Both torches face the +Z approach. Their measured base is -0.278 m, so mount the handle at a
  // consistent height on the timber posts instead of grounding a tiny flame in the path.
  return placement(tag, "torch", dx, TORCH_MOUNT_Y - TORCH_BASE_Y * scale, dz, 0, scale);
}

function threshold(tag: string, dz = 0.82, scale = 0.82): PartPlacement {
  // A single 1.64 m plank sits inside the hero's 1.728 m clear opening and bridges the arch's
  // stone foot into the dirt approach. It is a visual threshold only; the world composition
  // collider intentionally ignores floor tiles.
  return placement(tag, "floor_wood", 0, 0.02, dz, 0, scale);
}

function groundRoot(tag: string, dx: number, dz: number, scale = 0.18): PartPlacement {
  // At this scale roof_log is a short, low root (1.93 m along local Z and 0.25 m high). Its
  // measured pivot correction seats it in the earth beside a post rather than leaving a log in
  // mid-air.
  return placement(tag, "roof_log", dx, -ROOF_LOG_BASE_Y * scale, dz, 0, scale);
}

function variantA(kit: BuildingKit): PartPlacement[] {
  return [
    threshold("root_a_threshold"),
    post("root_a_post_l", kit, -1.42, 0),
    post("root_a_post_r", kit, 1.42, 0),
    lintel("root_a_lintel"),
    brace("root_a_brace_l", -1.52, 0.92, 0.58),
    brace("root_a_brace_r", 1.52, 0.92, 0.58),
    rock("root_a_rock_l", "rock_medium_2", -2.58, 0.58, 0.57),
    rock("root_a_rock_r", "rock_medium_3", 2.62, 0.66, 0.54),
    hangingVine("root_a_vine_r", 1.56, 0.11, 0.6),
    groundVine("root_a_ground_vine_l", -1.86, 0.48, 0.46),
    torch("root_a_torch_l", -1.52, 0.13, 0.86),
    torch("root_a_torch", 1.52, 0.13, 0.86),
  ];
}

function variantB(kit: BuildingKit): PartPlacement[] {
  return [
    threshold("root_b_threshold", 0.8, 0.8),
    post("root_b_post_l", kit, -1.42, 0.02),
    post("root_b_post_r", kit, 1.42, 0.02),
    lintel("root_b_lintel", 0.32, -0.06),
    groundRoot("root_b_root_l", -1.68, 0.7),
    groundRoot("root_b_root_r", 1.68, 0.7),
    rock("root_b_rock_l", "rock_medium_1", -2.54, 0.7, 0.54),
    rock("root_b_rock_r", "rock_medium_3", 2.56, 0.84, 0.52),
    hangingVine("root_b_vine_l", -1.56, 0.1, 0.58),
    hangingVine("root_b_vine_r", 1.56, 0.1, 0.58),
    groundVine("root_b_ground_vine_r", 1.9, 0.52, 0.43),
    torch("root_b_torch_l", -1.52, 0.13, 0.84),
    torch("root_b_torch_r", 1.52, 0.13, 0.84),
  ];
}

function variantC(kit: BuildingKit): PartPlacement[] {
  return [
    threshold("root_c_threshold", 0.84, 0.84),
    post("root_c_post_l", kit, -1.43, 0),
    post("root_c_post_r", kit, 1.43, 0),
    lintel("root_c_lintel", 0.33, -0.08),
    brace("root_c_brace_l", -1.53, 0.96, 0.6),
    brace("root_c_brace_r", 1.53, 0.96, 0.6),
    // The left flank borders Hollowcut's raised haul approach. Keep its timber brace and vine,
    // but leave the adjacent walking strip clear of a decorative rock collider.
    rock("root_c_rock_r", "rock_medium_1", 2.64, 0.74, 0.52),
    hangingVine("root_c_vine_l", -1.56, 0.11, 0.6),
    hangingVine("root_c_vine_r", 1.56, 0.11, 0.6),
    groundVine("root_c_ground_vine_l", -1.92, 0.46, 0.44),
    torch("root_c_torch_l", -1.53, 0.13, 0.86),
    torch("root_c_torch", 1.53, 0.13, 0.86),
  ];
}

/**
 * Build one of three stable Root Tunnel dressings. The unsigned seed keeps negative caller seeds
 * deterministic too; adjacent seeds intentionally select adjacent authored silhouettes.
 */
export function buildRootTunnelComposition(seed: number, kit: BuildingKit): PartPlacement[] {
  switch ((seed >>> 0) % 3) {
    case 0: return variantA(kit);
    case 1: return variantB(kit);
    default: return variantC(kit);
  }
}
