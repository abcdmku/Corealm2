import type { PartPlacement } from "../buildings.js";
import { inset, mapAssets, variantPart, withDetails } from "./parts.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";

const FRONT_FACE = 2;
const FRONT_YAW = Math.PI;
const WINDOW_SHUTTER_SCALE = 0.9;

interface TaggedBay {
  readonly part: PartPlacement;
  readonly side: number;
  readonly index: number;
}

interface DormerSpec {
  /** Distance along the ridge from its centre. */
  readonly along: number;
  /** -1 is the front/left slope, +1 the back/right slope. */
  readonly slope: -1 | 1;
}

function fitsCottage(context: StructureVariantContext): boolean {
  const long = Math.max(context.width, context.depth);
  const short = Math.min(context.width, context.depth);
  return Math.abs(long - 6) < 0.01 && Math.abs(short - 4) < 0.01;
}

function taggedBays(base: readonly PartPlacement[], prefix: "w" | "g"): TaggedBay[] {
  const pattern = prefix === "w" ? /^w([0-3])_(\d+)$/ : /^g([0-3])_(\d+)$/;
  const bays: TaggedBay[] = [];
  for (const part of base) {
    const match = pattern.exec(part.tag);
    if (match === null) continue;
    bays.push({ part, side: Number(match[1]), index: Number(match[2]) });
  }
  return bays;
}

function orderedBays(
  base: readonly PartPlacement[],
  prefix: "w" | "g",
  preferredSides: readonly number[],
): TaggedBay[] {
  const ranks = new Map(preferredSides.map((side, index) => [side, index]));
  return taggedBays(base, prefix).sort((left, right) => (
    (ranks.get(left.side) ?? preferredSides.length) - (ranks.get(right.side) ?? preferredSides.length)
    || left.index - right.index
  ));
}

function withoutFoundationPlants(base: readonly PartPlacement[]): PartPlacement[] {
  return base.filter((part) => !part.tag.startsWith("foundation_plant_"));
}

function withoutFoundationGreenery(base: readonly PartPlacement[]): PartPlacement[] {
  return base.filter((part) => !part.tag.startsWith("foundation_"));
}

function wallAttachment(
  wall: PartPlacement,
  tag: string,
  assetId: string,
  out = 0.04,
  along = 0,
  dy = 0,
  scale = 1,
): PartPlacement {
  const yaw = wall.rotationY;
  return variantPart(
    tag,
    assetId,
    wall.dx + Math.sin(yaw) * out + Math.cos(yaw) * along,
    wall.dy + dy,
    wall.dz + Math.cos(yaw) * out - Math.sin(yaw) * along,
    yaw,
    scale,
  );
}

function doorWall(context: StructureVariantContext, base: readonly PartPlacement[]): PartPlacement {
  const wall = orderedBays(base, "w", [FRONT_FACE])
    .find((bay) => bay.side === FRONT_FACE && bay.part.assetId === context.kit.wallDoor)?.part;
  if (wall === undefined) throw new Error("Cottage variant cannot find its local -Z door wall");
  return wall;
}

function doorFrame(context: StructureVariantContext, base: readonly PartPlacement[]): PartPlacement {
  return wallAttachment(doorWall(context, base), "door_frame", "door_frame_round", 0.05, 0, 0, 0.94);
}

function entryLamp(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  side: -1 | 1,
): PartPlacement {
  // Keep the whole native bracket and chain together. After world-position rounding its bottom
  // is 2.057 m; the shortened projection clears the actual sloping eave in all three kits.
  // The plate's local z=-0.050977 puts its back 5 mm outside the wall face at z=0.093.
  return wallAttachment(doorWall(context, base), "entry_lamp", "lamp_wall", 0.121, side * 1.18, 2.02, 0.45);
}

function windowInserts(
  base: readonly PartPlacement[],
  count: number,
  preferredSides: readonly number[] = [FRONT_FACE, 1, 3, 0],
): PartPlacement[] {
  return orderedBays(base, "g", preferredSides).slice(0, count).map((bay) => bay.part);
}

/** Shutters are wood only, so they always sit over an existing glass insert. */
function shuttersFor(
  base: readonly PartPlacement[],
  count: number,
  tagPrefix: string,
  preferredSides?: readonly number[],
): PartPlacement[] {
  return windowInserts(base, count, preferredSides).map((window, index) => wallAttachment(
    window,
    `${tagPrefix}_shutters_${index}`,
    "window_shutters",
    0,
    // The shutter mesh is 9.7 cm off-centre at scale 1.
    0.048,
    0,
    WINDOW_SHUTTER_SCALE,
  ));
}

function narrowShutteredWindows(
  base: readonly PartPlacement[],
  count: number,
  tagPrefix: string,
  preferredSides?: readonly number[],
): { readonly elevation: PartPlacement[]; readonly shutters: PartPlacement[] } {
  const targets = windowInserts(base, count, preferredSides);
  const tags = new Set(targets.map((part) => part.tag));
  const elevation = mapAssets(base, (part) => tags.has(part.tag) ? "window_thin" : undefined);
  return {
    elevation,
    shutters: targets.map((window, index) => wallAttachment(
      window,
      `${tagPrefix}_shutters_${index}`,
      "window_shutters",
      0,
      0.048,
      0,
      WINDOW_SHUTTER_SCALE,
    )),
  };
}

function roofBase(base: readonly PartPlacement[]): number {
  return base.find((part) => part.tag === "roof")?.dy ?? 3.123;
}

function roofRunsAlongZ(context: StructureVariantContext): boolean {
  return context.width < context.depth;
}

/**
 * `roof_dormer` faces local +X. The measured placement puts its glass sill into the tile slope;
 * the old prefab yaw pointed the glass along the ridge and buried one side of the dormer.
 */
function placedDormer(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  tag: string,
  spec: DormerSpec,
): PartPlacement {
  const alongZ = roofRunsAlongZ(context);
  const ridgeHalf = (alongZ ? context.depth : context.width) / 2;
  const along = inset(spec.along, ridgeHalf, 1.25);
  const stone = context.kitId === "stone";
  // Exact triangle checks put both the glass sill and rear roof seam on the tiles at these offsets.
  // Sliding the plaster dormer inward to 0.25 m keeps its sill close but buries the rear seam 0.4 m.
  const scale = stone ? 0.8 : 1;
  const cross = spec.slope * (stone ? 0.58 : 0.5);
  const yaw = alongZ
    ? (spec.slope < 0 ? Math.PI : 0)
    : (spec.slope < 0 ? Math.PI / 2 : -Math.PI / 2);
  return variantPart(
    tag,
    "roof_dormer",
    alongZ ? cross : along,
    roofBase(base) + (stone ? 0.58 : 0.19),
    alongZ ? along : cross,
    yaw,
    scale,
  );
}

/** Keep timber's stable `dormer` tag, and append only any additional dormers. */
function withDormers(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  tagPrefix: string,
  specs: readonly DormerSpec[],
): PartPlacement[] {
  const placements = specs.map((spec, index) => placedDormer(context, base, `${tagPrefix}_${index}`, spec));
  const existing = base.some((part) => part.tag === "dormer");
  const elevation = existing
    ? base.map((part) => part.tag === "dormer" ? { ...placements[0]!, tag: part.tag } : part)
    : [...base];
  return withDetails(elevation, ...placements.slice(existing ? 1 : 0));
}

function moveChimney(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  alongSign: -1 | 1,
  slopeSign: -1 | 1,
): PartPlacement[] {
  const alongZ = roofRunsAlongZ(context);
  const alongHalf = (alongZ ? context.depth : context.width) / 2;
  const crossHalf = (alongZ ? context.width : context.depth) / 2;
  const along = alongSign * inset(alongHalf * 0.52, alongHalf, 0.6);
  const cross = slopeSign * Math.max(0.45, crossHalf - 0.55);
  return base.map((part) => part.tag === "chimney" ? {
    ...part,
    dx: alongZ ? cross : along,
    dz: alongZ ? along : cross,
  } : part);
}

function moveVine(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  preferredSides: readonly number[],
): PartPlacement[] {
  const wall = orderedBays(base, "w", preferredSides)
    .find((bay) => bay.part.assetId === context.kit.wall)?.part;
  if (wall === undefined) return [...base];
  const placement = wallAttachment(wall, "curated_vine", "vine_1", 0.08, 0, 1.75, 0.74);
  return base.map((part) => part.tag === "foundation_vine" ? { ...placement, tag: part.tag } : part);
}

function sideBench(context: StructureVariantContext, side: -1 | 1, z = 0): PartPlacement {
  return variantPart(
    "side_bench",
    "bench",
    side * (context.width / 2 + 0.24),
    0.008,
    inset(z, context.depth / 2, 1.2),
    side < 0 ? -Math.PI / 2 : Math.PI / 2,
    0.85,
  );
}

function flowerCorners(context: StructureVariantContext, tagPrefix: string): PartPlacement[] {
  const x = inset(context.width / 2 - 0.55, context.width / 2, 0.35);
  const z = -context.depth / 2 - 0.2;
  return [
    variantPart(`${tagPrefix}_a`, "flower_a_group", -x, 0.012, z, 0.35, 0.32),
    variantPart(`${tagPrefix}_b`, "flower_b_group", x, 0.018, z, -0.5, 0.28),
  ];
}

/** Four 2.78 m logs, measured from the roof-log pivot, tucked beneath the rear eave. */
function woodPile(context: StructureVariantContext, side: -1 | 1): PartPlacement[] {
  const scale = 0.26;
  const drop = -3.849 * scale + 0.001;
  const thick = 1.149 * scale;
  const x = side * inset(context.width * 0.18, context.width / 2, 1.45);
  const z = context.depth / 2 + 0.18;
  return [
    variantPart("wood_0", "roof_log", x, drop, z - thick, Math.PI / 2, scale),
    variantPart("wood_1", "roof_log", x, drop, z, Math.PI / 2, scale),
    variantPart("wood_2", "roof_log", x, drop, z + thick, Math.PI / 2, scale),
    variantPart("wood_3", "roof_log", x + side * 0.1, drop + thick * 0.86, z + thick / 2, Math.PI / 2, scale),
  ];
}

export const COTTAGE_VARIANTS: readonly StructureVariantRecipe[] = [
  {
    id: "cottage:plaster-shuttered-hearth",
    label: "Shuttered plaster hearth",
    family: "domestic",
    prefab: "cottage",
    kits: ["plaster"],
    detailBudget: 4,
    fits: fitsCottage,
    build: (context, base) => {
      const elevation = withoutFoundationPlants(moveChimney(context, base, -1, 1));
      return withDetails(
        elevation,
        ...shuttersFor(elevation, 2, "hearth", [2, 1, 3, 0]),
        doorFrame(context, elevation),
        sideBench(context, 1, 0.35),
      );
    },
  },
  {
    id: "cottage:plaster-garden-dormer",
    label: "Garden dormer cottage",
    family: "domestic",
    prefab: "cottage",
    kits: ["plaster"],
    detailBudget: 4,
    fits: fitsCottage,
    build: (context, base) => {
      const garden = moveVine(context, withoutFoundationPlants(base), [3, 1, 0]);
      // Keep the gable solid. A paired roof dormer gives the cottage a roofline accent without
      // pasting a freestanding window onto `roof_gable_brick`.
      const roofline = withDormers(context, garden, "garden_dormer", [
        { along: -0.72, slope: -1 },
        { along: 0.72, slope: 1 },
      ]);
      return withDetails(
        roofline,
        ...flowerCorners(context, "garden_flower"),
      );
    },
  },
  {
    id: "cottage:plaster-lantern-nook",
    label: "Lantern-window cottage",
    family: "domestic",
    prefab: "cottage",
    kits: ["plaster"],
    detailBudget: 4,
    fits: fitsCottage,
    build: (context, base) => {
      const clean = withoutFoundationPlants(moveChimney(context, base, 1, -1));
      const windows = narrowShutteredWindows(clean, 2, "lantern", [2, 3, 1, 0]);
      return withDetails(
        windows.elevation,
        ...windows.shutters,
        entryLamp(context, windows.elevation, -1),
        sideBench(context, -1, -0.35),
      );
    },
  },
  {
    id: "cottage:plaster-twin-dormer",
    label: "Twin-dormer woodstore",
    family: "domestic",
    prefab: "cottage",
    kits: ["plaster"],
    detailBudget: 6,
    fits: fitsCottage,
    build: (context, base) => {
      const clean = withoutFoundationGreenery(moveChimney(context, base, 1, 1));
      const roofline = withDormers(context, clean, "plaster_twin", [
        { along: -1.28, slope: -1 },
        { along: 1.28, slope: -1 },
      ]);
      return withDetails(roofline, ...woodPile(context, -1));
    },
  },
  {
    id: "cottage:timber-sawyer-stack",
    label: "Sawyer's ridge cottage",
    family: "domestic",
    prefab: "cottage",
    kits: ["timber"],
    detailBudget: 5,
    fits: fitsCottage,
    build: (context, base) => {
      const clean = withoutFoundationGreenery(moveChimney(context, base, -1, 1));
      const roofline = withDormers(context, clean, "sawyer", [{ along: -0.72, slope: -1 }]);
      return withDetails(
        roofline,
        ...woodPile(context, 1),
      );
    },
  },
  {
    id: "cottage:timber-twin-dormer",
    label: "Twin-dormer timber cottage",
    family: "domestic",
    prefab: "cottage",
    kits: ["timber"],
    detailBudget: 4,
    fits: fitsCottage,
    build: (context, base) => {
      const roofline = withDormers(context, base, "timber_twin", [
        { along: -1.28, slope: -1 },
        { along: 1.28, slope: -1 },
      ]);
      return withDetails(
        roofline,
        ...shuttersFor(roofline, 2, "timber_twin", [2, 1, 3, 0]),
        entryLamp(context, roofline, 1),
      );
    },
  },
  {
    id: "cottage:timber-vine-bench",
    label: "Vine-side timber cottage",
    family: "domestic",
    prefab: "cottage",
    kits: ["timber"],
    detailBudget: 4,
    fits: fitsCottage,
    build: (context, base) => {
      // -1.56 keeps the stack clear of `vine_dormer`, which sits at along +0.68 on the same slope.
      const garden = moveVine(context, withoutFoundationPlants(moveChimney(context, base, -1, -1)), [1, 3, 0]);
      const roofline = withDormers(context, garden, "vine_dormer", [{ along: 0.68, slope: -1 }]);
      return withDetails(
        roofline,
        sideBench(context, 1, -0.3),
        ...flowerCorners(context, "vine_flower"),
      );
    },
  },
  {
    id: "cottage:timber-back-dormer",
    label: "Back-dormer timber cottage",
    family: "domestic",
    prefab: "cottage",
    kits: ["timber"],
    detailBudget: 4,
    fits: fitsCottage,
    build: (context, base) => {
      const roofline = withDormers(context, moveChimney(context, base, -1, -1), "back_dormer", [
        { along: 0.55, slope: 1 },
      ]);
      const windows = narrowShutteredWindows(roofline, 1, "back_dormer", [2, 1, 3, 0]);
      return withDetails(
        windows.elevation,
        ...windows.shutters,
        doorFrame(context, windows.elevation),
        variantPart("door_bucket", "bucket_wood", 1.45, 0.006, -context.depth / 2 - 0.22, -0.3, 0.9),
      );
    },
  },
  {
    id: "cottage:stone-shuttered-croft",
    label: "Shuttered stone croft",
    family: "domestic",
    prefab: "cottage",
    kits: ["stone"],
    detailBudget: 5,
    fits: fitsCottage,
    build: (context, base) => {
      const clean = withoutFoundationPlants(moveChimney(context, base, -1, 1));
      const roofline = withDormers(context, clean, "croft_dormer", [{ along: -0.55, slope: -1 }]);
      const windows = narrowShutteredWindows(roofline, 2, "stone_croft", [2, 1, 3, 0]);
      return withDetails(
        windows.elevation,
        ...windows.shutters,
        sideBench(context, -1, 0.3),
      );
    },
  },
  {
    id: "cottage:stone-quarry-dormer",
    label: "Quarry dormer cottage",
    family: "domestic",
    prefab: "cottage",
    kits: ["stone"],
    detailBudget: 4,
    fits: fitsCottage,
    build: (context, base) => {
      const garden = moveVine(context, withoutFoundationPlants(base), [3, 1, 0]);
      const roofline = withDormers(context, garden, "quarry_dormer", [{ along: -0.55, slope: -1 }]);
      return withDetails(
        roofline,
        ...flowerCorners(context, "quarry_flower"),
      );
    },
  },
  {
    id: "cottage:stone-woodstore",
    label: "Stone woodstore cottage",
    family: "domestic",
    prefab: "cottage",
    kits: ["stone"],
    detailBudget: 7,
    fits: fitsCottage,
    build: (context, base) => {
      // The chimney goes on the slope the dormers are NOT on; at (1, -1) it was driven straight
      // through `woodstore_dormer_1`.
      const clean = withoutFoundationGreenery(moveChimney(context, base, 1, 1));
      // +-1.28, not +-0.72. The stone kit draws dormers at 0.8, so each is 1.951 m wide along
      // the ridge and a 1.44 m separation drove the pair 0.511 m through each other.
      const roofline = withDormers(context, clean, "woodstore_dormer", [
        { along: -1.28, slope: -1 },
        { along: 1.28, slope: -1 },
      ]);
      return withDetails(
        roofline,
        ...woodPile(context, -1),
        variantPart("woodstore_bucket", "bucket_wood", 1.4, 0.006, context.depth / 2 + 0.18, 0.4, 0.86),
      );
    },
  },
  {
    id: "cottage:stone-lantern-gables",
    label: "Lantern-gabled stone cottage",
    family: "domestic",
    prefab: "cottage",
    kits: ["stone"],
    detailBudget: 6,
    fits: fitsCottage,
    build: (context, base) => {
      const clean = withoutFoundationPlants(base);
      const roofline = withDormers(context, clean, "lantern_dormer", [
        { along: -1.28, slope: -1 },
        { along: 1.28, slope: -1 },
      ]);
      return withDetails(
        roofline,
        ...shuttersFor(roofline, 2, "stone_lantern", [2, 3, 1, 0]),
        entryLamp(context, roofline, -1),
        sideBench(context, 1, -0.25),
      );
    },
  },
];
