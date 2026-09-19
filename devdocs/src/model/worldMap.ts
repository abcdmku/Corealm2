import { WORLD_MAP_IMAGE_BOUNDS } from "../../../game/src/generated/worldMapFingerprint.js";

/*
  Placing world metres on the drawn map image. The image is north-up: +z is north, so its top edge
  is maxZ and a point's share of the height is measured down from there. Getting that flip wrong
  puts every pin and every crop on the far side of the island, so both the thumbnails and the
  record maps go through these; only the world workspace's SVG does its own (y = -z).
*/

/** A rectangle of world metres: its south-west corner and how far it reaches east and north. */
export interface MapBox { x0: number; z0: number; spanX: number; spanZ: number }

const { minX, maxX, minZ, maxZ } = WORLD_MAP_IMAGE_BOUNDS;
export const IMAGE_BOX: MapBox = { x0: minX, z0: minZ, spanX: maxX - minX, spanZ: maxZ - minZ };

/** Where a world point sits in a box, as fractions from its left and top edges. */
export function boxFraction(box: MapBox, x: number, z: number): { u: number; v: number } {
  return { u: (x - box.x0) / box.spanX, v: (box.z0 + box.spanZ - z) / box.spanZ };
}

/** The world z a box shows at a fraction down from its top edge: `boxFraction` read backwards. */
export function zAtFraction(box: MapBox, v: number): number {
  return box.z0 + box.spanZ - v * box.spanZ;
}

/**
 * `background-position` for a crop of the whole map image, as fractions. A percentage position
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
