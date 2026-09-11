import { wildernessMagicAt } from './wildernessDepth.js';

/** One centreline owns rendering, terrain carving, scatter clearance and navigation exclusion. */
export interface LavaChannel {
  readonly id: string;
  readonly points: readonly (readonly [number, number])[];
  readonly halfWidth: number;
  readonly depth: number;
  readonly bankWidth: number;
  readonly seed: number;
  /** Pools are short broad spines with rounded, lobed shores, not decorative discs. */
  readonly kind?: 'flow' | 'pool';
  /** A connected end stays open beneath the adjoining flow instead of tapering to dry ground. */
  readonly openEnds?: readonly [boolean, boolean];
  /** Fixture override. Authored world channels always sample the continuous depth field. */
  readonly magic?: number;
}

export interface LavaSection {
  readonly x: number;
  readonly z: number;
  readonly tx: number;
  readonly tz: number;
  readonly progress: number;
  readonly distance: number;
  readonly halfWidth: number;
}

const ORIGINAL_WILDERNESS_LAVA_CHANNELS: readonly LavaChannel[] = [{
  id: 'widows-furnace',
  points: [[127, 656], [144, 652], [162, 655], [180, 664], [199, 672], [218, 676], [234, 690]],
  halfWidth: 3.25,
  depth: 2.6,
  bankWidth: 4.4,
  seed: 7301,
}];

/** A short section of the same authored channel, translated into the compact lab yard. */
export const WILDERNESS_LAVA_LAB_CHANNELS: readonly LavaChannel[] = [{
  id: 'lab-widows-furnace',
  points: [[-20, -7], [-9, -11], [4, -6], [18, -9]],
  halfWidth: 3.25,
  depth: 2.6,
  bankWidth: 4.4,
  seed: 7301,
}];

/** Isolated production fixture. Root accepts its forks, basin and palette before world registration. */
export const DEEP_WILDERNESS_LAVA_LAB_CHANNELS: readonly LavaChannel[] = [
  { id: 'lab-cinder-fork', points: [[-22, -11], [-10, -13], [1, -9], [13, -13], [24, -10]],
    halfWidth: 2.4, depth: 2.6, bankWidth: 4.4, seed: 11031, magic: 0 },
  { id: 'lab-cinder-tributary', points: [[1, -9], [3, -18], [-3, -24]],
    halfWidth: 1.7, depth: 2.6, bankWidth: 4.4, seed: 11032, openEnds: [true, true], magic: 0 },
  { id: 'lab-cinder-basin', points: [[-12, -25], [-4, -24], [4, -27]],
    halfWidth: 5.5, depth: 2.6, bankWidth: 4.4, seed: 11033, kind: 'pool', magic: 0 },
  { id: 'lab-nightglass-pool', points: [[16, -28], [24, -30], [31, -27]],
    halfWidth: 6.1, depth: 3, bankWidth: 4.8, seed: 11034, kind: 'pool', magic: 1 },
];

const seededUnit = (seed: number): number => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

/** Stable scatter within authored dry pockets. Adding a pool cannot move any existing one. */
function scatteredPool(id: string, centre: readonly [number, number], seed: number): LavaChannel {
  const angle = seededUnit(seed + 1) * Math.PI;
  const length = 6.5 + seededUnit(seed + 2) * 2.5;
  const dx = Math.cos(angle) * length, dz = Math.sin(angle) * length;
  const x = centre[0] + (seededUnit(seed + 3) - .5) * 3;
  const z = centre[1] + (seededUnit(seed + 4) - .5) * 3;
  const bend = (seededUnit(seed + 5) - .5) * 1.5;
  return { id, kind: 'pool', points: [[x - dx, z - dz], [x - Math.sin(angle) * bend, z + Math.cos(angle) * bend],
    [x + dx, z + dz]], halfWidth: 3.8 + seededUnit(seed + 6) * 2.2,
    depth: 2.6, bankWidth: 4.2, seed };
}

/** Lab-accepted molten surfaces, banks and effects, composed across both northern depth bands. */
export const WILDERNESS_LAVA_EXPANSION_CHANNELS: readonly LavaChannel[] = [
  ...ORIGINAL_WILDERNESS_LAVA_CHANNELS,
  { id: 'widows-furnace-west-seep', points: [[162, 655], [161, 666], [149, 678]],
    halfWidth: 1.65, depth: 2.6, bankWidth: 4.4, seed: 12001, openEnds: [true, false] },
  { id: 'chainfire-rill', points: [[-133, 708], [-119, 731], [-106, 748], [-102, 769], [-96, 793], [-88, 815]],
    halfWidth: 2.6, depth: 2.7, bankWidth: 4.5, seed: 12010 },
  { id: 'chainfire-fork', points: [[-106, 748], [-94, 739], [-79, 735]],
    halfWidth: 1.8, depth: 2.7, bankWidth: 4.5, seed: 12011, openEnds: [true, false] },
  { id: 'chainfire-basin', points: [[-140, 707], [-133, 708], [-124, 706]],
    halfWidth: 5.1, depth: 2.7, bankWidth: 4.5, seed: 12012, kind: 'pool' },
  { id: 'chainfire-nightfall-pool', points: [[-96, 816], [-88, 815], [-79, 819]],
    halfWidth: 5.8, depth: 2.7, bankWidth: 4.5, seed: 12013, kind: 'pool' },
  { id: 'veilburn-river', points: [[75, 735], [77, 755], [81, 778], [92, 802], [105, 827], [108, 852], [93, 879]],
    halfWidth: 3.1, depth: 3.0, bankWidth: 4.8, seed: 12020 },
  { id: 'veilburn-fork', points: [[81, 778], [66, 770], [47, 765]],
    halfWidth: 1.85, depth: 3.0, bankWidth: 4.8, seed: 12021, openEnds: [true, false] },
  { id: 'veilburn-mouth', points: [[84, 881], [93, 879], [104, 883]],
    halfWidth: 6.3, depth: 3.0, bankWidth: 4.8, seed: 12022, kind: 'pool' },
  { id: 'hollow-star-rift', points: [[-212, 883], [-190, 895], [-170, 902], [-149, 906], [-129, 911]],
    halfWidth: 2.7, depth: 2.8, bankWidth: 4.7, seed: 12030 },
  { id: 'hollow-star-fork', points: [[-190, 895], [-202, 908], [-202, 920]],
    halfWidth: 1.7, depth: 2.8, bankWidth: 4.7, seed: 12031, openEnds: [true, false] },
  { id: 'hollow-star-eye', points: [[-137, 910], [-129, 911], [-122, 916]],
    halfWidth: 5.5, depth: 2.8, bankWidth: 4.7, seed: 12032, kind: 'pool' },
  scatteredPool('nameless-cinder-pool', [-166, 539], 12101),
  scatteredPool('black-keep-seep', [-5, 635], 12102),
  scatteredPool('widows-ember-pool', [112, 681], 12103),
  scatteredPool('empty-sluice-pool', [205, 588], 12104),
  scatteredPool('western-nightglass-pool', [-322, 766], 12105),
  scatteredPool('forgotten-star-pool', [-244, 799], 12106),
  scatteredPool('eastern-twilight-pool', [210, 723], 12107),
  scatteredPool('moonvein-seep', [313, 830], 12108),
  scatteredPool('nightforge-overflow', [191, 915], 12109),
];

/** Terrain, rendering, scatter and navigation share this exact active channel set. */
export const WILDERNESS_LAVA_CHANNELS = WILDERNESS_LAVA_EXPANSION_CHANNELS;

export function lavaMagicAt(channel: LavaChannel, x: number, z: number): number {
  return channel.magic === undefined ? wildernessMagicAt(x, z) : Math.max(0, Math.min(1, channel.magic));
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const smooth = (a: number, b: number, value: number): number => {
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function pointAt(channel: LavaChannel, progress: number): readonly [number, number] {
  if (channel.points.length < 2) throw new Error(`Lava channel ${channel.id} requires two points`);
  const scaled = clamp01(progress) * (channel.points.length - 1);
  const i = Math.min(channel.points.length - 2, Math.floor(scaled));
  const t = scaled - i;
  const p0 = channel.points[Math.max(0, i - 1)]!;
  const p1 = channel.points[i]!;
  const p2 = channel.points[i + 1]!;
  const p3 = channel.points[Math.min(channel.points.length - 1, i + 2)]!;
  const interpolate = (axis: 0 | 1): number => .5 * ((2 * p1[axis])
    + (-p0[axis] + p2[axis]) * t
    + (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t * t
    + (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t * t * t);
  return [interpolate(0), interpolate(1)];
}

export function lavaWidthAt(channel: LavaChannel, progress: number): number {
  const cap = channel.kind === 'pool' ? Math.sin(clamp01(progress) * Math.PI) ** .55
    : Math.min(channel.openEnds?.[0] ? 1 : smooth(0, .065, progress),
      channel.openEnds?.[1] ? 1 : smooth(0, .065, 1 - progress));
  const irregular = channel.kind === 'pool'
    ? 1 + .13 * Math.sin(progress * 13 + channel.seed) + .1 * Math.sin(progress * 25 + channel.seed * .3)
    : 1 + .19 * Math.sin(progress * 9 + channel.seed) + .055 * Math.sin(progress * 27 + channel.seed * .3);
  return channel.halfWidth * cap * irregular;
}

export function lavaSections(channel: LavaChannel, maxSpacing = 1.2): readonly LavaSection[] {
  const polyLength = channel.points.slice(1).reduce((sum, p, i) =>
    sum + Math.hypot(p[0] - channel.points[i]![0], p[1] - channel.points[i]![1]), 0);
  const steps = Math.max(12, Math.ceil(polyLength / Math.max(.3, maxSpacing)));
  const rows: LavaSection[] = [];
  let distance = 0;
  let previous = pointAt(channel, 0);
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    const [x, z] = pointAt(channel, progress);
    const a = pointAt(channel, Math.max(0, progress - .001));
    const b = pointAt(channel, Math.min(1, progress + .001));
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    distance += Math.hypot(x - previous[0], z - previous[1]);
    rows.push({ x, z, tx: (b[0] - a[0]) / length, tz: (b[1] - a[1]) / length,
      progress, distance, halfWidth: lavaWidthAt(channel, progress) });
    previous = [x, z];
  }
  return rows;
}

const sectionCache = new WeakMap<LavaChannel, readonly LavaSection[]>();
const boundsCache = new WeakMap<LavaChannel, { minX: number; maxX: number; minZ: number; maxZ: number }>();
function cachedSections(channel: LavaChannel): readonly LavaSection[] {
  let sections = sectionCache.get(channel);
  if (!sections) { sections = lavaSections(channel); sectionCache.set(channel, sections); }
  return sections;
}

function boundsDistance(channel: LavaChannel, x: number, z: number): number {
  let bounds = boundsCache.get(channel);
  if (!bounds) {
    const sections = cachedSections(channel);
    const margin = channel.halfWidth * 1.24 + channel.bankWidth + 1.2;
    bounds = { minX: Math.min(...sections.map(row => row.x)) - margin,
      maxX: Math.max(...sections.map(row => row.x)) + margin,
      minZ: Math.min(...sections.map(row => row.z)) - margin,
      maxZ: Math.max(...sections.map(row => row.z)) + margin };
    boundsCache.set(channel, bounds);
  }
  return Math.hypot(Math.max(bounds.minX - x, 0, x - bounds.maxX),
    Math.max(bounds.minZ - z, 0, z - bounds.maxZ));
}

export interface LavaSample {
  readonly channelId: string;
  readonly distance: number;
  readonly signedDistance: number;
  readonly halfWidth: number;
  readonly bankWidth: number;
  readonly progress: number;
  readonly centre: readonly [number, number];
}

export function sampleLavaChannel(channel: LavaChannel, x: number, z: number): LavaSample {
  const sections = cachedSections(channel);
  let closest = Infinity;
  let result: LavaSample | undefined;
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1]!;
    const b = sections[i]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = clamp01(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1));
    const cx = a.x + dx * t;
    const cz = a.z + dz * t;
    const distance = Math.hypot(x - cx, z - cz);
    const progress = a.progress + (b.progress - a.progress) * t;
    const halfWidth = lavaWidthAt(channel, progress);
    if (distance - halfWidth >= closest) continue;
    closest = distance - halfWidth;
    result = { channelId: channel.id, distance, signedDistance: distance - halfWidth,
      halfWidth, bankWidth: channel.bankWidth, progress, centre: [cx, cz] };
  }
  return result!;
}

/** Apply to the shared terrain sampler before its lattice is built, never only to a render mesh. */
export function carveLavaTerrain(baseHeight: number, x: number, z: number,
  channels: readonly LavaChannel[] = WILDERNESS_LAVA_CHANNELS): number {
  let depth = 0;
  for (const channel of channels) {
    if (boundsDistance(channel, x, z) > 0) continue;
    const sample = sampleLavaChannel(channel, x, z);
    const bank = 1 - smooth(0, channel.bankWidth, sample.signedDistance);
    // The terminal basin remains cut below grade. Tapering its depth lifted the lava
    // into pointed horns and introduced discontinuous banks at pool medial seams.
    depth = Math.max(depth, channel.depth * bank);
  }
  return baseHeight - depth;
}

/** Capsules exclude molten ground; dry bank paths can pass outside radius + actor clearance. */
export function lavaCollisionSegments(channel: LavaChannel): readonly {
  from: readonly [number, number]; to: readonly [number, number]; radius: number;
}[] {
  const sections = lavaSections(channel, 2.2);
  return sections.slice(1).map((b, index) => {
    const a = sections[index]!;
    return { from: [a.x, a.z] as const, to: [b.x, b.z] as const,
      radius: Math.max(a.halfWidth, b.halfWidth) + .4 };
  });
}

export function lavaClearanceAt(x: number, z: number,
  channels: readonly LavaChannel[] = WILDERNESS_LAVA_CHANNELS): number {
  return Math.min(...channels.map(channel => {
    // Outside the cached footprint this conservative positive clearance avoids all segment work.
    const outside = boundsDistance(channel, x, z);
    if (outside > 0) return outside;
    const sample = sampleLavaChannel(channel, x, z);
    return sample.signedDistance - channel.bankWidth;
  }));
}

/** The visible molten union, excluding the dry bank. Used to keep fork mouths free of bank rock. */
export function isMoltenLavaAt(x: number, z: number, channels: readonly LavaChannel[], margin = 0): boolean {
  return channels.some(channel => boundsDistance(channel, x, z) <= Math.max(0, margin)
    && sampleLavaChannel(channel, x, z).signedDistance <= margin);
}

/** Signed molten distance for clipping bank triangles at a joined channel's actual shore. */
export function lavaSurfaceClearanceAt(x: number, z: number, channels: readonly LavaChannel[]): number {
  return Math.min(...channels.map(channel => {
    const outside = boundsDistance(channel, x, z);
    return outside > 0 ? outside + channel.bankWidth + 1.2 : sampleLavaChannel(channel, x, z).signedDistance;
  }));
}
