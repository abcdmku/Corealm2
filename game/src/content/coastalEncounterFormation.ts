import type { RegionId } from '../contracts.js';
import type { EnemyGroupDef, Spot } from './regions.js';
import type { HabitatDef } from './worldHabitats.js';
import { createEncounterFormation, encounterPopulationCount, EncounterFormationError,
  type EncounterFormation } from './encounterPopulation.js';
import { wildernessTierAt } from './wildernessDepth.js';

export interface CoastalEncounterSite {
  readonly id: string;
  readonly regionId: RegionId;
  readonly biomeId: RegionId;
  readonly spot: Spot;
}

/** The semantic Wilderness owns its depth progression even where the visual biome blends. */
export function coastalEncounterTier(regionId: RegionId, z: number, regionTier: number): number {
  return regionId === 'wilderness' ? wildernessTierAt(z) : regionTier;
}

export interface CoastalEncounterOptions {
  /** Actual animated horizontal envelope after the chosen tier's draw scale. */
  readonly bodyRadius: number;
  /** Tests the entire receiving circle, including water, slope and local solids. */
  readonly accepts: (point: Spot, bodyRadius: number) => boolean;
  /** Previously accepted authored or coastal formations, in stable generation order. */
  readonly reserved?: readonly Pick<EncounterFormation, 'group' | 'anchors' | 'bodyRadius'>[];
  readonly maxRadius?: number;
  readonly count?: number;
  readonly regionTier?: number;
  /** Minimum body-to-body gap between different packs. Within a pack the shared 0.5 m applies. */
  readonly packGap?: number;
}

export interface CoastalEncounterFormation extends EncounterFormation {
  readonly habitat: HabitatDef;
}

/**
 * Returns no pack when the whole requested population cannot fit. No partial formations escape,
 * and no global reservations change until the caller accepts and appends this result.
 */
export function createCoastalEncounterFormation(site: CoastalEncounterSite, source: EnemyGroupDef,
  options: CoastalEncounterOptions): CoastalEncounterFormation | null {
  if (source.boss || source.miniBoss) return null;
  const packGap = options.packGap ?? 2;
  if (!Number.isFinite(packGap) || packGap < .5) throw new Error(`${site.id}: coastal pack gap must be at least 0.5 m`);
  const maximum = options.maxRadius ?? Math.min(32, Math.max(10, options.bodyRadius * 7 + 1.5));
  const legacy: EnemyGroupDef = { ...source, id: site.id, centre: site.spot,
    tier: coastalEncounterTier(site.regionId, site.spot[1], options.regionTier ?? source.tier),
    count: 1, legacyCount: 1, radius: 0 };
  const count = options.count ?? (Number.isInteger(source.count) && source.count >= 7 && source.count <= 15
    ? source.count : encounterPopulationCount(legacy));
  // Only nearby packs can intersect this candidate. Inflate other actor circles to enforce
  // the inter-pack gap while retaining the shared formation helper's ordinary half-meter gap.
  const occupied = (options.reserved ?? []).filter(formation =>
    Math.hypot(formation.group.centre[0] - site.spot[0], formation.group.centre[1] - site.spot[1])
      <= maximum + formation.group.radius + packGap)
    .flatMap(formation => formation.anchors.map(position => ({ position,
      bodyRadius: formation.bodyRadius + packGap - .5 })));
  let formed: EncounterFormation;
  try {
    formed = createEncounterFormation(legacy, { bodyRadius: options.bodyRadius, count,
      maxRadius: maximum, occupied, accepts: options.accepts });
  } catch (error) {
    if (error instanceof EncounterFormationError) return null;
    throw error;
  }
  return { ...formed, habitat: { id: `${site.id}_habitat`, groupId: site.id, regionId: site.regionId,
    centre: formed.group.centre, radius: formed.group.radius, anchors: formed.anchors,
    activity: 'patrol', dressing: [], boundary: 'playable-coast' } };
}

/** Minimal shape shared with WorldScene.sampleWorld; this module has no render dependency. */
export interface CoastalGroundSample {
  readonly playable: boolean;
  readonly height: number;
  readonly slope: number | null;
  readonly waterBodyId: string | null;
  readonly coast: { readonly seaLevel: number } | null;
}

/**
 * Receiving-floor check for the production coast sampler. It samples the interior as well as the
 * circumference, so a wet or steep pocket between dry edges cannot accept a creature's body.
 * Local solid/terrain clearance can be composed with this predicate by the caller.
 */
export function coastalBodyOnSafeGround(sampleAt: (x: number, z: number) => CoastalGroundSample,
  point: Spot, bodyRadius: number, options: { readonly seaMargin?: number; readonly maxSlope?: number;
    readonly sampleSpacing?: number } = {}): boolean {
  if (!Number.isFinite(bodyRadius) || bodyRadius <= 0 || !point.every(Number.isFinite)) return false;
  const seaMargin = options.seaMargin ?? .5, maxSlope = options.maxSlope ?? .85;
  const spacing = options.sampleSpacing ?? .75;
  if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(seaMargin) || seaMargin < 0
    || !Number.isFinite(maxSlope) || maxSlope < 0) throw new Error('Invalid coastal receiving-floor limits');
  const safe = (x: number, z: number): boolean => {
    const sample = sampleAt(x, z);
    return sample.playable && sample.coast !== null && Number.isFinite(sample.coast.seaLevel) && sample.waterBodyId === null
      && Number.isFinite(sample.height) && sample.height >= sample.coast.seaLevel + seaMargin
      && sample.slope !== null && Number.isFinite(sample.slope) && sample.slope <= maxSlope;
  };
  if (!safe(point[0], point[1])) return false;
  const rings = Math.max(1, Math.ceil(bodyRadius / spacing));
  for (let ring = 1; ring <= rings; ring++) {
    const radius = bodyRadius * ring / rings;
    const points = Math.max(12, Math.ceil(Math.PI * 2 * radius / spacing));
    for (let index = 0; index < points; index++) {
      const angle = index / points * Math.PI * 2;
      if (!safe(point[0] + Math.cos(angle) * radius, point[1] + Math.sin(angle) * radius)) return false;
    }
  }
  return true;
}
