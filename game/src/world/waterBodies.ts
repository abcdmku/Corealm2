import type { ResourceClusterDef } from "../content/regions.js";
import { resourceDef } from "../content/resources.js";
import { organicDistance, organicRadiusScale, seedFromText, type OrganicShapeSpec } from "./organicFields.js";

/** Vertical distance from the dry ground at a body's centre to its basin floor. */
export const WATER_BASIN_DEPTH = 0.9;

/** Fraction of the basin depth filled with water. */
export const WATER_FILL_FRACTION = 0.55;

/** Water depth over the flat centre of every authored body. */
export const WATER_FILL_DEPTH = WATER_BASIN_DEPTH * WATER_FILL_FRACTION;

/** Height of the closed bank above the water plane. */
export const WATER_BANK_FREEBOARD = 0.45;

/**
 * An authored fishing body as terrain understands it.
 *
 * The four radii describe one continuous radial profile. The floor holds every fishing marker on
 * level ground. The rising bed meets the water at `shoreRadius`, then climbs to a dry crest before
 * returning to the terrain outside. The same organic shape deforms all four rings. A hillside
 * basin can fit its elevation to the lower bank instead of raising a dam to its centre height.
 */
export interface WaterBasinSpec {
  id: string;
  x: number;
  z: number;
  floorRadius: number;
  shoreRadius: number;
  crestRadius: number;
  outerRadius: number;
  depth: number;
  fillFraction: number;
  freeboard: number;
  /** Shared radial deformation for every nested ring in this basin. */
  shape: OrganicShapeSpec;
  /** Local terrain fit. Omitted basins retain their authored centre-height placement. */
  bankFit?: {
    /** Maximum lowering below the dry centre, in metres. */
    maximumInset: number;
    /** Permitted rim fill above a representative low bank, in metres. */
    maximumRimFill: number;
  };
}

const FLOOR_MARGIN = 4;
const SHORE_MARGIN = 12;
const CREST_MARGIN = 14;
const OUTER_MARGIN = 32;

type BasinShapeProfile = Pick<OrganicShapeSpec, "aspectRatio" | "irregularity" | "lobes">;

const DEFAULT_BASIN_SHAPE: BasinShapeProfile = {
  aspectRatio: 0.8,
  irregularity: 0.28,
  lobes: 5,
};

/** Four distinct silhouettes, with the seed still owning their rotation and cove phases. */
const BASIN_SHAPES: Readonly<Record<string, BasinShapeProfile>> = {
  redsill_spots: { aspectRatio: 0.74, irregularity: 0.3, lobes: 4 },
  blackwater_spots: { aspectRatio: 0.82, irregularity: 0.28, lobes: 5 },
  cairn_tarn_spots: { aspectRatio: 0.72, irregularity: 0.26, lobes: 6 },
  far_tarn_spots: { aspectRatio: 0.78, irregularity: 0.32, lobes: 7 },
};

function basinShape(id: string): OrganicShapeSpec {
  const seed = seedFromText(id);
  const profile = BASIN_SHAPES[id] ?? DEFAULT_BASIN_SHAPE;
  return {
    seed,
    ...profile,
    rotation: ((seed >>> 8) & 0xffff) / 0x1_0000 * Math.PI * 2,
  };
}

/** One source for the terrain carve, water mesh search bounds, and later shoreline consumers. */
export function waterBasinForCluster(cluster: ResourceClusterDef): WaterBasinSpec {
  if (resourceDef(cluster.resourceId).archetype !== "fishing_spot") {
    throw new Error(`Water basin requested for non-fishing cluster "${cluster.id}".`);
  }
  const shape = basinShape(cluster.id);
  const shoreRadius = cluster.radius + SHORE_MARGIN;
  // The strongest possible cove is bounded by aspect * (1 - irregularity). Size the nominal
  // floor against that bound so every authored fishing marker still sits over flat basin floor.
  const minimumScale = (shape.aspectRatio ?? 1) * (1 - shape.irregularity);
  const floorRadius = Math.min(
    shoreRadius - 1,
    Math.max(cluster.radius + FLOOR_MARGIN, cluster.radius / minimumScale + 0.75),
  );
  return {
    id: cluster.id,
    x: cluster.centre[0],
    z: cluster.centre[1],
    floorRadius,
    shoreRadius,
    crestRadius: cluster.radius + CREST_MARGIN,
    outerRadius: cluster.radius + OUTER_MARGIN,
    depth: WATER_BASIN_DEPTH,
    fillFraction: WATER_FILL_FRACTION,
    freeboard: WATER_BANK_FREEBOARD,
    // `organicRadiusScale` only shrinks. The old radii remain hard outer limits for terrain edits.
    shape,
    // This tarn straddles a terrace. Centre-height placement raised its north bank by 12 m.
    // Fit the existing footprint into that terrace; neighbouring basins keep their own levels.
    ...(cluster.id === "cairn_tarn_spots"
      ? { bankFit: { maximumInset: 10, maximumRimFill: 0.8 } }
      : {}),
  };
}

/** Resolve once, before the shared terrain lattice, using ground before any water edits. */
export function resolveWaterBasinBaseHeight(
  basin: WaterBasinSpec,
  heightAt: (x: number, z: number) => number,
): number {
  const centre = heightAt(basin.x, basin.z);
  if (!Number.isFinite(centre)) throw new Error(`Water basin ${basin.id} has no finite centre height`);
  const fit = basin.bankFit;
  if (!fit) return centre;
  if (!Number.isFinite(fit.maximumInset) || fit.maximumInset < 0
    || !Number.isFinite(fit.maximumRimFill) || fit.maximumRimFill < 0) {
    throw new Error(`Water basin ${basin.id} has an invalid bank fit`);
  }
  const banks: number[] = [];
  for (let sample = 0; sample < 64; sample++) {
    const angle = sample / 64 * Math.PI * 2;
    const radius = basin.crestRadius * organicRadiusScale(angle, basin.shape);
    const bank = heightAt(basin.x + Math.cos(angle) * radius, basin.z + Math.sin(angle) * radius);
    if (!Number.isFinite(bank)) throw new Error(`Water basin ${basin.id} has no finite bank height`);
    banks.push(bank);
  }
  banks.sort((a, b) => a - b);
  // A lower sector determines a lake's outlet. The fifteenth percentile ignores a single narrow
  // terrain notch while keeping most of a hillside's low side near its existing elevation.
  const lowBank = banks[Math.floor(banks.length * 0.15)]!;
  const crestAboveBase = basin.freeboard - basin.depth * (1 - basin.fillFraction);
  const fitted = lowBank + fit.maximumRimFill - crestAboveBase;
  return Math.max(centre - fit.maximumInset, Math.min(centre, fitted));
}

/**
 * Minimum closed bank outside the crest. The caller combines it with the broad terrain return.
 * Fitted banks meet the actual outer-ring elevation and slope in physical metres; blending toward
 * the changing height under each sample adds the hillside's slope a second time halfway down.
 */
export function waterBasinOuterBankHeight(
  basin: WaterBasinSpec,
  x: number,
  z: number,
  currentHeight: number,
  crestHeight: number,
  heightAt: (x: number, z: number) => number,
): number {
  const dx = x - basin.x;
  const dz = z - basin.z;
  const radius = organicDistance(dx, dz, basin.shape);
  const t = Math.max(0, Math.min(1, (radius - basin.crestRadius) / (basin.outerRadius - basin.crestRadius)));
  if (!basin.bankFit) {
    const blend = t * t * (3 - 2 * t);
    return crestHeight + (Math.min(currentHeight, crestHeight) - crestHeight) * blend;
  }
  const angle = Math.atan2(dz, dx);
  const scale = organicRadiusScale(angle, basin.shape);
  const directionX = Math.cos(angle);
  const directionZ = Math.sin(angle);
  const outerX = basin.x + directionX * basin.outerRadius * scale;
  const outerZ = basin.z + directionZ * basin.outerRadius * scale;
  const target = Math.min(crestHeight, heightAt(outerX, outerZ));
  const before = heightAt(outerX - directionX * 0.5, outerZ - directionZ * 0.5);
  const after = heightAt(outerX + directionX * 0.5, outerZ + directionZ * 0.5);
  if (![target, before, after].every(Number.isFinite)) {
    throw new Error(`Water basin ${basin.id} has no finite outer-bank profile`);
  }
  const width = (basin.outerRadius - basin.crestRadius) * scale;
  // A monotone cubic has no crest overshoot or dip below the outer ground. Its inner slope is
  // zero, matching the dry stance ledge; the endpoint tangent follows the existing hillside.
  const tangent = Math.max(3 * (target - crestHeight), Math.min(0, (after - before) * width));
  const squared = t * t;
  const cubed = squared * t;
  return (2 * cubed - 3 * squared + 1) * crestHeight
    + (-2 * cubed + 3 * squared) * target
    + (cubed - squared) * tangent;
}
