import type { RegionId, Vec3 } from "../contracts.js";
import type { RegionalPackAssembly } from "./regionalPackEntities.js";
import { habitatIdleTargets } from "./habitatMovement.js";

/** Supply the generated world's real terrain, solved water, solids and navigation queries.
 * This is an acceptance probe, never a replacement terrain or navigation implementation. */
export interface RegionalPackAuditPorts {
  sample(x: number, z: number): {
    regionId: RegionId | null;
    height: number;
    slopeDegrees: number;
    waterDepth: number;
  };
  /** Must test the whole body disc against trunks, walls and reserved interaction approaches. */
  clearance(x: number, z: number, radius: number): boolean;
  /** Return the unrounded production navmesh route, including its snapped destination. */
  path(from: Vec3, to: Vec3): readonly Vec3[] | null;
}

export interface RegionalPackAuditOptions {
  readonly sampleSpacing?: number;
  readonly maxSlopeDegrees?: number;
  /** Production navmesh endpoint tolerance. Debug display rounding must not change it. */
  readonly arrivalTolerance?: number;
  /** Supply the actual AI leash when auditing unrestricted combat pursuit. */
  readonly pursuitRadius?: number;
}

export interface RegionalPackAuditResult {
  readonly packId: string;
  readonly accepted: boolean;
  readonly sampledPoints: number;
  readonly checkedRoutes: number;
  readonly failures: readonly { kind: string; memberId: string; position: Vec3 }[];
}

/** Check body clearance along every possible idle leg and its return path. Patrol circuit
 * corners alone miss trunks in the middle of a leg. This also rejects nav routes that detour
 * outside the reserved habitat. A supplied pursuit radius samples each complete leash disc.
 * Sampling supplements browser travel proof; it cannot certify gaps smaller than its spacing. */
export function auditRegionalPack(
  assembly: RegionalPackAssembly, ports: RegionalPackAuditPorts,
  options: RegionalPackAuditOptions = {},
): RegionalPackAuditResult {
  const spacing = options.sampleSpacing ?? 0.75;
  const maxSlope = options.maxSlopeDegrees ?? 35;
  const tolerance = options.arrivalTolerance ?? 0.35;
  const pursuit = options.pursuitRadius ?? 0;
  if (![spacing, maxSlope, tolerance, pursuit].every(Number.isFinite)
    || spacing <= 0 || maxSlope < 0 || tolerance < 0 || pursuit < 0) {
    throw new Error("Invalid regional pack audit options");
  }
  let sampledPoints = 0, checkedRoutes = 0;
  const failures: { kind: string; memberId: string; position: Vec3 }[] = [];
  const habitat = assembly.habitat;
  const fail = (kind: string, memberId: string, position: Vec3): void => {
    // Keep reports bounded while still checking the entire scene.
    if (failures.length < 100) failures.push({ kind, memberId, position });
  };
  for (const entity of assembly.entities) {
    const radius = entity.combat?.bodyRadius;
    if (!radius || radius <= 0 || !Number.isFinite(radius)) {
      fail("missing-body-radius", entity.id, entity.position);
      continue;
    }
    const sample = (point: Vec3, contained: boolean): void => {
      sampledPoints++;
      if (!point.every(Number.isFinite)) { fail("invalid-position", entity.id, point); return; }
      if (contained && Math.hypot(point[0] - habitat.centre[0], point[2] - habitat.centre[1])
        + radius > habitat.radius + 1e-7) fail("habitat-envelope", entity.id, point);
      if (!ports.clearance(point[0], point[2], radius)) fail("blocked-body", entity.id, point);
      // Check the body perimeter too, since a dry centre can straddle a shore or region seam.
      const count = Math.max(12, Math.ceil(2 * Math.PI * radius / spacing));
      for (let i = -1; i < count; i++) {
        const x = point[0] + (i < 0 ? 0 : Math.cos(i * Math.PI * 2 / count) * radius);
        const z = point[2] + (i < 0 ? 0 : Math.sin(i * Math.PI * 2 / count) * radius);
        const surface = ports.sample(x, z);
        const at: Vec3 = [x, surface.height, z];
        if (![surface.height, surface.slopeDegrees, surface.waterDepth].every(Number.isFinite))
          fail("invalid-surface", entity.id, at);
        else {
          if (surface.regionId !== habitat.regionId) fail("region-seam", entity.id, at);
          if (surface.waterDepth > 0) fail("wet-body", entity.id, at);
          if (surface.slopeDegrees > maxSlope) fail("steep-ground", entity.id, at);
        }
      }
    };
    const targets = habitatIdleTargets(entity.id, entity.position, habitat).candidates.map(({ position }) => position);
    const stops = [entity.position, ...targets];
    sample(entity.position, true);
    for (let a = 0; a < stops.length; a++) for (let b = 0; b < stops.length; b++) {
      if (a === b) continue;
      const from = stops[a]!, to = stops[b]!;
      checkedRoutes++;
      const path = ports.path(from, to);
      const last = path?.at(-1);
      if (!path?.length || !last || !path.every((point) => point.every(Number.isFinite))
        || Math.hypot(last[0] - to[0], last[2] - to[2]) > tolerance) {
        fail("unreachable-arrival", entity.id, to); continue;
      }
      const legs = [from, ...path];
      for (let i = 1; i < legs.length; i++) {
        const start = legs[i - 1]!, end = legs[i]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(end[0] - start[0], end[2] - start[2]) / spacing));
        for (let step = 1; step <= steps; step++) {
          const t = step / steps;
          sample([start[0] + (end[0] - start[0]) * t,
            start[1] + (end[1] - start[1]) * t, start[2] + (end[2] - start[2]) * t], true);
        }
      }
    }
    if (pursuit > 0) {
      const rings = Math.ceil(pursuit / spacing);
      for (let ring = 0; ring <= rings; ring++) {
        const distance = pursuit * ring / rings;
        const count = Math.max(1, Math.ceil(Math.PI * 2 * distance / spacing));
        for (let i = 0; i < count; i++) sample([
          entity.position[0] + Math.cos(i * Math.PI * 2 / count) * distance,
          entity.position[1], entity.position[2] + Math.sin(i * Math.PI * 2 / count) * distance,
        ], false);
      }
    }
  }
  return { packId: assembly.packId, accepted: failures.length === 0, sampledPoints, checkedRoutes, failures };
}
