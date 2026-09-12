import type { PartPlacement } from '../buildings.js';

/** User-supplied medieval stone bridge, normalized about X/Z; crossing runs along local X. */
export const CROWNWARD_BRIDGE = {
  compositionId: 'crownward_bridge',
  assetId: 'crownward_timber_bridge',
  scale: 24 / 6.938079,
  offsetY: -0.65,
  footprint: [24, 6.210436] as const,
  /** Paved deck approaches meet bank level near the source mesh ends. */
  deckEnds: [-11.95, 11.95] as const,
  /** Clear centre-line points on land for a complete keyboard traversal. */
  approaches: [[-13, 0], [13, 0]] as const,
} as const;

export function buildCrownwardBridge(): PartPlacement[] {
  return [{ tag: 'premade_bridge', assetId: CROWNWARD_BRIDGE.assetId,
    scale: CROWNWARD_BRIDGE.scale, dx: 0, dy: CROWNWARD_BRIDGE.offsetY, dz: 0, rotationY: 0 }];
}
