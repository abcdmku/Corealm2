import { worldSitePoint, type WorldSite } from "../content/worldSites.js";

export interface WorldSiteHaulRamp {
  readonly startDistance: number;
  readonly endDistance: number;
  readonly halfWidth: number;
  readonly outerHalfWidth: number;
  readonly localEnd: readonly [number, number];
  readonly worldEnd: readonly [number, number];
}

interface MineShape {
  readonly site: WorldSite;
  readonly cos: number;
  readonly sin: number;
  readonly approachCos: number;
  readonly approachSin: number;
  readonly halfWorldX: number;
  readonly halfWorldZ: number;
  readonly seam: readonly { x: number; z: number }[];
  readonly ramp: WorldSiteHaulRamp;
}

// WorldSite data is immutable. Compile orientations and cheap world bounds once per authored list.
const shapesBySites = new WeakMap<readonly WorldSite[], readonly MineShape[]>();
const shapesBySite = new WeakMap<WorldSite, MineShape>();

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - from) / Math.max(0.001, to - from)));
  return t * t * (3 - 2 * t);
}

/** Integral of a smooth, mostly constant grade, with level transitions at both ends. */
function rampBlend(progress: number): number {
  const tail = 0.15;
  if (progress < tail) {
    const u = progress / tail;
    return tail * (u * u * u - 0.5 * u * u * u * u) / (1 - tail);
  }
  if (progress > 1 - tail) return 1 - rampBlend(1 - progress);
  return (progress - tail / 2) / (1 - tail);
}

/** One finite approach shared by the terrain cut, authored haul road and access diagnostics. */
export function worldSiteHaulRamp(site: WorldSite): WorldSiteHaulRamp {
  const { floorRadius, approachAngle } = site.terrain;
  if (site.kind !== "mine" || !(floorRadius > 0) || !Number.isFinite(approachAngle)) {
    throw new Error(`Haul ramp ${site.id} requires a mine floor and finite approach angle`);
  }
  const alongX = Math.sin(approachAngle), alongZ = Math.cos(approachAngle);
  const boundaryMargin = 2.4;
  const extentReach = Math.min(
    Math.abs(alongX) > 1e-9 ? (site.extent[0] - boundaryMargin) / Math.abs(alongX) : Infinity,
    Math.abs(alongZ) > 1e-9 ? (site.extent[1] - boundaryMargin) / Math.abs(alongZ) : Infinity,
  );
  const startDistance = Math.max(4, floorRadius * 0.3);
  const endDistance = Math.min(floorRadius + 5, extentReach);
  if (!Number.isFinite(endDistance) || endDistance <= startDistance) {
    throw new Error(`Haul ramp ${site.id} has no room inside its authored extent`);
  }
  const localEnd = [alongX * endDistance, alongZ * endDistance] as const;
  return {
    startDistance, endDistance, halfWidth: 2.8, outerHalfWidth: 4.8,
    localEnd, worldEnd: worldSitePoint(site, ...localEnd),
  };
}

function mineShape(site: WorldSite): MineShape {
  let shape = shapesBySite.get(site);
  if (shape) return shape;
  const cos = Math.cos(site.rotationY);
  const sin = Math.sin(site.rotationY);
  const seam = site.cutFace?.stations.map((station) => {
    const slot = site.resourceSlots.find((candidate) => candidate.clusterId === station.clusterId
      && candidate.index === station.index);
    if (!slot) throw new Error(`Mine terrain ${site.id} has no slot for ${station.clusterId}_${station.index}.`);
    return { x: slot.x, z: slot.z };
  }) ?? [];
  if (seam.length < 2) {
    const radius = site.terrain.floorRadius;
    seam.splice(0, seam.length, { x: -radius * 0.75, z: -radius * 0.65 },
      { x: radius * 0.75, z: -radius * 0.65 });
  }
  shape = {
    site, cos, sin, seam, ramp: worldSiteHaulRamp(site),
    approachCos: Math.cos(site.terrain.approachAngle),
    approachSin: Math.sin(site.terrain.approachAngle),
    halfWorldX: Math.abs(cos) * site.extent[0] + Math.abs(sin) * site.extent[1],
    halfWorldZ: Math.abs(sin) * site.extent[0] + Math.abs(cos) * site.extent[1],
  };
  shapesBySite.set(site, shape);
  return shape;
}

function cutSample(shape: MineShape, x: number, z: number) {
  const { site, cos, sin, seam } = shape;
  const dx = x - site.centre[0];
  const dz = z - site.centre[1];
  if (Math.abs(dx) >= shape.halfWorldX || Math.abs(dz) >= shape.halfWorldZ) return null;
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const marginX = site.extent[0] - Math.abs(localX);
  const marginZ = site.extent[1] - Math.abs(localZ);
  if (marginX <= 0 || marginZ <= 0) return null;
  let nearest = Infinity;
  let distance = 0;
  let beyondEnd = 0;
  for (let i = 0; i < seam.length - 1; i++) {
    const a = seam[i]!; const b = seam[i + 1]!;
    const sx = b.x - a.x; const sz = b.z - a.z;
    const lengthSquared = sx * sx + sz * sz;
    if (lengthSquared < 0.001) continue;
    const raw = ((localX - a.x) * sx + (localZ - a.z) * sz) / lengthSquared;
    const t = Math.max(0, Math.min(1, raw));
    const qx = localX - a.x - sx * t;
    const qz = localZ - a.z - sz * t;
    const squared = qx * qx + qz * qz;
    if (squared >= nearest) continue;
    nearest = squared;
    const length = Math.sqrt(lengthSquared);
    const signed = (qx * -sz + qz * sx) / length;
    distance = (i === 0 && raw < 0) || (i === seam.length - 2 && raw > 1)
      ? signed : Math.sign(signed) * Math.sqrt(squared);
    beyondEnd = i === 0 && raw < 0 ? -raw * length
      : i === seam.length - 2 && raw > 1 ? (raw - 1) * length : 0;
  }
  const across = localX * shape.approachCos - localZ * shape.approachSin;
  const along = localX * shape.approachSin + localZ * shape.approachCos;
  const { floorRadius, backDistance, bermWidth } = site.terrain;
  const boundary = smoothstep(0, 2.4, marginX) * smoothstep(0, 2.4, marginZ);
  // A 3.6 m rear buffer protects the ore footprint and surrounding 2 m lattice cells.
  // The whole seam shares this ledge; recesses in the plan no longer become dirt plinths.
  const ends = 1 - smoothstep(5, 8, beyondEnd);
  const front = 1 - smoothstep(5.4, Math.max(6.4, floorRadius + 1.5), distance);
  const rear = 1 - smoothstep(backDistance + bermWidth * 0.22, backDistance + bermWidth, -distance);
  const approach = (1 - smoothstep(2, 3.7, Math.abs(across)))
    * smoothstep(-2, 0, along) * (1 - smoothstep(floorRadius * 0.4, floorRadius, along));
  const haulMask = (1 - smoothstep(shape.ramp.halfWidth, shape.ramp.outerHalfWidth, Math.abs(across)))
    * smoothstep(-2, 0, along);
  const progress = Math.max(0, Math.min(1, (along - shape.ramp.startDistance)
    / (shape.ramp.endDistance - shape.ramp.startDistance)));
  // Fade the influence as well as its height offset, so overlapping cuts also join continuously.
  const haul = haulMask * boundary * (1 - rampBlend(progress));
  // Keep this lane clear of the old cut after its ramp rejoins the incoming terrain. Letting
  // cut authority return at the endpoint would restore a lip on the angled Upper Seam.
  const cutWeight = Math.max(ends * front * rear, approach) * boundary * (1 - haulMask);
  return { distance, along, boundary, ends, approach, haul, cutWeight,
    weight: cutWeight + haul };
}

/** Worn walking strip and haul approach in world coordinates; never paints the rear bank. */
export function worldSiteWorkFloorWeight(x: number, z: number, site: WorldSite): number {
  if (site.kind !== "mine" || site.terrain.floorRadius <= 0) return 0;
  const sample = cutSample(mineShape(site), x, z);
  if (!sample) return 0;
  const strip = smoothstep(-0.8, 0.35, sample.distance)
    * (1 - smoothstep(2.5, 4.9, sample.distance)) * sample.ends;
  return Math.max(strip, sample.approach * 0.82) * sample.boundary;
}

/**
 * Applies mine cuts to the shared heightfield. The natural callback reads regional relief;
 * the optional support callback reads terrain after flats but before site edits. This keeps
 * a mine beside a raised settlement connected to that settlement's approach. Neither callback
 * may sample site-edited terrain recursively. Run before roads and water basins.
 * Groves keep their natural ground and fisheries keep the existing water basin profile.
 */
export function applyWorldSiteTerrain(
  x: number,
  z: number,
  currentHeight: number,
  sites: readonly WorldSite[],
  heightAtNatural: (x: number, z: number) => number,
  heightAtSupport: (x: number, z: number) => number = heightAtNatural,
): number {
  let shapes = shapesBySites.get(sites);
  if (!shapes) {
    shapes = sites.filter((site) => site.kind === "mine" && site.terrain.floorRadius > 0).map(mineShape);
    shapesBySites.set(sites, shapes);
  }

  let weightedChange = 0;
  let totalWeight = 0;
  let strongestWeight = 0;
  for (const shape of shapes) {
    const { site } = shape;
    const sample = cutSample(shape, x, z);
    if (!sample || sample.weight === 0) continue;
    const { backRise, backDistance } = site.terrain;
    const { weight } = sample;
    const centreHeight = heightAtNatural(site.centre[0], site.centre[1]);
    const supportHeight = heightAtSupport === heightAtNatural ? centreHeight
      : heightAtSupport(site.centre[0], site.centre[1]);
    const floor = supportHeight - Math.min(2.3, Math.max(1.3, backRise * 0.35));
    // Two percent drainage grade toward the approach. Rear distance is measured from the
    // exposed seam, so curved returns and deep stations retain the same accessible footing.
    const back = smoothstep(3.6, Math.max(4.6, backDistance), -sample.distance);
    const regionalRelief = back > 0 ? Math.max(-0.6, Math.min(1.4, heightAtNatural(x, z) - centreHeight)) : 0;
    const floorPlane = floor - sample.along * 0.02;
    const target = floorPlane + backRise * back + regionalRelief * back * back * 0.35;
    const cutChange = (target - currentHeight) * sample.cutWeight;
    // The graded lane meets this point's incoming height, preserving its flats and regional
    // relief without sampling an edited-height callback recursively. Its smooth influence
    // spreads the climb across the lane and matches the floor and surrounding slopes.
    const rampChange = floorPlane - currentHeight;
    weightedChange += cutChange + rampChange * sample.haul;
    totalWeight += weight;
    strongestWeight = Math.max(strongestWeight, weight);
  }

  // If authored cuts overlap, average their target heights instead of excavating twice.
  return totalWeight === 0 ? currentHeight : currentHeight + weightedChange * strongestWeight / totalWeight;
}
