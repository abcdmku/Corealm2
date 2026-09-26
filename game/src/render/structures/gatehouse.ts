import type { PartPlacement } from "../buildings.js";
import { wallMountedBanner } from "../bannerPlacement.js";
import { mapAssets, variantPart, withDetails } from "./parts.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";

type PierSide = -1 | 1;
type GateFace = -1 | 1;

const LEFT: PierSide = -1;
const RIGHT: PierSide = 1;
const BACK: GateFace = -1;
const FRONT: GateFace = 1;

/** Gatehouse facade panels use the shared wall-face measurement from the prefab renderer. */
const GATE_WALL_FACE = 0.093;
/** Keep the mounting rail just clear of the masonry face to avoid z-fighting. */
const BANNER_FACE_CLEARANCE = 0.01;
const GATE_MODULE_METRES = 2;
const GATE_GAP_METRES = 4;

/** The classic base lamps sit just outside the four-metre passage jambs. */
const BASE_LAMP_X = 2.45;

/** The lamp pivot is its wall bracket; 12 cm past the panel pivot seats it on the outer face. */
const LAMP_FACE_OFFSET = -0.12;

/**
 * The classic gatehouse owns these four decorative tags. Everything else builds the two piers,
 * the covered four-metre passage, the deck, and its parapet, so recipes leave it byte-for-byte
 * unchanged.
 */
const BASE_DECOR_TAGS = new Set(["lamp0", "lamp1", "banner0", "banner1"]);

function bareGatehouse(base: readonly PartPlacement[]): PartPlacement[] {
  return base.filter((part) => !BASE_DECOR_TAGS.has(part.tag));
}

function compose(
  base: readonly PartPlacement[],
  ...details: readonly PartPlacement[]
): PartPlacement[] {
  return withDetails(bareGatehouse(base), ...details);
}

function fitsGatehouse({ width, depth }: StructureVariantContext): boolean {
  return width >= 8 && depth >= 3;
}

function faceZ(depth: number, inset: number, face: GateFace = FRONT): number {
  return face * (depth / 2 - inset);
}

/** The front and rear mounting rails sit on the matching outward face of the gatehouse. */
function bannerFaceZ(depth: number, face: GateFace): number {
  return face * (depth / 2 + GATE_WALL_FACE + BANNER_FACE_CLEARANCE);
}

/**
 * Match the gatehouse prefab's whole-module pier rule without importing its private geometry
 * helper. This returns the centre of either masonry pier, rather than treating the cloth width as
 * if it were a span along the facade. The result is symmetric for every supported width.
 */
function pierCenter(width: number, side: PierSide): number {
  const usable = Math.max(3 * GATE_MODULE_METRES, GATE_MODULE_METRES * Math.round(width / GATE_MODULE_METRES));
  const roomFor = Math.max(1, Math.floor((usable - GATE_MODULE_METRES) / (2 * GATE_MODULE_METRES)));
  const wanted = Math.floor((usable - GATE_GAP_METRES) / (2 * GATE_MODULE_METRES));
  const pierWidth = Math.max(1, Math.min(roomFor, wanted)) * GATE_MODULE_METRES;
  return side * (usable / 2 - pierWidth / 2);
}

function bannerAsset(assetId: string): "banner_1" | "banner_2" {
  return assetId === "banner_2" ? "banner_2" : "banner_1";
}

/**
 * Keep the plain recipe's stable base tags, but keep its banner pair on the same front elevation.
 * A gatehouse reads as one facade from the approach, so the two standards share one mounting
 * height, one outward direction, and the two pier centres. Other recipes intentionally strip
 * these four tags before adding their own face-aware detail packet.
 */
function balancedBaseDecor(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
): PartPlacement[] {
  return base.map((part) => {
    switch (part.tag) {
      case "lamp0":
        return {
          ...part,
          dx: -BASE_LAMP_X,
          dz: faceZ(context.depth, LAMP_FACE_OFFSET, FRONT),
          rotationY: 0,
        };
      case "lamp1":
        return {
          ...part,
          dx: BASE_LAMP_X,
          dz: faceZ(context.depth, LAMP_FACE_OFFSET, BACK),
          rotationY: Math.PI,
        };
      case "banner0":
        return wallMountedBanner(
          part.tag,
          bannerAsset(part.assetId),
          {
            dx: pierCenter(context.width, LEFT),
            dy: part.dy,
            dz: bannerFaceZ(context.depth, FRONT),
          },
          0,
          part.scale,
        );
      case "banner1":
        return wallMountedBanner(
          part.tag,
          bannerAsset(part.assetId),
          {
            dx: pierCenter(context.width, RIGHT),
            dy: part.dy,
            dz: bannerFaceZ(context.depth, FRONT),
          },
          0,
          part.scale,
        );
      default:
        return part;
    }
  });
}

/** A projecting banner with its mounting rail at the centre of a pier. */
function standard(
  tag: string,
  side: PierSide,
  assetId: "banner_1" | "banner_2",
  width: number,
  depth: number,
  face: GateFace = FRONT,
): PartPlacement {
  const scale = 1;
  return wallMountedBanner(
    `v_${tag}`,
    assetId,
    {
      dx: pierCenter(width, side),
      dy: 5.12,
      dz: bannerFaceZ(depth, face),
    },
    face === FRONT ? 0 : Math.PI,
    scale,
  );
}

/** A single projecting pennant centred on the gate's solid head course above the arch. */
function centeredHeadBanner(
  tag: string,
  assetId: "banner_1" | "banner_2",
  depth: number,
  face: GateFace = FRONT,
): PartPlacement {
  return wallMountedBanner(
    `v_${tag}`,
    assetId,
    {
      dx: 0,
      dy: 5.12,
      dz: bannerFaceZ(depth, face),
    },
    face === FRONT ? 0 : Math.PI,
    1,
  );
}

/** The measured pivot is the wall bracket; the lantern body projects away from that face. */
function lamp(
  tag: string,
  side: PierSide,
  depth: number,
  face: GateFace = FRONT,
): PartPlacement {
  return variantPart(
    tag,
    "lamp_wall",
    side * 2.75,
    4.05,
    faceZ(depth, LAMP_FACE_OFFSET, face),
    face === FRONT ? 0 : Math.PI,
  );
}

/** A compact flame fixed high on a pier, clear of the road and the parapet. */
function torch(
  tag: string,
  side: PierSide,
  depth: number,
  face: GateFace = FRONT,
): PartPlacement {
  return variantPart(
    tag,
    "torch",
    side * 2.7,
    4.55,
    faceZ(depth, -0.1, face),
    face === FRONT ? 0 : Math.PI,
  );
}

/**
 * One timber gallery rail on a pier. At 0.95 scale it spans x = 2.05..3.95 on the right pier and
 * the mirrored interval on the left. Its inner edge seats just beyond the masonry face.
 */
function hoarding(tag: string, side: PierSide, face: GateFace, depth: number): PartPlacement {
  return variantPart(
    tag,
    "balcony_straight",
    side * 3,
    4.95,
    faceZ(depth, 0.76, face),
    face === FRONT ? 0 : Math.PI,
    0.95,
  );
}

/** The upper pier panel directly beside the passage on one gate elevation. */
function watchPanel(
  base: readonly PartPlacement[],
  side: PierSide,
  face: GateFace,
): PartPlacement | undefined {
  const elevation = face === FRONT ? "pf1_" : "pb1_";
  const expectedSign = side;
  // Wider authored gates add complete pier modules outwards. The panel nearest the passage is
  // therefore the stable watch panel at every supported width, while matching the elevation tag
  // prevents a front insert from being paired with a rear wall.
  return base
    .filter((part) => part.tag.startsWith(elevation) && Math.sign(part.dx) === expectedSign)
    .sort((left, right) => Math.abs(left.dx) - Math.abs(right.dx))[0];
}

/**
 * An upper-storey watch opening fitted to a real apertured pier panel.
 *
 * This used to insert `window_thin` lifted 0.28 m. The kit's window panel is a hole 1.19 m wide
 * from a 1.05 m sill to a 2.69 m arched crown, and `window_thin` is 0.888 m wide reaching 2.90 m
 * once lifted - so it covered 61% of the aperture and left 0.15 m of open jamb down each side plus
 * the whole sill strip. From outside the gate you looked through the pier.
 *
 * `window_wide` at the default scale is the insert authored to this aperture (frame x +-0.6825,
 * y 1.016..2.742), which is what `buildings.ts:ringWindows` inserts and what `tower.ts` uses.
 */
function watchSlit(tag: string, panel: PartPlacement): PartPlacement {
  const outward = 0.01;
  return variantPart(
    tag,
    "window_wide",
    panel.dx + Math.sin(panel.rotationY) * outward,
    panel.dy,
    panel.dz + Math.cos(panel.rotationY) * outward,
    panel.rotationY,
  );
}

/** Convert the exact target panels before adding inserts, never paste a slit onto solid masonry. */
function austereWatch(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
): PartPlacement[] {
  const targets = [
    { side: LEFT, face: FRONT, tag: "watch_slit_left" },
    { side: RIGHT, face: BACK, tag: "watch_slit_right" },
  ] as const;
  const panels = targets
    .map((target) => ({ ...target, panel: watchPanel(base, target.side, target.face) }))
    .filter((target): target is typeof target & { panel: PartPlacement } => target.panel !== undefined);
  const panelTags = new Set(panels.map(({ panel }) => panel.tag));
  const converted = mapAssets(
    base,
    (part) => panelTags.has(part.tag) ? context.kit.wallWindow : undefined,
  );
  return withDetails(
    bareGatehouse(converted),
    ...panels.map(({ tag, panel }) => watchSlit(tag, panel)),
  );
}

export const GATEHOUSE_VARIANTS: readonly StructureVariantRecipe[] = [
  {
    id: "gatehouse:plain-parapet",
    label: "Plain Parapet",
    family: "fortification",
    prefab: "gatehouse",
    fits: fitsGatehouse,
    detailBudget: 0,
    build: (context, base) => balancedBaseDecor(context, base),
  },
  {
    id: "gatehouse:twin-standards",
    label: "Twin Standards",
    family: "fortification",
    prefab: "gatehouse",
    fits: fitsGatehouse,
    detailBudget: 2,
    build: (context, base) => compose(
      base,
      standard("standard_left", LEFT, "banner_1", context.width, context.depth, FRONT),
      standard("standard_right", RIGHT, "banner_1", context.width, context.depth, FRONT),
    ),
  },
  {
    id: "gatehouse:single-pennant",
    label: "Single Pennant",
    family: "fortification",
    prefab: "gatehouse",
    fits: fitsGatehouse,
    detailBudget: 1,
    build: (context, base) => compose(
      base,
      centeredHeadBanner("pennant_center", "banner_2", context.depth, FRONT),
    ),
  },
  {
    id: "gatehouse:lamplit-watch",
    label: "Lamplit Watch",
    family: "fortification",
    prefab: "gatehouse",
    fits: fitsGatehouse,
    detailBudget: 2,
    build: (context, base) => compose(
      base,
      lamp("lamp_left", LEFT, context.depth, FRONT),
      lamp("lamp_right", RIGHT, context.depth, BACK),
    ),
  },
  {
    id: "gatehouse:torchwatch",
    label: "Torchwatch",
    family: "fortification",
    prefab: "gatehouse",
    fits: fitsGatehouse,
    detailBudget: 2,
    build: (context, base) => compose(
      base,
      torch("torch_left", LEFT, context.depth, FRONT),
      torch("torch_right", RIGHT, context.depth, BACK),
    ),
  },
  {
    id: "gatehouse:front-hoarding",
    label: "Front Hoarding",
    family: "fortification",
    prefab: "gatehouse",
    fits: fitsGatehouse,
    detailBudget: 2,
    build: (context, base) => compose(
      base,
      hoarding("hoarding_front_left", LEFT, FRONT, context.depth),
      hoarding("hoarding_front_right", RIGHT, FRONT, context.depth),
    ),
  },
  {
    id: "gatehouse:double-hoarding",
    label: "Double Hoarding",
    family: "fortification",
    prefab: "gatehouse",
    fits: fitsGatehouse,
    detailBudget: 4,
    build: (context, base) => compose(
      base,
      hoarding("hoarding_front_left", LEFT, FRONT, context.depth),
      hoarding("hoarding_front_right", RIGHT, FRONT, context.depth),
      hoarding("hoarding_back_left", LEFT, BACK, context.depth),
      hoarding("hoarding_back_right", RIGHT, BACK, context.depth),
    ),
  },
  {
    id: "gatehouse:austere-watch",
    label: "Austere Watch",
    family: "fortification",
    prefab: "gatehouse",
    fits: fitsGatehouse,
    detailBudget: 2,
    build: austereWatch,
  },
];
