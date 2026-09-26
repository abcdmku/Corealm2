import { WORLD_MAP_IMAGE_BOUNDS } from "../../../game/src/generated/worldMapFingerprint.js";
import { worldToMap } from "../../../game/src/world/mapOrientation.js";

/* Display maps share the gameplay frame: +Z up, +X left. The baked atlas stores +X
   to the right; crop it in storage coordinates, then mirror only its rendered background. */

/** Minimum world coordinates and dimensions in metres. */
export interface MapBox { x0: number; z0: number; spanX: number; spanZ: number }

const { minX, maxX, minZ, maxZ } = WORLD_MAP_IMAGE_BOUNDS;
export const IMAGE_BOX: MapBox = { x0: minX, z0: minZ, spanX: maxX - minX, spanZ: maxZ - minZ };

/** Where a world point sits in a box, as fractions from its left and top edges. */
export function boxFraction(box: MapBox, x: number, z: number): { u: number; v: number } {
  const point = worldToMap(x, z), origin = worldToMap(box.x0 + box.spanX, box.z0 + box.spanZ);
  return { u: (point.u - origin.u) / box.spanX, v: (point.v - origin.v) / box.spanZ };
}

export function xAtFraction(box: MapBox, u: number): number { return box.x0 + box.spanX - u * box.spanX; }

/** The world z a box shows at a fraction down from its top edge: `boxFraction` read backwards. */
export function zAtFraction(box: MapBox, v: number): number {
  return box.z0 + box.spanZ - v * box.spanZ;
}

/**
 * Raw atlas `background-position` before display mirroring, for a crop of the whole map image, as fractions. A percentage position
 * aligns the same fraction of image and box, so the crop's offset is its share of the leftover
 * image; a crop as big as the image has no leftover and sits at 0.
 */
export function cropPosition(crop: MapBox): { u: number; v: number } {
  const leftoverX = IMAGE_BOX.spanX - crop.spanX, leftoverZ = IMAGE_BOX.spanZ - crop.spanZ;
  return {
    u: leftoverX > 0 ? (crop.x0 - IMAGE_BOX.x0) / leftoverX : 0,
    v: leftoverZ > 0 ? (maxZ - (crop.z0 + crop.spanZ)) / leftoverZ : 0,
  };
}

/** Is a point on the drawn map at all? Everything else (the fairy realm) is pinned on a plain grid. */
export function onDrawnMap(x: number, z: number): boolean {
  return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
}
