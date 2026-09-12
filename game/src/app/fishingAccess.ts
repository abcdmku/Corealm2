import type { Vec3 } from "../contracts.js";
import { worldSitePoint, type WorldSite } from "../content/worldSites.js";
import { SCHOOL_MIN_WATER_DEPTH } from "../world/waterBodies.js";

interface FishingWaterBody {
  readonly centre?: readonly [number, number];
  readonly id: string;
  readonly contour: readonly (readonly [number, number])[];
  readonly level: number;
}

/**
 * Metres of dry bank between a casting stance and the waterline.
 *
 * It stays at 3 rather than hugging the water, and that is a movement constraint, not a look one:
 * `INTERACT_RANGE` is 2.4 m and a solved water surface is still walkable ground, so any smaller
 * clearance lets a player who stopped short of the anchor stand in the pond. The distance the
 * player actually sees closed is the one to the SCHOOL, which now sits just inside the waterline.
 */
const BANK_CLEARANCE = 3;
const BANK_DIRECTION_DISTANCE = 24;
const BANK_SEARCH_STEP = 0.5;
const MAX_BANK_SEARCH = 12;
const BANK_SEARCH_ANGLES = [0, 15, -15, 30, -30, 45, -45, 60, -60, 75, -75] as const;

/** Metres of water kept between a school and the waterline, so the ripple is not half beached. */
const SCHOOL_SHORE_INSET = 1;
/** How far inward the depth search may retreat before a shoreline is declared unfishable. */
const MAX_SCHOOL_INSET = 14;
const SCHOOL_SEARCH_STEP = 0.25;
const EPSILON = 1e-7;

/**
 * Where a fishery's schools sit and where the player stands to fish them.
 *
 * Both are solved from the same outward ray, so every school lies directly in front of its own
 * casting stance. They used to be independent: the bank came off the ray through local
 * (`slot.x`, 24) while the school kept its authored local (`slot.x`, `slot.z`) near the basin
 * centre. At Redsill that put 14.3 m of open water between the two, which is what made fishing
 * look like the player was casting at the far side of the pond.
 */
export interface FishingAnchors {
  /** Dry casting stances, keyed by `locationId` and by `${clusterId}_${index}`. */
  readonly banks: ReadonlyMap<string, Vec3>;
  /** School positions on the solved water plane, keyed by `${clusterId}_${index}`. */
  readonly schools: ReadonlyMap<string, Vec3>;
}

/**
 * Resolves dry casting positions from the already solved water outlines. These points give roads,
 * navigation and interaction their bank; `fishingSiteAnchors` also returns the schools they face.
 */
export function fishingAccessPositions(
  sites: readonly WorldSite[],
  bodies: readonly FishingWaterBody[],
  heightAt: (x: number, z: number) => number,
): Map<string, Vec3> {
  return fishingSiteAnchors(sites, bodies, heightAt).banks as Map<string, Vec3>;
}

/** Bank stances and the schools in front of them, from one pass over the solved water bodies. */
export function fishingSiteAnchors(
  sites: readonly WorldSite[],
  bodies: readonly FishingWaterBody[],
  heightAt: (x: number, z: number) => number,
): FishingAnchors {
  const positions = new Map<string, Vec3>();
  const schools = new Map<string, Vec3>();
  const fisheries = sites.filter((site) => site.kind === "fishery");
  if (fisheries.length === 0) return { banks: positions, schools };
  const byId = new Map<string, FishingWaterBody>();
  for (const body of bodies) {
    if (byId.has(body.id)) throw new Error(`Duplicate fishing water body ${body.id}`);
    if (!Number.isFinite(body.level) || body.contour.length < 3
      || body.contour.some(([x, z]) => !Number.isFinite(x) || !Number.isFinite(z))) {
      throw new Error(`Fishing water body ${body.id} has no valid solved contour`);
    }
    byId.set(body.id, body);
  }

  for (const site of fisheries) {
    const bodyId = site.waterBodyId ?? site.resourceSlots[0]?.clusterId;
    const body = bodyId === undefined ? undefined : byId.get(bodyId)
      ?? (bodyId.startsWith('river:') ? bodies.filter(candidate => candidate.id.startsWith(bodyId))
        .sort((a, b) => Math.hypot((a.centre?.[0] ?? 0) - site.centre[0], (a.centre?.[1] ?? 0) - site.centre[1])
          - Math.hypot((b.centre?.[0] ?? 0) - site.centre[0], (b.centre?.[1] ?? 0) - site.centre[1]))[0] : undefined);
    if (!body) throw new Error(`Fishery ${site.id} is missing solved water body ${bodyId ?? "for its resource slots"}`);

    /** The outward ray a stance and its school share, and where it leaves the water. */
    const shorelineExit = (id: string, localX: number): {
      direction: readonly [number, number]; shoreX: number; shoreZ: number;
    } => {
      const target = worldSitePoint(site, localX, BANK_DIRECTION_DISTANCE);
      const dx = target[0] - site.centre[0];
      const dz = target[1] - site.centre[1];
      const length = Math.hypot(dx, dz);
      if (!Number.isFinite(length) || length <= EPSILON) {
        throw new Error(`Fishery ${site.id} has no finite bank direction for ${id}`);
      }
      const direction: readonly [number, number] = [dx / length, dz / length];
      const shore = finalRayIntersection(site.centre, direction, body.contour);
      if (shore === null) throw new Error(`Fishery ${site.id} bank ray for ${id} misses solved water body ${body.id}`);
      return {
        direction,
        shoreX: site.centre[0] + direction[0] * shore,
        shoreZ: site.centre[1] + direction[1] * shore,
      };
    };

    const addPosition = (id: string, localX: number): void => {
      if (positions.has(id)) throw new Error(`Duplicate fishing access position ${id}`);
      const { direction, shoreX, shoreZ } = shorelineExit(id, localX);
      // Stay near this authored landing. A blocked ray can fan along the bank, but rotating
      // around the lake centre would jump to another shore. Every candidate is within 12 m
      // of the same solved exit and clear of every actual water contour.
      for (const degrees of BANK_SEARCH_ANGLES) {
        const radians = degrees * Math.PI / 180;
        const fanX = direction[0] * Math.cos(radians) - direction[1] * Math.sin(radians);
        const fanZ = direction[0] * Math.sin(radians) + direction[1] * Math.cos(radians);
        for (let extra = BANK_CLEARANCE; extra <= MAX_BANK_SEARCH; extra += BANK_SEARCH_STEP) {
          const x = shoreX + fanX * extra;
          const z = shoreZ + fanZ * extra;
          if (bodies.some((candidate) => insideContour(x, z, candidate.contour)
            || contourDistance(x, z, candidate.contour) < BANK_CLEARANCE - EPSILON)) continue;
          const height = heightAt(x, z);
          // Closed mountain basins can have dry slopes below the lake plane outside their
          // raised rim. Containment determines wetness; terrain supplies the standing height.
          if (!Number.isFinite(height)) continue;
          positions.set(id, [x, height, z]);
          return;
        }
      }
      throw new Error(`Fishery ${site.id} has no dry bank for ${id} within ${MAX_BANK_SEARCH} m of its solved shoreline`);
    };

    /**
     * Walks back along the same ray from the waterline until the bed is far enough under the
     * water plane to hide a fish, and stops at the FIRST such point. Depth, not an authored
     * radius, is what decides how far offshore a school ends up, so a wide shallow shelf pushes
     * one out and a steep bank keeps it at the player's feet.
     */
    const addSchool = (id: string, localX: number): void => {
      const { direction, shoreX, shoreZ } = shorelineExit(id, localX);
      for (let inset = SCHOOL_SHORE_INSET; inset <= MAX_SCHOOL_INSET; inset += SCHOOL_SEARCH_STEP) {
        const x = shoreX - direction[0] * inset;
        const z = shoreZ - direction[1] * inset;
        if (!insideContour(x, z, body.contour)
          || contourDistance(x, z, body.contour) < SCHOOL_SHORE_INSET - EPSILON) continue;
        const bed = heightAt(x, z);
        if (!Number.isFinite(bed) || body.level - bed < SCHOOL_MIN_WATER_DEPTH) continue;
        // The school renders on the solved water plane; `EntityViews` sinks it by the authored
        // water offset. Sampling the bed here would hang it below its own ripple.
        schools.set(id, [x, body.level, z]);
        return;
      }
      throw new Error(
        `Fishery ${site.id} has no water ${SCHOOL_MIN_WATER_DEPTH} m deep for ${id} `
        + `within ${MAX_SCHOOL_INSET} m of its solved shoreline`,
      );
    };

    addPosition(site.locationId, 0);
    for (const slot of site.resourceSlots) {
      const id = `${slot.clusterId}_${slot.index}`;
      addPosition(id, slot.x);
      addSchool(id, slot.x);
    }
  }
  return { banks: positions, schools };
}

/** The last forward crossing stays outside lobes farther along a concave polygon's ray. */
function finalRayIntersection(
  origin: readonly [number, number],
  direction: readonly [number, number],
  contour: readonly (readonly [number, number])[],
): number | null {
  let farthest: number | null = null;
  for (let index = 0; index < contour.length; index++) {
    const start = contour[index]!;
    const end = contour[(index + 1) % contour.length]!;
    const edgeX = end[0] - start[0];
    const edgeZ = end[1] - start[1];
    const offsetX = start[0] - origin[0];
    const offsetZ = start[1] - origin[1];
    const denominator = direction[0] * edgeZ - direction[1] * edgeX;
    if (Math.abs(denominator) <= EPSILON) {
      // A ray along a contour edge still exits at that edge's farther endpoint.
      if (Math.abs(offsetX * direction[1] - offsetZ * direction[0]) > EPSILON) continue;
      for (const point of [start, end]) {
        const distance = (point[0] - origin[0]) * direction[0] + (point[1] - origin[1]) * direction[1];
        if (distance >= -EPSILON) farthest = Math.max(farthest ?? 0, distance);
      }
      continue;
    }
    const distance = (offsetX * edgeZ - offsetZ * edgeX) / denominator;
    const alongEdge = (offsetX * direction[1] - offsetZ * direction[0]) / denominator;
    if (distance < -EPSILON || alongEdge < -EPSILON || alongEdge > 1 + EPSILON) continue;
    farthest = Math.max(farthest ?? 0, distance);
  }
  return farthest;
}

function insideContour(x: number, z: number, contour: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let index = 0, previous = contour.length - 1; index < contour.length; previous = index++) {
    const a = contour[index]!;
    const b = contour[previous]!;
    if ((a[1] > z) !== (b[1] > z)
      && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function contourDistance(x: number, z: number, contour: readonly (readonly [number, number])[]): number {
  let nearest = Infinity;
  for (let index = 0; index < contour.length; index++) {
    const a = contour[index]!;
    const b = contour[(index + 1) % contour.length]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const lengthSquared = dx * dx + dz * dz;
    const fraction = lengthSquared > 0
      ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSquared)) : 0;
    nearest = Math.min(nearest, Math.hypot(x - a[0] - fraction * dx, z - a[1] - fraction * dz));
  }
  return nearest;
}
