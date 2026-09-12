import { sampleFairyBankHeight } from './fairyBankHeightmaps.js';

/** Native crags define both the rendered village banks and the terrain receiving them. */
export const FAIRY_VILLAGE_CRAGS = [
    ['lantern_market_garden', 2081, -88, 1.08, 3.29, 0],
    ['lantern_market_garden', 2078.1, -90.5, 0.3, .6, 1],
    ['lantern_market_garden', 2084, -90, 0.34, 2.5, 1],
    ['lantern_market_garden', 2078, -85, 0.88, 1.8, 1],
    ['lantern_market_garden', 2081.8, -85.5, 0.9, -.7, 0],
    ['lantern_foreground_garden', 2085.2, -110.6, .42, -.3, 1],
    ['lantern_west_bank', 2062.4, -107, .88, 1.4, 1],
    ['lantern_west_bank', 2062.6, -89, .86, 2.1, 1],
    ['lantern_northwest_bank', 2062.8, -84.5, 1.02, 2.4, 0],
    ['lantern_east_bank', 2102, -104.6, .88, 1.3, 1],
    ['lantern_east_bank', 2100, -89, .88, 2.2, 1],
    ['lantern_northeast_bank', 2100, -82.7, .9, 1.1, 0],
    ['lantern_west_bank', 2063.2, -101, 0.88, .8, 1],
    ['lantern_west_bank', 2062, -94.5, 0.94, 2.8, 0],
    ['lantern_northwest_bank', 2068.5, -78, 0.88, .35, 1],
    ['lantern_northwest_bank', 2063, -77, 0.96, 1.9, 0],
    ['lantern_northeast_bank', 2094, -78, 0.88, -.2, 1],
    ['lantern_northeast_bank', 2100, -77, 0.95, 1.5, 0],
    ['lantern_east_bank', 2099.7, -100.5, 0.88, -.6, 1],
    ['lantern_east_bank', 2101, -94.5, 0.93, 2.4, 0],
    ['lantern_south_bank', 2097, -130.5, 0.88, .2, 1],
    ['lantern_forge_bank', 2059, -128.5, 0.85, 1.4, 0],
    ['lantern_west_bank', 2066, -107, .5, 0, 1],
    ['lantern_west_bank', 2065.5, -97, .5, .5, 1],
    ['lantern_northwest_bank', 2064.9, -84, .60, 1.1, 1],
    ['lantern_northwest_bank', 2070.4, -81.8, .30, 2.4, 1],
    ['lantern_northeast_bank', 2091.4, -83, .45, 0, 1],
    ['lantern_northeast_bank', 2097.5, -84, .60, .3, 1],
    ['lantern_east_bank', 2098, -105.6, .45, 0, 1],
    ['lantern_market_garden', 2081, -79.5, .82, 1.1, 1],
    ['lantern_northwest_bank', 2080, -66, .85, .3, 1],
    ['lantern_northwest_bank', 2077.5, -62, .88, 1.3, 0],
    ['lantern_northwest_bank', 2077.5, -55, .88, .3, 1],
    ['lantern_northwest_bank', 2078.7, -48, .82, 1.3, 0],
    ['lantern_northeast_bank', 2091, -62, .88, .3, 1],
    ['lantern_northeast_bank', 2090.8, -55, .88, 1.3, 0],
    ['lantern_northeast_bank', 2091.4, -45, .88, 1.3, 0],
    ['lantern_northeast_bank', 2091, -38, .88, .3, 1],
    ['lantern_foreground_garden', 2072, -109, 0.61, 1.2, 1],
    ['lantern_bank_garden', 2080, -123, 0.75, -.2, 0],
    ['prism_root_garden', 2284, 144, 0.85, .8, 1],
    ['prism_orchid_garden', 2316, 151, 0.85, -.4, 0],
    ['prism_moon_garden', 2301, 166, 0.88, .2, 1],
    ['prism_root_garden', 2287, 139, .55, .3, 1],
    ['prism_root_garden', 2292, 154, .75, .3, 1],
    ['prism_orchid_garden', 2314, 156, .70, 1.1, 1],
    ['prism_moon_garden', 2296, 162, .60, 0, 1],
    ['prism_moon_garden', 2305, 160.5, .55, 0, 1],
    ['prism_orchid_garden', 2307, 155, .65, 0, 1],
    ['prism_bank_garden', 2315, 135.65, 0.72, 1.5, 0],
  ] as const;

const BANK_BOUNDS = new Map<string | undefined, { minX: number; maxX: number; minZ: number; maxZ: number }>();
for (const [id, x, z] of FAIRY_VILLAGE_CRAGS) for (const key of [id, undefined]) {
  const old = BANK_BOUNDS.get(key);
  BANK_BOUNDS.set(key, { minX: Math.min(old?.minX ?? Infinity, x - 7), maxX: Math.max(old?.maxX ?? -Infinity, x + 7),
    minZ: Math.min(old?.minZ ?? Infinity, z - 7), maxZ: Math.max(old?.maxZ ?? -Infinity, z + 7) });
}
function outsideBank(x: number, z: number, bankId?: string): boolean {
  const rect = BANK_BOUNDS.get(bankId);
  return !rect || x < rect.minX || x > rect.maxX || z < rect.minZ || z > rect.maxZ;
}

export function sampleFairyVillageBank(x: number, z: number, bankId?: string): number {
  if (outsideBank(x, z, bankId)) return 0;
  let height = 0;
  for (const [id, cx, cz, scale, yaw, variant] of FAIRY_VILLAGE_CRAGS) {
    if (bankId && id !== bankId) continue;
    if (Math.abs(x - cx) > 6 || Math.abs(z - cz) > 6) continue;
    const dx = x - cx, dz = z - cz, c = Math.cos(yaw), s = Math.sin(yaw);
    const localX = (dx * c - dz * s) / scale, localZ = (dx * s + dz * c) / scale;
    const sample = sampleFairyBankHeight(variant === 0 ? 'fairy_rounded_bank_0' : 'fairy_rounded_bank_1', localX, localZ);
    if (sample !== null) height = Math.max(height, (sample - .08) * scale);
  }
  return Math.max(0, height);
}

/** Keep the one-metre terrain triangles inside the native rock silhouette. */
const UNDERLAY_EDGE: readonly (readonly [number, number])[] = Array.from({ length: 9 }, (_, x) =>
  Array.from({ length: 9 }, (_, z) => [(x - 4) * .4, (z - 4) * .4] as const)).flat();
export function sampleFairyVillageUnderlay(x: number, z: number, bankId?: string): number {
  const centre = sampleFairyVillageBank(x, z, bankId);
  if (centre <= 0) return 0;
  let lowest = centre;
  for (const [dx, dz] of UNDERLAY_EDGE) {
    lowest = Math.min(lowest, sampleFairyVillageBank(x + dx, z + dz, bankId));
    if (lowest <= 0) return 0;
  }
  return Math.max(0, lowest - .45);
}

/** Low earth shoulders join neighbouring crags and meet the cottage footing cuts. */
export function sampleFairyVillageEarth(x: number, z: number, bankId?: string): number {
  let height = 0;
  for (const [id, cx, cz, scale, yaw, variant] of FAIRY_VILLAGE_CRAGS) {
    if (bankId && id !== bankId) continue;
    const dx = x - cx, dz = z - cz;
    if (Math.abs(dx) > 7 || Math.abs(dz) > 7) continue;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const rx = (variant === 0 ? 3.426 : 3.556) * scale + 2.1;
    const rz = (variant === 0 ? 3.490 : 3.032) * scale + 2.1;
    const q = Math.hypot((dx * c - dz * s) / rx, (dx * s + dz * c) / rz);
    if (q >= 1) continue;
    const t = 1 - q;
    height = Math.max(height, Math.min(1.45, scale * 2) * t * t * (3 - 2 * t));
  }
  return height;
}
export function sampleFairyVillageTerrain(x: number, z: number, bankId?: string): number {
  if (outsideBank(x, z, bankId)) return 0;
  return Math.max(sampleFairyVillageUnderlay(x, z, bankId), sampleFairyVillageEarth(x, z, bankId));
}

const CRAG_BASES = new WeakMap<(x: number, z: number) => number, Map<number, number>>();
/** Seat the complete native body into the lowest receiving ground, including the valley-facing toe. */
export function fairyVillageCragBase(index: number, ground: (x: number, z: number) => number): number {
  const cache = CRAG_BASES.get(ground) ?? new Map<number, number>();
  CRAG_BASES.set(ground, cache);
  const cached = cache.get(index);
  if (cached !== undefined) return cached;
  const [, cx, cz, scale, yaw, variant] = FAIRY_VILLAGE_CRAGS[index]!;
  const halfX = (variant === 0 ? 3.426 : 3.556) * scale, halfZ = (variant === 0 ? 3.490 : 3.032) * scale;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let base = ground(cx, cz) - sampleFairyVillageTerrain(cx, cz);
  for (let ix = -8; ix <= 8; ix++) for (let iz = -8; iz <= 8; iz++) {
    const x = ix / 8 * halfX, z = iz / 8 * halfZ;
    base = Math.min(base, ground(cx + x * c + z * s, cz - x * s + z * c));
  }
  cache.set(index, base); return base;
}

/** Visible bank surface for planting; the hidden terrain is deliberately recessed. */
export function sampleFairyVillageSurface(x: number, z: number, ground: (x: number, z: number) => number): number {
  let top = ground(x, z);
  for (const [index, [, cx, cz, scale, yaw, variant]] of FAIRY_VILLAGE_CRAGS.entries()) {
    if (Math.abs(x - cx) > 6 || Math.abs(z - cz) > 6) continue;
    const c = Math.cos(yaw), s = Math.sin(yaw), dx = x - cx, dz = z - cz;
    const local = sampleFairyBankHeight(variant === 0 ? 'fairy_rounded_bank_0' : 'fairy_rounded_bank_1',
      (dx * c - dz * s) / scale, (dx * s + dz * c) / scale);
    if (local !== null) {
      const valley = fairyVillageCragBase(index, ground);
      top = Math.max(top, valley + (local - .08) * scale);
    }
  }
  return top;
}
