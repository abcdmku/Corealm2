/** Native source dimensions for the authored, walkable Rootfall stump and its stone stair. */
export const ROOTFALL_STUMP = {
  assetId: 'corealm_stump_oak', scale: 4,
  topY: 0.8818 * 4,
  // Centre treads rise from .003 to .818; the 1.204 m bounds include buried base and side caps.
  stairFlights: 4,
  stairScale: 0.8818 * 4 / (3 + 0.818),
  stairFrontZ: 8.3,
  stairYaw: Math.PI / 4,
  // Native narrow treads lose diagonal cells on the final world's .45 m Recast grid.
  // Width 1.6 preserves a walkable strip across the tested X/Z and vertical grid phases.
  stairWidthScale: 1.6,
  spawnLocal: [4, 0, 7] as const,
} as const;
