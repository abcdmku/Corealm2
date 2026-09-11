/** A shared, low-frequency warp for biome borders and other broad world features. */
export interface DomainWarpSpec {
  seed: number;
  /** Metres between broad bends in the warped field. */
  scale: number;
  /** Maximum displacement along either axis, in metres. */
  strength: number;
}

/** A repeatable radial shape that never grows past its authored radius. */
export interface OrganicShapeSpec {
  seed: number;
  /** Maximum fraction removed from the authored radius. */
  irregularity: number;
  /** Approximate number of broad bends around the contour. */
  lobes: number;
  /** Minor-to-major axis ratio. Values below 1 elongate without exceeding the authored radius. */
  aspectRatio?: number;
  /** Major-axis rotation in radians. */
  rotation?: number;
}

/** An authored place that must keep the named visual biome around it. */
export interface OrganicBiomeAnchor {
  id: string;
  centre: readonly [number, number];
  radius: number;
  /** Relative pull inside the intent. Defaults to 1. */
  strength?: number;
  /** Radius of the guaranteed core. Defaults to one fifth of the broader pull radius. */
  holdRadius?: number;
}

/** A soft authored connection between two biome intents. Corridors guide but never pin a winner. */
export interface OrganicBiomeCorridor {
  from: readonly [number, number];
  to: readonly [number, number];
  halfWidth: number;
  strength?: number;
}

/** Two broad deterministic climate channels sampled at the given metre scales. */
export interface OrganicClimateSpec {
  seed: number;
  scales: readonly [number, number];
  strength: number;
}

export interface OrganicBiomeFieldSpec<T extends string = string> {
  id: T;
  seed: number;
  climateTarget: readonly [number, number];
  climateTolerance: readonly [number, number];
  bias?: number;
  /** A geographical climate trend, sampled in the shared warped domain. It has no rectangular edge. */
  northwardClimate?: { startZ: number; endZ: number; strength: number };
  anchors: readonly OrganicBiomeAnchor[];
  corridors?: readonly OrganicBiomeCorridor[];
}

/**
 * A complete visual partition. Authored intents hold important places while broad climate fields
 * decide the open land between them. Every sample returns normalized weights with no gaps.
 */
export interface OrganicBiomeSpec<T extends string = string> {
  warp: DomainWarpSpec;
  climate: OrganicClimateSpec;
  /** Metres between local bends in otherwise broad climate borders. */
  edgeScale: number;
  /** Additive strength of each biome's local edge noise. */
  edgeStrength: number;
  /** Softmax temperature. Lower values tighten biome transitions. */
  temperature: number;
  fields: readonly OrganicBiomeFieldSpec<T>[];
}

export interface OrganicBiomeWeight<T extends string = string> {
  id: T;
  weight: number;
  score: number;
}

/** The shape-only part of the render coast spec. */
export interface OrganicCoastShapeSpec {
  seed: number;
  /** Narrow guaranteed collar, then the furthest permitted reach from the gameplay rectangle. */
  shoreline: readonly [number, number];
}

export interface OrganicBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface OrganicCoastSample {
  boundaryX: number;
  boundaryZ: number;
  /** Ordinary distance outside the canonical gameplay bounds. */
  outsideDistance: number;
  /** Distance left before the organic land field reaches its zero contour. */
  remaining: number;
  /** Full descent distance along this sample's path away from gameplay. */
  shorelineWidth: number;
  /** Distance from the gameplay edge to the end of the natural-land plateau, in metres. */
  shelfWidth: number;
  /** Smooth 0..1 descent from the shelf edge to the organic zero contour. */
  descent: number;
  land: boolean;
}

/** Stable FNV-1a seed for authored ids and labels. */
export function seedFromText(text: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

function hash01(seed: number, x: number, z: number): number {
  let hash = (seed ^ Math.imul(x, 0x1f12_3bb5) ^ Math.imul(z, 0x5f35_6495)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0_aaad) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x735a_2d97) >>> 0;
  return ((hash ^ (hash >>> 15)) >>> 0) / 0x1_0000_0000;
}

function fade(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/**
 * Smooth value noise in the -1..1 range.
 *
 * Coordinates are in noise cells. Divide world coordinates by the desired feature width before
 * calling this. Quintic interpolation keeps the first derivative quiet at cell boundaries, which
 * matters when the value controls a visible shoreline width.
 */
export function smoothNoise2D(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const tz = fade(z - z0);
  const north = lerp(hash01(seed, x0, z0), hash01(seed, x0 + 1, z0), tx);
  const south = lerp(hash01(seed, x0, z0 + 1), hash01(seed, x0 + 1, z0 + 1), tx);
  return lerp(north, south, tz) * 2 - 1;
}

/** Apply the same deterministic two-axis warp anywhere a broad border is sampled. */
export function warpPoint(x: number, z: number, spec: DomainWarpSpec): readonly [number, number] {
  const scale = Math.max(0.000_001, Math.abs(spec.scale));
  const sampleX = x / scale;
  const sampleZ = z / scale;
  const offsetX = smoothNoise2D(sampleX + 19.17, sampleZ - 43.91, spec.seed ^ 0x68bc_21eb);
  const offsetZ = smoothNoise2D(sampleX - 71.63, sampleZ + 7.41, spec.seed ^ 0x02e5_be93);
  return [x + offsetX * spec.strength, z + offsetZ * spec.strength];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function phase(seed: number, salt: number): number {
  return hash01(seed, salt, -salt) * Math.PI * 2;
}

function distanceSquaredToSegment(
  x: number,
  z: number,
  from: readonly [number, number],
  to: readonly [number, number],
): number {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-12) return (x - from[0]) ** 2 + (z - from[1]) ** 2;
  const along = clamp01(((x - from[0]) * dx + (z - from[1]) * dz) / lengthSquared);
  const offsetX = x - (from[0] + dx * along);
  const offsetZ = z - (from[1] + dz * along);
  return offsetX * offsetX + offsetZ * offsetZ;
}

function boundedPull(distance: number, radius: number, strength: number): number {
  const safeRadius = Math.max(0.000_001, Math.abs(radius));
  const safeStrength = Math.max(0, Number.isFinite(strength) ? strength : 1);
  if (safeStrength === 0) return -1;
  if (distance >= safeRadius) return -1;
  const amount = smoothstep01(1 - distance / safeRadius);
  return -1 + (safeStrength + 1) * amount;
}

function climateChannel(
  x: number,
  z: number,
  scales: readonly [number, number],
  seed: number,
): number {
  const broadScale = Math.max(0.000_001, Math.abs(scales[0]));
  const detailScale = Math.max(0.000_001, Math.abs(scales[1]));
  const broadX = x * 0.866_025_4 - z * 0.5;
  const broadZ = x * 0.5 + z * 0.866_025_4;
  const detailX = x * 0.798_635_5 + z * 0.601_815;
  const detailZ = -x * 0.601_815 + z * 0.798_635_5;
  const broad = smoothNoise2D(broadX / broadScale, broadZ / broadScale, seed);
  const detail = smoothNoise2D(
    detailX / detailScale + 37.17,
    detailZ / detailScale - 19.41,
    seed ^ 0x9e37_79b9,
  );
  return Math.max(-1, Math.min(1, broad * 0.78 + detail * 0.22));
}

function stableSoftmax(logits: readonly number[], temperature: number): number[] {
  const safeTemperature = Math.max(0.000_001, Math.abs(temperature));
  let maximum = -Infinity;
  for (const logit of logits) maximum = Math.max(maximum, logit / safeTemperature);
  const values = logits.map((logit) => Math.exp(Math.max(-80, Math.min(0, logit / safeTemperature - maximum))));
  const sum = values.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum) || sum <= 0) {
    return values.map((_, index) => index === 0 ? 1 : 0);
  }
  return values.map((value) => value / sum);
}

/** Sample deterministic visual biomes without consulting the semantic region rectangles. */
export function sampleOrganicBiomeWeights<T extends string>(
  x: number,
  z: number,
  spec: OrganicBiomeSpec<T>,
): readonly OrganicBiomeWeight<T>[] {
  if (spec.fields.length === 0) return [];

  const [warpedX, warpedZ] = warpPoint(x, z, spec.warp);
  const firstClimate = climateChannel(
    warpedX,
    warpedZ,
    spec.climate.scales,
    spec.climate.seed ^ 0x68bc_21eb,
  );
  const secondClimate = climateChannel(
    warpedX + 83.31,
    warpedZ - 47.93,
    spec.climate.scales,
    spec.climate.seed ^ 0x02e5_be93,
  );
  const edgeScale = Math.max(0.000_001, Math.abs(spec.edgeScale));
  const climateStrength = Math.max(0, Number.isFinite(spec.climate.strength) ? spec.climate.strength : 0);
  const edgeStrength = Math.max(0, Number.isFinite(spec.edgeStrength) ? spec.edgeStrength : 0);
  const holds: number[] = [];
  const logits = spec.fields.map((field) => {
    let spatial = -1;
    let hold = 0;
    for (const anchor of field.anchors) {
      const offsetX = x - anchor.centre[0];
      const offsetZ = z - anchor.centre[1];
      const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
      const requestedStrength = anchor.strength ?? 1;
      const strength = Math.max(0, Number.isFinite(requestedStrength) ? requestedStrength : 1);
      const radius = Math.max(
        0.000_001,
        Number.isFinite(anchor.radius) ? Math.abs(anchor.radius) : 0,
      );
      if (distanceSquared > radius * radius) continue;
      const distance = Math.sqrt(distanceSquared);
      if (strength > 0) spatial = Math.max(spatial, boundedPull(distance, radius, strength));
      const requestedHoldRadius = anchor.holdRadius ?? radius * 0.2;
      const finiteHoldRadius = Number.isFinite(requestedHoldRadius)
        ? Math.abs(requestedHoldRadius)
        : radius * 0.2;
      // Leave a finite fade band even when malformed authoring puts the core at or beyond the
      // broader pull radius. This keeps the mask continuous for every finite sample coordinate.
      const holdRadius = Math.min(finiteHoldRadius, Math.max(0, radius - 0.000_001));
      const anchorHold = distance <= holdRadius
        ? 1
        : smoothstep01((radius - distance) / Math.max(0.000_001, radius - holdRadius));
      hold = Math.max(hold, anchorHold);
    }
    for (const corridor of field.corridors ?? []) {
      const strength = Math.max(0, corridor.strength ?? 0.7);
      if (strength === 0) continue;
      const halfWidth = Math.max(0.000_001, Math.abs(corridor.halfWidth));
      const distanceSquared = distanceSquaredToSegment(x, z, corridor.from, corridor.to);
      if (distanceSquared > halfWidth * halfWidth) continue;
      spatial = Math.max(
        spatial,
        boundedPull(Math.sqrt(distanceSquared), halfWidth, strength),
      );
    }
    holds.push(hold);

    const toleranceA = Math.max(0.000_001, Math.abs(field.climateTolerance[0]));
    const toleranceB = Math.max(0.000_001, Math.abs(field.climateTolerance[1]));
    const climateDistance = (
      ((firstClimate - field.climateTarget[0]) / toleranceA) ** 2
      + ((secondClimate - field.climateTarget[1]) / toleranceB) ** 2
    );
    const affinity = -Math.min(4, Math.max(0, climateDistance));
    const edgeX = warpedX * 0.866_025_4 - warpedZ * 0.5;
    const edgeZ = warpedX * 0.5 + warpedZ * 0.866_025_4;
    const edgeBroad = smoothNoise2D(
      edgeX / edgeScale + phase(field.seed, 11),
      edgeZ / edgeScale + phase(field.seed, 17),
      field.seed ^ 0x4f1b_35a7,
    );
    const edgeDetail = smoothNoise2D(
      (warpedX * 0.601_815 + warpedZ * 0.798_635_5) / (edgeScale * 0.46) + phase(field.seed, 23),
      (-warpedX * 0.798_635_5 + warpedZ * 0.601_815) / (edgeScale * 0.46) + phase(field.seed, 29),
      field.seed ^ 0x7a4f_9c15,
    );
    const edge = edgeBroad * 0.74 + edgeDetail * 0.26;
    const north = field.northwardClimate;
    const latitude = north ? fade(Math.max(0, Math.min(1,
      (warpedZ - north.startZ) / Math.max(1, north.endZ - north.startZ)))) : .5;
    const geography = north ? (latitude - .5) * north.strength : 0;
    const logit = spatial + climateStrength * affinity + edgeStrength * edge + (field.bias ?? 0) + geography;
    return Number.isFinite(logit) ? logit : -4;
  });

  const weights = stableSoftmax(logits, spec.temperature);
  // A full core suppresses another field's fading skirt. The product keeps that suppression
  // continuous just outside the core instead of switching to a coordinate-specific winner.
  let heldWeights = holds.map((hold, index) => {
    let exclusive = hold;
    for (let other = 0; other < holds.length; other += 1) {
      if (other !== index) exclusive *= 1 - holds[other]!;
    }
    return exclusive;
  });
  let holdSum = heldWeights.reduce((total, hold) => total + hold, 0);
  if (holdSum <= 0) {
    heldWeights = holds;
    holdSum = holds.reduce((total, hold) => total + hold, 0);
  }
  const blend = smoothstep01(Math.max(...holds));
  if (holdSum > 0 && blend > 0) {
    for (let index = 0; index < weights.length; index += 1) {
      const heldWeight = heldWeights[index]! / holdSum;
      weights[index] = weights[index]! + (heldWeight - weights[index]!) * blend;
    }
  }

  const weightSum = weights.reduce((total, weight) => total + weight, 0);
  return spec.fields.map((field, index) => ({
    id: field.id,
    score: logits[index]!,
    weight: Number.isFinite(weightSum) && weightSum > 0 ? Math.max(0, weights[index]! / weightSum) : (index === 0 ? 1 : 0),
  }));
}

const COAST_REACH_BANDS = [
  { cells: 3, weight: 0.22, salt: 0x51ed_270b },
  { cells: 7, weight: 0.24, salt: 0x2f6e_2b1d },
  { cells: 15, weight: 0.22, salt: 0x7a4f_9c15 },
  { cells: 31, weight: 0.20, salt: 0x36d8_f3ab },
  { cells: 63, weight: 0.12, salt: 0x68bc_21eb },
] as const;

const COAST_DETAIL_BANDS = [
  { cells: 63, metres: 8, salt: 0x1357_9bdf },
  { cells: 127, metres: 3, salt: 0x02e5_be93 },
  { cells: 255, metres: 1.5, salt: 0x9e37_79b9 },
] as const;

const COAST_REACH_GAIN = 5;
const COAST_JOIN_BRIDGE_METRES = 12;
const COAST_SHORE_BAND_METRES = 36;

interface CoastPerimeterSample {
  turn: number;
  joinTurn: number;
  joinDistance: number;
  bridgeMetres: number;
}

/** Quintic value noise whose first and last cells meet on the same closed turn. */
function periodicQuinticNoise1D(turn: number, cells: number, seed: number): number {
  const wrapped = turn - Math.floor(turn);
  const position = wrapped * cells;
  const lower = Math.floor(position);
  const upper = (lower + 1) % cells;
  const amount = fade(position - lower);
  // Adjacent hash differences sum to zero around the closed band. This stops a three-cell octave
  // whose hashes happen to share a sign from biasing the entire coast toward land or water.
  const lowerValue = hash01(seed, lower, cells) - hash01(seed, upper, cells);
  const upperValue = hash01(seed, upper, cells) - hash01(seed, (upper + 1) % cells, cells);
  return lerp(lowerValue, upperValue, amount);
}

function periodicFractalCoastNoise(turn: number, seed: number): number {
  let noise = 0;
  for (const band of COAST_REACH_BANDS) {
    noise += band.weight * periodicQuinticNoise1D(turn, band.cells, seed ^ band.salt);
  }
  return noise;
}

/** Suppress radial slope at a rectangle join, then meet the untouched field with matching slope. */
function joinSafeCoastNoise(
  sample: CoastPerimeterSample,
  noiseAt: (turn: number) => number,
): number {
  const raw = noiseAt(sample.turn);
  if (sample.joinDistance >= sample.bridgeMetres) return raw;
  const atJoin = noiseAt(sample.joinTurn);
  const amount = fade(sample.joinDistance / sample.bridgeMetres);
  return lerp(atJoin, raw, amount);
}

function shapeCoastNoise(raw: number): number {
  return Math.atan(raw * COAST_REACH_GAIN) / Math.atan(COAST_REACH_GAIN);
}

function joinSafeFractalCoastNoise(sample: CoastPerimeterSample, seed: number): number {
  return joinSafeCoastNoise(
    sample,
    (turn) => periodicFractalCoastNoise(turn, seed),
  );
}

function detailedCoastOffset(sample: CoastPerimeterSample, seed: number): number {
  let offset = 0;
  for (const band of COAST_DETAIL_BANDS) {
    offset += band.metres * joinSafeCoastNoise(
      sample,
      (turn) => periodicQuinticNoise1D(turn, band.cells, seed ^ band.salt),
    );
  }
  return offset;
}

/**
 * A continuous turn around a rounded reference offset of the gameplay rectangle.
 *
 * The four side strips and four corner quadrants cover every point outside the rectangle. The turn
 * stays fixed while a point moves away from its nearest boundary point. A positive reach at every
 * turn therefore gives the implicit field `outsideDistance - reach(turn)` one closed shoreline,
 * with one crossing per outward path and no detached land.
 */
function sampleCoastPerimeter(
  x: number,
  z: number,
  bounds: OrganicBounds,
  referenceRadius: number,
): CoastPerimeterSample {
  const width = Math.max(0, bounds.maxX - bounds.minX);
  const depth = Math.max(0, bounds.maxZ - bounds.minZ);
  const quarterArc = Math.PI * referenceRadius / 2;
  const perimeter = 2 * (width + depth) + 4 * quarterArc;
  let distance = 0;
  let segmentStart = 0;
  let segmentLength = width;

  if (z >= bounds.maxZ && x >= bounds.minX && x <= bounds.maxX) {
    distance = x - bounds.minX;
  } else if (x > bounds.maxX && z > bounds.maxZ) {
    segmentStart = width;
    segmentLength = quarterArc;
    distance = width + referenceRadius * (
      Math.PI / 2 - Math.atan2(z - bounds.maxZ, x - bounds.maxX)
    );
  } else if (x >= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ) {
    segmentStart = width + quarterArc;
    segmentLength = depth;
    distance = width + quarterArc + bounds.maxZ - z;
  } else if (x > bounds.maxX && z < bounds.minZ) {
    segmentStart = width + quarterArc + depth;
    segmentLength = quarterArc;
    distance = width + quarterArc + depth
      + referenceRadius * Math.atan2(bounds.minZ - z, x - bounds.maxX);
  } else if (z <= bounds.minZ && x >= bounds.minX && x <= bounds.maxX) {
    segmentStart = width + 2 * quarterArc + depth;
    segmentLength = width;
    distance = width + 2 * quarterArc + depth + bounds.maxX - x;
  } else if (x < bounds.minX && z < bounds.minZ) {
    segmentStart = 2 * width + 2 * quarterArc + depth;
    segmentLength = quarterArc;
    distance = 2 * width + 2 * quarterArc + depth
      + referenceRadius * Math.atan2(bounds.minX - x, bounds.minZ - z);
  } else if (x <= bounds.minX && z >= bounds.minZ && z <= bounds.maxZ) {
    segmentStart = 2 * width + 3 * quarterArc + depth;
    segmentLength = depth;
    distance = 2 * width + 3 * quarterArc + depth + z - bounds.minZ;
  } else if (x < bounds.minX && z > bounds.maxZ) {
    segmentStart = 2 * width + 3 * quarterArc + 2 * depth;
    segmentLength = quarterArc;
    distance = 2 * width + 3 * quarterArc + 2 * depth
      + referenceRadius * Math.atan2(z - bounds.maxZ, bounds.minX - x);
  }

  const progress = Math.max(0, Math.min(segmentLength, distance - segmentStart));
  const nearestStart = progress <= segmentLength / 2;
  const joinDistance = nearestStart ? progress : segmentLength - progress;
  const joinPosition = nearestStart ? segmentStart : segmentStart + segmentLength;
  const safePerimeter = Math.max(0.000_001, perimeter);
  return {
    turn: distance / safePerimeter,
    joinTurn: (joinPosition % safePerimeter) / safePerimeter,
    joinDistance,
    // Small authored fixtures can have corner arcs shorter than 24 m. Keep their bridges apart.
    bridgeMetres: Math.max(
      0.000_001,
      Math.min(COAST_JOIN_BRIDGE_METRES, segmentLength * 0.45),
    ),
  };
}

function fractalCoastReach(
  perimeter: CoastPerimeterSample,
  seed: number,
  minimumReach: number,
  maximumReach: number,
): number {
  const middleReach = (minimumReach + maximumReach) / 2;
  const reachRange = (maximumReach - minimumReach) / 2;
  const broadReach = shapeCoastNoise(joinSafeFractalCoastNoise(perimeter, seed));
  const reach = middleReach + reachRange * broadReach
    + detailedCoastOffset(perimeter, seed);
  return Math.max(minimumReach, Math.min(maximumReach, reach));
}

/**
 * Sample the same render-only coast field used by the scene and the SVG preview.
 *
 * The gameplay rectangle stays dry. Outside it, one periodic multi-scale reach field cuts broad
 * headlands, coves, and smaller notches into a single implicit shoreline.
 */
export function sampleOrganicCoast(
  x: number,
  z: number,
  bounds: OrganicBounds,
  spec: OrganicCoastShapeSpec,
): OrganicCoastSample {
  const boundaryX = Math.max(bounds.minX, Math.min(bounds.maxX, x));
  const boundaryZ = Math.max(bounds.minZ, Math.min(bounds.maxZ, z));
  const outsideDistance = Math.hypot(x - boundaryX, z - boundaryZ);
  const minimumReach = Math.max(0.001, Math.min(spec.shoreline[0], spec.shoreline[1]));
  const maximumReach = Math.max(minimumReach, Math.max(spec.shoreline[0], spec.shoreline[1]));
  const perimeter = sampleCoastPerimeter(
    x,
    z,
    bounds,
    (minimumReach + maximumReach) / 2,
  );
  const reach = fractalCoastReach(
    perimeter,
    spec.seed,
    minimumReach,
    maximumReach,
  );
  const remaining = Math.max(0, reach - outsideDistance);
  const shorelineWidth = Math.max(0.001, outsideDistance + remaining);
  // A fixed-width band follows the reach field without copying its small notches into the shelf.
  const shelfWidth = Math.max(0, shorelineWidth - COAST_SHORE_BAND_METRES);
  const descent = smoothstep01(
    (outsideDistance - shelfWidth) / Math.max(0.001, shorelineWidth - shelfWidth),
  );
  const playable = x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
  return {
    boundaryX,
    boundaryZ,
    outsideDistance,
    remaining,
    shorelineWidth,
    shelfWidth,
    descent,
    land: playable || remaining > 0,
  };
}

/** Radius multiplier for an angle in radians. The result is always greater than zero and at most 1. */
export function organicRadiusScale(angle: number, shape: OrganicShapeSpec): number {
  const irregularity = Math.min(0.95, clamp01(shape.irregularity));
  const aspectRatio = Math.max(0.05, Math.min(1, Math.abs(shape.aspectRatio ?? 1)));
  const rotation = shape.rotation ?? 0;
  const relativeAngle = angle - (Number.isFinite(rotation) ? rotation : 0);
  const cosine = Math.cos(relativeAngle);
  const sine = Math.sin(relativeAngle);
  // This is the polar radius of an ellipse whose major radius is 1. It can only shrink the
  // authored circle, and rotating it does not change that bound.
  const ellipseScale = aspectRatio / Math.hypot(aspectRatio * cosine, sine);
  if (irregularity === 0) return ellipseScale;

  const lobes = Math.max(1, Math.round(Math.abs(shape.lobes)));
  const wave = Math.max(-1, Math.min(1, (
    Math.sin(relativeAngle * lobes + phase(shape.seed, 1)) * 0.54
    + Math.sin(relativeAngle * Math.max(2, lobes - 2) + phase(shape.seed, 2)) * 0.18
    + Math.sin(relativeAngle + phase(shape.seed, 3)) * 0.28
  )));
  const removed = irregularity * (wave * 0.5 + 0.5);
  return Math.max(0.05, ellipseScale * (1 - removed));
}

/**
 * Effective radius for a local x/z offset.
 *
 * Compare this value with a nominal radius. Since the shape scale cannot exceed 1, the accepted
 * contour can shrink inside that radius but cannot leak beyond it.
 */
export function organicDistance(localX: number, localZ: number, shape: OrganicShapeSpec): number {
  const radius = Math.hypot(localX, localZ);
  if (radius === 0) return 0;
  return radius / organicRadiusScale(Math.atan2(localZ, localX), shape);
}

/** Sample an open contour. Consumers close the final point back to the first. */
export function sampleOrganicContour(
  centreX: number,
  centreZ: number,
  nominalRadius: number,
  shape: OrganicShapeSpec,
  segments = 64,
): readonly (readonly [number, number])[] {
  const count = Math.max(3, Math.floor(segments));
  const radius = Math.max(0, nominalRadius);
  return Array.from({ length: count }, (_, index) => {
    const angle = index / count * Math.PI * 2;
    const shapedRadius = radius * organicRadiusScale(angle, shape);
    return [
      centreX + Math.cos(angle) * shapedRadius,
      centreZ + Math.sin(angle) * shapedRadius,
    ] as const;
  });
}
