import type { PartPlacement } from '../buildings.js';

export const CROWNWARD_CASTLE_IDS = ['crownward_castle', 'crownward_fortress'] as const;
export type CrownwardCastleId = typeof CROWNWARD_CASTLE_IDS[number];

/** Measured, uniformly scaled CreativeTrio models; local +Z is the main entrance. */
export const CROWNWARD_CASTLES = {
  crownward_castle: { assetId: 'crownward_premade_castle', scale: 19.6415,
    footprint: [52, 47.827] as const, height: 27.195 },
  crownward_fortress: { assetId: 'crownward_premade_fortress', scale: 28.6092,
    footprint: [60, 52.873] as const, height: 21.043 },
} as const;

export function buildCrownwardCastle(id: CrownwardCastleId): PartPlacement[] {
  const castle = CROWNWARD_CASTLES[id];
  return [{ tag: 'premade_castle', assetId: castle.assetId, scale: castle.scale,
    dx: 0, dy: 0, dz: 0, rotationY: 0 }];
}

/** One footprint source for terrain grading, paving and scatter clearance. */
export function castleGroundLayout(id: string | undefined): {
  pad: readonly [number, number]; paving: readonly [number, number]; exclusion: readonly [number, number];
} | undefined {
  if (id === 'black_knight_castle' || id === 'white_knight_castle') {
    return { pad: [48, 56], paving: [36, 40], exclusion: [46, 52] };
  }
  if (id !== 'crownward_castle' && id !== 'crownward_fortress') return undefined;
  const [width, depth] = CROWNWARD_CASTLES[id].footprint;
  return { pad: [width + 6, depth + 6], paving: [width - 4, depth - 4], exclusion: [width + 4, depth + 4] };
}
