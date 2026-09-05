import type { Vec3 } from "../contracts.js";
import { worldSitePoint, type WorldSite } from "../content/worldSites.js";

interface FishingWaterBody {
  readonly id: string;
  readonly contour: readonly (readonly [number, number])[];
  readonly level: number;
}

const BANK_CLEARANCE = 3;
const BANK_DIRECTION_DISTANCE = 24;
const BANK_SEARCH_STEP = 0.5;
const MAX_BANK_SEARCH = 12;
const BANK_SEARCH_ANGLES = [0, 15, -15, 30, -30, 45, -45, 60, -60, 75, -75] as const;
const EPSILON = 1e-7;

/**
 * Resolves dry casting positions from the already solved water outlines. Fish entities keep
 * their underwater positions; these points give roads, navigation and interaction their bank.
 */
export function fishingAccessPositions(
  sites: readonly WorldSite[],
  bodies: readonly FishingWaterBody[],
  heightAt: (x: number, z: number) => number,
): Map<string, Vec3> {
  const positions = new Map<string, Vec3>();
  const fisheries = sites.filter((site) => site.kind === "fishery");
  if (fisheries.length === 0) return positions;
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
    const bodyId = site.resourceSlots[0]?.clusterId;
    const body = bodyId === undefined ? undefined : byId.get(bodyId);
    if (!body) throw new Error(`Fishery ${site.id} is missing solved water body ${bodyId ?? "for its resource slots"}`);

    const addPosition = (id: string, localX: number): void => {
      if (positions.has(id)) throw new Error(`Duplicate fishing access position ${id}`);
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

      const shoreX = site.centre[0] + direction[0] * shore;
      const shoreZ = site.centre[1] + direction[1] * shore;
      // Stay near this authored landing. A blocked ray can fan along the bank, but rotating
      // around the lake centre would jump to another shore. Every candidate is within 12 m
      // of the same solved exit and at least 3 m from every actual water contour.
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

    addPosition(site.locationId, 0);
    for (const slot of site.resourceSlots) addPosition(`${slot.clusterId}_${slot.index}`, slot.x);
  }
  return positions;
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
