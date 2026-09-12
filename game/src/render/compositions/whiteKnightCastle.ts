import type { PartPlacement } from "../buildings.js";
import { BLACK_KEEP, buildBlackKnightCastle } from "./blackKnightCastle.js";

/** Crownward keeps use the proven curtain, six-metre gate and open court layout. */
export const WHITE_KEEP = BLACK_KEEP;

/**
 * An occupied royal keep with slate-roofed corner towers and court standards. Crownward's
 * architecture palette supplies the pale limestone while retaining the original masonry maps.
 * All new parts sit on the existing towers or wall faces, so the courtyard and gate stay clear.
 */
export function buildWhiteKnightCastle(): PartPlacement[] {
  const parts = buildBlackKnightCastle();
  const storey = 3.123;
  // The existing roof is 5.427 m deep, with its base 0.572 m below its pivot.
  const roofScale = 7.4 / 5.427;
  for (const side of [-1, 1]) {
    for (const [end, z] of [["front", 18], ["rear", -18]] as const) {
      parts.push({
        tag: `royal_${end}_${side}_slate_spire`, assetId: "roof_tower",
        dx: side * 17, dy: 3 * storey + .572 * roofScale, dz: z,
        rotationY: 0, scale: roofScale,
      });
    }
    // Standards hang outside the curtain, beside the gate approach rather than across it.
    parts.push({
      tag: `royal_curtain_standard_${side}`, assetId: "banner_1",
      dx: side * 11, dy: 4.8, dz: 20.72,
      rotationY: 0, scale: 1.2,
    });
    parts.push({
      tag: `royal_court_standard_${side}`, assetId: "banner_2",
      dx: side * 17.25, dy: 4.8, dz: 2,
      rotationY: side * -Math.PI / 2, scale: 1.2,
    });
  }
  return parts;
}
