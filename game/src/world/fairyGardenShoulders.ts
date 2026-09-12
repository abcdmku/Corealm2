import type { FairyLandformPoint, FairyLandformRegion } from './fairyLandforms.js';

interface GardenShoulder {
  readonly id: string;
  readonly regionId: FairyLandformRegion;
  readonly centre: FairyLandformPoint;
  readonly radii: FairyLandformPoint;
  readonly rise: number;
}

/** Local wooded garden ends: unequal knolls, inset from the realm's outer boundary. */
export const FAIRY_GARDEN_SHOULDERS: readonly GardenShoulder[] = [
  { id: 'southern_west', regionId: 'gloamgarden', centre: [2223, -184], radii: [22, 13], rise: 4.5 },
  { id: 'southern_saddle', regionId: 'gloamgarden', centre: [2245, -193], radii: [20, 5.5], rise: 3.5 },
  { id: 'southern_east', regionId: 'gloamgarden', centre: [2265, -180], radii: [22, 17], rise: 5 },
  { id: 'starroot_west', regionId: 'faeholme', centre: [2285, 444], radii: [24, 13], rise: 4.8 },
  { id: 'starroot_saddle', regionId: 'faeholme', centre: [2305, 453], radii: [20, 5.5], rise: 3.8 },
  { id: 'starroot_east', regionId: 'faeholme', centre: [2325, 442], radii: [24, 15], rise: 5 },
  { id: 'sovereign_south', regionId: 'faeholme', centre: [2582, 378], radii: [15, 24], rise: 4.6 },
  { id: 'sovereign_saddle', regionId: 'faeholme', centre: [2593, 404], radii: [5.5, 21], rise: 3.8 },
  { id: 'sovereign_north', regionId: 'faeholme', centre: [2583, 425], radii: [14, 24], rise: 5.2 },
];

const ease = (value: number): number => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

/** Added to the shared terrain lattice; entrances retain their original walkable receiving grade. */
export function fairyGardenShoulderRise(x: number, z: number,
  landings: readonly { from: FairyLandformPoint; to: FairyLandformPoint; halfWidth: number }[]): number {
  let rise = 0;
  for (const shoulder of FAIRY_GARDEN_SHOULDERS) {
    const dx = (x - shoulder.centre[0]) / shoulder.radii[0], dz = (z - shoulder.centre[1]) / shoulder.radii[1];
    const angle = Math.atan2(dz, dx);
    const contour = 1 - .045 * (1 + Math.sin(angle * 3 + shoulder.centre[0]));
    const distance = Math.hypot(dx, dz) / contour;
    rise = Math.max(rise, shoulder.rise * ease((1 - distance) / .58));
  }
  if (!rise) return 0;
  let reserve = 1;
  for (const landing of landings) {
    const dx = landing.to[0] - landing.from[0], dz = landing.to[1] - landing.from[1];
    const t = Math.max(0, Math.min(1, ((x - landing.from[0]) * dx + (z - landing.from[1]) * dz) / (dx * dx + dz * dz)));
    const distance = Math.hypot(x - landing.from[0] - dx * t, z - landing.from[1] - dz * t);
    reserve = Math.min(reserve, ease((distance - landing.halfWidth - .5) / 2));
  }
  return rise * reserve;
}
