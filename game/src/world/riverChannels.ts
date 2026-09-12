import { lavaBedAt, lavaSections, sampleLavaChannel, type LavaChannel, type LavaSample } from '../content/wildernessLava.js';
import { organicRadiusScale, sampleOrganicContour, smoothNoise2D, type OrganicShapeSpec } from './organicFields.js';
import type { WaterBodySnapshot } from '../render/scene.js';

/** Fresh water uses the accepted continuous channel footprint, with explicit downhill beds. */
export interface RiverChannel extends LavaChannel {
  readonly bedHeights: readonly number[];
  /** Ocean owns the coplanar outlet beyond this free-surface elevation. */
  readonly oceanLevel?: number;
  /** A closed lake outline shared by the carve, water mesh, navigation and shore plants. */
  readonly lake?: { readonly centre: readonly [number, number]; readonly radius: number; readonly shape: OrganicShapeSpec };
}

export const RIVER_FILL_DEPTH = 2;
export const riverSections = lavaSections;
export function sampleRiverChannel(channel: RiverChannel, x: number, z: number): LavaSample {
  if (!channel.lake) return sampleLavaChannel(channel, x, z);
  const { centre, radius, shape } = channel.lake;
  const dx = x - centre[0], dz = z - centre[1];
  const distance = Math.hypot(dx, dz);
  const halfWidth = radius * organicRadiusScale(Math.atan2(dz, dx), shape);
  // Broad variation creates shallow beaches and firmer headlands without a cliff ring.
  const bankWidth = channel.bankWidth * (.85 + .25 * smoothNoise2D(x / 32, z / 32, channel.seed));
  return { channelId: channel.id, distance, signedDistance: distance - halfWidth,
    halfWidth, bankWidth, progress: 0, centreProgress: 0, centreDistance: distance, centre };
}
const channelBounds = new WeakMap<RiverChannel, readonly [number, number, number, number]>();
function inChannelBounds(channel: RiverChannel, x: number, z: number): boolean {
  let bounds = channelBounds.get(channel);
  if (!bounds) {
    if (channel.lake) {
      const { centre, radius } = channel.lake;
      const reach = radius + channel.bankWidth * 1.2 + 1;
      bounds = [centre[0] - reach, centre[0] + reach, centre[1] - reach, centre[1] + reach];
      channelBounds.set(channel, bounds);
      return x >= bounds[0] && x <= bounds[1] && z >= bounds[2] && z <= bounds[3];
    }
    const rows = riverSections(channel);
    const margin = Math.max(...rows.flatMap(row => [row.leftHalfWidth, row.rightHalfWidth])) + channel.bankWidth + 1;
    bounds = [Math.min(...rows.map(row => row.x)) - margin, Math.max(...rows.map(row => row.x)) + margin,
      Math.min(...rows.map(row => row.z)) - margin, Math.max(...rows.map(row => row.z)) + margin];
    channelBounds.set(channel, bounds);
  }
  return x >= bounds[0] && x <= bounds[1] && z >= bounds[2] && z <= bounds[3];
}
const smooth = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export function riverSurfaceHeight(channel: RiverChannel, progress: number): number {
  return lavaBedAt(channel, progress)! + RIVER_FILL_DEPTH;
}

/** The bed rises to exactly the same shoreline used by the ribbon and navigation masks. */
export function carveRiverTerrain(height: number, x: number, z: number, channels: readonly RiverChannel[]): number {
  let result = Infinity;
  for (const channel of channels) {
    if (!inChannelBounds(channel, x, z)) continue;
    const sample = sampleRiverChannel(channel, x, z);
    if (sample.signedDistance >= sample.bankWidth) continue;
    const bed = lavaBedAt(channel, sample.centreProgress)!;
    const shore = sample.centreDistance - sample.signedDistance;
    const cross = sample.centreDistance / Math.max(.001, shore);
    const target = bed + RIVER_FILL_DEPTH * smooth((cross - .55) / .45)
      // A low receiving meadow still needs a closed bank above the free surface.
      // The short crest survives terrain-lattice interpolation at the waterline.
      + .55 * smooth(Math.max(0, sample.signedDistance) / 2);
    const influence = 1 - smooth(Math.max(0, sample.signedDistance) / sample.bankWidth);
    const carved = height + (target - height) * influence;
    // Connected surfaces share a lowest-bed union, independent of channel ordering.
    result = Math.min(result, carved);
  }
  return Number.isFinite(result) ? result : height;
}

/** Short masks follow the descending free surface; elevated bridge decks remain dry geometry. */
export function riverWaterBodies(channels: readonly RiverChannel[]): WaterBodySnapshot[] {
  // Conservative capsule discs cover the same swept footprint as sampleLavaChannel. The dry
  // navigation clip still tests elevation, so dry banks and elevated bridge decks are retained.
  return channels.flatMap(channel => {
    if (channel.lake) {
      const { centre, radius, shape } = channel.lake;
      const level = riverSurfaceHeight(channel, 0);
      return [{ id: `lake:${channel.id}`, centre: [...centre] as [number, number], level,
        floorY: level - RIVER_FILL_DEPTH, depth: RIVER_FILL_DEPTH,
        radii: { floor: radius * .55, shore: radius, crest: radius + channel.bankWidth / 2, outer: radius + channel.bankWidth },
        contour: sampleOrganicContour(...centre, radius, shape, 192).map(p => [...p] as [number, number]), closed: true }];
    }
    const rows = riverSections(channel, 1.2);
    return rows.flatMap((row, index) => {
      const width = Math.max(row.leftHalfWidth, row.rightHalfWidth);
      if (width < .01) return [];
      const radius = width / Math.cos(Math.PI / 16) + .2;
      const level = Math.max(...rows.slice(Math.max(0,index-1),index+2).map(r => riverSurfaceHeight(channel,r.progress)));
      const floorY = level - RIVER_FILL_DEPTH;
      const contour: [number,number][] = Array.from({length:16},(_,i) => [row.x+Math.cos(i*Math.PI/8)*radius,row.z+Math.sin(i*Math.PI/8)*radius]);
      return [{id:`river:${channel.id}:${index}`,centre:[row.x,row.z] as [number,number],level,floorY,depth:RIVER_FILL_DEPTH,
        radii:{floor:width*.55,shore:width,crest:width+channel.bankWidth/2,outer:width+channel.bankWidth},contour,closed:true}];
    });
  });
}
