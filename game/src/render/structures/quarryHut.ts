import type { PartPlacement } from "../buildings.js";
import { wallMountedBanner } from "../bannerPlacement.js";
import { inset, mapAssets, variantPart, withDetails } from "./parts.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";

const MODULE_METRES = 2;
const FRONT_YAW = Math.PI;

/** Highcairn uses 6 x 4 huts. Wider even-module plans keep the same centred door safely. */
function fitsEvenHut(context: StructureVariantContext): boolean {
  const widthInModules = context.width / MODULE_METRES;
  return context.width >= 4
    && context.depth >= 4
    && Math.abs(widthInModules - Math.round(widthInModules)) < 1e-6;
}

function frontModuleCount(context: StructureVariantContext): number {
  return Math.max(2, Math.round(context.width / MODULE_METRES));
}

function frontDoorTag(context: StructureVariantContext): string {
  return `w2_${Math.floor(frontModuleCount(context) / 2)}`;
}

function frontFlankTags(context: StructureVariantContext): string[] {
  const count = frontModuleCount(context);
  const door = Math.floor(count / 2);
  return Array.from({ length: count }, (_unused, index) => index)
    .filter((index) => index !== door)
    .map((index) => `w2_${index}`);
}

/** The side bay nearest the local -Z entry. Used as a safe second window on a 4 m facade. */
function sideFrontTag(context: StructureVariantContext, right: boolean): string {
  const sideModules = Math.max(2, Math.round(context.depth / MODULE_METRES));
  return right ? `w1_${sideModules - 1}` : "w3_0";
}

function oneFrontFlank(context: StructureVariantContext): string {
  const flanks = frontFlankTags(context);
  return flanks[((context.seed >>> 3) & 1) === 0 ? 0 : flanks.length - 1]!;
}

function twinWindowTags(context: StructureVariantContext): string[] {
  const flanks = frontFlankTags(context);
  if (flanks.length >= 2) return [flanks[0]!, flanks[flanks.length - 1]!];
  return [flanks[0]!, sideFrontTag(context, (context.seed & 1) === 0)];
}

/** Remove the old ground-dropped braces. Correct wall-mounted braces are added by one recipe. */
function cleanBase(base: readonly PartPlacement[]): PartPlacement[] {
  return base.filter((part) => part.tag !== "prop_l" && part.tag !== "prop_r");
}

function insertTagFor(wallTag: string): string {
  return `g${wallTag.slice(1)}`;
}

/**
 * Give the entry elevation an intentional window plan. The doorway, trims, studs and corners keep
 * their original tags and positions, so the closed body and its collision box do not change.
 */
function planFrontWindows(
  context: StructureVariantContext,
  base: readonly PartPlacement[],
  windowWallTags: readonly string[],
): PartPlacement[] {
  const selected = new Set(windowWallTags);
  const replacedInserts = new Set(windowWallTags.map(insertTagFor));
  const withoutOldInserts = cleanBase(base).filter((part) => (
    !part.tag.startsWith("g2_") && !replacedInserts.has(part.tag)
  ));

  return mapAssets(withoutOldInserts, (part) => {
    if (selected.has(part.tag)) return context.kit.wallWindow;
    if (part.tag.startsWith("w2_") && part.assetId === context.kit.wallWindow) {
      return context.kit.wall;
    }
    return undefined;
  });
}

interface AttachmentOptions {
  readonly out?: number;
  readonly along?: number;
  readonly dy?: number;
  readonly scale?: number;
}

/** Place one attachment in a wall panel's local frame. */
function wallAttachment(
  base: readonly PartPlacement[],
  wallTag: string,
  detailTag: string,
  assetId: string,
  options: AttachmentOptions = {},
): PartPlacement {
  const wall = base.find((part) => part.tag === wallTag);
  if (!wall) throw new Error(`Quarry hut variant cannot find wall tag ${wallTag}`);

  const out = options.out ?? 0.04;
  const along = options.along ?? 0;
  const yaw = wall.rotationY;
  return variantPart(
    detailTag,
    assetId,
    wall.dx + Math.sin(yaw) * out + Math.cos(yaw) * along,
    wall.dy + (options.dy ?? 0),
    wall.dz + Math.cos(yaw) * out - Math.sin(yaw) * along,
    yaw,
    options.scale ?? 1,
  );
}

function narrowWindow(base: readonly PartPlacement[], wallTag: string, tag: string): PartPlacement {
  return wallAttachment(base, wallTag, tag, "window_thin", { out: 0.035, scale: 0.96 });
}

export const QUARRY_HUT_VARIANTS: readonly StructureVariantRecipe[] = [
  {
    id: "quarry_hut:twin_windows",
    label: "Twin-window quarry hut",
    family: "workshop",
    prefab: "quarry_hut",
    kits: ["stone"],
    detailBudget: 2,
    fits: fitsEvenHut,
    build: (context, base) => {
      const targets = twinWindowTags(context);
      const elevation = planFrontWindows(context, base, targets);
      return withDetails(
        elevation,
        ...targets.map((wallTag, index) => narrowWindow(elevation, wallTag, `twin_window_${index}`)),
      );
    },
  },
  {
    id: "quarry_hut:narrow_window",
    label: "Shuttered narrow-window hut",
    family: "workshop",
    prefab: "quarry_hut",
    kits: ["stone"],
    detailBudget: 2,
    fits: fitsEvenHut,
    build: (context, base) => {
      const target = oneFrontFlank(context);
      const elevation = planFrontWindows(context, base, [target]);
      return withDetails(
        elevation,
        narrowWindow(elevation, target, "narrow_window"),
        // At 0.86 scale the 2.303 m shutter pair fits inside one 2 m wall bay.
        wallAttachment(elevation, target, "window_shutters", "window_shutters", { out: 0.07, scale: 0.86 }),
      );
    },
  },
  {
    id: "quarry_hut:solid_front",
    label: "Solid-front quarry hut",
    family: "workshop",
    prefab: "quarry_hut",
    kits: ["stone"],
    detailBudget: 1,
    fits: fitsEvenHut,
    build: (context, base) => {
      const elevation = planFrontWindows(context, base, []);
      return withDetails(
        elevation,
        wallAttachment(elevation, frontDoorTag(context), "door_frame", "door_frame_round", { out: 0.05 }),
      );
    },
  },
  {
    id: "quarry_hut:offset_emphasis",
    label: "Offset work-window hut",
    family: "workshop",
    prefab: "quarry_hut",
    kits: ["stone"],
    detailBudget: 2,
    fits: fitsEvenHut,
    build: (context, base) => {
      const target = oneFrontFlank(context);
      const elevation = planFrontWindows(context, base, [target]);
      const shelfShift = (context.seed & 1) === 0 ? -0.12 : 0.12;
      return withDetails(
        elevation,
        narrowWindow(elevation, target, "offset_window"),
        // shelf's bbox starts 0.201 m below its pivot, so dy 0.94 meets the window sill.
        wallAttachment(elevation, target, "window_shelf", "shelf", {
          out: 0.055,
          along: shelfShift,
          dy: 0.94,
          scale: 0.9,
        }),
      );
    },
  },
  {
    id: "quarry_hut:side_braced",
    label: "Side-braced quarry hut",
    family: "workshop",
    prefab: "quarry_hut",
    kits: ["stone"],
    detailBudget: 2,
    fits: fitsEvenHut,
    build: (context, base) => {
      const elevation = cleanBase(base);
      const sideX = context.width / 2 + 0.04;
      const braceZ = inset(context.depth * 0.16, context.depth / 2, 0.6);
      return withDetails(
        elevation,
        // Geometry begins at y 1.211. Keeping dy at zero mounts both braces below the eaves.
        variantPart("side_brace_l", "support_beam", -sideX, 0, -braceZ, 0, 0.95),
        variantPart("side_brace_r", "support_beam", sideX, 0, braceZ, Math.PI, 0.95),
      );
    },
  },
  {
    id: "quarry_hut:lamp_bracket",
    label: "Lamp-bracket quarry hut",
    family: "workshop",
    prefab: "quarry_hut",
    kits: ["stone"],
    detailBudget: 2,
    fits: fitsEvenHut,
    build: (context, base) => {
      const elevation = cleanBase(base);
      const side = (context.seed & 1) === 0 ? -1 : 1;
      const x = side * inset(context.width * 0.24, context.width / 2, 0.8);
      return withDetails(
        elevation,
        // A half-scale support beam lies across the facade as a bracket instead of jutting outward.
        variantPart("lamp_brace", "support_beam", x, 1.02, -context.depth / 2 - 0.02, Math.PI / 2, 0.55),
        variantPart("entry_lamp", "lamp_wall", x, 2.02, -context.depth / 2 - 0.121, FRONT_YAW, 0.45),
      );
    },
  },
  {
    id: "quarry_hut:rubble_corner",
    label: "Rubble-corner quarry hut",
    family: "workshop",
    prefab: "quarry_hut",
    kits: ["stone"],
    detailBudget: 3,
    fits: fitsEvenHut,
    build: (context, base) => {
      const elevation = cleanBase(base);
      const side = (context.seed & 1) === 0 ? -1 : 1;
      const cornerX = side * inset(context.width / 2 - 0.42, context.width / 2, 0.32);
      const frontZ = -context.depth / 2 - 0.2;
      return withDetails(
        elevation,
        variantPart("rubble_3", "rubble_brick_3", cornerX, 0, frontZ, 0.55 + side * 0.2, 1.8),
        variantPart("rubble_4", "rubble_brick_4", cornerX - side * 0.38, 0, frontZ + 0.28, 2.2, 1.55),
        variantPart("rubble_vase", "rubble_vase", cornerX - side * 0.18, 0, frontZ - 0.26, 0.8, 1.05),
      );
    },
  },
  {
    id: "quarry_hut:foreman_banner",
    label: "Foreman's quarry hut",
    family: "workshop",
    prefab: "quarry_hut",
    kits: ["stone"],
    detailBudget: 1,
    fits: fitsEvenHut,
    build: (context, base) => {
      const elevation = planFrontWindows(context, base, []);
      const target = oneFrontFlank(context);
      const wall = elevation.find((part) => part.tag === target);
      if (!wall) throw new Error(`Quarry hut variant cannot find banner wall tag ${target}`);
      const outwardYaw = Math.PI;
      const faceOut = 0.093 + 0.01;
      return withDetails(
        elevation,
        // banner_2 projects from its rail. Keep the rail just proud of the solid south/front wall
        // and turn its local +X outward, instead of laying the cloth flat along the facade.
        wallMountedBanner(
          "v_foreman_banner",
          "banner_2",
          {
            dx: wall.dx + Math.sin(outwardYaw) * faceOut,
            dy: 2.42,
            dz: wall.dz + Math.cos(outwardYaw) * faceOut,
          },
          outwardYaw,
          0.8,
        ),
      );
    },
  },
];
