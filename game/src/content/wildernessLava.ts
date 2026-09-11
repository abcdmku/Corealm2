import { wildernessMagicAt } from './wildernessDepth.js';
import { smoothNoise2D } from '../world/organicFields.js';
import { rockMassHeight, type LavaRockMass } from '../world/lavaLandforms.js';
import { WILDERNESS_LAVA_LANDFORMS } from './wildernessLavaLandforms.js';

/** One centreline owns rendering, terrain carving, scatter clearance and navigation exclusion. */
export interface LavaChannel {
  readonly id: string;
  readonly points: readonly (readonly [number, number])[];
  readonly halfWidth: number;
  readonly depth: number;
  readonly bankWidth: number;
  readonly seed: number;
  /** Half-widths and bed elevations at the authored controls; shared by every consumer. */
  readonly widths?: readonly number[];
  readonly bedHeights?: readonly number[];
  readonly rugged?: boolean;
  readonly naturalBanks?: boolean;
  readonly rockMasses?: readonly LavaRockMass[];
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
  readonly leftHalfWidth: number;
  readonly rightHalfWidth: number;
}

/** One shore can be a short resistant cut while its opposite is a broad ash slope. */
export function lavaBankWidthAt(channel: LavaChannel, progress: number, side: number): number {
  if (!channel.naturalBanks) return channel.bankWidth;
  const [x, z] = pointAt(channel, progress);
  const field = smoothNoise2D(x / 17, z / 17, channel.seed + side * 71);
  return channel.bankWidth * (.62 + .28 * field);
}

const ORIGINAL_WILDERNESS_LAVA_CHANNELS: readonly LavaChannel[] = [{
  id: 'widows-furnace',
  points: [[224,700],[218,693],[207,688],[201,679],[191,675],[182,676],[171,670],[159,671],[151,679]],
  widths: [1,1.7,2.4,2,3.4,4.8,4.1,6.8,4],
  bedHeights: [7.5,7.3,7.05,6.8,6.55,6.35,6.15,5.95,5.8],
  halfWidth: 3.25,
  depth: 2.6,
  bankWidth: 8.5,
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
    halfWidth: 2.4, widths: [1.8, 2.2, 3.1, 3.7, 2.4], bedHeights: [-2.1, -2.3, -2.6, -2.8, -3],
    depth: 2.6, bankWidth: 6.5, seed: 11031, magic: 0, rugged: true, naturalBanks: true,
    rockMasses: [
      { id: 'lab-broken-wall', weathered: true, crown: 4.8, polygon: [[-20,-21],[-15,-25],[-8,-24],[-5,-20],[-7,-16],[-13,-17],[-17,-15],[-21,-17]] },
      { id: 'lab-downstream-spur', weathered: true, crown: 3.4, polygon: [[9,-20],[17,-22],[25,-19],[27,-15],[22,-12],[18,-16],[12,-15],[8,-17]] },
      { id: 'lab-low-bench', weathered: true, crown: 1.6, polygon: [[-16,-5],[-9,-7],[-3,-4],[-2,1],[-11,3],[-17,0]] },
    ] },
  { id: 'lab-cinder-tributary', points: [[1, -9], [3, -18], [-3, -24]],
    halfWidth: 1.7, depth: 2.6, bedHeights: [-2.6,-2.6,-2.6], bankWidth: 4.4, seed: 11032, openEnds: [true, true], magic: 0, rugged: true, naturalBanks: true },
  { id: 'lab-cinder-basin', points: [[-12, -25], [-4, -24], [4, -27]],
    halfWidth: 5.5, depth: 2.6, bedHeights: [-2.6,-2.6,-2.6], bankWidth: 4.4, seed: 11033, kind: 'pool', magic: 0, rugged: true, naturalBanks: true },
  { id: 'lab-nightglass-pool', points: [[16, -28], [24, -30], [31, -27]],
    halfWidth: 6.1, depth: 3, bedHeights: [-3,-3,-3], bankWidth: 4.8, seed: 11034, kind: 'pool', magic: 1, rugged: true, naturalBanks: true },
  { id: 'lab-bypass-trunk', points: [[42,-4],[43,-14],[50,-21],[59,-24]],
    halfWidth: 3, widths:[1.5,3.5,3,4.5], bedHeights:[-1.9,-2.2,-2.6,-2.9],
    depth:2.6, bankWidth:4, seed:11035, magic:0, rugged:true, naturalBanks:true },
  { id: 'lab-bypass-arm', points: [[43,-14],[51,-12],[59,-16],[59,-24]],
    halfWidth:1.5, widths:[1.4,1,1.6,2], bedHeights:[-2.2,-2.3,-2.6,-2.9],
    depth:2.6, bankWidth:3.5, seed:11036, openEnds:[true,true], magic:0, rugged:true, naturalBanks:true },
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
const AUTHORED_LAVA_EXPANSION_CHANNELS: readonly LavaChannel[] = [
  ...ORIGINAL_WILDERNESS_LAVA_CHANNELS,
  { id: 'widows-furnace-west-seep', points: [[197,649],[196,659],[190,666],[184,672],[181,676]],
    widths: [.65,1.1,1.5,1.9,2.5], bedHeights: [7.6,7.2,6.85,6.5,6.34],
    halfWidth: 1.65, depth: 2.6, bankWidth: 7, seed: 12001, openEnds: [false, true] },
  { id: 'chainfire-rill', points: [[-86,724],[-94,733],[-111,738],[-117,747],[-111,757],[-115,774],[-108,787],[-111,799],[-97,808],[-84,809]],
    widths: [1.6,2.1,3.7,4.2,2.4,2.9,3.8,3.1,6.2,5.8], bedHeights: [9,8.4,7.8,7.45,7.25,7,6.8,6.55,6.38,6.3],
    halfWidth: 2.6, depth: 2.7, bankWidth: 8, seed: 12010, openEnds: [true, true] },
  // A narrow overflow arm leaves and rejoins the trunk around an older rock island.
  { id: 'chainfire-fork', points: [[-114,743],[-110,747],[-105,755],[-108,765],[-114,770],[-115,774]],
    widths: [1.8,1.2,1.5,1.1,1.9,2.4], bedHeights: [7.58,7.48,7.3,7.12,7.03,7],
    halfWidth: 1.8, depth: 2.7, bankWidth: 6.5, seed: 12011, openEnds: [true, true] },
  { id: 'chainfire-basin', points: [[-78, 710], [-81, 718], [-86, 724], [-93, 731]],
    widths: [1.8, 3.1, 2.6, 2], bedHeights: [9.5, 9.25, 9, 8.55],
    halfWidth: 3.1, depth: 2.7, bankWidth: 8, seed: 12012, kind: 'pool' },
  { id: 'chainfire-nightfall-pool', points: [[-99, 801], [-87, 808], [-73, 809], [-65, 814]],
    widths: [4.2, 6.2, 7.1, 4], bedHeights: [6.5, 6.3, 6.15, 6.1],
    halfWidth: 6.2, depth: 2.7, bankWidth: 9, seed: 12013, kind: 'pool' },
  { id: 'veilburn-river', points: [[102,879],[93,870],[90,857],[82,849],[79,838],[67,832],[70,821],[80,812],[87,804],[87,793],[94,783],[95,772],[93,763],[101,750]],
    widths: [.8,1.3,1.7,2.8,3.8,2.1,2.8,4.7,4.1,3.2,4.9,6.8,4.2,5.8],
    bedHeights: [10.3,9.2,8.1,7.65,7.45,7.3,7.15,7,6.9,6.65,6.45,6.3,6.2,5.9],
    halfWidth: 3.1, depth: 3, bankWidth: 9, seed: 12020, openEnds: [false, true] },
  { id: 'veilburn-fork', points: [[48,827],[56,820],[68,820],[76,812],[80,812]],
    widths: [.6,1.1,1.4,2,2.6], bedHeights: [8.05,7.9,7.55,7.08,7],
    halfWidth: 1.85, depth: 3, bankWidth: 7.5, seed: 12021, openEnds: [false, true] },
  { id: 'veilburn-mouth', points: [[99, 756], [104, 746], [110, 737], [116, 729]],
    widths: [4.8, 6.3, 5.8, 2.8], bedHeights: [6, 5.85, 5.7, 5.65],
    halfWidth: 6.3, depth: 3, bankWidth: 8, seed: 12022, kind: 'pool' },
  { id: 'hollow-star-rift', points: [[-129,915],[-143,908],[-151,897],[-166,887],[-184,883],[-190,875],[-205,872],[-218,877]],
    widths: [1.6,2.3,2,3.8,2.6,5.1,7.4,4.5], bedHeights: [9.5,8.6,7.9,7.25,6.4,6.1,5.7,5.5],
    halfWidth: 2.7, depth: 2.8, bankWidth: 9, seed: 12030, openEnds: [true, false] },
  { id: 'hollow-star-fork', points: [[-179,915],[-173,909],[-171,900],[-175,891],[-184,883],[-188,879]],
    widths: [.7,1.1,1.4,1.2,2.3,2.5], bedHeights: [8.9,8.3,7.6,6.95,6.4,6.25],
    halfWidth: 1.7, depth: 2.8, bankWidth: 7, seed: 12031, openEnds: [false, true] },
  { id: 'hollow-star-eye', points: [[-119, 925], [-123, 920], [-129, 915], [-136, 909]],
    widths: [1.5, 3.1, 2.5, 2], bedHeights: [10.1, 9.8, 9.5, 8.95],
    halfWidth: 3.1, depth: 2.8, bankWidth: 8, seed: 12032, kind: 'pool' },
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

export const WILDERNESS_LAVA_EXPANSION_CHANNELS: readonly LavaChannel[] =
  AUTHORED_LAVA_EXPANSION_CHANNELS.map(channel => ({ ...channel, rugged: true, naturalBanks: true,
    rockMasses: WILDERNESS_LAVA_LANDFORMS[channel.id]?.map(mass => ({ ...mass, weathered: true })) }));

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

const lengthCache = new WeakMap<LavaChannel, number>();
function channelLength(channel: LavaChannel): number {
  let length = lengthCache.get(channel);
  if (length === undefined) {
    length = channel.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - channel.points[i]![0], p[1] - channel.points[i]![1]), 0);
    lengthCache.set(channel, length);
  }
  return length;
}

export function lavaWidthAt(channel: LavaChannel, progress: number, side = 0): number {
  const cap = channel.kind === 'pool' ? Math.sin(clamp01(progress) * Math.PI) ** .55
    : Math.min(channel.openEnds?.[0] ? 1 : smooth(0, .065, progress),
      channel.openEnds?.[1] ? 1 : smooth(0, .065, 1 - progress));
  if (channel.naturalBanks) {
    const [x,z] = pointAt(channel, progress);
    const width = profileAt(channel.widths, channel.halfWidth, progress) * cap;
    const edge = (s: number) => 1 + .14 * smoothNoise2D(x / 7, z / 7, channel.seed + s * 19)
      + .045 * smoothNoise2D(x / 1.3, z / 1.3, channel.seed + s * 39);
    return width * (side ? edge(side) : Math.max(edge(-1), edge(1)));
  }
  const irregular = channel.kind === 'pool'
    ? 1 + .13 * Math.sin(progress * 13 + channel.seed) + .1 * Math.sin(progress * 25 + channel.seed * .3)
    : 1 + .19 * Math.sin(progress * 9 + channel.seed) + .055 * Math.sin(progress * 27 + channel.seed * .3);
  const width = profileAt(channel.widths, channel.halfWidth, progress) * cap * irregular;
  if (!channel.rugged) return width;
  const along = progress * channelLength(channel);
  const brokenEdge = (edge: number): number => {
    const cell = along / 2.8, i = Math.floor(cell), t = cell - i;
    const a = smoothNoise2D(i, edge * 7, channel.seed);
    const b = smoothNoise2D(i + 1, edge * 7, channel.seed);
    return 1 + .18 * (a + (b - a) * t) + .1 * smoothNoise2D(along / 9, edge * 11, channel.seed + 91);
  };
  return width * (side ? brokenEdge(side) : Math.max(brokenEdge(-1), brokenEdge(1)));
}

function profileAt(values: readonly number[] | undefined, fallback: number, progress: number): number {
  if (!values?.length) return fallback;
  const scaled = clamp01(progress) * (values.length - 1);
  const i = Math.min(values.length - 1, Math.floor(scaled));
  const t = smooth(0, 1, scaled - i);
  return values[i]! + ((values[i + 1] ?? values[i]!) - values[i]!) * t;
}

export function lavaBedAt(channel: LavaChannel, progress: number): number | undefined {
  return channel.bedHeights ? profileAt(channel.bedHeights, 0, progress) : undefined;
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
      progress, distance, halfWidth: lavaWidthAt(channel, progress),
      leftHalfWidth: lavaWidthAt(channel, progress, -1), rightHalfWidth: lavaWidthAt(channel, progress, 1) });
    previous = [x, z];
  }
  return rows;
}

const sectionCache = new WeakMap<LavaChannel, readonly LavaSection[]>();
const boundsCache = new WeakMap<LavaChannel, { minX: number; maxX: number; minZ: number; maxZ: number }>();
function cachedSections(channel: LavaChannel): readonly LavaSection[] {
  let sections = sectionCache.get(channel);
  if (!sections) { sections = lavaSections(channel, channel.rugged ? .55 : 1.2); sectionCache.set(channel, sections); }
  return sections;
}

function boundsDistance(channel: LavaChannel, x: number, z: number): number {
  let bounds = boundsCache.get(channel);
  if (!bounds) {
    const sections = cachedSections(channel);
    const margin = Math.max(channel.halfWidth, ...channel.widths ?? []) * (channel.rugged ? 1.6 : 1.25) + channel.bankWidth + 1.2;
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
  readonly centreProgress: number;
  readonly centreDistance: number;
  readonly centre: readonly [number, number];
}

export function sampleLavaChannel(channel: LavaChannel, x: number, z: number): LavaSample {
  const sections = cachedSections(channel);
  let closest = Infinity;
  let nearestCentre = Infinity, centreProgress = 0;
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
    if (distance < nearestCentre) { nearestCentre = distance; centreProgress = progress; }
    const side = (x - cx) * -dz + (z - cz) * dx < 0 ? -1 : 1;
    const aw = side < 0 ? a.leftHalfWidth : a.rightHalfWidth;
    const bw = side < 0 ? b.leftHalfWidth : b.rightHalfWidth;
    const halfWidth = aw + (bw - aw) * t;
    if (distance - halfWidth >= closest) continue;
    closest = distance - halfWidth;
    result = { channelId: channel.id, distance, signedDistance: distance - halfWidth,
      halfWidth, bankWidth: lavaBankWidthAt(channel, progress, side), progress, centreProgress: 0, centreDistance: 0, centre: [cx, cz] };
  }
  return { ...result!, centreProgress, centreDistance: nearestCentre };
}

/** Apply to the shared terrain sampler before its lattice is built, never only to a render mesh. */
export function carveLavaTerrain(baseHeight: number, x: number, z: number,
  channels: readonly LavaChannel[] = WILDERNESS_LAVA_CHANNELS): number {
  for (const channel of channels) for (const mass of channel.rockMasses ?? []) {
    baseHeight = Math.max(baseHeight, rockMassHeight(baseHeight, x, z, mass));
  }
  let depth = 0;
  for (const channel of channels) {
    if (boundsDistance(channel, x, z) > 0) continue;
    const sample = sampleLavaChannel(channel, x, z);
    const bankT = clamp01(sample.signedDistance / sample.bankWidth);
    const bank = channel.naturalBanks ? 1 - smooth(0, 1, bankT)
      : channel.rugged
      ? 1 - (.5 * smooth(.01, .25, bankT) + .32 * smooth(.37, .62, bankT) + .18 * smooth(.76, 1, bankT))
      : 1 - smooth(0, 1, bankT);
    // The terminal basin remains cut below grade. Tapering its depth lifted the lava
    // into pointed horns and introduced discontinuous banks at pool medial seams.
    const bed = lavaBedAt(channel, sample.centreProgress);
    const wettedBed = bed === undefined ? undefined : bed + smooth(.55, 1,
      sample.centreDistance / Math.max(.05, sample.centreDistance - sample.signedDistance));
    depth = Math.max(depth, (wettedBed === undefined ? channel.depth : Math.max(0, baseHeight - wettedBed)) * bank);
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
