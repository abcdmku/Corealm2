import type { PartPlacement } from "../buildings.js";
import { wallMountedBanner, type BannerAssetId } from "../bannerPlacement.js";
import { inset, variantPart, withDetails } from "./parts.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";

/**
 * The porch shell's back wall is the local +Z-facing facade.  `wallMountedBanner` anchors the
 * rail on that face and turns the projecting banner a quarter-turn into the covered walk.  Keep
 * the measured 1 cm stand-off here so retained base banners and optional heralds share one mount.
 */
const PORCH_BACK_WALL_OFFSET = 0.103;

/**
 * Converted bays are glazed with the asset authored to the aperture, at the scale the base prefab
 * uses (`buildings.ts:ringWindows` inserts `window_wide` at 1).
 *
 * The kit's window panel is a 1.20 m wide hole from a 1.04 m sill to a 2.71 m arched crown.
 * `window_wide` at 1 covers x +-0.6825 and y 1.016..2.742, so it plugs it. Every recipe here used
 * to shrink the insert - 0.82, 0.9, 0.94, and `window_thin`, which is an arrow loop - and left the
 * arched head of the aperture standing open on a wall the player walks right under.
 */
const WINDOW_INSERT_SCALE = 1;

/**
 * How far behind the post line a front knee brace's foot sits.
 *
 * `support_beam` is a rake whose foot is at local z -0.118 and whose head is at 1.918. At the
 * old 0.55 the foot landed 0.21 m in front of the post it leans on and the head stopped 0.10 m
 * under the canopy soffit, so both braces floated in the bay carrying nothing - the geometry
 * linter reports them as a free assembly 2.20 m in the air.
 */
const FRONT_BRACE_SETBACK = 0.18;
// Native support_beam reaches y 2.920026 at its head. At scale 0.48 this seats that
// head against the shared 3.123 m canopy while its foot remains inside the supporting post/wall.
const BRACE_Y = 3.123 - 2.9200263023376465 * 0.48;

interface PorchFrame {
  readonly bays: number;
  readonly span: number;
  readonly backZ: number;
  readonly frontZ: number;
  readonly postX: number;
  readonly windowX: number;
  /** Centre of the bay that receives the single shuttered window. */
  readonly windowBayX: number;
  readonly windowBayIndex: number;
}

function frameFor(context: StructureVariantContext): PorchFrame {
  const bays = Math.min(3, Math.max(2, Math.round(context.width / 2)));
  const span = bays * 2;
  // A two-bay porch has no geometric middle bay. Keep the window wholly in the right-hand bay;
  // on a three-bay porch this resolves to the actual middle bay.
  const windowBayIndex = Math.floor(bays / 2);
  return {
    bays,
    span,
    backZ: -context.depth / 2,
    frontZ: -context.depth / 2 + 2,
    postX: inset(span / 2 - 0.2, span / 2, 0.18),
    windowX: inset(Math.min(1.15, span * 0.23), span / 2, 0.7),
    windowBayX: (windowBayIndex + 0.5) * 2 - span / 2,
    windowBayIndex,
  };
}

function bayCentre(frame: PorchFrame, index: number): number {
  return (index + 0.5) * 2 - frame.span / 2;
}

/** Resolve a facade detail's X coordinate to the exact two-metre bay it belongs to. */
function bayIndexAt(frame: PorchFrame, x: number): number {
  return Math.max(0, Math.min(frame.bays - 1, Math.floor((x + frame.span / 2) / 2)));
}

function pairedWindowBays(frame: PorchFrame): readonly number[] {
  return [...new Set([-frame.windowX, frame.windowX].map((x) => bayIndexAt(frame, x)))].sort(
    (left, right) => left - right,
  );
}

function omit(base: readonly PartPlacement[], ...tags: readonly string[]): PartPlacement[] {
  const removed = new Set(tags);
  return base.filter((part) => !removed.has(part.tag));
}

function movePart(
  base: readonly PartPlacement[],
  tag: string,
  at: Partial<Pick<PartPlacement, "dx" | "dy" | "dz" | "rotationY" | "scale">>,
): PartPlacement[] {
  return base.map((part) => part.tag === tag ? { ...part, ...at } : part);
}

/**
 * A porch banner hangs under the canopy, not over it.
 *
 * Both banner assets put their bbox top 0.844 above the pivot, so the inherited `dy 2.4, scale
 * 1.05` reached 3.285 m against a plaster canopy that tops out at 3.028 - the whole 1.69 m arm and
 * its finial stood on the roof. These are the numbers `arcade.ts` already proved.
 */
const BANNER_RAIL_Y = 2.38;
const BANNER_RAIL_SCALE = 0.75;

function backWallBanner(
  frame: PorchFrame,
  tag: string,
  assetId: BannerAssetId,
  dx: number,
  dy: number,
  scale: number,
): PartPlacement {
  return wallMountedBanner(
    tag,
    assetId,
    { dx, dy, dz: frame.backZ + PORCH_BACK_WALL_OFFSET },
    0,
    scale,
  );
}

/**
 * Slides the base lamp along the back wall, keeping the depth and height the base recipe set.
 *
 * Recipes used to re-place the lamp with their own `dz: frame.backZ + 0.35..0.42`, which is the
 * pre-`bayLamp` convention: in the stone kit that stands the bracket up to 0.24 m clear of the
 * panel behind it, and the geometry linter reports the lamp as a free-floating assembly 1.49 m in
 * the air. A variant's business is which bay the lamp lights, not how far off the wall it sits.
 */
function slideLamp(base: readonly PartPlacement[], dx: number): PartPlacement[] {
  return movePart(base, "lamp", { dx });
}

/** Every porch banner, retained or added, hangs from the one rail height that clears the canopy. */
function canopyBanner(
  frame: PorchFrame,
  tag: string,
  assetId: BannerAssetId,
  dx: number,
): PartPlacement {
  return backWallBanner(frame, tag, assetId, dx, BANNER_RAIL_Y, BANNER_RAIL_SCALE);
}

function bannerAssetForKit(context: StructureVariantContext): BannerAssetId {
  // Keep the porch's heraldry aligned with the regional gate treatment: timber uses its blue
  // pennant, while plaster and stone use the red standard. A paired treatment always reuses this
  // one choice for both rails.
  return context.kitId === "timber" ? "banner_2" : "banner_1";
}

/** Re-seat any retained base banner after a recipe remaps its asset, keeping the rail contract. */
function remountBaseBanner(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  assetOverride?: BannerAssetId,
): PartPlacement[] {
  const frame = frameFor(context);
  return base.map((part) => {
    if (part.tag !== "banner") return part;
    const assetId = assetOverride
      ?? (part.assetId === "banner_2" ? "banner_2" : "banner_1");
    return canopyBanner(frame, part.tag, assetId, part.dx);
  });
}

function frontBraces(frame: PorchFrame, prefix = "brace"): readonly PartPlacement[] {
  return [-1, 1].map((side, index) => variantPart(
    `${prefix}_${index}`,
    "support_beam",
    frame.postX * side,
    BRACE_Y,
    frame.frontZ - FRONT_BRACE_SETBACK,
    Math.PI,
    0.48,
  ));
}

function rearBraces(frame: PorchFrame): readonly PartPlacement[] {
  return [-1, 1].map((side, index) => variantPart(
    `rear_brace_${index}`,
    "support_beam",
    frame.postX * side,
    BRACE_Y,
    frame.backZ + 0.08,
    0,
    0.48,
  ));
}

/**
 * Make the shuttered bay a real opening in the exact base bay it occupies.
 *
 * Covered bays have separate wall, canopy and footing parts in every kit. Replace only the wall:
 * mixing the old integral plaster canopy with a different roof over a window produced a stepped
 * roofline, a wedge at the panel joint and a missing footing where its tag became the replacement
 * roof. Native window panels now share their neighbours' wall frame and keep the original aperture.
 */
function convertWindowBays(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  _frame: PorchFrame,
  selectedBayIndices: readonly number[],
): PartPlacement[] {
  const selected = new Set(selectedBayIndices);
  return base.map((part) => {
    const match = /^b(\d+)_w$/.exec(part.tag);
    if (match === null || !selected.has(Number(match[1]))) return part;
    return { ...part, assetId: context.kit.wallWindow };
  });
}

function shutteredBayBase(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  frame: PorchFrame,
): PartPlacement[] {
  return convertWindowBays(context, base, frame, [frame.windowBayIndex]);
}

function shutteredBayWindows(frame: PorchFrame): readonly PartPlacement[] {
  return [
    // Keep the glass/frame explicit so catalog invariant repair never has to synthesize a backing.
    variantPart(
      "centre_window",
      "window_wide",
      frame.windowBayX,
      0,
      frame.backZ + 0.035,
      0,
      WINDOW_INSERT_SCALE,
    ),
    variantPart(
      "centre_shutters",
      "window_shutters",
      frame.windowBayX,
      0,
      frame.backZ + 0.045,
      0,
      0.82,
    ),
  ];
}

export const PORCH_VARIANTS: readonly StructureVariantRecipe[] = [
  {
    id: "porch:braced-lantern",
    label: "Braced lantern porch",
    family: "open_air",
    prefab: "porch",
    detailBudget: 2,
    build: (context, base) => {
      const frame = frameFor(context);
      const bannered = remountBaseBanner(context, base, "banner_2");
      const lit = slideLamp(bannered, 0);
      return withDetails(lit, ...frontBraces(frame));
    },
  },
  {
    id: "porch:shuttered-bay",
    label: "Shuttered bay porch",
    family: "open_air",
    prefab: "porch",
    detailBudget: 3,
    build: (context, base) => {
      const frame = frameFor(context);
      const converted = remountBaseBanner(context, shutteredBayBase(context, base, frame));
      const lit = slideLamp(converted, -frame.windowX - 0.55);
      return withDetails(
        lit,
        ...shutteredBayWindows(frame),
      );
    },
  },
  {
    id: "porch:paired-windows",
    label: "Paired-window porch",
    family: "open_air",
    prefab: "porch",
    detailBudget: 2,
    build: (context, base) => {
      const frame = frameFor(context);
      const plain = omit(base, "banner");
      const windowBays = pairedWindowBays(frame);
      const windowXs = windowBays.map((index) => bayCentre(frame, index));
      const converted = convertWindowBays(context, plain, frame, windowBays);
      return withDetails(
        slideLamp(converted, 0),
        variantPart("window_l", "window_wide", windowXs[0]!, 0, frame.backZ + 0.035, 0, WINDOW_INSERT_SCALE),
        variantPart("window_r", "window_wide", windowXs[1]!, 0, frame.backZ + 0.035, 0, WINDOW_INSERT_SCALE),
      );
    },
  },
  {
    id: "porch:heralded",
    label: "Heralded porch",
    family: "open_air",
    prefab: "porch",
    // A matched pair reads as civic heraldry, so keep it off cookhouses and ordinary shop porches.
    fits: (context) => context.width >= 8,
    detailBudget: 4,
    build: (context, base) => {
      const frame = frameFor(context);
      const heraldAsset = bannerAssetForKit(context);
      const unbannered = omit(base, "banner");
      const lit = slideLamp(unbannered, 0);
      return withDetails(
        lit,
        // The rail is the wall anchor. Both standards project into the +Z covered walk, so neither
        // uses the old cloth-width compensation that placed a banner span along the facade.
        canopyBanner(frame, "v_banner_l", heraldAsset, -frame.postX),
        canopyBanner(frame, "v_banner_r", heraldAsset, frame.postX),
        ...frontBraces(frame, "herald_brace"),
      );
    },
  },
  {
    id: "porch:watch-window",
    label: "Watch-window porch",
    family: "open_air",
    prefab: "porch",
    detailBudget: 4,
    build: (context, base) => {
      const frame = frameFor(context);
      const plain = omit(base, "banner");
      const converted = convertWindowBays(context, plain, frame, [frame.windowBayIndex]);
      const lit = slideLamp(converted, -frame.postX + 0.55);
      return withDetails(
        lit,
        variantPart(
          "watch_glass",
          "window_wide",
          frame.windowBayX,
          0,
          frame.backZ + 0.035,
          0,
          WINDOW_INSERT_SCALE,
        ),
        variantPart(
          "watch_shutters",
          "window_shutters",
          frame.windowBayX,
          0,
          frame.backZ + 0.055,
          0,
          0.82,
        ),
        ...rearBraces(frame),
      );
    },
  },
  {
    id: "porch:austere",
    label: "Austere porch",
    family: "open_air",
    prefab: "porch",
    detailBudget: 0,
    build: (_context, base) => omit(base, "lamp", "banner"),
  },
];
