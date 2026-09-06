import type { PartPlacement } from "../buildings.js";
import { wallMountedBanner } from "../bannerPlacement.js";
import { inset, variantPart, withDetails } from "./parts.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";

const STOREY_METRES = 3.123;
const FRONT_YAW = Math.PI;
const BALCONY_RAIL_Y = STOREY_METRES + 0.105;
const DORMER_Y = 2 * STOREY_METRES + 0.55;

const BASE_BALCONY_RAILS = new Set([
  "balcony_front_0",
  "balcony_front_1",
  "balcony_side_l",
  "balcony_side_r",
]);

function fitsTownhouse(context: StructureVariantContext): boolean {
  return context.width >= 6 && context.depth >= 4 && context.entranceZ === -1;
}

/** The base dormer has the old quarter-turn error, so every recipe replaces or omits it. */
function facadeBase(
  base: readonly PartPlacement[],
  railing: "straight" | "corner",
): PartPlacement[] {
  return base.filter((part) => (
    part.tag !== "dormer"
    && (railing === "straight" || !BASE_BALCONY_RAILS.has(part.tag))
  ));
}

/**
 * Two L rails cover the same two floor tiles as the classic four-piece balcony rail.
 *
 * `balcony_corner` is an L whose corner is at local (+1, -1) with its legs running toward -X
 * and +Z. The two yaws were swapped, which turned the L the wrong way at both ends: the left
 * piece laid a rail back across the balcony doorway and the right-hand edge of the deck was
 * left open. These yaws put each corner on the deck corner it belongs to.
 */
function cornerRails(context: StructureVariantContext): PartPlacement[] {
  const z = -context.depth / 2 - 1;
  return [
    variantPart("corner_rail_l", "balcony_corner", -1, BALCONY_RAIL_Y, z, Math.PI / 2),
    variantPart("corner_rail_r", "balcony_corner", 1, BALCONY_RAIL_Y, z, 0),
  ];
}

function frontX(context: StructureVariantContext, side: -1 | 1, wide: boolean): number {
  const margin = wide ? 1.16 : 0.55;
  return inset(side * (context.width / 2 - 1), context.width / 2, margin);
}

type FrontWindowAsset = "window_shutters" | "window_thin";

interface FrontWindowRequest {
  readonly tag: string;
  readonly assetId: FrontWindowAsset;
  readonly side: -1 | 1;
  readonly storey: 0 | 1;
  readonly scale: number;
}

interface FrontWindowResult {
  readonly elevation: PartPlacement[];
  readonly details: PartPlacement[];
  readonly wallTag: string;
}

/** Place an exterior asset in the local frame of a wall panel. */
function wallAttachment(
  wall: PartPlacement,
  tag: string,
  assetId: string,
  out: number,
  along = 0,
  scale = wall.scale,
): PartPlacement {
  const yaw = wall.rotationY;
  return variantPart(
    tag,
    assetId,
    wall.dx + Math.sin(yaw) * out + Math.cos(yaw) * along,
    wall.dy,
    wall.dz + Math.cos(yaw) * out - Math.sin(yaw) * along,
    yaw,
    scale,
  );
}

/**
 * Find the intended front bay rather than trusting the seeded ring-window plan. The front
 * elevation is side 2, and the two requested sides target the nearest non-door flank. Keeping the
 * search on the authored wall tags is important: a shutter on a synthetic backing can look valid
 * while still leaving a solid wall behind it.
 */
function nearestFrontWall(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  side: -1 | 1,
  storey: 0 | 1,
  wide: boolean,
  used: ReadonlySet<string>,
): PartPlacement {
  const prefix = `w${storey}_2_`;
  const intendedX = frontX(context, side, wide);
  const candidates = base.filter((part) => (
    part.tag.startsWith(prefix)
    && !used.has(part.tag)
    && !part.assetId.endsWith("_door")
  ));
  const wall = candidates.sort((left, right) => (
    Math.abs(left.dx - intendedX) - Math.abs(right.dx - intendedX)
    || left.tag.localeCompare(right.tag)
  ))[0];
  if (wall === undefined) {
    throw new Error(`Townhouse variant cannot find a free front bay for storey ${storey}`);
  }
  return wall;
}

/**
 * Cut a real aperture in one front bay, restore its exact insert, and overlay shutters if asked.
 * Existing `g…` inserts retain their stable base tags; a missing insert is the only new optional
 * part this helper emits. The 4 cm/8 cm offsets leave the insert and shutter visibly proud of the
 * panel while keeping them inside the same bay for the catalog pairing check.
 */
function frontWindow(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  request: FrontWindowRequest,
  used: ReadonlySet<string>,
): FrontWindowResult {
  const wall = nearestFrontWall(
    context,
    base,
    request.side,
    request.storey,
    request.assetId === "window_shutters",
    used,
  );
  const suffix = wall.tag.slice(1);
  const insertTag = `g${suffix}`;
  const frameTag = `f${suffix}`;
  const wallAsset = request.storey === 0 ? "wall_brick_window" : "wall_plaster_window";
  const insertAsset = request.assetId === "window_shutters" ? "window_wide" : "window_thin";
  const insert = wallAttachment(wall, insertTag, insertAsset, 0.035, 0, wall.scale);
  const existingInsert = base.some((part) => part.tag === insertTag);
  const elevation = base
    .filter((part) => part.tag !== frameTag)
    .map((part) => {
      if (part.tag === wall.tag) return { ...part, assetId: wallAsset };
      if (part.tag === insertTag) return { ...insert, tag: part.tag };
      return part;
    });
  const details: PartPlacement[] = [];
  if (!existingInsert) {
    // Optional additions must carry the recipe prefix, but retaining the canonical g suffix keeps
    // diagnostics able to associate this repaired insert with its w{storey}_2_{index} wall.
    details.push(variantPart(insertTag, insertAsset, insert.dx, insert.dy, insert.dz, insert.rotationY, insert.scale));
  }
  if (request.assetId === "window_shutters") {
    details.push(wallAttachment(wall, request.tag, "window_shutters", 0.08, 0.048, request.scale));
  }
  return { elevation, details, wallTag: wall.tag };
}

/** Apply a set of front requests while keeping each requested side in a distinct bay. */
function frontWindows(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  requests: readonly FrontWindowRequest[],
): PartPlacement[] {
  let elevation = [...base];
  const details: PartPlacement[] = [];
  const used = new Set<string>();
  for (const request of requests) {
    const resolved = frontWindow(context, elevation, request, used);
    elevation = resolved.elevation;
    details.push(...resolved.details);
    used.add(resolved.wallTag);
  }
  return withDetails(elevation, ...details);
}

function lamp(
  context: StructureVariantContext,
  tag: string,
  x: number,
): PartPlacement {
  // The native bracket and hanging lantern span local Y .082..1.419. Fit the entire
  // assembly above walking headroom and below the 3.123 m balcony, including its chain.
  const scale = 0.72;
  const bottomY = 2.1;
  return variantPart(
    tag,
    "lamp_wall",
    inset(x, context.width / 2, 0.3),
    bottomY - 0.082 * scale,
    -context.depth / 2 - 0.14,
    FRONT_YAW,
    scale,
  );
}

function banner(
  context: StructureVariantContext,
  tag: string,
  x: number,
): PartPlacement {
  // banner_1 is a projecting standard: its rail is local X = 0 and the cloth reaches outward
  // along local +X. The townhouse entrance wall is the local south face, so the banner must turn
  // perpendicular to that wall. Keep the rail just proud of the measured wall face; treating the
  // cloth width as frontage span made these variants read like flags pasted along the elevation.
  return wallMountedBanner(
    `v_${tag}`,
    "banner_1",
    {
      dx: inset(x, context.width / 2, 0.35),
      dy: 5.25,
      dz: -context.depth / 2 - 0.103,
    },
    FRONT_YAW,
    0.86,
  );
}

/**
 * `roof_dormer` faces local +X. Keep that 1.9 m reach inside the tiled eave and turn it toward the
 * local -Z entrance. The smaller scale leaves room for a genuinely separate twin-dormer recipe.
 */
function dormer(
  context: StructureVariantContext,
  tag: string,
  along: number,
  scale = 0.9,
): PartPlacement {
  const long = Math.max(context.width, context.depth);
  const short = Math.min(context.width, context.depth);
  const roofScale = Math.max(
    short / context.kit.roofSmallCovers[0],
    long / context.kit.roofSmallCovers[1],
  );
  const eaveHalf = context.kit.roofSmallBox[0] * roofScale / 2;
  const pivotInset = Math.max(0.2, eaveHalf - 1.9 * scale - 0.12);
  const alongMargin = 1.22 * scale + 0.18;

  if (context.width >= context.depth) {
    return variantPart(
      tag,
      "roof_dormer",
      inset(along, context.width / 2, alongMargin),
      DORMER_Y,
      -pivotInset,
      Math.PI / 2,
      scale,
    );
  }
  return variantPart(
    tag,
    "roof_dormer",
    -pivotInset,
    DORMER_Y,
    inset(along, context.depth / 2, alongMargin),
    Math.PI,
    scale,
  );
}

export const TOWNHOUSE_VARIANTS: readonly StructureVariantRecipe[] = [
  {
    id: "townhouse:corner-merchant",
    label: "Corner Merchant House",
    family: "domestic",
    prefab: "townhouse",
    // Wider valid footprints can leave both requested front flanks solid, so allow one true insert
    // beside each shutter: the old eight-part dressing plus two repairs.
    detailBudget: 10,
    fits: fitsTownhouse,
    build: (context, base) => {
      const elevation = frontWindows(context, facadeBase(base, "corner"), [
        { tag: "merchant_shutter_l", assetId: "window_shutters", side: -1, storey: 1, scale: 0.94 },
        { tag: "merchant_shutter_r", assetId: "window_shutters", side: 1, storey: 1, scale: 0.94 },
      ]);
      return withDetails(
        elevation,
        ...cornerRails(context),
        dormer(context, "merchant_dormer", 0),
        // 0.8, not 2.35: this recipe shutters the +1 bay, whose leaf occupies x 0.915..3.080,
        // so a banner at 2.35 was planted straight through the open shutter. The balcony door
        // ends at x 0.596, which leaves this the only clear column on a 6 m frontage.
        banner(context, "merchant_banner", 0.8),
        lamp(context, "merchant_lamp_l", -1.45),
        lamp(context, "merchant_lamp_r", 1.65),
      );
    },
  },
  {
    id: "townhouse:shuttered-balcony",
    label: "Shuttered Balcony House",
    family: "domestic",
    prefab: "townhouse",
    // Two shutter repairs are possible when the frontage has more than the canonical three bays.
    detailBudget: 7,
    fits: fitsTownhouse,
    build: (context, base) => {
      const elevation = frontWindows(context, facadeBase(base, "straight"), [
        { tag: "shuttered_upper_l", assetId: "window_shutters", side: -1, storey: 1, scale: 0.92 },
        { tag: "shuttered_upper_r", assetId: "window_shutters", side: 1, storey: 1, scale: 0.92 },
        { tag: "shuttered_lower_l", assetId: "window_thin", side: -1, storey: 0, scale: 0.96 },
        { tag: "shuttered_lower_r", assetId: "window_thin", side: 1, storey: 0, scale: 0.96 },
      ]);
      return withDetails(elevation, lamp(context, "shuttered_lamp", -1.15));
    },
  },
  {
    id: "townhouse:twin-dormer",
    label: "Twin Dormer House",
    family: "domestic",
    prefab: "townhouse",
    detailBudget: 8,
    fits: fitsTownhouse,
    build: (context, base) => {
      const elevation = frontWindows(context, facadeBase(base, "corner"), [
        { tag: "twin_window_l", assetId: "window_thin", side: -1, storey: 1, scale: 0.95 },
        { tag: "twin_window_r", assetId: "window_thin", side: 1, storey: 1, scale: 0.95 },
      ]);
      return withDetails(
        elevation,
        ...cornerRails(context),
        dormer(context, "twin_dormer_l", -1.22, 0.82),
        dormer(context, "twin_dormer_r", 1.22, 0.82),
        lamp(context, "twin_lamp_l", -1.55),
        lamp(context, "twin_lamp_r", 1.7),
      );
    },
  },
  {
    id: "townhouse:guild-banners",
    label: "Guild Banner House",
    family: "domestic",
    prefab: "townhouse",
    // Both requested front flanks may be solid on a wider valid frontage.
    detailBudget: 8,
    fits: (context) => fitsTownhouse(context) && context.width >= 8,
    build: (context, base) => {
      const elevation = frontWindows(context, facadeBase(base, "straight"), [
        { tag: "guild_shutter_l", assetId: "window_shutters", side: -1, storey: 1, scale: 0.9 },
        { tag: "guild_shutter_r", assetId: "window_shutters", side: 1, storey: 1, scale: 0.9 },
      ]);
      return withDetails(
        elevation,
        dormer(context, "guild_dormer", -0.8, 0.9),
        banner(context, "guild_banner_l", -2.4),
        banner(context, "guild_banner_r", 2.4),
        lamp(context, "guild_lamp", -1.55),
      );
    },
  },
  {
    id: "townhouse:lantern-corner",
    label: "Lantern Corner House",
    family: "domestic",
    prefab: "townhouse",
    // The lower shutter and two upper narrow windows may each need a true insert.
    detailBudget: 8,
    fits: fitsTownhouse,
    build: (context, base) => {
      const elevation = frontWindows(context, facadeBase(base, "corner"), [
        { tag: "lantern_upper_l", assetId: "window_thin", side: -1, storey: 1, scale: 1 },
        { tag: "lantern_upper_r", assetId: "window_thin", side: 1, storey: 1, scale: 1 },
        { tag: "lantern_lower_shutter", assetId: "window_shutters", side: -1, storey: 0, scale: 0.88 },
      ]);
      return withDetails(
        elevation,
        ...cornerRails(context),
        lamp(context, "lantern_lamp_l", -1.45),
        lamp(context, "lantern_lamp_r", 1.65),
      );
    },
  },
  {
    id: "townhouse:dormer-and-shutters",
    label: "Dormer and Shutters House",
    family: "domestic",
    prefab: "townhouse",
    // Both shuttered storeys can need two repaired inserts on a wider valid frontage.
    detailBudget: 10,
    fits: fitsTownhouse,
    build: (context, base) => {
      const elevation = frontWindows(context, facadeBase(base, "straight"), [
        { tag: "shutter_upper_l", assetId: "window_shutters", side: -1, storey: 1, scale: 0.9 },
        { tag: "shutter_upper_r", assetId: "window_shutters", side: 1, storey: 1, scale: 0.9 },
        { tag: "shutter_lower_l", assetId: "window_shutters", side: -1, storey: 0, scale: 0.86 },
        { tag: "shutter_lower_r", assetId: "window_shutters", side: 1, storey: 0, scale: 0.86 },
      ]);
      return withDetails(
        elevation,
        dormer(context, "shutter_dormer", 0.9, 0.92),
        lamp(context, "shutter_lamp", -1.2),
      );
    },
  },
  {
    id: "townhouse:quiet-gallery",
    label: "Quiet Gallery House",
    family: "domestic",
    prefab: "townhouse",
    // Two upper shutter repairs plus any missing lower narrow inserts fit this ceiling.
    detailBudget: 8,
    fits: fitsTownhouse,
    build: (context, base) => {
      const elevation = frontWindows(context, facadeBase(base, "corner"), [
        { tag: "gallery_shutter_l", assetId: "window_shutters", side: -1, storey: 1, scale: 0.92 },
        { tag: "gallery_shutter_r", assetId: "window_shutters", side: 1, storey: 1, scale: 0.92 },
        { tag: "gallery_window_l", assetId: "window_thin", side: -1, storey: 0, scale: 0.92 },
        { tag: "gallery_window_r", assetId: "window_thin", side: 1, storey: 0, scale: 0.92 },
      ]);
      return withDetails(elevation, ...cornerRails(context));
    },
  },
  {
    id: "townhouse:bannered-twins",
    label: "Bannered Twin Dormer House",
    family: "domestic",
    prefab: "townhouse",
    detailBudget: 7,
    fits: fitsTownhouse,
    build: (context, base) => {
      const elevation = frontWindows(context, facadeBase(base, "straight"), [
        { tag: "bannered_window_l", assetId: "window_thin", side: -1, storey: 1, scale: 0.96 },
        { tag: "bannered_window_r", assetId: "window_thin", side: 1, storey: 1, scale: 0.96 },
      ]);
      return withDetails(
        elevation,
        dormer(context, "bannered_dormer_l", -1.18, 0.8),
        dormer(context, "bannered_dormer_r", 1.18, 0.8),
        banner(context, "bannered_banner", 2.35),
        lamp(context, "bannered_lamp_l", -1.5),
        lamp(context, "bannered_lamp_r", 1.65),
      );
    },
  },
];
