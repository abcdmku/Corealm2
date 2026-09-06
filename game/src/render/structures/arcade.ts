import { bayWallFace, type PartPlacement } from "../buildings.js";
import { wallMountedBanner } from "../bannerPlacement.js";
import { inset, variantPart, withDetails } from "./parts.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";

const CANOPY_DEPTH = 2;
const BRACE_SCALE = 0.92;
const BANNER_SCALE = 0.75;
const BANNER_Y = 2.38;
const BANNER_ASSET = "banner_1" as const;
// Kit wall panels place their outward face 0.093 m past the authored back-wall anchor.  The
// additional centimetre leaves the banner rail clear of the facade while its bracket projects
// into the covered bay.
const BANNER_WALL_FACE_OFFSET = 0.103;
/**
 * A window insert plugs its aperture at scale 1, which is what `buildings.ts:ringWindows` uses.
 *
 * The kit's window panel is a hole 1.20 m wide from a 1.04 m sill to a 2.71 m arched crown, and
 * `window_wide` is authored to it: frame x +-0.6825, y 1.016..2.742. At the 0.72 this file used,
 * the frame covered x +-0.491 and stopped at y 1.999, so every converted bay kept 0.2 m of open
 * jamb down each side and the whole arched head stood empty - you could see the far side of the
 * building through a shuttered window.
 */
/**
 * Keeps the lantern's head under the canopy and its plate on the wall, in every kit.
 *
 * `lamp_wall` is 1.337 m tall over a base at +0.082 with its mounting plate at local z -0.051.
 */
const LANTERN_SCALE = 0.55;
const LAMP_WALL_PLATE_Z = -0.051;
const LANTERN_Y = 2.10 - 0.082 * LANTERN_SCALE;
const WINDOW_INSERT_SCALE = 1;
const WINDOW_INSERT_OUT = 0.03;
const SHUTTER_SCALE = 0.72;
const SHUTTER_OUT = 0.08;
const SHUTTER_Y = 0.05;

function frontPosts(base: readonly PartPlacement[]): PartPlacement[] {
  return base
    .filter((part) => /^post\d+$/.test(part.tag))
    .sort((left, right) => left.dx - right.dx);
}

function bayCentres(base: readonly PartPlacement[]): number[] {
  const posts = frontPosts(base);
  return posts.slice(0, -1).map((post, index) => (post.dx + posts[index + 1]!.dx) / 2);
}

/**
 * Select a restrained, centred banner rhythm for the arcade back wall.  A one-bay arcade gets a
 * single centre mark; wider rows get the closest mirrored pair around the row midpoint.  Keeping
 * the pair on matching bays prevents the old every-other-bay run from reading as noisy signage.
 */
function bannerBays(base: readonly PartPlacement[]): readonly number[] {
  const centres = bayCentres(base);
  if (centres.length <= 1) return centres;

  const middle = (centres.length - 1) / 2;
  if (Number.isInteger(middle)) {
    const offset = Math.min(1, middle);
    return [centres[middle - offset]!, centres[middle + offset]!];
  }

  const left = Math.floor(middle);
  return [centres[left]!, centres[left + 1]!];
}

interface ArcadeBay {
  readonly index: number;
  readonly centre: number;
  readonly left: number;
  readonly right: number;
  readonly wall?: PartPlacement;
  readonly canopy?: PartPlacement;
}

function arcadeBays(base: readonly PartPlacement[]): ArcadeBay[] {
  const posts = frontPosts(base);
  return posts.slice(0, -1).map((post, index) => {
    const next = posts[index + 1]!;
    const prefix = `b${index}_`;
    return {
      index,
      centre: (post.dx + next.dx) / 2,
      left: post.dx,
      right: next.dx,
      wall: base.find((part) => part.tag === `${prefix}w`),
      canopy: base.find((part) => part.tag === `${prefix}o`),
    };
  });
}

function halfSpan(base: readonly PartPlacement[], context: StructureVariantContext): number {
  const posts = frontPosts(base);
  return posts.length === 0
    ? context.width / 2
    : Math.max(...posts.map((post) => Math.abs(post.dx)));
}

function withoutBaseLamps(base: readonly PartPlacement[]): PartPlacement[] {
  return base.filter((part) => part.assetId !== "lamp_wall");
}

function wallAttachment(
  anchor: PartPlacement,
  tag: string,
  assetId: string,
  out: number,
  dy: number,
  scale: number,
): PartPlacement {
  return variantPart(
    tag,
    assetId,
    anchor.dx + Math.sin(anchor.rotationY) * out,
    anchor.dy + dy,
    anchor.dz + Math.cos(anchor.rotationY) * out,
    anchor.rotationY,
    scale,
  );
}

/**
 * Change only the selected native wall panels. Every kit now has separate roof and footing
 * parts, so window conversion preserves their continuous profile and original aperture shape.
 */
function convertBackWindowBays(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  selected: readonly ArcadeBay[],
): PartPlacement[] {
  const selectedByIndex = new Set(selected.map((bay) => bay.index));
  return base.map((part) => {
    const match = /^b(\d+)_w$/.exec(part.tag);
    if (match === null) return part;
    const index = Number(match[1]);
    if (!selectedByIndex.has(index)) return part;
    return { ...part, assetId: context.kit.wallWindow };
  });
}

function shutteredBack(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
): PartPlacement[] {
  const bays = arcadeBays(base);
  const selected = bays.filter((_bay, index) => index % 2 === 0);
  const shell = convertBackWindowBays(context, base, selected);

  const details = selected.flatMap((bay) => {
    const anchor = bay.wall ?? bay.canopy;
    if (anchor === undefined) return [];
    return [
      wallAttachment(anchor, `window_${bay.index}`, "window_wide", WINDOW_INSERT_OUT, 0, WINDOW_INSERT_SCALE),
      wallAttachment(anchor, `shutters_${bay.index}`, "window_shutters", SHUTTER_OUT, SHUTTER_Y, SHUTTER_SCALE),
    ];
  });
  return withDetails(shell, ...details);
}

export const ARCADE_VARIANTS: readonly StructureVariantRecipe[] = [
  {
    id: "arcade:braced-bays",
    label: "Braced bays",
    family: "open_air",
    prefab: "arcade",
    detailBudget: 4,
    build: (context, base) => {
      const posts = frontPosts(base);
      const edge = halfSpan(base, context);
      const frontZ = -context.depth / 2 + CANOPY_DEPTH;
      const braces = posts.slice(1, -1)
        .filter((_post, index) => index % 2 === 0)
        .map((post, index) => variantPart(
          `brace_${index}`,
          "support_beam",
          inset(post.dx, edge, 0.1),
          -1.211 * BRACE_SCALE,
          frontZ - 0.1,
          Math.PI,
          BRACE_SCALE,
        ));
      return withDetails(base, ...braces);
    },
  },
  {
    id: "arcade:banner-run",
    label: "Banner run",
    family: "open_air",
    prefab: "arcade",
    detailBudget: 2,
    fits: (context) => context.width >= 8,
    build: (context, base) => {
      const backZ = -context.depth / 2;
      const banners = bannerBays(base).map((centre, index) => wallMountedBanner(
        `v_banner_${index}`,
        BANNER_ASSET,
        {
          // The rail is fixed to the back-wall bay centre; outwardYaw=0 turns the projecting
          // bracket into the +Z arcade, keeping the cloth perpendicular to the facade.
          dx: centre,
          dy: BANNER_Y,
          dz: backZ + BANNER_WALL_FACE_OFFSET,
        },
        0,
        BANNER_SCALE,
      ));
      return withDetails(base, ...banners);
    },
  },
  {
    id: "arcade:lantern-rhythm",
    label: "Lantern rhythm",
    family: "open_air",
    prefab: "arcade",
    detailBudget: 2,
    build: (context, base) => {
      const centres = bayCentres(base);
      const edge = halfSpan(base, context);
      const middle = Math.floor(centres.length / 2);
      const litBays = centres.length % 2 === 0
        ? [centres[middle - 1]!, centres[middle]!]
        : [centres[middle]!];
      // The native lantern spans y 2.10..2.835 at scale 0.55, below the canopy's hanging brackets.
      const backZ = -context.depth / 2;
      const lamps = litBays.map((centre, index) => variantPart(
        `lamp_${index}`,
        "lamp_wall",
        inset(centre, edge, 0.5),
        LANTERN_Y,
        backZ + bayWallFace(context.kit) - LAMP_WALL_PLATE_Z * LANTERN_SCALE,
        0,
        LANTERN_SCALE,
      ));
      return withDetails(withoutBaseLamps(base), ...lamps);
    },
  },
  {
    id: "arcade:shuttered-back",
    label: "Shuttered back wall",
    family: "open_air",
    prefab: "arcade",
    detailBudget: 8,
    build: shutteredBack,
  },
  {
    id: "arcade:narrow-back-windows",
    label: "Narrow back windows",
    family: "open_air",
    prefab: "arcade",
    detailBudget: 8,
    build: (context, base) => {
      const bays = arcadeBays(base);
      // Preserve the authored all-bay rhythm. As in the shuttered variant, only each bN_w
      // panel changes to a native aperture; its roof and footing stay in the shared bay frame.
      const shell = convertBackWindowBays(context, base, bays);
      const windows = bays.flatMap((bay) => {
        const anchor = bay.wall ?? bay.canopy;
        if (anchor === undefined) return [];
        // `window_thin` is an arrow loop, not a window: at 0.88 it covers x +-0.391 of a
        // +-0.597 aperture and tops out 0.35 m under the crown, so it holed every bay it was
        // supposed to glaze. The narrow reading now comes from the shutter, not from the frame.
        return [wallAttachment(
          anchor,
          `window_${bay.index}`,
          "window_wide",
          WINDOW_INSERT_OUT,
          0,
          WINDOW_INSERT_SCALE,
        )];
      });
      return withDetails(shell, ...windows);
    },
  },
  {
    id: "arcade:plain-colonnade",
    label: "Plain colonnade",
    family: "open_air",
    prefab: "arcade",
    detailBudget: 0,
    build: (_context, base) => withDetails(withoutBaseLamps(base)),
  },
];
