import type { PartPlacement } from "../buildings.js";
import { inset, mapAssets, variantPart, withDetails } from "./parts.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";

const STOREY_METRES = 3.123;
const CHIMNEY_SCALE = 0.9;
const SHUTTER_OUT_METRES = 0.03;
const SHUTTER_BACKING_INSET_METRES = 0.025;

function fitsWorkshop(context: StructureVariantContext): boolean {
  return context.width >= 6 && context.depth >= 4;
}

/** The base forge owns one lamp. Recipes relocate it instead of quietly doubling the light. */
function curatedBase(base: readonly PartPlacement[], removeSupports = false): PartPlacement[] {
  return base.filter((part) => (
    part.tag !== "lamp"
    && (!removeSupports || (part.tag !== "strut0" && part.tag !== "strut1"))
  ));
}

function sideX(context: StructureVariantContext, sign: -1 | 1, margin = 0.55): number {
  return inset(sign * context.width / 2, context.width / 2, margin);
}

function rearZ(context: StructureVariantContext, margin = 0.5): number {
  return inset(-context.depth / 2 + margin, context.depth / 2, margin);
}

function frontZ(context: StructureVariantContext): number {
  return inset(context.depth / 2 - 0.2, context.depth / 2, 0.2);
}

function chimney(context: StructureVariantContext, tag: string, sign: -1 | 1): PartPlacement {
  return variantPart(
    tag,
    "chimney",
    inset(sign * context.width * 0.27, context.width / 2, 0.85),
    STOREY_METRES - 0.35,
    rearZ(context, 0.72),
    0,
    CHIMNEY_SCALE,
  );
}

function lamp(context: StructureVariantContext, sign: -1 | 0 | 1): PartPlacement {
  return variantPart(
    "lamp",
    "lamp_wall",
    sign === 0 ? 0 : inset(sign * context.width * 0.24, context.width / 2, 0.8),
    2.1,
    rearZ(context, 0.4),
    0,
    1.08,
  );
}

function crate(context: StructureVariantContext, tag: string, sign: -1 | 1, assetId = "crate_metal"): PartPlacement {
  return variantPart(
    tag,
    assetId,
    sideX(context, sign, 0.48),
    0,
    rearZ(context, 0.46),
    sign < 0 ? 0.35 : -0.35,
    0.72,
  );
}

/** Seat a compact tool rack against the solid rear wall, clear of the working centre and mouth. */
function toolRack(context: StructureVariantContext, sign: -1 | 1): PartPlacement {
  return variantPart(
    "rear_tool_rack",
    "weapon_rack",
    inset(sign * context.width * 0.3, context.width / 2, 0.95),
    0,
    rearZ(context, 0.42),
    0,
    0.8,
  );
}

/**
 * One raking prop against a side wall of the open mouth.
 *
 * `dzBack` moves it along the wall rather than in off it. The pair of "inner" braces used to be
 * placed by insetX alone, which stood them 0.19 m clear of both the wall and the outer brace: two
 * posts in mid-air in the middle of the forge mouth, touching nothing. A prop leans on something.
 */
function brace(
  context: StructureVariantContext,
  tag: string,
  sign: -1 | 1,
  insetX: number,
  scale: number,
  dzBack = 0,
): PartPlacement {
  return variantPart(
    tag,
    "support_beam",
    sideX(context, sign, insetX),
    -1.211 * scale,
    frontZ(context) - dzBack,
    Math.PI,
    scale,
  );
}

function rearSideWall(base: readonly PartPlacement[], side: 1 | 3): PartPlacement | undefined {
  const prefix = `w${side}_`;
  return base
    .filter((part) => part.tag.startsWith(prefix))
    .reduce<PartPlacement | undefined>((rear, part) => (
      rear === undefined || part.dz < rear.dz ? part : rear
    ), undefined);
}

function isWindowInsert(part: PartPlacement): boolean {
  return part.assetId === "window_wide" || part.assetId === "window_thin";
}

function offsetFromWall(wall: PartPlacement, out: number): { dx: number; dz: number } {
  return {
    dx: wall.dx + Math.sin(wall.rotationY) * out,
    dz: wall.dz + Math.cos(wall.rotationY) * out,
  };
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Turn selected side modules into real apertures and fit a full-size insert. Plain replacements
 * remove the old glass and timber overlay; shutter replacements keep or add the glass backing.
 */
function sideInserts(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  inserts: readonly { side: 1 | 3; assetId: "window_shutters" | "window_wide"; tag: string }[],
): { shell: PartPlacement[]; details: PartPlacement[] } {
  const targets = inserts
    .map((insert) => ({ insert, wall: rearSideWall(base, insert.side) }))
    .filter((entry): entry is { insert: typeof inserts[number]; wall: PartPlacement } => entry.wall !== undefined);
  const wallTags = new Set(targets.map((entry) => entry.wall.tag));
  const shutterBackingTags = new Set(
    targets
      .filter(({ insert }) => insert.assetId === "window_shutters")
      .map(({ wall }) => `g${wall.tag.slice(1)}`),
  );
  const companionTags = new Set<string>();
  for (const tag of wallTags) {
    const suffix = tag.slice(1);
    // A shutter is an overlay. Keep its existing real window insert as the backing; if the bay was
    // solid, the detail path below adds one explicitly. Non-shutter replacements still remove
    // their old insert before adding the requested window, so they never double up.
    if (!shutterBackingTags.has(`g${suffix}`)) companionTags.add(`g${suffix}`);
    companionTags.add(`f${suffix}`);
  }
  const shell = mapAssets(
    base.filter((part) => !companionTags.has(part.tag)),
    (part) => wallTags.has(part.tag) ? context.kit.wallWindow : undefined,
  ).map((part) => {
    if (!shutterBackingTags.has(part.tag) || !isWindowInsert(part)) return part;
    // Match the backing depth used by the invariant, but keep this true insert in the recipe so
    // the catalog never needs to synthesize one for the shuttered forge.
    const offset = offsetFromWall(part, -SHUTTER_BACKING_INSET_METRES);
    return { ...part, dx: rounded(offset.dx), dz: rounded(offset.dz) };
  });
  const details: PartPlacement[] = [];
  for (const { insert, wall } of targets) {
    if (insert.assetId === "window_shutters") {
      const backingTag = `g${wall.tag.slice(1)}`;
      const hasBacking = base.some((part) => part.tag === backingTag && isWindowInsert(part));
      if (!hasBacking) {
        const offset = offsetFromWall(
          wall,
          SHUTTER_OUT_METRES - SHUTTER_BACKING_INSET_METRES,
        );
        details.push(variantPart(
          `${insert.tag}_window`,
          "window_wide",
          offset.dx,
          wall.dy,
          offset.dz,
          wall.rotationY,
          1,
        ));
      }
    }
    const offset = offsetFromWall(wall, SHUTTER_OUT_METRES);
    details.push(variantPart(
      insert.tag,
      insert.assetId,
      offset.dx,
      wall.dy,
      offset.dz,
      wall.rotationY,
      1,
    ));
  }
  return { shell, details };
}

export const FORGE_VARIANTS: readonly StructureVariantRecipe[] = [
  {
    id: "forge:stack-left",
    label: "Left-stack Forge",
    family: "workshop",
    prefab: "forge",
    detailBudget: 4,
    fits: fitsWorkshop,
    build: (context, base) => {
      const opened = sideInserts(context, curatedBase(base), [
        { side: 1, assetId: "window_wide", tag: "side_light_right" },
      ]);
      return withDetails(
        opened.shell,
        ...opened.details,
        chimney(context, "stack_left", -1),
        toolRack(context, 1),
        lamp(context, -1),
      );
    },
  },
  {
    id: "forge:stack-right",
    label: "Right-stack Forge",
    family: "workshop",
    prefab: "forge",
    detailBudget: 4,
    fits: fitsWorkshop,
    build: (context, base) => {
      const opened = sideInserts(context, curatedBase(base), [
        { side: 3, assetId: "window_wide", tag: "side_light_left" },
      ]);
      return withDetails(
        opened.shell,
        ...opened.details,
        chimney(context, "stack_right", 1),
        toolRack(context, -1),
        lamp(context, 1),
      );
    },
  },
  {
    id: "forge:twin-stack",
    label: "Twin-stack Forge",
    family: "workshop",
    prefab: "forge",
    detailBudget: 5,
    fits: fitsWorkshop,
    build: (context, base) => {
      const opened = sideInserts(context, curatedBase(base), [
        { side: 1, assetId: "window_wide", tag: "side_light_right" },
        { side: 3, assetId: "window_wide", tag: "side_light_left" },
      ]);
      return withDetails(
        opened.shell,
        ...opened.details,
        chimney(context, "stack_left", -1),
        chimney(context, "stack_right", 1),
        lamp(context, 0),
      );
    },
  },
  {
    id: "forge:front-braced",
    label: "Front-braced Forge",
    family: "workshop",
    prefab: "forge",
    detailBudget: 6,
    fits: fitsWorkshop,
    build: (context, base) => withDetails(
      curatedBase(base, true),
      brace(context, "outer_brace_left", -1, 0.3, 1.2),
      brace(context, "outer_brace_right", 1, 0.3, 1.2),
      // Set back along the same wall, not inboard of the outer pair.
      brace(context, "inner_brace_left", -1, 0.3, 0.72, 1.5),
      brace(context, "inner_brace_right", 1, 0.3, 0.72, 1.5),
      chimney(context, "stack_rear", -1),
      lamp(context, 1),
    ),
  },
  {
    id: "forge:side-shuttered",
    label: "Side-shuttered Forge",
    family: "workshop",
    prefab: "forge",
    // Two selected side bays can start solid, so each shutter may need its own true backing insert.
    detailBudget: 7,
    fits: fitsWorkshop,
    build: (context, base) => {
      const opened = sideInserts(context, curatedBase(base), [
        { side: 1, assetId: "window_shutters", tag: "shutters_right" },
        { side: 3, assetId: "window_shutters", tag: "shutters_left" },
      ]);
      return withDetails(
        opened.shell,
        ...opened.details,
        chimney(context, "stack_rear", 1),
        crate(context, "coal_crate", -1, "crate_village"),
        lamp(context, 0),
      );
    },
  },
  {
    id: "forge:stone-workshop",
    label: "Stone Workshop",
    family: "workshop",
    prefab: "forge",
    kits: ["stone"],
    detailBudget: 8,
    fits: fitsWorkshop,
    build: (context, base) => {
      const opened = sideInserts(context, curatedBase(base), [
        { side: 1, assetId: "window_wide", tag: "window_right" },
        { side: 3, assetId: "window_wide", tag: "window_left" },
      ]);
      return withDetails(
        opened.shell,
        ...opened.details,
        chimney(context, "stack_rear", -1),
        brace(context, "side_brace_left", -1, 0.38, 0.82),
        brace(context, "side_brace_right", 1, 0.38, 0.82),
        crate(context, "ore_crate", 1),
        variantPart(
          "whetstone",
          "whetstone",
          sideX(context, -1, 0.5),
          0,
          rearZ(context, 0.5),
          0.3,
          0.68,
        ),
        lamp(context, 1),
      );
    },
  },
];
