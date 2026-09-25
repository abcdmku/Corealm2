import type { StructureVariantDescriptor } from "../../contracts.js";
import type { BuildingKit, PartPlacement, PrefabId } from "../buildings.js";
import { ARCADE_VARIANTS } from "./arcade.js";
import { COTTAGE_VARIANTS } from "./cottage.js";
import { FARMSTEAD_VARIANTS } from "./farmstead.js";
import { FORGE_VARIANTS } from "./forge.js";
import { GATEHOUSE_VARIANTS } from "./gatehouse.js";
import { HALL_VARIANTS } from "./hall.js";
import { PORCH_VARIANTS } from "./porch.js";
import { QUARRY_HUT_VARIANTS } from "./quarryHut.js";
import { RUIN_VARIANTS } from "./ruin.js";
import { SHED_VARIANTS } from "./shed.js";
import { STALL_VARIANTS } from "./stall.js";
import { TOWER_VARIANTS } from "./tower.js";
import { TOWNHOUSE_VARIANTS } from "./townhouse.js";
import type { StructureVariantContext, StructureVariantRecipe } from "./types.js";
import { WALL_SEGMENT_VARIANTS } from "./wallSegment.js";
import { WELL_VARIANTS } from "./well.js";

const ALL_VARIANTS: readonly StructureVariantRecipe[] = [
  ...COTTAGE_VARIANTS,
  ...TOWNHOUSE_VARIANTS,
  ...HALL_VARIANTS,
  ...TOWER_VARIANTS,
  ...SHED_VARIANTS,
  ...QUARRY_HUT_VARIANTS,
  ...FARMSTEAD_VARIANTS,
  ...GATEHOUSE_VARIANTS,
  ...WALL_SEGMENT_VARIANTS,
  ...RUIN_VARIANTS,
  ...FORGE_VARIANTS,
  ...PORCH_VARIANTS,
  ...ARCADE_VARIANTS,
  ...STALL_VARIANTS,
  ...WELL_VARIANTS,
];

const ENTRANCE_Z: Readonly<Partial<Record<PrefabId, -1 | 1>>> = {
  cottage: -1,
  townhouse: -1,
  hall: -1,
  tower: -1,
  shed: -1,
  quarry_hut: -1,
  farmstead: -1,
  forge: 1,
  porch: 1,
  arcade: 1,
};

const ids = new Set<string>();
for (const recipe of ALL_VARIANTS) {
  if (ids.has(recipe.id)) throw new Error(`Duplicate structure variant id ${recipe.id}`);
  if (recipe.detailBudget < 0 || !Number.isInteger(recipe.detailBudget)) {
    throw new Error(`Structure variant ${recipe.id} has invalid detail budget ${recipe.detailBudget}`);
  }
  ids.add(recipe.id);
}

/** Metadata for tooling and diagnostics. Recipe functions remain renderer-private. */
export const STRUCTURE_VARIANTS: readonly StructureVariantDescriptor<PrefabId>[] = ALL_VARIANTS.map((recipe) => ({
  id: recipe.id,
  label: recipe.label,
  family: recipe.family,
  prefab: recipe.prefab,
  detailBudget: recipe.detailBudget,
}));

function contextFor(
  prefab: PrefabId,
  footprint: readonly [number, number],
  seed: number,
  kit: BuildingKit,
): StructureVariantContext {
  return {
    prefab,
    width: Math.max(2, footprint[0]),
    depth: Math.max(2, footprint[1]),
    seed: seed >>> 0,
    kitId: kit.id,
    kit,
    entranceZ: ENTRANCE_Z[prefab] ?? 0,
  };
}

function candidatesFor(context: StructureVariantContext): readonly StructureVariantRecipe[] {
  return ALL_VARIANTS.filter((recipe) => (
    recipe.prefab === context.prefab
    && (recipe.kits === undefined || recipe.kits.includes(context.kitId))
    && (recipe.fits === undefined || recipe.fits(context))
  ));
}

const WINDOW_PAIR_DISTANCE_METRES = 0.25;
const WINDOW_PAIR_Y_DISTANCE_METRES = 0.25;
const WINDOW_PAIR_ANGLE_RADIANS = Math.PI / 18;
const SHUTTER_BACKING_INSET_METRES = 0.025;

interface ShutterInvariantResult {
  readonly parts: PartPlacement[];
  readonly generatedBackingTags: ReadonlySet<string>;
}

function angleDistance(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function roundMetres(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The one insert that closes a kit aperture.
 *
 * `window_thin` used to count here, which meant a recipe that put a shutter over an arrow loop
 * satisfied the invariant with two overlays and no pane, and the hole stayed open.
 */
function isWindowInsert(part: PartPlacement): boolean {
  return part.assetId === "window_wide";
}

function isPairedWindow(shutter: PartPlacement, candidate: PartPlacement): boolean {
  return isWindowInsert(candidate)
    && Math.hypot(candidate.dx - shutter.dx, candidate.dz - shutter.dz) <= WINDOW_PAIR_DISTANCE_METRES
    && Math.abs(candidate.dy - shutter.dy) <= WINDOW_PAIR_Y_DISTANCE_METRES
    && angleDistance(candidate.rotationY, shutter.rotationY) <= WINDOW_PAIR_ANGLE_RADIANS;
}

function uniqueBackingTag(shutterTag: string, usedTags: Set<string>): string {
  const stem = `v_window_backing_${shutterTag}`;
  let tag = stem;
  let suffix = 2;
  while (usedTags.has(tag)) {
    tag = `${stem}_${suffix}`;
    suffix += 1;
  }
  usedTags.add(tag);
  return tag;
}

/**
 * Every insert that stands in a wall aperture has to close it.
 *
 * Two overlays in the kit do not: `window_shutters` is a pair of leaves with nothing behind them,
 * and `window_thin` is an arrow loop 0.888 m wide. The panel they go into is a hole 1.19 m wide
 * from a 1.05 m sill to a 2.69 m arched crown, and the only asset authored to plug it is
 * `window_wide` at scale 1 - which is exactly what the classic prefab path inserts
 * (`buildings.ts:ringWindows`).
 *
 * Recipes are allowed to use either overlay for its silhouette. This adds the backing pane behind
 * whichever of them is left unpaired, so a shuttered bay or a watch slit is a window and not a
 * hole you can see the far side of the building through. Backings do not count against a recipe's
 * detail budget.
 */
const APERTURE_OVERLAYS = new Set(["window_shutters", "window_thin"]);

function enforceShutterWindowInvariant(parts: readonly PartPlacement[]): ShutterInvariantResult {
  const result = [...parts];
  const usedTags = new Set(result.map((part) => part.tag));
  const generatedBackingTags = new Set<string>();

  for (const shutter of parts) {
    if (!APERTURE_OVERLAYS.has(shutter.assetId)) continue;
    if (result.some((part) => part !== shutter && isPairedWindow(shutter, part))) continue;

    const tag = uniqueBackingTag(shutter.tag, usedTags);
    generatedBackingTags.add(tag);
    result.push({
      tag,
      assetId: "window_wide",
      dx: roundMetres(shutter.dx - Math.sin(shutter.rotationY) * SHUTTER_BACKING_INSET_METRES),
      dy: shutter.dy,
      dz: roundMetres(shutter.dz - Math.cos(shutter.rotationY) * SHUTTER_BACKING_INSET_METRES),
      rotationY: shutter.rotationY,
      // The backing is sized to the aperture, never to the overlay standing in front of it.
      scale: 1,
    });
  }

  return { parts: result, generatedBackingTags };
}

function validatePlacements(
  source: string,
  base: readonly PartPlacement[],
  result: readonly PartPlacement[],
): void {
  const baseTags = new Set(base.map((part) => part.tag));
  const tags = new Set<string>();
  for (const part of result) {
    if (tags.has(part.tag)) throw new Error(`${source} emitted duplicate tag ${part.tag}`);
    if (!baseTags.has(part.tag) && !part.tag.startsWith("v_")) {
      throw new Error(`${source} emitted unprefixed optional tag ${part.tag}`);
    }
    tags.add(part.tag);
    const axesValid = part.scaleAxes === undefined
      || (part.scaleAxes.every(Number.isFinite) && part.scaleAxes.every((axis) => axis > 0));
    if (!part.assetId || part.scale <= 0 || !axesValid ||
        ![part.dx, part.dy, part.dz, part.rotationY, part.scale].every(Number.isFinite)) {
      throw new Error(`${source} emitted an invalid part at ${part.tag}`);
    }
  }
}

function validateParts(
  recipe: StructureVariantRecipe,
  base: readonly PartPlacement[],
  result: readonly PartPlacement[],
  generatedBackingTags: ReadonlySet<string>,
): void {
  const optionalCount = result.filter((part) => (
    part.tag.startsWith("v_") && !generatedBackingTags.has(part.tag)
  )).length;
  if (optionalCount > recipe.detailBudget) {
    throw new Error(
      `Structure variant ${recipe.id} emitted ${optionalCount} optional parts; budget is ${recipe.detailBudget}`,
    );
  }
  validatePlacements(`Structure variant ${recipe.id}`, base, result);
}

/** Number of compatible recipes, used to enumerate every branch during manifest validation. */
export function structureVariantCount(
  prefab: PrefabId,
  footprint: readonly [number, number],
  kit: BuildingKit,
): number {
  return candidatesFor(contextFor(prefab, footprint, 0, kit)).length;
}

/** Stable recipe id selected for diagnostics. `undefined` means the classic prefab output. */
export function selectedStructureVariantId(
  prefab: PrefabId,
  footprint: readonly [number, number],
  seed: number,
  kit: BuildingKit,
): string | undefined {
  const context = contextFor(prefab, footprint, seed, kit);
  const candidates = candidatesFor(context);
  return candidates.length === 0 ? undefined : candidates[(seed >>> 0) % candidates.length]!.id;
}

/** Apply one deterministic recipe without changing the public four-argument prefab API. */
export function applyStructureVariant(
  prefab: PrefabId,
  footprint: readonly [number, number],
  seed: number,
  kit: BuildingKit,
  base: readonly PartPlacement[],
): PartPlacement[] {
  const context = contextFor(prefab, footprint, seed, kit);
  const candidates = candidatesFor(context);
  if (candidates.length === 0) {
    const invariant = enforceShutterWindowInvariant(base);
    validatePlacements(`Classic prefab ${prefab}`, base, invariant.parts);
    return invariant.parts;
  }
  const recipe = candidates[(seed >>> 0) % candidates.length]!;
  const result = enforceShutterWindowInvariant(recipe.build(context, base));
  validateParts(recipe, base, result.parts, result.generatedBackingTags);
  return result.parts;
}
