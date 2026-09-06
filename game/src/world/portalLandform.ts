import { seedFromText, smoothNoise2D } from "./organicFields.js";

export interface PortalLandform {
  centre: readonly [number, number];
  rotationY: number;
  floorY: number;
}

const BANK_SEED = seedFromText("gravelmaw-portal-bank");
const TRANSFORM_EPSILON = 1e-9;

function smooth(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function lobe(x: number, z: number, centreX: number, centreZ: number, halfX: number, halfZ: number, salt: number): number {
  const distance = Math.hypot((x - centreX) / halfX, (z - centreZ) / halfZ);
  if (distance >= 1) return 0;
  // Only contract the authored footprint. The shared smooth field breaks the oval contour while
  // retaining a zero value and slope at its edge; it never adds a detached mound outside it.
  const radius = 0.94 + 0.06 * smoothNoise2D(x / 7.5, z / 8.5, BANK_SEED ^ salt);
  return 1 - smooth(distance / radius);
}

/**
 * Earth behind the accepted Gravelmaw masonry. +Z faces the quarry approach. The rear carries an
 * 8.2 m crest, with lower, unequal shoulders returning to the existing ground around the rocks.
 * Resolve floorY once from the surface before applying this bank; this helper never samples back
 * into the edited terrain. The worked entrance floor cuts or fills natural ground; the bank
 * outside that bounded pad only adds earth.
 *
 * World-authoring exception: this is the portal's authored host terrain. The separately accepted
 * masonry/crown supplies the overhead enclosure; a heightfield must keep the passage below clear.
 */
export function portalLandformHeight(x: number, z: number, height: number, landform: PortalLandform): number {
  const dx = x - landform.centre[0];
  const dz = z - landform.centre[1];
  const cos = Math.cos(landform.rotationY);
  const sin = Math.sin(landform.rotationY);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const absX = Math.abs(localX);
  // Two successive terrain samplers surround the visible 4.4 m paving and 5.555 m recess.
  // Extend the flat datum beyond their edges so interpolated terrain triangles remain below
  // the thin stone flags. Preserving the original hill here buried their uphill half.
  const padSide = 1 - smooth((absX - 5.2) / 3);
  const padBack = smooth((localZ + 11.8) / 4);
  const padFront = 1 - smooth((localZ - 7.4) / 3);
  const pad = padSide * padBack * padFront;
  const supported = height + (landform.floorY - height) * pad;

  // Tolerance only absorbs roundoff when a point on the authored boundary is rotated to world.
  if (localZ >= -TRANSFORM_EPSILON
    || (absX <= 2.4 + TRANSFORM_EPSILON && localZ >= -6.2 - TRANSFORM_EPSILON)
    || absX >= 12 || localZ <= -20) return supported;

  const rear = lobe(localX, localZ, 0, -12, 12, 8, 0);
  const left = lobe(localX, localZ, -6.8, -3.5, 4, 6, 0x52a1) * 0.48;
  const right = lobe(localX, localZ, 6.8, -3.5, 4, 6, 0x317d) * 0.42;
  // Smooth unions retain each slope through overlaps and do not clamp the bank to a flat cap.
  const bank = 1 - (1 - rear) * (1 - left) * (1 - right);
  if (bank <= 0) return supported;
  const side = smooth((absX - 2.4) / 1.6);
  const back = smooth((-localZ - 6.2) / 2.3);
  const opening = 1 - (1 - side) * (1 - back);
  const front = smooth(-localZ / 4.5);
  const fill = Math.max(0, landform.floorY + 8.2 - supported);
  return supported + fill * bank * opening * front * (1 - pad);
}
